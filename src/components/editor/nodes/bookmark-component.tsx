import { useCallback, useRef } from "react"
import {
  type NodeKey,
} from "lexical"
import { $isBookmarkNode } from "./bookmark-node"
import { cn } from "@/lib/utils"
import { Globe } from "lucide-react"
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
}

export function BookmarkComponent({
  nodeKey,
  url,
  title,
  description,
  imageUrl,
  faviconUrl,
}: BookmarkComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const { isSelected } = useDecoratorBlock({
    nodeKey,
    containerRef,
    isNodeType: $isBookmarkNode,
  })

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
