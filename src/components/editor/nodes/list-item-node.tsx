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
  RangeSelection,
  SerializedElementNode,
  Spread,
} from "lexical"

export type ListType = "bullet" | "number" | "check"

export type SerializedListItemNode = Spread<
  {
    type: "list-item"
    listType: ListType
    checked: boolean
    version: 1
  },
  SerializedElementNode
>

export class ListItemNode extends ElementNode {
  __listType: ListType
  __checked: boolean
  static readonly INDENT_PX = 40

  static getType(): string {
    return "list-item"
  }

  static clone(node: ListItemNode): ListItemNode {
    return new ListItemNode(node.__listType, node.__checked, node.__key)
  }

  constructor(listType: ListType = "bullet", checked = false, key?: NodeKey) {
    super(key)
    this.__listType = listType
    this.__checked = checked
  }

  // -- Getters / Setters --

  getListType(): ListType {
    return this.getLatest().__listType
  }

  setListType(listType: ListType): this {
    const self = this.getWritable()
    self.__listType = listType
    return this
  }

  getChecked(): boolean {
    return this.getLatest().__checked
  }

  setChecked(checked: boolean): this {
    const self = this.getWritable()
    self.__checked = checked
    return this
  }

  toggleChecked(): this {
    return this.setChecked(!this.getChecked())
  }

  // -- DOM --

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("div")
    this.__applyDOMAttributes(dom)
    return dom
  }

  __applyDOMAttributes(dom: HTMLElement): void {
    const listType = this.__listType
    dom.className = `list-item list-item--${listType}`
    dom.style.setProperty(
      "--flat-list-indent-offset",
      `${this.getIndent() * ListItemNode.INDENT_PX}px`
    )

    if (listType === "check") {
      dom.setAttribute("role", "checkbox")
      dom.setAttribute("aria-checked", String(this.__checked))
      dom.tabIndex = -1
      if (this.__checked) {
        dom.classList.add("list-item--checked")
      }
    }
  }

  updateDOM(
    prevNode: ListItemNode,
    dom: HTMLElement,
    _config: EditorConfig
  ): boolean {
    dom.style.setProperty(
      "--flat-list-indent-offset",
      `${this.getIndent() * ListItemNode.INDENT_PX}px`
    )

    if (
      prevNode.__listType !== this.__listType ||
      prevNode.__checked !== this.__checked
    ) {
      // Re-create DOM when type or checked state changes
      return true
    }
    return false
  }

  static importDOM(): DOMConversionMap | null {
    return null
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement("div")
    this.__applyDOMAttributes(element)
    return { element }
  }

  // -- Serialization --

  static importJSON(serializedNode: SerializedListItemNode): ListItemNode {
    return $createListItemNode(
      serializedNode.listType,
      serializedNode.checked
    ).updateFromJSON(serializedNode)
  }

  exportJSON(): SerializedListItemNode {
    return {
      ...super.exportJSON(),
      type: "list-item",
      listType: this.__listType,
      checked: this.__checked,
      version: 1,
    }
  }

  updateFromJSON(serializedNode: SerializedListItemNode): this {
    return super
      .updateFromJSON(serializedNode)
      .setListType(serializedNode.listType)
      .setChecked(serializedNode.checked)
  }

  // -- Behavior --

  canIndent(): boolean {
    return true
  }

  insertNewAfter(
    _selection: RangeSelection,
    restoreSelection = true
  ): ListItemNode {
    const newItem = $createListItemNode(this.__listType, false)
    newItem.setIndent(this.getIndent())
    newItem.setDirection(this.getDirection())
    this.insertAfter(newItem, restoreSelection)
    return newItem
  }

  collapseAtStart(selection: RangeSelection): boolean {
    const indent = this.getIndent()
    if (indent > 0) {
      this.setIndent(indent - 1)
      return true
    }

    // At indent 0: convert to paragraph, keep cursor on the same line
    const paragraph = $createParagraphNode()
    const children = this.getChildren()
    children.forEach((child) => paragraph.append(child))
    this.replace(paragraph)

    // Point selection at the new paragraph
    const key = paragraph.getKey()
    selection.anchor.set(key, 0, "element")
    selection.focus.set(key, 0, "element")

    return true
  }
}

export function $createListItemNode(
  listType: ListType = "bullet",
  checked = false
): ListItemNode {
  return $applyNodeReplacement(new ListItemNode(listType, checked))
}

export function $isListItemNode(
  node: LexicalNode | null | undefined
): node is ListItemNode {
  return node instanceof ListItemNode
}
