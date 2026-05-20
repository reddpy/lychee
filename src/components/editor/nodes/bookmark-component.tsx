import { useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  type NodeKey,
} from "lexical"
import { $isBookmarkNode, BookmarkNode } from "./bookmark-node"
import { $createImageNode } from "./image-node"
import { cn } from "@/lib/utils"
import { Globe, Loader2 } from "lucide-react"
import { useDecoratorBlock } from "@/components/editor/hooks/use-decorator-block"

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

interface BookmarkComponentProps {
  nodeKey: NodeKey
  url: string
  title: string
  description: string
  imageUrl: string
  faviconUrl: string
  autoResolve: boolean
  hydrationAttempted: boolean
}

export function BookmarkComponent({
  nodeKey,
  url,
  title: initialTitle,
  description: initialDescription,
  imageUrl: initialImageUrl,
  faviconUrl: initialFaviconUrl,
  autoResolve,
  hydrationAttempted: initialHydrationAttempted,
}: BookmarkComponentProps) {
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
    isNodeType: $isBookmarkNode,
  })

  // Mirror node state in component state so async updates re-render reliably.
  const stateRef = useRef({ title, description, imageUrl, faviconUrl, hydrationAttempted })
  stateRef.current = { title, description, imageUrl, faviconUrl, hydrationAttempted }

  useEffect(() => {
    return editor.registerMutationListener(BookmarkNode, (mutations) => {
      if (!mutations.has(nodeKey)) return
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey)
        if (!$isBookmarkNode(node)) return
        const s = stateRef.current
        if (node.__title !== s.title) setTitle(node.__title)
        if (node.__description !== s.description) setDescription(node.__description)
        if (node.__imageUrl !== s.imageUrl) setImageUrl(node.__imageUrl)
        if (node.__faviconUrl !== s.faviconUrl) setFaviconUrl(node.__faviconUrl)
        if (node.__hydrationAttempted !== s.hydrationAttempted) setHydrationAttempted(node.__hydrationAttempted)
      })
    })
  }, [editor, nodeKey])

  // Hydrate metadata for newly-inserted bookmarks and for nodes that were
  // saved mid-fetch (partial state persisted to disk). When autoResolve is
  // true (bookmark inserted via Embed), ask the backend to discriminate —
  // if the URL is actually an image, swap this node out for an ImageNode.
  // Marks the node as attempted on settle (success OR failure) so reopening a
  // doc with metadata-less bookmarks doesn't refetch on every mount.
  useEffect(() => {
    if (hydrationAttempted) return
    const needsHydration = !title && !description && !imageUrl && !faviconUrl
    if (!needsHydration) return
    let cancelled = false
    setIsHydrating(true)

    // On `.catch` we deliberately do NOT mark hydration as attempted: IPC
    // rejection signals a transient failure (network down, backend hiccup),
    // not a definitive "no metadata exists." Leaving hydrationAttempted=false
    // lets the next mount retry — recovering when the user comes back online.
    // Definitive negative answers from the backend (youtube/unsupported below)
    // DO mark attempted because they describe the resource, not the network.
    if (autoResolve) {
      window.lychee.invoke("url.resolve", { url }).then((result) => {
        if (cancelled) return
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if (!$isBookmarkNode(node)) return
          if (result.type === "image") {
            const img = $createImageNode({
              imageId: result.id,
              src: result.filePath,
              sourceUrl: result.sourceUrl,
              loading: false,
            })
            node.replace(img)
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
          // youtube / unsupported: leave as bare bookmark — the backend gave
          // us a definitive answer about the resource type, so mark attempted.
          node.markHydrationAttempted()
        }, { tag: "history-merge" })
      }).catch((err) => {
        console.error("Failed to resolve embed URL:", err)
      }).finally(() => {
        setIsHydrating(false)
      })
    } else {
      window.lychee.invoke("url.fetchMetadata", { url }).then((meta) => {
        if (cancelled) return
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if ($isBookmarkNode(node)) {
            node.setMetadata({
              title: meta.title,
              description: meta.description,
              imageUrl: meta.imageUrl,
              faviconUrl: meta.faviconUrl,
            })
          }
        }, { tag: "history-merge" })
      }).catch((err) => {
        console.error("Failed to fetch bookmark metadata:", err)
      }).finally(() => {
        setIsHydrating(false)
      })
    }

    return () => { cancelled = true }
  }, [hydrationAttempted, title, description, imageUrl, faviconUrl, autoResolve, nodeKey, url, editor])

  const handleClick = useCallback(() => {
    window.lychee.invoke("shell.openExternal", { url })
  }, [url])

  const displayTitle = title || getHostname(url)
  const displayDescription = description || url

  return (
    <div
      ref={containerRef}
      className={cn("bookmark-card", isSelected && "selected")}
      onDoubleClick={handleClick}
      title={`Double-click to open ${url}`}
    >
      <div className="bookmark-content">
        <div className="bookmark-text">
          <div className="bookmark-title">{displayTitle}</div>
          {description && (
            <div className="bookmark-description">{displayDescription}</div>
          )}
          <div className="bookmark-url">
            {faviconUrl ? (
              <img
                className="bookmark-favicon"
                src={faviconUrl}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
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
                (e.target as HTMLImageElement).parentElement!.style.display = "none"
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
