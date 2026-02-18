import {
  $applyNodeReplacement,
  $createParagraphNode,
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
    dom.setAttribute("data-placeholder", "Untitled")
    dom.setAttribute("data-lexical-no-drag", "true")
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importDOM(): DOMConversionMap | null {
    return null
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement("h1")
    element.className = "editor-title"
    return { element }
  }

  static importJSON(_serializedNode: SerializedTitleNode): TitleNode {
    return $createTitleNode()
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
