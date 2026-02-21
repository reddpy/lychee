/**
 * Converts a Lexical SerializedEditorState JSON object into ProseMirror-compatible JSON.
 *
 * Lexical format: { root: { children: [...], type: "root", ... } }
 * PM format:      { type: "doc", content: [...] }
 */

// Lexical format bitmask → PM mark types
const FORMAT_BOLD = 1
const FORMAT_ITALIC = 2
const FORMAT_STRIKETHROUGH = 4
const FORMAT_UNDERLINE = 8
const FORMAT_CODE = 16
const FORMAT_SUBSCRIPT = 32
const FORMAT_SUPERSCRIPT = 64

interface LexicalNode {
  type: string
  children?: LexicalNode[]
  text?: string
  format?: number | string
  tag?: string
  url?: string
  listType?: string
  checked?: boolean
  indent?: number
  language?: string
  open?: boolean
  [key: string]: unknown
}

interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

function formatToMarks(format: number): PMMark[] {
  const marks: PMMark[] = []
  if (format & FORMAT_BOLD) marks.push({ type: "bold" })
  if (format & FORMAT_ITALIC) marks.push({ type: "italic" })
  if (format & FORMAT_STRIKETHROUGH) marks.push({ type: "strikethrough" })
  if (format & FORMAT_UNDERLINE) marks.push({ type: "underline" })
  if (format & FORMAT_CODE) marks.push({ type: "code" })
  if (format & FORMAT_SUBSCRIPT) marks.push({ type: "subscript" })
  if (format & FORMAT_SUPERSCRIPT) marks.push({ type: "superscript" })
  return marks
}

/**
 * Convert Lexical inline children to PM inline nodes.
 */
function migrateInlineChildren(
  children: LexicalNode[],
  extraMarks?: PMMark[]
): PMNode[] {
  const result: PMNode[] = []

  for (const child of children) {
    if (child.type === "text") {
      if (!child.text) continue
      const format = typeof child.format === "number" ? child.format : 0
      const marks = [...formatToMarks(format), ...(extraMarks || [])]
      const node: PMNode = { type: "text", text: child.text }
      if (marks.length > 0) node.marks = marks
      result.push(node)
    } else if (child.type === "linebreak") {
      result.push({ type: "hardBreak" })
    } else if (child.type === "link" || child.type === "autolink") {
      const linkMark: PMMark = { type: "link", attrs: { href: child.url || "" } }
      const linkChildren = migrateInlineChildren(
        child.children || [],
        [...(extraMarks || []), linkMark]
      )
      result.push(...linkChildren)
    } else if (child.type === "code-highlight") {
      if (child.text) {
        result.push({ type: "text", text: child.text })
      }
    } else if (child.type === "tab") {
      result.push({ type: "text", text: "\t" })
    }
  }

  return result
}

// ── List migration helpers ────────────────────────────────

/** Convert a Lexical listitem into a PM list_item (with nested sublists for indent). */
function migrateListItem(item: LexicalNode): PMNode {
  const inlineChildren: LexicalNode[] = []
  const nestedLists: LexicalNode[] = []

  for (const child of item.children || []) {
    if (child.type === "list") {
      nestedLists.push(child)
    } else {
      inlineChildren.push(child)
    }
  }

  const inlineContent = migrateInlineChildren(inlineChildren)
  const paragraph: PMNode = {
    type: "paragraph",
    content: inlineContent.length > 0 ? inlineContent : undefined,
  }

  const listItemContent: PMNode[] = [paragraph]

  // Nested sublists become child lists inside this list_item
  for (const nested of nestedLists) {
    const sublist = migrateListNode(nested)
    if (sublist) listItemContent.push(sublist)
  }

  return { type: "list_item", content: listItemContent }
}

/** Convert a Lexical list node to a PM bullet_list or ordered_list. */
function migrateListNode(node: LexicalNode): PMNode | null {
  const listType = node.listType || "bullet"
  const pmType = listType === "number" ? "ordered_list" : "bullet_list"

  const items: PMNode[] = []
  for (const child of node.children || []) {
    items.push(migrateListItem(child))
  }

  if (items.length === 0) return null
  return { type: pmType, content: items }
}

/**
 * Group consecutive flat list-item nodes (from our Lexical flat list format)
 * into proper PM list wrappers. Handles indent via nesting.
 */
function groupFlatListItems(flatItems: LexicalNode[]): PMNode[] {
  // For flat list-items, wrap each in list_item > paragraph, then group by type
  const result: PMNode[] = []
  let currentType: string | null = null
  let currentItems: PMNode[] = []

  for (const item of flatItems) {
    const listType = item.listType || "bullet"
    const pmListType = listType === "number" ? "ordered_list" : "bullet_list"

    const inlineContent = migrateInlineChildren(item.children || [])
    const paragraph: PMNode = {
      type: "paragraph",
      content: inlineContent.length > 0 ? inlineContent : undefined,
    }
    const listItem: PMNode = { type: "list_item", content: [paragraph] }

    if (pmListType !== currentType) {
      // Flush previous group
      if (currentType && currentItems.length > 0) {
        result.push({ type: currentType, content: currentItems })
      }
      currentType = pmListType
      currentItems = [listItem]
    } else {
      currentItems.push(listItem)
    }
  }

  // Flush last group
  if (currentType && currentItems.length > 0) {
    result.push({ type: currentType, content: currentItems })
  }

  return result
}

