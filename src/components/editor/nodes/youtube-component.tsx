import { useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  type NodeKey,
} from "lexical"
import { $isYouTubeNode, YouTubeNode } from "./youtube-node"
import type { ImageAlignment } from "./image-node"
import { cn } from "@/lib/utils"
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react"
import { useMediaStore } from "@/renderer/media-store"
import { useNoteContext } from "@/renderer/note-context"
import { useDecoratorBlock } from "@/components/editor/hooks/use-decorator-block"
import { useBlockResize } from "@/components/editor/hooks/use-block-resize"

// ── YouTube IFrame API loader (singleton) ──────────────────────────
let ytApiReady: Promise<void> | null = null

function loadYTApi(): Promise<void> {
  if (ytApiReady) return ytApiReady
  ytApiReady = new Promise<void>((resolve) => {
    if ((window as any).YT?.Player) {
      resolve()
      return
    }
    const prev = (window as any).onYouTubeIframeAPIReady
    ;(window as any).onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const tag = document.createElement("script")
    tag.src = "https://www.youtube.com/iframe_api"
    document.head.appendChild(tag)
  })
  return ytApiReady
}

// ── Alignment helpers ──────────────────────────────────────────────
const ALIGNMENT_MARGIN: Record<ImageAlignment, React.CSSProperties> = {
  left: {},
  center: { marginLeft: "auto", marginRight: "auto" },
  right: { marginLeft: "auto" },
}

interface YouTubeComponentProps {
  nodeKey: NodeKey
  videoId: string
  width: number | undefined
  alignment: ImageAlignment
}

export function YouTubeComponent({
  nodeKey,
  videoId,
  width: initialWidth,
  alignment: initialAlignment,
}: YouTubeComponentProps) {
  const [editor] = useLexicalComposerContext()
  const [currentWidth, setCurrentWidth] = useState(initialWidth)
  const [currentAlignment, setCurrentAlignment] = useState(initialAlignment)
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const playerRef = useRef<any>(null)
  const noteCtx = useNoteContext()
  const setPlaying = useMediaStore((s) => s.setPlaying)
  const setPaused = useMediaStore((s) => s.setPaused)

  // Stable ref so the YT.Player callback always reads the latest context
  const noteCtxRef = useRef(noteCtx)
  noteCtxRef.current = noteCtx

  // ── Shared hooks ──
  const applySize = useCallback(
    (width: number) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isYouTubeNode(node)) node.setWidth(width)
      })
    },
    [editor, nodeKey],
  )

  const { isResizing, onResizeStart } = useBlockResize({
    resizeRef: containerRef,
    containerRef,
    aspectMode: "fixed",
    applySize: (w) => applySize(w),
  })

  const { isSelected } = useDecoratorBlock({
    nodeKey,
    containerRef,
    isNodeType: $isYouTubeNode,
    isResizing,
    ignoreClickSelector: ".image-toolbar",
  })

  // Sync with node state via mutation listener
  const stateRef = useRef({ currentWidth, currentAlignment })
  stateRef.current = { currentWidth, currentAlignment }

  useEffect(() => {
    return editor.registerMutationListener(YouTubeNode, (mutations) => {
      if (!mutations.has(nodeKey)) return
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey)
        if (!$isYouTubeNode(node)) return
        const s = stateRef.current
        if (node.__width !== s.currentWidth) setCurrentWidth(node.__width)
        if (node.__alignment !== s.currentAlignment) setCurrentAlignment(node.__alignment)
      })
    })
  }, [editor, nodeKey])

  // Initialize YT.Player after iframe mounts
  useEffect(() => {
    let destroyed = false

    const init = async () => {
      await loadYTApi()
      if (destroyed || !iframeRef.current) return
      const YT = (window as any).YT
      const player = new YT.Player(iframeRef.current, {
        events: {
          onStateChange: (event: any) => {
            if (destroyed) return
            const ctx = noteCtxRef.current
            if (event.data === YT.PlayerState.PLAYING) {
              const vtitle = (() => { try { return player.getVideoData()?.title } catch { return "" } })() || ""
              setPlaying(
                nodeKey,
                ctx.documentId,
                ctx.title,
                videoId,
                vtitle,
                "youtube",
                () => { try { player.pauseVideo() } catch { /* noop */ } },
                () => { try { player.playVideo() } catch { /* noop */ } },
                () => containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
              )
            } else if (
              event.data === YT.PlayerState.PAUSED ||
              event.data === YT.PlayerState.ENDED
            ) {
              setPaused(nodeKey)
            }
          },
        },
      })
      playerRef.current = player
    }

    init()

    return () => {
      destroyed = true
      playerRef.current = null
      setPaused(nodeKey)
    }
  }, [nodeKey, videoId, setPlaying, setPaused])

  // Alignment
  const onAlignmentChange = useCallback(
    (alignment: ImageAlignment) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isYouTubeNode(node)) node.setAlignment(alignment)
      })
    },
    [editor, nodeKey],
  )

  // iframe is interactive only when selected and not resizing (so user can play video)
  const iframeInteractive = isSelected && !isResizing

  return (
    <div
      ref={containerRef}
      className={cn("youtube-container", isSelected && "selected", isResizing && "resizing")}
      style={{
        width: currentWidth ? `${currentWidth}px` : undefined,
        ...ALIGNMENT_MARGIN[currentAlignment],
      }}
    >
      <iframe
        ref={iframeRef}
        src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="YouTube video"
        style={{ pointerEvents: iframeInteractive ? "auto" : "none" }}
      />

      {/* Toolbar */}
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
      </div>

      {/* Resize handles */}
      <div className="image-resizer image-resizer-left" onPointerDown={(e) => onResizeStart(e, "left")} />
      <div className="image-resizer image-resizer-right" onPointerDown={(e) => onResizeStart(e, "right")} />
    </div>
  )
}
