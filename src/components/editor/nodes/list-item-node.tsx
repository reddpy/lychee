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
    const indent = this.__indent

    dom.className = `list-item list-item--${listType}`
    dom.setAttribute("data-list-type", listType)
    dom.setAttribute("data-indent", String(indent))
    dom.style.marginLeft = indent > 0 ? `${indent * 24}px` : ""

    // Clean up attributes from other list types
    if (listType !== "number") {
      dom.removeAttribute("data-ordinal")
    }
    if (listType === "check") {
      dom.setAttribute("role", "checkbox")
      dom.setAttribute("aria-checked", String(this.__checked))
      dom.tabIndex = -1
      if (this.__checked) {
        dom.classList.add("list-item--checked")
      }
    } else {
      dom.removeAttribute("role")
      dom.removeAttribute("aria-checked")
    }
  }

  updateDOM(
    prevNode: ListItemNode,
    dom: HTMLElement,
    _config: EditorConfig
  ): boolean {
    // Patch DOM in place rather than re-creating. Re-creation via
    // createDOM() produces a detached element where getComputedStyle
    // can't resolve our --lexical-indent-base-value: 0px CSS override,
    // so Lexical falls back to 40px and adds unwanted padding-inline-start.
    const typeChanged = prevNode.__listType !== this.__listType
    const checkedChanged = prevNode.__checked !== this.__checked
    const indentChanged = prevNode.__indent !== this.__indent

    if (typeChanged || checkedChanged) {
      this.__applyDOMAttributes(dom)
    } else if (indentChanged) {
      // Only update indent-related attributes (skip full __applyDOMAttributes)
      const indent = this.__indent
      dom.setAttribute("data-indent", String(indent))
      dom.style.marginLeft = indent > 0 ? `${indent * 24}px` : ""
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
    )
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
