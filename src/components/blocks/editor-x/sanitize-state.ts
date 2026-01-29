/**
 * Sanitize serialized editor state so it can be parsed by the current editor.
 * Replaces or strips node types that are no longer registered (e.g. image, emoji)
 * so existing documents still render.
 */

import type { SerializedEditorState } from "lexical"

const SUPPORTED_TYPES = new Set([
  "root",
  "paragraph",
  "text",
  "heading",
  "quote",
  "code",
  "code-highlight",
  "link",
  "autolink",
])

type SerializedLexicalNode = SerializedEditorState["root"] & {
  type: string
  children?: SerializedLexicalNode[]
  [key: string]: unknown
}

function createFallbackParagraph(text: string): SerializedLexicalNode {
  return {
    type: "paragraph",
    version: 1,
    indent: 0,
    format: "",
    direction: "ltr",
    textFormat: 0,
    textStyle: "",
    children: [
      {
        type: "text",
        version: 1,
        text,
        format: 0,
        mode: "normal",
        style: "",
        detail: 0,
      },
    ] as unknown as SerializedLexicalNode[],
  }
}

function sanitizeNode(node: SerializedLexicalNode): SerializedLexicalNode {
  const type = node.type

  if (!SUPPORTED_TYPES.has(type)) {
    return createFallbackParagraph(`[${type}]`)
  }

  if (node.children && Array.isArray(node.children)) {
    const sanitizedChildren = node.children
      .map((child) => sanitizeNode(child as SerializedLexicalNode))
      .filter(Boolean)
    return { ...node, children: sanitizedChildren }
  }

  return node
}

export function sanitizeSerializedState(
  state: SerializedEditorState
): SerializedEditorState {
  if (!state?.root) return state

  const root = state.root as SerializedLexicalNode
  const sanitizedRoot = sanitizeNode(root)

  return {
    ...state,
    root: sanitizedRoot,
  }
}
