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
import { CodeBlockComponent } from "./code-block-component"

export type SerializedCodeBlockNode = Spread<
  {
    type: "code-block"
    code: string
    language: string
    version: 1
  },
  SerializedLexicalNode
>

export class CodeBlockNode extends DecoratorNode<ReactElement | null> {
  __code: string
  __language: string

  static getType(): string {
    return "code-block"
  }

  static clone(node: CodeBlockNode): CodeBlockNode {
    return new CodeBlockNode(node.__code, node.__language, node.__key)
  }

  constructor(code: string = "", language: string = "", key?: NodeKey) {
    super(key)
    this.__code = code
    this.__language = language
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div")
    div.className = "editor-code-block"
    return div
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(serializedNode: SerializedCodeBlockNode): CodeBlockNode {
    return $createCodeBlockNode(serializedNode.code, serializedNode.language)
  }

  exportJSON(): SerializedCodeBlockNode {
    return {
      type: "code-block",
      code: this.__code,
      language: this.__language,
      version: 1,
    }
  }

  isInline(): false {
    return false
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  getCode(): string {
    return this.__code
  }

  setCode(code: string): void {
    const writable = this.getWritable()
    writable.__code = code
  }

  getLanguage(): string {
    return this.__language
  }

  setLanguage(language: string): void {
    const writable = this.getWritable()
    writable.__language = language
  }

  getTextContent(): string {
    return this.__code
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactElement | null {
    return (
      <CodeBlockComponent
        nodeKey={this.__key}
        code={this.__code}
        language={this.__language}
      />
    )
  }
}

export function $createCodeBlockNode(
  code: string = "",
  language: string = ""
): CodeBlockNode {
  return $applyNodeReplacement(new CodeBlockNode(code, language))
}

export function $isCodeBlockNode(
  node: LexicalNode | null | undefined
): node is CodeBlockNode {
  return node instanceof CodeBlockNode
}
