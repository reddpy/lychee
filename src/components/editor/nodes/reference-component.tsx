import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  HISTORY_PUSH_TAG,
  type NodeKey,
} from "lexical"
import {
  $isReferenceNode,
  ReferenceNode,
  type ImageAlignment,
  type ReferenceDisplayMode,
} from "./reference-node"
import { $convertReferenceToLink } from "@/components/editor/utils/reference-link"
import { LYCHEE_SAVE_TAG } from "@/components/editor/editor"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDocumentStore } from "@/renderer/document-store"
import { parseInternalNoteUrl } from "@/shared/internal-note-link"
import { RENDERER_CONTEXT_MENU_CLOSED_EVENT } from "@/shared/editor-events"
import { cn } from "@/lib/utils"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  ImageOff,
  Link2,
  Loader2,
  SquareArrowOutUpRight,
  Trash2,
  Unlink,
} from "lucide-react"
import { useDecoratorBlock } from "@/components/editor/hooks/use-decorator-block"
import { useBlockResize } from "@/components/editor/hooks/use-block-resize"

function getHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function toImageUrl(filename: string): string {
  if (!filename) return ""
  if (
    filename.startsWith("lychee-image://") ||
    filename.startsWith("data:") ||
    filename.startsWith("http")
  ) {
    return filename
  }
  return `lychee-image://image/${filename}`
}

const CARD_ACTION_BUTTON =
  "inline-flex h-6 w-6 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"

/** Tooltip wrapper matching the floating toolbar's hover affordance. */
function HoverTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  )
}

interface ReferenceComponentProps {
  nodeKey: NodeKey
  url: string
  displayMode: ReferenceDisplayMode
  title: string
  description: string
  imageUrl: string
  faviconUrl: string
  imageId: string
  src: string
  altText: string
  width: number | undefined
  height: number | undefined
  loading: boolean
  alignment: ImageAlignment
  sourceUrl: string
  autoResolve: boolean
  hydrationAttempted: boolean
}

/**
 * Single decorator entry point for every URL reference. The canonical URL lives
 * on the node; this only routes to the right presentation for its display mode.
 */
export function ReferenceComponent(props: ReferenceComponentProps) {
  const { nodeKey, displayMode: initialDisplayMode } = props
  const [editor] = useLexicalComposerContext()
  const [displayMode, setDisplayMode] = useState(initialDisplayMode)
  const modeRef = useRef(displayMode)
  modeRef.current = displayMode

  // Keep in sync both when Lexical re-renders the decorator with new props and
  // when only a property mutation fires (card upgraded to image in place).
  useEffect(() => {
    setDisplayMode(initialDisplayMode)
  }, [initialDisplayMode])

  // A card can be upgraded to an image in place during hydration (the URL is
  // preserved). Keep the rendered mode in sync with the node.
  useEffect(() => {
    return editor.registerMutationListener(ReferenceNode, (mutations) => {
      if (!mutations.has(nodeKey)) return
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isReferenceNode(node) && node.getDisplayMode() !== modeRef.current) {
          setDisplayMode(node.getDisplayMode())
        }
      })
    })
  }, [editor, nodeKey])

  if (displayMode === "image") {
    return (
      <ReferenceImage
        nodeKey={props.nodeKey}
        imageId={props.imageId}
        src={props.src}
        altText={props.altText}
        width={props.width}
        height={props.height}
        loading={props.loading}
        alignment={props.alignment}
        sourceUrl={props.sourceUrl}
      />
    )
  }

  return (
    <ReferenceCard
      nodeKey={props.nodeKey}
      url={props.url}
      title={props.title}
      description={props.description}
      imageUrl={props.imageUrl}
      faviconUrl={props.faviconUrl}
      autoResolve={props.autoResolve}
      hydrationAttempted={props.hydrationAttempted}
    />
  )
}

