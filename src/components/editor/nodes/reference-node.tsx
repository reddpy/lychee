import type { ReactElement } from "react"
import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"
import { getNodeRenderer } from "./node-renderers"

export type ImageAlignment = "left" | "center" | "right"

/**
 * How a reference renders. The URL is always the canonical, permanent value;
 * `displayMode` only decides presentation. New embed kinds (video, player,
 * etc.) become new modes rather than new node types.
 */
export type ReferenceDisplayMode = "card" | "image"

export type SerializedReferenceNode = Spread<
  {
    type: "reference"
    /** Canonical source URL. Always persisted; never lost when the display mode changes. */
    url: string
    displayMode: ReferenceDisplayMode
    // ── card mode ──
    title: string
    description: string
    imageUrl: string
    faviconUrl: string
    // ── image mode ──
    imageId: string
    src?: string
    altText: string
    width?: number
    height?: number
    alignment?: ImageAlignment
    loading?: boolean
    /** Inserted via Embed: a URL whose extension is ambiguous may resolve to an image. */
    autoResolve?: boolean
    hydrationAttempted?: boolean
    version: 1
  },
  SerializedLexicalNode
>

export interface ReferenceNodeParams {
  url?: string
  displayMode?: ReferenceDisplayMode
  title?: string
  description?: string
  imageUrl?: string
  faviconUrl?: string
  imageId?: string
  src?: string
  altText?: string
  width?: number
  height?: number
  loading?: boolean
  alignment?: ImageAlignment
  autoResolve?: boolean
  hydrationAttempted?: boolean
}

export class ReferenceNode extends DecoratorNode<ReactElement | null> {
  /** Canonical URL — the permanent identity of this reference. */
  __url: string
  __displayMode: ReferenceDisplayMode
  __title: string
  __description: string
  __imageUrl: string
  __faviconUrl: string
  __imageId: string
  /** Local image src — runtime-only; re-derived from `imageId`/`url` on load. */
  __src: string
  __altText: string
  __width: number | undefined
  __height: number | undefined
  __loading: boolean
  __alignment: ImageAlignment
  __autoResolve: boolean
  __hydrationAttempted: boolean

  static getType(): string {
    return "reference"
  }

