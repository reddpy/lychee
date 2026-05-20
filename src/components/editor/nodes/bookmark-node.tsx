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
    autoResolve?: boolean
    hydrationAttempted?: boolean
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
  /** True when this bookmark was inserted via Embed and should ask the backend
   *  to reclassify the URL on hydration (so non-obvious image URLs can swap
   *  to an ImageNode instead of staying as a bookmark). */
  __autoResolve: boolean
  /** True once the component has finished a hydration attempt (success or
   *  failure). Prevents refetch storms when a page returns no usable metadata —
   *  without this flag, every reopen of the document would re-fire the IPC. */
  __hydrationAttempted: boolean

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
      node.__autoResolve,
      node.__hydrationAttempted,
      node.__key,
    )
  }

  constructor(
    url: string,
    title: string = "",
    description: string = "",
    imageUrl: string = "",
    faviconUrl: string = "",
    autoResolve: boolean = false,
    hydrationAttempted: boolean = false,
    key?: NodeKey,
  ) {
    super(key)
    this.__url = url
    this.__title = title
    this.__description = description
    this.__imageUrl = imageUrl
    this.__faviconUrl = faviconUrl
    this.__autoResolve = autoResolve
    this.__hydrationAttempted = hydrationAttempted
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
      autoResolve: serializedNode.autoResolve ?? false,
      hydrationAttempted: serializedNode.hydrationAttempted ?? false,
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
      autoResolve: this.__autoResolve || undefined,
      hydrationAttempted: this.__hydrationAttempted || undefined,
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

  setMetadata(meta: {
    title: string
    description: string
    imageUrl: string
    faviconUrl: string
  }): void {
    const writable = this.getWritable()
    writable.__title = meta.title
    writable.__description = meta.description
    writable.__imageUrl = meta.imageUrl
    writable.__faviconUrl = meta.faviconUrl
    writable.__hydrationAttempted = true
  }

  markHydrationAttempted(): void {
    const writable = this.getWritable()
    writable.__hydrationAttempted = true
  }

  getNeedsHydration(): boolean {
    if (this.__hydrationAttempted) return false
    return (
      this.__title === "" &&
      this.__description === "" &&
      this.__imageUrl === "" &&
      this.__faviconUrl === ""
    )
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
        autoResolve={this.__autoResolve}
        hydrationAttempted={this.__hydrationAttempted}
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
  autoResolve?: boolean
  hydrationAttempted?: boolean
}

export function $createBookmarkNode(params: CreateBookmarkNodeParams): BookmarkNode {
  return $applyNodeReplacement(
    new BookmarkNode(
      params.url,
      params.title ?? "",
      params.description ?? "",
      params.imageUrl ?? "",
      params.faviconUrl ?? "",
      params.autoResolve ?? false,
      params.hydrationAttempted ?? false,
    ),
  )
}

export function $isBookmarkNode(
  node: LexicalNode | null | undefined,
): node is BookmarkNode {
  return node instanceof BookmarkNode
}