function ReferenceToLinkButton({
  nodeKey,
  className,
}: {
  nodeKey: NodeKey
  className?: string
}) {
  const [editor] = useLexicalComposerContext()
  const handleConvert = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isReferenceNode(node)) $convertReferenceToLink(node)
    }, { tag: HISTORY_PUSH_TAG })
  }, [editor, nodeKey])

  return (
    <HoverTooltip label="Convert to link">
      <button
        type="button"
        className={className}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleConvert}
        aria-label="Convert to link"
      >
        <Unlink className="h-3 w-3" />
      </button>
    </HoverTooltip>
  )
}

/** Copies the canonical URL. Distinct from Convert to link, which turns the
 *  embed back into an inline link in the document. */
function ReferenceCopyLinkButton({
  url,
  className,
}: {
  url: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 1400)
      })
      .catch((err) => {
        console.error("Failed to copy link:", err)
      })
  }, [url])

  return (
    <HoverTooltip label="Copy link">
      <button
        type="button"
        className={className}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleCopy}
        aria-label="Copy link"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </HoverTooltip>
  )
}

/**
 * The canonical action surface for a reference block. Right-click works for
 * every display mode and, unlike the hover toolbar, can label actions so
 * "Copy link" and "Copy image" are unambiguous. Actions are composed per mode.
 */
