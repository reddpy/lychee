import type { SerializedEditorState } from "lexical"
import { createHeadlessEditor } from "@lexical/headless"
import { CONTENT_SCHEMA_VERSION } from "@/shared/documents"
import { KNOWN_NODE_TYPES, nodes } from "@/components/editor/nodes"
import { UNKNOWN_NODE_TYPE } from "@/components/editor/nodes/unknown-node"
import { $importDocumentMarkdown } from "@/components/editor/markdown-io"

export type ContentLoadResult =
  | { status: "empty" }
  | {
      status: "ready"
      editorState: SerializedEditorState
      /** Original types of any nodes preserved as UnknownNode placeholders. */
      preservedUnknownTypes: string[]
      /** True when the note was written by a build with a newer content schema. */
      schemaAhead: boolean
    }
  | { status: "error"; reason: string }

/**
 * Convert consecutive flat "list-item" nodes (from old flat-list format) into
 * nested "list" > "listitem" structure that Lexical's built-in @lexical/list
 * expects. Already-nested "list" nodes pass through unchanged.
 */
function nestFlatListItems(
  flatItems: any[],
  listType: string,
  knownTypes: ReadonlySet<string>,
): any {
  const tag = listType === "number" ? "ol" : "ul"
  const root: any = {
    type: "list",
    listType,
    tag,
    start: 1,
    direction: null,
    format: "",
    version: 1,
    children: [],
  }

  let i = 0
  while (i < flatItems.length) {
    const item = flatItems[i]
    const indent = item.indent ?? 0

    const nestedItems: any[] = []
    let j = i + 1
    while (j < flatItems.length && (flatItems[j].indent ?? 0) > indent) {
      nestedItems.push(flatItems[j])
      j++
    }

    const listitem: any = {
      type: "listitem",
      value: root.children.length + 1,
      checked: item.checked ?? false,
      direction: item.direction ?? null,
      format: item.format ?? "",
      version: 1,
      children: migrateChildren(item.children || [], knownTypes),
    }

    if (nestedItems.length > 0) {
      const adjusted = nestedItems.map((n) => ({ ...n, indent: (n.indent ?? 0) - indent - 1 }))
      const subListType = nestedItems[0].listType || listType
      listitem.children.push(nestFlatListItems(adjusted, subListType, knownTypes))
    }

    root.children.push(listitem)
    i = j
  }

  return root
}

/**
 * Migrate a legacy ImageNode/BookmarkNode into the unified ReferenceNode shape.
 * The URL is preserved as the reference's canonical value; the old node type
 * only told us which display mode to start in.
 */
function migrateReferenceNode(node: any): any {
  if (node.type === "image") {
    return {
      type: "reference",
      displayMode: "image",
      url: node.sourceUrl ?? "",
      title: "",
      description: "",
      imageUrl: "",
      faviconUrl: "",
      imageId: node.imageId ?? "",
      altText: node.altText ?? "",
      width: node.width,
      height: node.height,
      alignment: node.alignment,
      loading: node.loading,
      version: 1,
    }
  }

  return {
    type: "reference",
    displayMode: "card",
    url: node.url ?? "",
    title: node.title ?? "",
    description: node.description ?? "",
    imageUrl: node.imageUrl ?? "",
    faviconUrl: node.faviconUrl ?? "",
    imageId: "",
    altText: "",
    autoResolve: node.autoResolve,
    hydrationAttempted: node.hydrationAttempted,
    version: 1,
  }
}

function wrapUnknown(child: any): any {
  return { type: UNKNOWN_NODE_TYPE, raw: child, version: 1 }
}

/**
 * Restore an `unknown` envelope once this build registers the raw type. Without
 * this, a node preserved by an older build would stay opaque even after an
 * upgrade that understands it.
 */
function unwrapKnownUnknowns(children: any[], knownTypes: ReadonlySet<string>): any[] {
  return children.map((child) => {
    if (
      child?.type === UNKNOWN_NODE_TYPE &&
      child.raw &&
      typeof child.raw === "object" &&
      typeof child.raw.type === "string" &&
      knownTypes.has(child.raw.type)
    ) {
      return child.raw
    }
    return child
  })
}

/**
 * Migrate children: remove legacy nodes, convert old flat "list-item" nodes into
 * proper nested list/listitem structure, and wrap unrecognized node types so they
 * are preserved verbatim instead of aborting the parse (#286).
 */
function migrateChildren(children: any[], knownTypes: ReadonlySet<string>): any[] {
  const result: any[] = []
  children = unwrapKnownUnknowns(children, knownTypes)

  let i = 0
  while (i < children.length) {
    const child = children[i]

    if (child.type === "code-snippet" || child.type === "executable-code-block") {
      i++
      continue
    }

    if (child.type === "image" || child.type === "bookmark") {
      result.push(migrateReferenceNode(child))
      i++
      continue
    }

    if (child.type === "list-item") {
      const group: any[] = []
      while (i < children.length && children[i].type === "list-item") {
        group.push(children[i])
        i++
      }
      const listType = group[0].listType || "bullet"
      result.push(nestFlatListItems(group, listType, knownTypes))
    } else if (child.type === "list") {
      result.push(child)
      i++
    } else if (typeof child.type === "string" && knownTypes.has(child.type)) {
      if (child.children && Array.isArray(child.children)) {
        result.push({ ...child, children: migrateChildren(child.children, knownTypes) })
      } else {
        result.push(child)
      }
      i++
    } else {
      result.push(wrapUnknown(child))
      i++
    }
  }

  return result
}

