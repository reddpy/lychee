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
import { BookmarkComponent } from "./bookmark-component"

export type SerializedBookmarkNode = Spread<
  {
    type: "bookmark"
    url: string
    title: string
    description: string
    imageUrl: string
    faviconUrl: string
    version: 1
  },
  SerializedLexicalNode
>

export class BookmarkNode extends DecoratorNode<ReactElement | null> {
  __url: string
  __title: string
  __description: string
  __imageUrl: string
  __faviconUrl: string

  static getType(): string {
    return "bookmark"
  }

  static clone(node: BookmarkNode): BookmarkNode {
    return new BookmarkNode(
      node.__url,
      node.__title,
      node.__description,
      node.__imageUrl,
      node.__faviconUrl,
      node.__key,
    )
  }

  constructor(
    url: string,
    title: string = "",
    description: string = "",
    imageUrl: string = "",
    faviconUrl: string = "",
    key?: NodeKey,
  ) {
    super(key)
    this.__url = url
    this.__title = title
    this.__description = description
    this.__imageUrl = imageUrl
    this.__faviconUrl = faviconUrl
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div")
    div.className = "editor-bookmark"
    return div
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(serializedNode: SerializedBookmarkNode): BookmarkNode {
    return $createBookmarkNode({
      url: serializedNode.url,
      title: serializedNode.title,
      description: serializedNode.description,
      imageUrl: serializedNode.imageUrl,
      faviconUrl: serializedNode.faviconUrl,
    })
  }

  exportJSON(): SerializedBookmarkNode {
    return {
      type: "bookmark",
      url: this.__url,
      title: this.__title,
      description: this.__description,
      imageUrl: this.__imageUrl,
      faviconUrl: this.__faviconUrl,
      version: 1,
    }
  }

  isInline(): false {
    return false
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  setTitle(title: string): void {
    const writable = this.getWritable()
    writable.__title = title
  }

  setDescription(description: string): void {
    const writable = this.getWritable()
    writable.__description = description
  }

  setImageUrl(imageUrl: string): void {
    const writable = this.getWritable()
    writable.__imageUrl = imageUrl
  }

  setFaviconUrl(faviconUrl: string): void {
    const writable = this.getWritable()
    writable.__faviconUrl = faviconUrl
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactElement | null {
    return (
      <BookmarkComponent
        nodeKey={this.__key}
        url={this.__url}
        title={this.__title}
        description={this.__description}
        imageUrl={this.__imageUrl}
        faviconUrl={this.__faviconUrl}
      />
    )
  }
}

export interface CreateBookmarkNodeParams {
  url: string
  title?: string
  description?: string
  imageUrl?: string
  faviconUrl?: string
}

export function $createBookmarkNode(params: CreateBookmarkNodeParams): BookmarkNode {
  return $applyNodeReplacement(
    new BookmarkNode(
      params.url,
      params.title ?? "",
      params.description ?? "",
      params.imageUrl ?? "",
      params.faviconUrl ?? "",
    ),
  )
}

export function $isBookmarkNode(
  node: LexicalNode | null | undefined,
): node is BookmarkNode {
  return node instanceof BookmarkNode
}