function ReferenceContextMenu({
  nodeKey,
  url,
  isImage,
  imageId,
  children,
}: {
  nodeKey: NodeKey
  url: string
  isImage: boolean
  imageId: string
  children: ReactNode
}) {
  const [editor] = useLexicalComposerContext()
  const internalDocumentId = parseInternalNoteUrl(url)?.documentId ?? null
  const internalDocumentExists = useDocumentStore((state) =>
    internalDocumentId
      ? state.documents.some((document) => document.id === internalDocumentId)
      : false,
  )

  const open = useCallback(() => {
    if (!url) return
    if (internalDocumentId) {
      const state = useDocumentStore.getState()
      if (state.documents.some((document) => document.id === internalDocumentId)) {
        state.openOrSelectTab(internalDocumentId)
      }
      return
    }
    window.lychee.invoke("shell.openExternal", { url })
  }, [url, internalDocumentId])

  const openInNewTab = useCallback(() => {
    if (!internalDocumentId) return
    const state = useDocumentStore.getState()
    if (state.documents.some((document) => document.id === internalDocumentId)) {
      state.openTab(internalDocumentId)
    }
  }, [internalDocumentId])

  const copyLink = useCallback(() => {
    if (!url) return
    navigator.clipboard.writeText(url).catch((err) => {
      console.error("Failed to copy link:", err)
    })
  }, [url])

  const copyImage = useCallback(() => {
    if (!imageId) return
    window.lychee.invoke("clipboard.writeImage", { id: imageId }).catch((err) => {
      console.error("Failed to copy image:", err)
    })
  }, [imageId])

  const saveImageAs = useCallback(() => {
    if (!imageId) return
    window.lychee.invoke("images.saveAs", { id: imageId }).catch((err) => {
      console.error("Failed to save image:", err)
    })
  }, [imageId])

  const convertToLink = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isReferenceNode(node)) $convertReferenceToLink(node)
    }, { tag: HISTORY_PUSH_TAG })
  }, [editor, nodeKey])

  const remove = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isReferenceNode(node)) return
      const next = node.getNextSibling()
      node.remove()
      if (next) {
        next.selectStart()
      } else {
        const paragraph = $createParagraphNode()
        $getRoot().append(paragraph)
        paragraph.selectStart()
      }
    }, { tag: HISTORY_PUSH_TAG })
  }, [editor, nodeKey])

  const canCopyImage = isImage && imageId !== ""

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) window.dispatchEvent(new Event(RENDERER_CONTEXT_MENU_CLOSED_EVENT))
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {url && (
          <ContextMenuItem onSelect={open}>
            <ExternalLink className="h-4 w-4" />
            Open
          </ContextMenuItem>
        )}
        {internalDocumentId && internalDocumentExists && (
          <ContextMenuItem onSelect={openInNewTab}>
            <SquareArrowOutUpRight className="h-4 w-4" />
            Open in new tab
          </ContextMenuItem>
        )}
        {(url || canCopyImage) && <ContextMenuSeparator />}
        {url && (
          <ContextMenuItem onSelect={copyLink}>
            <Link2 className="h-4 w-4" />
            Copy link
          </ContextMenuItem>
        )}
        {canCopyImage && (
          <ContextMenuItem onSelect={copyImage}>
            <Copy className="h-4 w-4" />
            Copy image
          </ContextMenuItem>
        )}
        {canCopyImage && (
          <ContextMenuItem onSelect={saveImageAs}>
            <Download className="h-4 w-4" />
            Save image as…
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {url && (
          <ContextMenuItem onSelect={convertToLink}>
            <Unlink className="h-4 w-4" />
            Convert to link
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={remove}>
          <Trash2 className="h-4 w-4" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── Card mode ────────────────────────────────────────────────────────────────

interface ReferenceCardProps {
  nodeKey: NodeKey
  url: string
  title: string
  description: string
  imageUrl: string
  faviconUrl: string
  autoResolve: boolean
  hydrationAttempted: boolean
}

function ReferenceCard({
  nodeKey,
  url,
  title: initialTitle,
  description: initialDescription,
  imageUrl: initialImageUrl,
  faviconUrl: initialFaviconUrl,
  autoResolve,
  hydrationAttempted: initialHydrationAttempted,
}: ReferenceCardProps) {
  const [editor] = useLexicalComposerContext()
  const containerRef = useRef<HTMLDivElement>(null)

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [imageUrl, setImageUrl] = useState(initialImageUrl)
  const [faviconUrl, setFaviconUrl] = useState(initialFaviconUrl)
  const [hydrationAttempted, setHydrationAttempted] = useState(initialHydrationAttempted)
  const [isHydrating, setIsHydrating] = useState(false)

  const { isSelected } = useDecoratorBlock({
    nodeKey,
    containerRef,
    isNodeType: (node) => $isReferenceNode(node) && node.getDisplayMode() === "card",
  })

  // Mirror node state in component state so async updates re-render reliably.
  const stateRef = useRef({ title, description, imageUrl, faviconUrl, hydrationAttempted })
  stateRef.current = { title, description, imageUrl, faviconUrl, hydrationAttempted }

  useEffect(() => {
    return editor.registerMutationListener(ReferenceNode, (mutations) => {
      if (!mutations.has(nodeKey)) return
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey)
        if (!$isReferenceNode(node) || node.getDisplayMode() !== "card") return
        const s = stateRef.current
        if (node.getTitle() !== s.title) setTitle(node.getTitle())
        if (node.getDescription() !== s.description) setDescription(node.getDescription())
        if (node.getImageUrl() !== s.imageUrl) setImageUrl(node.getImageUrl())
        if (node.getFaviconUrl() !== s.faviconUrl) setFaviconUrl(node.getFaviconUrl())
        if (node.getHydrationAttempted() !== s.hydrationAttempted) {
          setHydrationAttempted(node.getHydrationAttempted())
        }
      })
    })
  }, [editor, nodeKey])

  // Hydrate metadata for newly-inserted cards and for nodes saved mid-fetch.
  // When autoResolve is true (inserted via Embed), ask the backend to
  // discriminate — if the URL is actually an image, flip this node's display
  // mode in place rather than replacing it, so the URL is never lost.
  // Marks the node as attempted on settle (success OR failure) so reopening a
  // doc with metadata-less cards doesn't refetch on every mount.
  useEffect(() => {
    if (hydrationAttempted) return
    const needsHydration = !title && !description && !imageUrl && !faviconUrl
    if (!needsHydration) return
    let cancelled = false
    setIsHydrating(true)

    // On `.catch` we deliberately do NOT mark hydration as attempted: IPC
    // rejection signals a transient failure (network down, backend hiccup),
    // not a definitive "no metadata exists." Leaving hydrationAttempted=false
    // lets the next mount retry. Definitive negative answers (`unsupported`)
    // DO mark attempted because they describe the resource, not the network.
    if (autoResolve) {
      window.lychee
        .invoke("url.resolve", { url })
        .then((result) => {
          if (cancelled) return
          editor.update(() => {
            const node = $getNodeByKey(nodeKey)
            if (!$isReferenceNode(node)) return
            if (result.type === "image") {
              node.setAsImage({
                imageId: result.id,
                src: result.filePath,
                url: result.sourceUrl,
              })
              return
            }
            if (result.type === "bookmark") {
              node.setMetadata({
                title: result.title,
                description: result.description,
                imageUrl: result.imageUrl,
                faviconUrl: result.faviconUrl,
              })
              return
            }
            node.markHydrationAttempted()
          }, { tag: ["history-merge", LYCHEE_SAVE_TAG] })
        })
        .catch((err) => {
          console.error("Failed to resolve embed URL:", err)
        })
        .finally(() => {
          setIsHydrating(false)
        })
    } else {
      window.lychee
        .invoke("url.fetchMetadata", { url })
        .then((meta) => {
          if (cancelled) return
          editor.update(() => {
            const node = $getNodeByKey(nodeKey)
            if ($isReferenceNode(node)) {
              node.setMetadata({
                title: meta.title,
                description: meta.description,
                imageUrl: meta.imageUrl,
                faviconUrl: meta.faviconUrl,
              })
            }
          }, { tag: ["history-merge", LYCHEE_SAVE_TAG] })
        })
        .catch((err) => {
          console.error("Failed to fetch bookmark metadata:", err)
        })
        .finally(() => {
          setIsHydrating(false)
        })
    }

    return () => {
      cancelled = true
    }
  }, [
    hydrationAttempted,
    title,
    description,
    imageUrl,
    faviconUrl,
    autoResolve,
    nodeKey,
    url,
    editor,
  ])

  const handleClick = useCallback(() => {
    window.lychee.invoke("shell.openExternal", { url })
  }, [url])

  const displayTitle = title || getHostname(url)
  const displayDescription = description || url

  return (
    <ReferenceContextMenu nodeKey={nodeKey} url={url} isImage={false} imageId="">
      <div
        ref={containerRef}
        className={cn("bookmark-card group relative", isSelected && "selected")}
        onDoubleClick={handleClick}
        title={`Double-click to open ${url}`}
      >
      <div className="bookmark-content">
        <div className="bookmark-text">
          <div className="bookmark-title">{displayTitle}</div>
          {description && <div className="bookmark-description">{displayDescription}</div>}
          <div className="bookmark-url">
            {faviconUrl ? (
              <img
                className="bookmark-favicon"
                src={faviconUrl}
                alt=""
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = "none"
                }}
              />
            ) : (
              <Globe className="bookmark-favicon-fallback" />
            )}
            <span>{getHostname(url)}</span>
            {isHydrating && (
              <Loader2 className="bookmark-hydrating-spinner size-3 animate-spin" />
            )}
          </div>
        </div>
        {imageUrl && (
          <div className="bookmark-image">
            <img
              src={imageUrl}
              alt=""
              onError={(e) => {
                ;(e.target as HTMLImageElement).parentElement!.style.display = "none"
              }}
            />
          </div>
        )}
      </div>
      {url && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <ReferenceCopyLinkButton url={url} className={CARD_ACTION_BUTTON} />
          <ReferenceToLinkButton nodeKey={nodeKey} className={CARD_ACTION_BUTTON} />
        </div>
      )}
      </div>
    </ReferenceContextMenu>
  )
}

