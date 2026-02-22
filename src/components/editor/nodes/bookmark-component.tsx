import { useCallback, useEffect, useRef } from "react"
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
import { $isBookmarkNode } from "./bookmark-node"
import { cn } from "@/lib/utils"
import { Globe } from "lucide-react"

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
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keyboard commands when selected
  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if ($isBookmarkNode(node)) node.remove()
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
          if (containerRef.current?.contains(event.target as Node)) {
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
  }, [editor, isSelected, nodeKey, setSelected, clearSelection])

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
