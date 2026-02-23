import type { ReactElement } from "react"
import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"

export type SerializedLoadingPlaceholderNode = Spread<
  {
    type: "loading-placeholder"
    label: string
    version: 1
  },
  SerializedLexicalNode
>

export class LoadingPlaceholderNode extends DecoratorNode<ReactElement | null> {
  __label: string

  static getType(): string {
    return "loading-placeholder"
  }

  static clone(node: LoadingPlaceholderNode): LoadingPlaceholderNode {
    return new LoadingPlaceholderNode(node.__label, node.__key)
  }

  constructor(label: string = "Loading…", key?: NodeKey) {
    super(key)
    this.__label = label
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div")
    div.className = "editor-loading-placeholder"
    return div
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(serializedNode: SerializedLoadingPlaceholderNode): LoadingPlaceholderNode {
    return $createLoadingPlaceholderNode(serializedNode.label)
  }

  exportJSON(): SerializedLoadingPlaceholderNode {
    return {
      type: "loading-placeholder",
      label: this.__label,
      version: 1,
    }
  }

  isInline(): false {
    return false
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactElement | null {
    return (
      <div className="loading-placeholder-content">
        <div className="loading-placeholder-spinner" />
        <span>{this.__label}</span>
      </div>
    )
  }
}

export function $createLoadingPlaceholderNode(label: string = "Loading…"): LoadingPlaceholderNode {
  return $applyNodeReplacement(new LoadingPlaceholderNode(label))
}

export function $isLoadingPlaceholderNode(
  node: LexicalNode | null | undefined,
): node is LoadingPlaceholderNode {
  return node instanceof LoadingPlaceholderNode
}
