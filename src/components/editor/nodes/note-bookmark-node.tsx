import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"

export type SerializedNoteBookmarkNode = Spread<
  {
    type: "note-bookmark"
    label: string
    createdAt: string
    version: 1
  },
  SerializedLexicalNode
>

/**
 * A zero-width inline marker that records a user-made bookmark on the block it
 * lives in. It renders nothing on purpose — bookmarks only appear in the note
 * drawer. Being part of the serialized content (rather than note metadata) means
 * it moves with the block, survives reloads, and participates in undo/redo.
 */
export class NoteBookmarkNode extends DecoratorNode<null> {
  __label: string
  __createdAt: string

  static getType(): string {
    return "note-bookmark"
  }

  static clone(node: NoteBookmarkNode): NoteBookmarkNode {
    return new NoteBookmarkNode(node.__label, node.__createdAt, node.__key)
  }

  constructor(label: string, createdAt: string, key?: NodeKey) {
    super(key)
    this.__label = label
    this.__createdAt = createdAt
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span")
    span.className = "editor-note-bookmark"
    span.setAttribute("aria-hidden", "true")
    return span
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): true {
    return true
  }

  isKeyboardSelectable(): boolean {
    return false
  }

  /** Bookmarks never contribute text to word counts, search, or previews. */
  getTextContent(): string {
    return ""
  }

  static importJSON(serializedNode: SerializedNoteBookmarkNode): NoteBookmarkNode {
    return $createNoteBookmarkNode({
      label: serializedNode.label,
      createdAt: serializedNode.createdAt,
    })
  }

  exportJSON(): SerializedNoteBookmarkNode {
    return {
      type: "note-bookmark",
      label: this.__label,
      createdAt: this.__createdAt,
      version: 1,
    }
  }

  getLabel(): string {
    return this.__label
  }

  getCreatedAt(): string {
    return this.__createdAt
  }

  setLabel(label: string): void {
    const writable = this.getWritable()
    writable.__label = label
  }

  decorate(): null {
    return null
  }
}

export interface CreateNoteBookmarkNodeParams {
  label?: string
  createdAt?: string
}

export function $createNoteBookmarkNode(
  params: CreateNoteBookmarkNodeParams = {},
): NoteBookmarkNode {
  return $applyNodeReplacement(
    new NoteBookmarkNode(
      params.label?.trim() || "Bookmark",
      params.createdAt ?? new Date().toISOString(),
    ),
  )
}

export function $isNoteBookmarkNode(
  node: LexicalNode | null | undefined,
): node is NoteBookmarkNode {
  return node instanceof NoteBookmarkNode
}