// ── Image mode ───────────────────────────────────────────────────────────────

interface ReferenceImageProps {
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

function ReferenceImage({
  nodeKey,
  imageId: initialImageId,
  src: initialSrc,
  altText,
  width,
  height,
  loading: initialLoading,
  alignment: initialAlignment,
  sourceUrl: initialSourceUrl,
}: ReferenceImageProps) {
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
    (w: number, h: number) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isReferenceNode(node) && node.getDisplayMode() === "image") {
          node.setWidthAndHeight(w, h)
        }
      })
    },
    [editor, nodeKey],
  )

  const { isResizing, onResizeStart } = useBlockResize({
    resizeRef: imageRef,
    containerRef,
    applySize,
  })

  const { isSelected } = useDecoratorBlock({
    nodeKey,
    containerRef,
    isNodeType: (node) => $isReferenceNode(node) && node.getDisplayMode() === "image",
    isResizing,
    ignoreClickSelector: ".image-toolbar",
  })

  // Reactively read node state — ensures component stays in sync even if
  // decorate() isn't re-called (e.g. after async property updates).
  const stateRef = useRef({
    isLoading,
    currentSrc,
    currentImageId,
    currentAlignment,
    currentSourceUrl,
  })
  stateRef.current = {
    isLoading,
    currentSrc,
    currentImageId,
    currentAlignment,
    currentSourceUrl,
  }

  useEffect(() => {
    return editor.registerMutationListener(ReferenceNode, (mutations) => {
      if (!mutations.has(nodeKey)) return
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey)
        if (!$isReferenceNode(node) || node.getDisplayMode() !== "image") return
        const s = stateRef.current
        if (node.__loading !== s.isLoading) setIsLoading(node.__loading)
        if (node.__src !== s.currentSrc) setCurrentSrc(node.__src)
        if (node.__imageId !== s.currentImageId) setCurrentImageId(node.__imageId)
        if (node.__alignment !== s.currentAlignment) setCurrentAlignment(node.__alignment)
        if (node.__url !== s.currentSourceUrl) setCurrentSourceUrl(node.__url)
      })
    })
  }, [editor, nodeKey])

  // Preload image via offscreen Image object — avoids hacky hidden <img> tricks.
  // Runs whenever we have a resolved src, including the loading-from-remote-URL
  // state where src points at the canonical URL while the local copy downloads.
  useEffect(() => {
    if (!resolvedSrc) return
    setHasError(false)
    setIsImageLoaded(false)
    const img = new Image()
    img.src = resolvedSrc
    img.onload = () => setIsImageLoaded(true)
    img.onerror = () => setHasError(true)
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [resolvedSrc])

  // Resolve imageId → file path on mount (for nodes loaded from JSON that have
  // imageId but no src). When no local image is available, fall back to
  // rendering the canonical URL directly.
  useEffect(() => {
    if (currentSrc) {
      setResolvedSrc(toImageUrl(currentSrc))
      return
    }
    if (!currentImageId) {
      setResolvedSrc(currentSourceUrl ? toImageUrl(currentSourceUrl) : "")
      return
    }
    let cancelled = false
    window.lychee
      .invoke("images.getPath", { id: currentImageId })
      .then(({ filePath }) => {
        if (cancelled) return
        const fileUrl = toImageUrl(filePath)
        setResolvedSrc(fileUrl)
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if ($isReferenceNode(node) && node.getDisplayMode() === "image") {
            node.setSrc(filePath)
          }
        })
      })
      .catch(() => {
        if (!cancelled) setHasError(true)
      })
    return () => {
      cancelled = true
    }
  }, [currentImageId, currentSrc, currentSourceUrl, nodeKey, editor])

  // Hydration: download the remote image to a local file when the node is in
  // loading-from-URL state. Runs both for newly-inserted embeds and for nodes
  // that were saved mid-download (the partial state persisted to disk).
  // On `.catch` we deliberately do NOT clear `loading`: an IPC rejection
  // signals a transient failure (network down, rate-limit), so leaving the
  // node in loading state lets the next mount retry. The spinner doesn't get
  // stuck visually because `<img src={url}>` still renders from the remote URL
  // while waiting.
  useEffect(() => {
    if (!isLoading) return
    if (currentImageId) return
    if (!currentSourceUrl) return
    let cancelled = false
    window.lychee
      .invoke("images.download", { url: currentSourceUrl })
      .then(({ id, filePath }) => {
        if (cancelled) return
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if ($isReferenceNode(node) && node.getDisplayMode() === "image") {
            node.setLocalImage(id, filePath)
          }
        }, { tag: ["history-merge", LYCHEE_SAVE_TAG] })
      })
      .catch((err) => {
        console.error("Failed to download image:", err)
      })
    return () => {
      cancelled = true
    }
  }, [isLoading, currentImageId, currentSourceUrl, nodeKey, editor])

  // ── Alignment ──
  const onAlignmentChange = useCallback(
    (alignment: ImageAlignment) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isReferenceNode(node) && node.getDisplayMode() === "image") {
          node.setAlignment(alignment)
        }
      })
    },
    [editor, nodeKey],
  )

  const showImage = !!(resolvedSrc && !hasError && isImageLoaded)
  const showError = hasError || (!isLoading && !resolvedSrc)
  const showSpinner = !showImage && !showError

  return (
    <ReferenceContextMenu
      nodeKey={nodeKey}
      url={currentSourceUrl}
      isImage={true}
      imageId={currentImageId}
    >
      <div
        ref={containerRef}
        className={cn("image-container", isSelected && "selected", isResizing && "resizing")}
      >
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

      {/* Toolbar — available once the image is visible (including while a local
          copy is still being downloaded in the background). */}
      {showImage && (
        <div className="image-toolbar">
          <HoverTooltip label="Align left">
            <button
              className={cn("image-toolbar-btn", currentAlignment === "left" && "active")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAlignmentChange("left")}
              aria-label="Align left"
            >
              <AlignLeft className="size-3.5" />
            </button>
          </HoverTooltip>
          <HoverTooltip label="Align center">
            <button
              className={cn("image-toolbar-btn", currentAlignment === "center" && "active")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAlignmentChange("center")}
              aria-label="Align center"
            >
              <AlignCenter className="size-3.5" />
            </button>
          </HoverTooltip>
          <HoverTooltip label="Align right">
            <button
              className={cn("image-toolbar-btn", currentAlignment === "right" && "active")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAlignmentChange("right")}
              aria-label="Align right"
            >
              <AlignRight className="size-3.5" />
            </button>
          </HoverTooltip>
          {currentSourceUrl && (
            <>
              <div className="image-toolbar-divider" />
              <HoverTooltip label="Open in browser">
                <button
                  className="image-toolbar-url"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    window.lychee.invoke("shell.openExternal", { url: currentSourceUrl })
                  }
                >
                  <ExternalLink className="size-3" />
                  <span>{getHostname(currentSourceUrl)}</span>
                </button>
              </HoverTooltip>
            </>
          )}
          {currentSourceUrl && (
            <>
              <div className="image-toolbar-divider" />
              <ReferenceCopyLinkButton url={currentSourceUrl} className="image-toolbar-copy" />
              <ReferenceToLinkButton nodeKey={nodeKey} className="image-toolbar-convert" />
            </>
          )}
        </div>
      )}

      {/* Resize handles — visible on hover via CSS */}
      {isImageLoaded && (
        <>
          <div
            className="image-resizer image-resizer-left"
            onPointerDown={(e) => onResizeStart(e, "left")}
          />
          <div
            className="image-resizer image-resizer-right"
            onPointerDown={(e) => onResizeStart(e, "right")}
          />
        </>
      )}
      </div>
    </ReferenceContextMenu>
  )
}
