import { useRef, type ReactElement } from "react"
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
import { useDecoratorBlock } from "@/components/editor/hooks/use-decorator-block"

export type SerializedLoadingPlaceholderNode = Spread<
  {
    type: "loading-placeholder"
    label: string
    version: 1
  },
  SerializedLexicalNode
>

function LoadingPlaceholderComponent({ nodeKey, label }: { nodeKey: NodeKey; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useDecoratorBlock({
    nodeKey,
    containerRef,
    isNodeType: $isLoadingPlaceholderNode,
  })

  return (
    <div ref={containerRef} className="loading-placeholder-content">
      <div className="loading-placeholder-spinner" />
      <span>{label}</span>
    </div>
  )
}

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
      <LoadingPlaceholderComponent nodeKey={this.__key} label={this.__label} />
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