/**
 * Migrate/sanitize a parsed editor state. Never throws on unknown node types:
 * they are wrapped in an UnknownNode payload that re-emits verbatim. Returns
 * null when the state has no renderable children (Lexical will create default
 * content).
 */
export function sanitizeSerializedState(
  state: SerializedEditorState,
  knownTypes: ReadonlySet<string> = KNOWN_NODE_TYPES,
): SerializedEditorState | null {
  const cloned = JSON.parse(JSON.stringify(state))

  if (cloned.root?.children) {
    cloned.root.children = migrateChildren(cloned.root.children, knownTypes)
  }

  if (!cloned.root?.children?.length) {
    return null
  }

  return cloned
}

/**
 * Load a stored document's `content` string into a form the editor can safely
 * mount, or report why it cannot. A non-`ready` result must gate autosave: the
 * editor is not mounted and nothing is written back.
 */
export function parseDocumentContent(args: {
  content: string | undefined
  contentSchemaVersion?: number
  knownTypes?: ReadonlySet<string>
}): ContentLoadResult {
  const { content, contentSchemaVersion, knownTypes = KNOWN_NODE_TYPES } = args

  if (!content || content.trim() === "") return { status: "empty" }

  // Content is markdown; during migration a stored value may still be legacy
  // Lexical JSON. Only a value that parses as a Lexical document is treated as
  // such — everything else (including malformed JSON) is markdown text.
  let legacyState: SerializedEditorState | null = null
  if (content.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(content) as unknown
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { root?: { children?: unknown } }).root &&
        Array.isArray((parsed as { root: { children?: unknown } }).root.children)
      ) {
        legacyState = parsed as SerializedEditorState
      }
    } catch {
      legacyState = null
    }
  }

  let state: SerializedEditorState
  if (legacyState) {
    state = legacyState
  } else {
    try {
      state = markdownToSerializedState(content)
    } catch {
      return { status: "error", reason: "Note content could not be parsed." }
    }
  }

  let sanitized: SerializedEditorState | null
  try {
    sanitized = sanitizeSerializedState(state, knownTypes)
  } catch {
    return { status: "error", reason: "Note content could not be parsed." }
  }

  if (sanitized == null) return { status: "empty" }

  const preservedUnknownTypes: string[] = []
  const walk = (nodes: any[]) => {
    for (const node of nodes) {
      if (node?.type === UNKNOWN_NODE_TYPE) {
        const rawType = node.raw?.type
        preservedUnknownTypes.push(typeof rawType === "string" ? rawType : UNKNOWN_NODE_TYPE)
      } else if (Array.isArray(node?.children)) {
        walk(node.children)
      }
    }
  }
  walk((sanitized as any).root.children)

  return {
    status: "ready",
    editorState: sanitized,
    preservedUnknownTypes,
    schemaAhead:
      typeof contentSchemaVersion === "number" && contentSchemaVersion > CONTENT_SCHEMA_VERSION,
  }
}

/**
 * Normalize a stored content string into a serialized editor state that is safe
 * to hand to `LexicalComposer`, or undefined. Guards against empty/corrupt states
 * (which make Lexical throw "editor state is empty").
 */
export function toSafeEditorStateString(content: string | undefined): string | undefined {
  const result = parseDocumentContent({ content })
  if (result.status !== "ready") return undefined
  const children = (result.editorState as { root?: { children?: unknown[] } }).root?.children
  if (!Array.isArray(children) || children.length === 0) return undefined
  return JSON.stringify(result.editorState)
}

/** Markdown body → SerializedEditorState (title ownership + lychee encodings). */
export function markdownToSerializedState(markdown: string): SerializedEditorState {
  // A fresh editor per call: `$convertFromMarkdownString` appends to the root,
  // so reusing an instance would accumulate every previously converted note.
  const editor = createHeadlessEditor({
    namespace: "content-load-markdown",
    nodes,
    onError: (error) => {
      throw error
    },
  })
  editor.update(
    () => {
      $importDocumentMarkdown(markdown)
    },
    { discrete: true },
  )
  return editor.getEditorState().toJSON()
}

/**
 * Serialize a state for `LexicalComposer`, but only if Lexical can actually parse
 * it into a non-empty root. Prevents the "editor state is empty" crash from any
 * malformed/edge-case state.
 *
 * Note: we no longer round-trip the state through a throwaway headless editor
 * here. `parseDocumentContent` already guarantees a valid, non-empty state
 * (sanitized + unknown nodes wrapped), and `LexicalComposer` parses it once on
 * mount — the extra parse was a measurable part of the open-a-note stall.
 */
export function safeComposerState(state: SerializedEditorState | undefined): string | undefined {
  if (state == null) return undefined
  const children = (state as { root?: { children?: unknown[] } }).root?.children
  if (!Array.isArray(children) || children.length === 0) return undefined
  return JSON.stringify(state)
}
