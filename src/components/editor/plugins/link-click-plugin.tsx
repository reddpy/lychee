"use client"

import { JSX, useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNearestNodeFromDOMNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ESCAPE_COMMAND,
  type LexicalNode,
} from "lexical"
import { $isAutoLinkNode, $isLinkNode } from "@lexical/link"
import { ExternalLink, Bookmark, Code, Loader2 } from "lucide-react"

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { $createImageNode } from "@/components/editor/nodes/image-node"
import { $createBookmarkNode } from "@/components/editor/nodes/bookmark-node"
import type { ResolvedUrlResult, UrlMetadataResult } from "@/shared/ipc-types"

function openExternalUrl(url: string) {
  window.lychee.invoke("shell.openExternal", { url }).catch((err) => {
    console.error("Failed to open URL:", err)
  })
}

interface HoverState {
  url: string
  anchorRect: DOMRect
  linkEl: HTMLAnchorElement
}

type ActionInProgress = "embed" | "bookmark" | null

export function LinkClickPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [hoverState, setHoverState] = useState<HoverState | null>(null)
  const [actionInProgress, setActionInProgress] = useState<ActionInProgress>(null)
  const hoverStateRef = useRef(hoverState)
  hoverStateRef.current = hoverState

  const dismiss = useCallback(() => {
    setHoverState(null)
    setActionInProgress(null)
  }, [])

  // Cmd+click to open + hover detection on links
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!event.metaKey && !event.ctrlKey) return

      const target = event.target as HTMLElement
      const linkElement = target.closest("a")
      if (!linkElement) return

      const href = linkElement.getAttribute("href")
      if (!href) return

      event.preventDefault()
      event.stopPropagation()
      openExternalUrl(href)
    }

    function handleMouseOver(event: MouseEvent) {
      const target = event.target as HTMLElement
      const linkElement = target.closest("a") as HTMLAnchorElement | null
      if (!linkElement) return

      const href = linkElement.getAttribute("href")
      if (!href) return

      // Don't re-trigger if already showing for this link
      if (hoverStateRef.current?.linkEl === linkElement) return

      const rect = linkElement.getBoundingClientRect()
      setHoverState({ url: href, anchorRect: rect, linkEl: linkElement })
    }

    function handleMouseOut(event: MouseEvent) {
      const target = event.target as HTMLElement
      const linkElement = target.closest("a") as HTMLAnchorElement | null
      if (!linkElement) return

      const related = event.relatedTarget as HTMLElement | null
      // If mouse moved into the popover (in a portal), stay open
      if (related?.closest("[data-slot='popover-content']")) return
      // If mouse moved to another part of the same link, stay open
      if (related && linkElement.contains(related)) return

      dismiss()
    }

    return editor.registerRootListener((rootElement, prevRootElement) => {
      if (prevRootElement) {
        prevRootElement.removeEventListener("click", handleClick)
        prevRootElement.removeEventListener("mouseover", handleMouseOver)
        prevRootElement.removeEventListener("mouseout", handleMouseOut)
      }
      if (rootElement) {
        rootElement.addEventListener("click", handleClick)
        rootElement.addEventListener("mouseover", handleMouseOver)
        rootElement.addEventListener("mouseout", handleMouseOut)
      }
    })
  }, [editor])

  // Popover mouse leave — dismiss unless mouse went back to the link
  const handlePopoverMouseLeave = useCallback((event: React.MouseEvent) => {
    if (actionInProgress) return

    const related = event.relatedTarget as HTMLElement | null
    if (related && hoverStateRef.current?.linkEl.contains(related)) return

    dismiss()
  }, [actionInProgress, dismiss])

  // ESC dismisses
  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (hoverStateRef.current) {
          dismiss()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, dismiss])

  // Scroll dismisses
  useEffect(() => {
    if (!hoverState) return

    const handleScroll = () => dismiss()
    window.addEventListener("scroll", handleScroll, true)
    return () => {
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [hoverState, dismiss])

  /**
   * Find the link node from its DOM element and replace it with the given node.
   */
  const replaceUrlNode = useCallback(
    (linkEl: HTMLAnchorElement, replacementNode: LexicalNode) => {
      const lexicalNode = $getNearestNodeFromDOMNode(linkEl)
      if (!lexicalNode) return

      // The nearest node might be a TextNode inside the link — walk up
      const linkNode =
        ($isAutoLinkNode(lexicalNode) || $isLinkNode(lexicalNode))
          ? lexicalNode
          : lexicalNode.getParent()

      if (!linkNode || (!$isAutoLinkNode(linkNode) && !$isLinkNode(linkNode))) return

      const parent = linkNode.getParent()
      if (parent && parent.getChildrenSize() === 1) {
        // The link is the only child of its paragraph — replace the whole paragraph
        parent.replace(replacementNode)
      } else {
        linkNode.insertAfter(replacementNode)
        linkNode.remove()
      }
      // Clear selection so the editor doesn't jump to a stale cursor position
      $setSelection(null)
    },
    [],
  )

  const createBookmark = useCallback(async (url: string, linkEl: HTMLAnchorElement) => {
    const meta: UrlMetadataResult = await window.lychee.invoke("url.fetchMetadata", { url })
    editor.update(
      () => {
        replaceUrlNode(linkEl, $createBookmarkNode({
          url: meta.url,
          title: meta.title,
          description: meta.description,
          imageUrl: meta.imageUrl,
          faviconUrl: meta.faviconUrl,
        }))
      },
      { tag: "link-hover-action" },
    )
  }, [editor, replaceUrlNode])

  const handleEmbed = useCallback(async () => {
    if (!hoverState) return
    setActionInProgress("embed")

    try {
      const result: ResolvedUrlResult = await window.lychee.invoke("url.resolve", { url: hoverState.url })

      if (result.type === "image") {
        editor.update(
          () => {
            replaceUrlNode(hoverState.linkEl, $createImageNode({
              imageId: result.id,
              src: result.filePath,
              sourceUrl: result.sourceUrl,
              loading: false,
            }))
          },
          { tag: "link-hover-action" },
        )
      } else {
        // Not embeddable as media — fall back to bookmark
        await createBookmark(hoverState.url, hoverState.linkEl)
      }
    } catch (err) {
      console.error("Failed to resolve URL:", err)
    } finally {
      dismiss()
    }
  }, [editor, hoverState, replaceUrlNode, createBookmark, dismiss])

  const handleBookmark = useCallback(async () => {
    if (!hoverState) return
    setActionInProgress("bookmark")

    try {
      await createBookmark(hoverState.url, hoverState.linkEl)
    } catch (err) {
      console.error("Failed to fetch metadata:", err)
    } finally {
      dismiss()
    }
  }, [hoverState, createBookmark, dismiss])

  const handleOpen = useCallback(() => {
    if (!hoverState) return
    openExternalUrl(hoverState.url)
    dismiss()
  }, [hoverState, dismiss])

  if (!hoverState) return null

  const btnClass = "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"

  const toolbarContent = actionInProgress ? (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{actionInProgress === "embed" ? "Embedding..." : "Creating bookmark..."}</span>
    </div>
  ) : (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={btnClass}
        onClick={handleBookmark}
        title="Convert to bookmark"
      >
        <Bookmark className="h-3 w-3" />
        Bookmark
      </button>
      <button
        type="button"
        className={btnClass}
        onClick={handleEmbed}
        title="Embed content"
      >
        <Code className="h-3 w-3" />
        Embed
      </button>
      <button
        type="button"
        className={btnClass}
        onClick={handleOpen}
        title="Open in browser"
      >
        <ExternalLink className="h-3 w-3" />
        Open
      </button>
    </div>
  )

  return (
    <Popover open={true} onOpenChange={(open) => { if (!open) dismiss() }}>
      <PopoverAnchor
        style={{
          position: "fixed",
          top: hoverState.anchorRect.bottom,
          left: hoverState.anchorRect.left,
          width: hoverState.anchorRect.width,
          height: 0,
        }}
      />
      <PopoverContent
        className="w-auto p-0 bg-transparent border-none shadow-none"
        side="bottom"
        align="start"
        sideOffset={0}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseLeave={handlePopoverMouseLeave}
      >
        <div className="pt-1.5">
          <div className="rounded-md border border-[hsl(var(--border))] bg-popover p-1 shadow-md">
            {toolbarContent}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
