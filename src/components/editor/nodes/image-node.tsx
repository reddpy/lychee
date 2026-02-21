import type { ReactElement } from "react"
import {
  $applyNodeReplacement,
  DecoratorNode,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  type Spread,
} from "lexical"
import { ImageComponent } from "./image-component"

export type SerializedImageNode = Spread<
  {
    type: "image"
    imageId: string
    altText: string
    width?: number
    height?: number
    version: 1
  },
  SerializedLexicalNode
>

export class ImageNode extends DecoratorNode<ReactElement | null> {
  __imageId: string
  __src: string
  __altText: string
  __width: number | undefined
  __height: number | undefined
  __loading: boolean

  static getType(): string {
    return "image"
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__imageId,
      node.__src,
      node.__altText,
      node.__width,
      node.__height,
      node.__loading,
      node.__key,
    )
  }

  constructor(
    imageId: string,
    src: string,
    altText: string = "",
    width?: number,
    height?: number,
    loading: boolean = false,
    key?: NodeKey,
  ) {
    super(key)
    this.__imageId = imageId
    this.__src = src
    this.__altText = altText
    this.__width = width
    this.__height = height
    this.__loading = loading
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div")
    div.className = "editor-image"
    return div
  }

  updateDOM(): boolean {
    return false
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: convertImageElement,
        priority: 0,
      }),
    }
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode({
      imageId: serializedNode.imageId,
      altText: serializedNode.altText,
      width: serializedNode.width,
      height: serializedNode.height,
    })
  }

  exportJSON(): SerializedImageNode {
    return {
      type: "image",
      imageId: this.__imageId,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
      version: 1,
    }
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const img = document.createElement("img")
    img.src = this.__src
    img.alt = this.__altText
    if (this.__width) img.width = this.__width
    if (this.__height) img.height = this.__height
    return { element: img }
  }

  isInline(): false {
    return false
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  setWidthAndHeight(width: number | undefined, height: number | undefined): void {
    const writable = this.getWritable()
    writable.__width = width
    writable.__height = height
  }

  setSrc(src: string): void {
    const writable = this.getWritable()
    writable.__src = src
  }

  setImageId(imageId: string): void {
    const writable = this.getWritable()
    writable.__imageId = imageId
  }

  setLoading(loading: boolean): void {
    const writable = this.getWritable()
    writable.__loading = loading
  }

  setAltText(altText: string): void {
    const writable = this.getWritable()
    writable.__altText = altText
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactElement | null {
    return (
      <ImageComponent
        nodeKey={this.__key}
        imageId={this.__imageId}
        src={this.__src}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
        loading={this.__loading}
      />
    )
  }
}

function convertImageElement(domNode: Node): DOMConversionOutput | null {
  const img = domNode as HTMLImageElement
  if (img.src) {
    return {
      node: $createImageNode({
        src: img.src,
        altText: img.alt || "",
        width: img.width || undefined,
        height: img.height || undefined,
      }),
    }
  }
  return null
}

export interface CreateImageNodeParams {
  imageId?: string
  src?: string
  altText?: string
  width?: number
  height?: number
  loading?: boolean
}

export function $createImageNode(params: CreateImageNodeParams = {}): ImageNode {
  return $applyNodeReplacement(
    new ImageNode(
      params.imageId ?? "",
      params.src ?? "",
      params.altText ?? "",
      params.width,
      params.height,
      params.loading ?? false,
    ),
  )
}

export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode
}
