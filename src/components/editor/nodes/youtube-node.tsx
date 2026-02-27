import type { ReactElement } from "react"
import {
  $applyNodeReplacement,
  DecoratorNode,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"
import type { ImageAlignment } from "./image-node"
import { YouTubeComponent } from "./youtube-component"

export type SerializedYouTubeNode = Spread<
  {
    type: "youtube"
    videoId: string
    width?: number
    alignment?: ImageAlignment
    version: 1
  },
  SerializedLexicalNode
>

export class YouTubeNode extends DecoratorNode<ReactElement | null> {
  __videoId: string
  __width: number | undefined
  __alignment: ImageAlignment

  static getType(): string {
    return "youtube"
  }

  static clone(node: YouTubeNode): YouTubeNode {
    return new YouTubeNode(
      node.__videoId,
      node.__width,
      node.__alignment,
      node.__key,
    )
  }

  constructor(
    videoId: string,
    width?: number,
    alignment: ImageAlignment = "left",
    key?: NodeKey,
  ) {
    super(key)
    this.__videoId = videoId
    this.__width = width
    this.__alignment = alignment
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div")
    div.className = "editor-youtube"
    return div
  }

  updateDOM(): boolean {
    return false
  }

  static importDOM(): DOMConversionMap | null {
    return {
      iframe: () => ({
        conversion: convertYouTubeIframe,
        priority: 0,
      }),
    }
  }

  static importJSON(serializedNode: SerializedYouTubeNode): YouTubeNode {
    return $createYouTubeNode({
      videoId: serializedNode.videoId,
      width: serializedNode.width,
      alignment: serializedNode.alignment,
    })
  }

  exportJSON(): SerializedYouTubeNode {
    return {
      type: "youtube",
      videoId: this.__videoId,
      width: this.__width,
      alignment: this.__alignment,
      version: 1,
    }
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const iframe = document.createElement("iframe")
    iframe.src = `https://www.youtube-nocookie.com/embed/${this.__videoId}`
    iframe.width = this.__width ? String(this.__width) : "560"
    iframe.height = this.__width ? String(Math.round(this.__width * 9 / 16)) : "315"
    iframe.allowFullscreen = true
    iframe.setAttribute("frameborder", "0")
    return { element: iframe }
  }

  isInline(): false {
    return false
  }

  isKeyboardSelectable(): boolean {
    return true
  }

  setWidth(width: number | undefined): void {
    const writable = this.getWritable()
    writable.__width = width
  }

  setAlignment(alignment: ImageAlignment): void {
    const writable = this.getWritable()
    writable.__alignment = alignment
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactElement | null {
    return (
      <YouTubeComponent
        nodeKey={this.__key}
        videoId={this.__videoId}
        width={this.__width}
        alignment={this.__alignment}
      />
    )
  }
}

function convertYouTubeIframe(domNode: Node): DOMConversionOutput | null {
  const iframe = domNode as HTMLIFrameElement
  const src = iframe.src || ""
  const match = src.match(
    /youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  )
  if (match) {
    return { node: $createYouTubeNode({ videoId: match[1] }) }
  }
  return null
}

export interface CreateYouTubeNodeParams {
  videoId: string
  width?: number
  alignment?: ImageAlignment
}

export function $createYouTubeNode(params: string | CreateYouTubeNodeParams): YouTubeNode {
  const p = typeof params === "string" ? { videoId: params } : params
  return $applyNodeReplacement(
    new YouTubeNode(p.videoId, p.width, p.alignment ?? "left"),
  )
}

export function $isYouTubeNode(
  node: LexicalNode | null | undefined,
): node is YouTubeNode {
  return node instanceof YouTubeNode
}
