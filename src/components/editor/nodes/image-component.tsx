import { useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $addUpdateTag,
  $getNodeByKey,
  type NodeKey,
} from "lexical"
import { $isImageNode, ImageNode, type ImageAlignment } from "./image-node"
import { cn } from "@/lib/utils"
import { Loader2, AlignLeft, AlignCenter, AlignRight, ImageOff, ExternalLink } from "lucide-react"
import { useDecoratorBlock } from "@/components/editor/hooks/use-decorator-block"
import { useBlockResize } from "@/components/editor/hooks/use-block-resize"

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function toImageUrl(filename: string): string {
  if (!filename) return ""
  if (filename.startsWith("lychee-image://") || filename.startsWith("data:") || filename.startsWith("http")) return filename
  return `lychee-image://image/${filename}`
}

interface ImageComponentProps {
  nodeKey: NodeKey
  imageId: string
  src: string
  altText: string
  width: number | undefined
  height: number | undefined
  loading: boolean
  alignment: ImageAlignment
  sourceUrl: string
}

export function ImageComponent({
  nodeKey,
  imageId: initialImageId,
  src: initialSrc,
  altText,
  width,
  height,
  loading: initialLoading,
  alignment: initialAlignment,
  sourceUrl: initialSourceUrl,
}: ImageComponentProps) {
  const [editor] = useLexicalComposerContext()
  const [resolvedSrc, setResolvedSrc] = useState(() => toImageUrl(initialSrc))
  const [isLoading, setIsLoading] = useState(initialLoading)
  const [hasError, setHasError] = useState(false)
  const [isImageLoaded, setIsImageLoaded] = useState(false)
  const [currentSrc, setCurrentSrc] = useState(initialSrc)
  const [currentImageId, setCurrentImageId] = useState(initialImageId)
  const [currentAlignment, setCurrentAlignment] = useState(initialAlignment)
  const [currentSourceUrl, setCurrentSourceUrl] = useState(initialSourceUrl)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Shared hooks ──
  const applySize = useCallback(
    (w: number, h: number | undefined) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isImageNode(node)) node.setWidthAndHeight(w, h ?? node.__height)
      })
    },
    [editor, nodeKey],
  )

  const { isResizing, onResizeStart } = useBlockResize({
    resizeRef: imageRef,
    containerRef,
    aspectMode: "preserve",
    applySize,
  })

  const { isSelected } = useDecoratorBlock({
    nodeKey,
    containerRef,
    isNodeType: $isImageNode,
    isResizing,
    ignoreClickSelector: ".image-toolbar",
  })

  // Reactively read node state — ensures component stays in sync even if
  // decorate() isn't re-called (e.g. after async property updates).
  const stateRef = useRef({ isLoading, currentSrc, currentImageId, currentAlignment, currentSourceUrl })
  stateRef.current = { isLoading, currentSrc, currentImageId, currentAlignment, currentSourceUrl }

  useEffect(() => {
    return editor.registerMutationListener(ImageNode, (mutations) => {
      if (!mutations.has(nodeKey)) return
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey)
        if (!$isImageNode(node)) return
        const s = stateRef.current
        if (node.__loading !== s.isLoading) setIsLoading(node.__loading)
        if (node.__src !== s.currentSrc) setCurrentSrc(node.__src)
        if (node.__imageId !== s.currentImageId) setCurrentImageId(node.__imageId)
        if (node.__alignment !== s.currentAlignment) setCurrentAlignment(node.__alignment)
        if (node.__sourceUrl !== s.currentSourceUrl) setCurrentSourceUrl(node.__sourceUrl)
      })
    })
  }, [editor, nodeKey])

  // Preload image via offscreen Image object — avoids hacky hidden <img> tricks
  // Skip while isLoading (main process is downloading, src may be a remote URL)
  useEffect(() => {
    if (!resolvedSrc || isLoading) return
    setHasError(false)
    setIsImageLoaded(false)
    const img = new Image()
    img.src = resolvedSrc
    img.onload = () => setIsImageLoaded(true)
    img.onerror = () => setHasError(true)
    return () => { img.onload = null; img.onerror = null }
  }, [resolvedSrc, isLoading])

  // Resolve imageId → file path on mount (for nodes loaded from JSON that have imageId but no src)
  useEffect(() => {
    if (currentSrc) {
      setResolvedSrc(toImageUrl(currentSrc))
      return
    }
    if (!currentImageId) {
      setResolvedSrc("")
      return
    }
    let cancelled = false
    window.lychee.invoke("images.getPath", { id: currentImageId }).then(({ filePath }) => {
      if (cancelled) return
      const fileUrl = toImageUrl(filePath)
      setResolvedSrc(fileUrl)
      editor.update(() => {
        $addUpdateTag('skip-selection-focus')
        const node = $getNodeByKey(nodeKey)
        if ($isImageNode(node)) node.setSrc(filePath)
      })
    })
    return () => { cancelled = true }
  }, [currentImageId, currentSrc, nodeKey, editor])

  // ── Alignment ──
  const onAlignmentChange = useCallback(
    (alignment: ImageAlignment) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isImageNode(node)) node.setAlignment(alignment)
      })
    },
    [editor, nodeKey],
  )

  const showError = !isLoading && (hasError || !resolvedSrc)
  const showImage = !isLoading && resolvedSrc && !hasError && isImageLoaded
  const showSpinner = isLoading || (!showImage && !showError)

  return (
    <div ref={containerRef} className={cn("image-container", isSelected && "selected", isResizing && "resizing")}>
      {showImage && (
        <img
          ref={imageRef}
          src={resolvedSrc}
          alt={altText}
          style={{
            width: width ? `${width}px` : undefined,
            height: height ? `${height}px` : undefined,
          }}
          draggable={false}
        />
      )}
      {showError && (
        <div className="image-placeholder image-error">
          <ImageOff className="size-5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground mt-1">Failed to load image</span>
        </div>
      )}
      {showSpinner && (
        <div className="image-placeholder">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground/70 mt-2">Loading media...</span>
        </div>
      )}

      {/* Toolbar — always available when not loading */}
      {!isLoading && (
        <div className="image-toolbar">
          <button
            className={cn("image-toolbar-btn", currentAlignment === "left" && "active")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAlignmentChange("left")}
          >
            <AlignLeft className="size-3.5" />
          </button>
          <button
            className={cn("image-toolbar-btn", currentAlignment === "center" && "active")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAlignmentChange("center")}
          >
            <AlignCenter className="size-3.5" />
          </button>
          <button
            className={cn("image-toolbar-btn", currentAlignment === "right" && "active")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAlignmentChange("right")}
          >
            <AlignRight className="size-3.5" />
          </button>
          {currentSourceUrl && (
            <>
              <div className="image-toolbar-divider" />
              <button
                className="image-toolbar-url"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => window.lychee.invoke("shell.openExternal", { url: currentSourceUrl })}
                title={currentSourceUrl}
              >
                <ExternalLink className="size-3" />
                <span>{getHostname(currentSourceUrl)}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Resize handles — visible on hover via CSS */}
      {isImageLoaded && (
        <>
          <div className="image-resizer image-resizer-left" onPointerDown={(e) => onResizeStart(e, "left")} />
          <div className="image-resizer image-resizer-right" onPointerDown={(e) => onResizeStart(e, "right")} />
        </>
      )}
    </div>
  )
}