  static clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(
      {
        url: node.__url,
        displayMode: node.__displayMode,
        title: node.__title,
        description: node.__description,
        imageUrl: node.__imageUrl,
        faviconUrl: node.__faviconUrl,
        imageId: node.__imageId,
        src: node.__src,
        altText: node.__altText,
        width: node.__width,
        height: node.__height,
        loading: node.__loading,
        alignment: node.__alignment,
        autoResolve: node.__autoResolve,
        hydrationAttempted: node.__hydrationAttempted,
      },
      node.__key,
    )
  }

  constructor(params: ReferenceNodeParams = {}, key?: NodeKey) {
    super(key)
    this.__url = params.url ?? ""
    this.__displayMode = params.displayMode ?? "card"
    this.__title = params.title ?? ""
    this.__description = params.description ?? ""
    this.__imageUrl = params.imageUrl ?? ""
    this.__faviconUrl = params.faviconUrl ?? ""
    this.__imageId = params.imageId ?? ""
    this.__src = params.src ?? ""
    this.__altText = params.altText ?? ""
    this.__width = params.width
    this.__height = params.height
    this.__loading = params.loading ?? false
    this.__alignment = params.alignment ?? "left"
    this.__autoResolve = params.autoResolve ?? false
    this.__hydrationAttempted = params.hydrationAttempted ?? false
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div")
    div.className = this.domClassName()
    return div
  }

  updateDOM(prevNode: ReferenceNode, dom: HTMLElement): boolean {
    if (prevNode.__displayMode !== this.__displayMode) {
      dom.className = this.domClassName()
    }
    if (this.__displayMode === "image") {
      dom.style.textAlign = this.__alignment
    } else {
      dom.style.textAlign = ""
    }
    return false
  }

  private domClassName(): string {
    return this.__displayMode === "image" ? "editor-image" : "editor-bookmark"
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: convertImageElement,
        priority: 0,
      }),
    }
  }

  static importJSON(serializedNode: SerializedReferenceNode): ReferenceNode {
    return $createReferenceNode({
      url: serializedNode.url,
      displayMode: serializedNode.displayMode,
      title: serializedNode.title,
      description: serializedNode.description,
      imageUrl: serializedNode.imageUrl,
      faviconUrl: serializedNode.faviconUrl,
      imageId: serializedNode.imageId,
      // `src` is runtime-only and omitted by exportJSON, but the live-append
      // transfer path injects it so images whose source lives only in `src`
      // (data URIs, relative `_assets/...` paths) are not lost.
      src: serializedNode.src ?? "",
      altText: serializedNode.altText,
      width: serializedNode.width,
      height: serializedNode.height,
      alignment: serializedNode.alignment,
      loading: serializedNode.loading ?? false,
      autoResolve: serializedNode.autoResolve ?? false,
      hydrationAttempted: serializedNode.hydrationAttempted ?? false,
    })
  }

  exportJSON(): SerializedReferenceNode {
    return {
      type: "reference",
      url: this.__url,
      displayMode: this.__displayMode,
      title: this.__title,
      description: this.__description,
      imageUrl: this.__imageUrl,
      faviconUrl: this.__faviconUrl,
      imageId: this.__imageId,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
      alignment: this.__alignment,
      loading: this.__loading || undefined,
      autoResolve: this.__autoResolve || undefined,
      hydrationAttempted: this.__hydrationAttempted || undefined,
      version: 1,
    }
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    if (this.__displayMode === "image") {
      const img = document.createElement("img")
      // lychee-image:// is private to this Electron app. Embed local image bytes
      // into clipboard HTML so rich-text targets outside Lychee can render them.
      // Keep the canonical URL as the best fallback for a remote image that has
      // not finished hydrating to local storage yet.
      const clipboardSrc = this.__imageId
        ? window.lychee?.getImageDataUrl?.(this.__imageId)
        : null
      img.src = clipboardSrc || this.__url || this.__src
      img.alt = this.__altText
      if (this.__width) img.width = this.__width
      if (this.__height) img.height = this.__height
      return { element: img }
    }

    const anchor = document.createElement("a")
    anchor.href = this.__url
    anchor.textContent = this.__title || this.__url
    return { element: anchor }
  }

  isInline(): false {
    return false
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  getUrl(): string {
    return this.__url
  }

  getDisplayMode(): ReferenceDisplayMode {
    return this.__displayMode
  }

  getTitle(): string {
    return this.__title
  }

  getDescription(): string {
    return this.__description
  }

  getImageUrl(): string {
    return this.__imageUrl
  }

  getFaviconUrl(): string {
    return this.__faviconUrl
  }

  getImageId(): string {
    return this.__imageId
  }

  getSrc(): string {
    return this.__src
  }

  getAltText(): string {
    return this.__altText
  }

  getWidth(): number | undefined {
    return this.__width
  }

  getHeight(): number | undefined {
    return this.__height
  }

  getAlignment(): ImageAlignment {
    return this.__alignment
  }

  getAutoResolve(): boolean {
    return this.__autoResolve
  }

  getHydrationAttempted(): boolean {
    return this.__hydrationAttempted
  }

  setUrl(url: string): void {
    this.getWritable().__url = url
  }

  setTitle(title: string): void {
    this.getWritable().__title = title
  }

  setDescription(description: string): void {
    this.getWritable().__description = description
  }

  setDisplayMode(displayMode: ReferenceDisplayMode): void {
    this.getWritable().__displayMode = displayMode
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

  setImageId(imageId: string): void {
    this.getWritable().__imageId = imageId
  }

  setSrc(src: string): void {
    this.getWritable().__src = src
  }

  setAltText(altText: string): void {
    this.getWritable().__altText = altText
  }

  setLoading(loading: boolean): void {
    this.getWritable().__loading = loading
  }

  setAlignment(alignment: ImageAlignment): void {
    this.getWritable().__alignment = alignment
  }

  setWidthAndHeight(width: number | undefined, height: number | undefined): void {
    const writable = this.getWritable()
    writable.__width = width
    writable.__height = height
  }

  /** Finished downloading a remote URL to local storage. */
  setLocalImage(imageId: string, src: string, width?: number, height?: number): void {
    const writable = this.getWritable()
    writable.__imageId = imageId
    writable.__src = src
    if (width !== undefined) writable.__width = width
    if (height !== undefined) writable.__height = height
    writable.__loading = false
  }

  /** Flip a card into an image in place — the URL is preserved. */
  setAsImage(params: { imageId?: string; src?: string; altText?: string; url?: string }): void {
    const writable = this.getWritable()
    writable.__displayMode = "image"
    writable.__hydrationAttempted = true
    writable.__loading = false
    if (params.imageId !== undefined) writable.__imageId = params.imageId
    if (params.src !== undefined) writable.__src = params.src
    if (params.altText !== undefined) writable.__altText = params.altText
    if (params.url) writable.__url = params.url
  }

  markHydrationAttempted(): void {
    this.getWritable().__hydrationAttempted = true
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
    // Resolved via the registry so this module stays importable without the
    // renderer/React-component runtime (headless Yjs, main process, MCP).
    const Renderer = getNodeRenderer("reference")
    if (!Renderer) return null
    const props = {
      nodeKey: this.__key,
      url: this.__url,
      displayMode: this.__displayMode,
      title: this.__title,
      description: this.__description,
      imageUrl: this.__imageUrl,
      faviconUrl: this.__faviconUrl,
      imageId: this.__imageId,
      src: this.__src,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
      loading: this.__loading,
      alignment: this.__alignment,
      sourceUrl: this.__url,
      autoResolve: this.__autoResolve,
      hydrationAttempted: this.__hydrationAttempted,
    }
    return <Renderer {...props} />
  }
}

function convertImageElement(domNode: Node): DOMConversionOutput | null {
  const img = domNode as HTMLImageElement
  if (img.src) {
    return {
      node: $createReferenceNode({
        displayMode: "image",
        src: img.src,
        url: img.src,
        altText: img.alt || "",
        width: img.width || undefined,
        height: img.height || undefined,
      }),
    }
  }
  return null
}

export function $createReferenceNode(params: ReferenceNodeParams = {}): ReferenceNode {
  return $applyNodeReplacement(new ReferenceNode(params))
}

export function $isReferenceNode(
  node: LexicalNode | null | undefined,
): node is ReferenceNode {
  return node instanceof ReferenceNode
}
