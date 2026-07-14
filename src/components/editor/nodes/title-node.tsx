import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getRoot,
  DOMConversionMap,
  DOMExportOutput,
  EditorConfig,
  ElementNode,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  ParagraphNode,
  RangeSelection,
  SerializedElementNode,
} from "lexical"
import { NEW_NOTE_TITLE } from "../../../shared/note-title"

export type SerializedTitleNode = SerializedElementNode & {
  type: "title"
  version: 1
}

export class TitleNode extends ElementNode {
  static getType(): string {
    return "title"
  }

  static clone(node: TitleNode): TitleNode {
    return new TitleNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("h1")
    dom.className = "editor-title"
    dom.setAttribute("data-placeholder", NEW_NOTE_TITLE)
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importDOM(): DOMConversionMap | null {
    return null
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    // The title placeholder is editor UI, not document content. Omitting an
    // empty title gives HTML/clipboard consumers a clean body while the
    // serialized Lexical state still retains the structural TitleNode.
    if (this.getTextContent().trim().length === 0) return { element: null }

    const element = document.createElement("h1")
    // Keep a format-neutral semantic marker for future full-document import.
    // importDOM intentionally remains null: pasting an arbitrary exported h1
    // into an existing note must not replace that note's canonical title.
    element.setAttribute("data-lychee-title", "true")
    return { element }
  }

  static importJSON(serializedNode: SerializedTitleNode): TitleNode {
    return $createTitleNode().updateFromJSON(serializedNode)
  }

  exportJSON(): SerializedTitleNode {
    return {
      ...super.exportJSON(),
      type: "title",
      version: 1,
    }
  }

  // Prevent this node from being replaced with other block types
  canReplaceWith(): boolean {
    return false
  }

  // Prevent merging with other nodes
  canMergeWith(): boolean {
    return false
  }

  // Handle Enter key - insert paragraph after title
  insertNewAfter(
    _selection: RangeSelection,
    restoreSelection = true
  ): ParagraphNode {
    const newElement = $createParagraphNode()
    const direction = this.getDirection()
    newElement.setDirection(direction)
    this.insertAfter(newElement, restoreSelection)
    return newElement
  }

  // Prevent deletion
  remove(): boolean {
    return false
  }

  // Prevent backspace from deleting the node at the start
  collapseAtStart(): boolean {
    return false
  }
}

export function $createTitleNode(): TitleNode {
  return $applyNodeReplacement(new TitleNode())
}

export function $isTitleNode(
  node: LexicalNode | null | undefined
): node is TitleNode {
  return node instanceof TitleNode
}

/** Return the one canonical title: the first top-level document node. */
export function $getTitleNode(): TitleNode | null {
  const firstChild = $getRoot().getFirstChild()
  return $isTitleNode(firstChild) ? firstChild : null
}
