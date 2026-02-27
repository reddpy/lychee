import { useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  type NodeKey,
} from "lexical"
import { mergeRegister } from "@lexical/utils"
import { $isYouTubeNode, YouTubeNode } from "./youtube-node"
import type { ImageAlignment } from "./image-node"
import { cn } from "@/lib/utils"
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react"
import { useMediaStore } from "@/renderer/media-store"
import { useNoteContext } from "@/renderer/note-context"

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
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const [isResizing, setIsResizing] = useState(false)
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

  // Keyboard commands
  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if ($isYouTubeNode(node)) node.remove()
        return true
      }
      return false
    }

    const onEnter = (event: KeyboardEvent | null) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        if (event) event.preventDefault()
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if (!node) return
          const next = node.getNextSibling()
          if (next) {
            next.selectStart()
          } else {
            const paragraph = $createParagraphNode()
            node.insertAfter(paragraph)
            paragraph.selectStart()
          }
        })
        return true
      }
      return false
    }

    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          if (isResizing) return true
          const target = event.target as Node
          if (containerRef.current?.contains(target)) {
            if ((target as HTMLElement).closest?.(".image-toolbar")) return true
            if (!event.shiftKey) clearSelection()
            setSelected(true)
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_LOW),
    )
  }, [editor, isResizing, isSelected, nodeKey, setSelected, clearSelection])

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

  // Resize
  const onResizeStart = useCallback(
    (e: React.PointerEvent, side: "left" | "right") => {
      e.preventDefault()
      e.stopPropagation()
      const container = containerRef.current
      if (!container) return
      setIsResizing(true)

      const startX = e.clientX
      const startWidth = container.offsetWidth
      const maxWidth = container.parentElement?.offsetWidth ?? 800

      const onMove = (me: PointerEvent) => {
        let dx = me.clientX - startX
        if (side === "left") dx = -dx
        const newWidth = Math.max(200, Math.min(maxWidth, startWidth + dx))
        container.style.width = `${newWidth}px`
      }

      const onUp = () => {
        document.removeEventListener("pointermove", onMove)
        document.removeEventListener("pointerup", onUp)

        const finalWidth = Math.round(containerRef.current?.offsetWidth ?? startWidth)
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if ($isYouTubeNode(node)) node.setWidth(finalWidth)
        })

        setTimeout(() => setIsResizing(false), 100)
      }

      document.addEventListener("pointermove", onMove)
      document.addEventListener("pointerup", onUp)
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
