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
 * Handles text nodes (with format bitmask → marks), link/autolink wrappers,
 * linebreak nodes, and code-highlight nodes inside code blocks.
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
      // Link wraps children — apply link mark to all inline children
      const linkMark: PMMark = { type: "link", attrs: { href: child.url || "" } }
      const linkChildren = migrateInlineChildren(
        child.children || [],
        [...(extraMarks || []), linkMark]
      )
      result.push(...linkChildren)
    } else if (child.type === "code-highlight") {
      // Inside code blocks: just extract text
      if (child.text) {
        result.push({ type: "text", text: child.text })
      }
    } else if (child.type === "tab") {
      result.push({ type: "text", text: "\t" })
    }
  }

  return result
}

/**
 * Flatten old-format nested list structures (same logic as editor.tsx migrateChildren).
 */
function flattenListItem(
  item: LexicalNode,
  indent: number,
  listType: string
): LexicalNode[] {
  const result: LexicalNode[] = []
  const inlineChildren: LexicalNode[] = []
  const nestedLists: LexicalNode[] = []

  for (const child of item.children || []) {
    if (child.type === "list") {
      nestedLists.push(child)
    } else {
      inlineChildren.push(child)
    }
  }

  result.push({
    type: "list-item",
    listType,
    checked: item.checked ?? false,
    indent,
    children: inlineChildren,
  })

  for (const nested of nestedLists) {
    const nestedType = nested.listType || listType
    for (const nestedItem of nested.children || []) {
      result.push(...flattenListItem(nestedItem, indent + 1, nestedType))
    }
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
      // Lexical quotes are flat inline content; PM blockquotes wrap block children
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

    case "list-item": {
      const content = migrateInlineChildren(node.children || [])
      return {
        type: "listItem",
        attrs: {
          listType: node.listType || "bullet",
          checked: node.checked ?? false,
          indent: node.indent ?? 0,
        },
        content: content.length > 0 ? content : undefined,
      }
    }

    case "code": {
      // Code blocks: concatenate all children text
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

    // Old nested list format: flatten to individual list items
    case "list": {
      const listType = node.listType || "bullet"
      const items: PMNode[] = []
      for (const listItem of node.children || []) {
        const flat = flattenListItem(listItem, 0, listType)
        for (const flatItem of flat) {
          const migrated = migrateBlockNode(flatItem)
          if (migrated) {
            if (Array.isArray(migrated)) {
              items.push(...migrated)
            } else {
              items.push(migrated)
            }
          }
        }
      }
      return items
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
      // Toggle content must have at least one block
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
      // Unknown node type — try to treat as paragraph with inline children
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

  for (const child of children) {
    if (child.type === "title") hasTitle = true
    const migrated = migrateBlockNode(child)
    if (migrated) {
      if (Array.isArray(migrated)) {
        blocks.push(...migrated)
      } else {
        blocks.push(migrated)
      }
    }
  }

  // Ensure title is first
  if (!hasTitle) {
    blocks.unshift({ type: "title" })
  }

  // Ensure at least one block after title
  if (blocks.length <= 1) {
    blocks.push({ type: "paragraph" })
  }

  return { type: "doc", content: blocks }
}