/** Convert a single Lexical block node to a PM block node. */
function migrateBlockNode(node: LexicalNode): PMNode | PMNode[] | null {
  switch (node.type) {
    case "title": {
      const content = migrateInlineChildren(node.children || [])
      return { type: "title", content: content.length > 0 ? content : undefined }
    }

    case "paragraph": {
      const content = migrateInlineChildren(node.children || [])
      return { type: "paragraph", content: content.length > 0 ? content : undefined }
    }

    case "heading": {
      const level = node.tag === "h1" ? 1 : node.tag === "h2" ? 2 : 3
      const content = migrateInlineChildren(node.children || [])
      return {
        type: "heading",
        attrs: { level },
        content: content.length > 0 ? content : undefined,
      }
    }

    case "quote": {
      const inlineContent = migrateInlineChildren(node.children || [])
      const innerParagraph: PMNode = {
        type: "paragraph",
        content: inlineContent.length > 0 ? inlineContent : undefined,
      }
      return {
        type: "blockquote",
        content: [innerParagraph],
      }
    }

    case "code": {
      const textParts: string[] = []
      for (const child of node.children || []) {
        if (child.text) textParts.push(child.text)
        if (child.type === "linebreak") textParts.push("\n")
      }
      const text = textParts.join("")
      return {
        type: "codeBlock",
        attrs: { language: node.language || "" },
        content: text ? [{ type: "text", text }] : undefined,
      }
    }

    case "horizontalrule": {
      return { type: "horizontalRule" }
    }

    // Old nested list format → standard PM nested lists
    case "list": {
      return migrateListNode(node)
    }

    // Legacy node types — skip
    case "code-snippet":
    case "executable-code-block":
      return null

    // Toggle container
    case "toggle-container": {
      const children = node.children || []
      const titleNode = children.find((c) => c.type === "toggle-title")
      const contentNode = children.find((c) => c.type === "toggle-content")

      const titleContent = migrateInlineChildren(titleNode?.children || [])
      const pmTitle: PMNode = {
        type: "toggleTitle",
        content: titleContent.length > 0 ? titleContent : undefined,
      }

      const contentBlocks: PMNode[] = []
      for (const child of contentNode?.children || []) {
        const migrated = migrateBlockNode(child)
        if (migrated) {
          if (Array.isArray(migrated)) {
            contentBlocks.push(...migrated)
          } else {
            contentBlocks.push(migrated)
          }
        }
      }
      if (contentBlocks.length === 0) {
        contentBlocks.push({ type: "paragraph" })
      }

      return {
        type: "toggleContainer",
        attrs: { open: node.open ?? true },
        content: [pmTitle, { type: "toggleContent", content: contentBlocks }],
      }
    }

    default:
      if (node.children && node.children.length > 0) {
        const content = migrateInlineChildren(node.children)
        return { type: "paragraph", content: content.length > 0 ? content : undefined }
      }
      return null
  }
}

/**
 * Detect whether a parsed JSON object is in Lexical format.
 */
export function isLexicalFormat(json: unknown): boolean {
  return (
    typeof json === "object" &&
    json !== null &&
    "root" in json &&
    typeof (json as Record<string, unknown>).root === "object"
  )
}

/**
 * Detect whether a parsed JSON object is in ProseMirror format.
 */
export function isProseMirrorFormat(json: unknown): boolean {
  return (
    typeof json === "object" &&
    json !== null &&
    "type" in json &&
    (json as Record<string, unknown>).type === "doc"
  )
}

/**
 * Convert a Lexical SerializedEditorState to ProseMirror JSON.
 */
export function migrateLexicalToProseMirror(lexicalState: Record<string, unknown>): PMNode {
  const root = lexicalState.root as { children?: LexicalNode[] } | undefined
  const children = root?.children || []

  const blocks: PMNode[] = []
  let hasTitle = false

  // Collect flat list-item nodes to group them
  let pendingListItems: LexicalNode[] = []

  function flushListItems() {
    if (pendingListItems.length > 0) {
      blocks.push(...groupFlatListItems(pendingListItems))
      pendingListItems = []
    }
  }

  for (const child of children) {
    if (child.type === "title") hasTitle = true

    // Our flat list-item format: collect and group
    if (child.type === "list-item") {
      pendingListItems.push(child)
      continue
    }

    // Non-list-item: flush any pending list items first
    flushListItems()

    const migrated = migrateBlockNode(child)
    if (migrated) {
      if (Array.isArray(migrated)) {
        blocks.push(...migrated)
      } else {
        blocks.push(migrated)
      }
    }
  }

  flushListItems()

  if (!hasTitle) {
    blocks.unshift({ type: "title" })
  }

  if (blocks.length <= 1) {
    blocks.push({ type: "paragraph" })
  }

  return { type: "doc", content: blocks }
}
