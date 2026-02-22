"use client"

import { JSX, useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createNodeSelection,
  $getNodeByKey,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  HISTORY_PUSH_TAG,
  KEY_ESCAPE_COMMAND,
  type LexicalNode,
  type NodeKey,
} from "lexical"
import { $isAutoLinkNode, $isLinkNode } from "@lexical/link"
import { ExternalLink, Bookmark, Code, Loader2 } from "lucide-react"

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { $createImageNode } from "@/components/editor/nodes/image-node"
import { $createBookmarkNode } from "@/components/editor/nodes/bookmark-node"
import type { ResolvedUrlResult } from "@/shared/ipc-types"

function openExternalUrl(url: string) {
  window.lychee.invoke("shell.openExternal", { url }).catch((err) => {
    console.error("Failed to open URL:", err)
  })
}

function $isAnyLinkNode(node: LexicalNode | null): boolean {
  return $isAutoLinkNode(node) || $isLinkNode(node)
}

/** Resolve a Lexical node key to the nearest link node (key may point to a child TextNode). */
function $getLinkByKey(nodeKey: NodeKey): LexicalNode | null {
  let node = $getNodeByKey(nodeKey)
  if (node && !$isAnyLinkNode(node)) node = node.getParent()
  return node && $isAnyLinkNode(node) ? node : null
}

interface HoverState {
  url: string
  anchorRect: DOMRect
  linkEl: HTMLAnchorElement
  linkNodeKey: NodeKey
}

type ActionInProgress = "embed" | "bookmark" | null

const BTN =
  "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"

export function LinkClickPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [hoverState, setHoverState] = useState<HoverState | null>(null)
  const [actionInProgress, setActionInProgress] = useState<ActionInProgress>(null)
  const hoverRef = useRef(hoverState)
  hoverRef.current = hoverState

  const keyProp = `__lexicalKey_${(editor as any)._key}`

  const dismiss = useCallback((refocus = false) => {
    setHoverState(null)
    setActionInProgress(null)
    if (refocus) editor.getRootElement()?.focus({ preventScroll: true })
  }, [editor])

  // ── DOM events: Cmd+click, hover in/out ──
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!e.metaKey && !e.ctrlKey) return
      const a = (e.target as HTMLElement).closest("a")
      const href = a?.getAttribute("href")
      if (!href) return
      e.preventDefault()
      e.stopPropagation()
      openExternalUrl(href)
    }

    function handleMouseOver(e: MouseEvent) {
      const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute("href")
      if (!href || hoverRef.current?.linkEl === a) return

      // Walk DOM to find Lexical node key
      let nodeKey: NodeKey | undefined
      let el: HTMLElement | null = a
      while (el && !nodeKey) {
        nodeKey = (el as any)[keyProp]
        el = el.parentElement
      }
      if (!nodeKey) return

      setHoverState({ url: href, anchorRect: a.getBoundingClientRect(), linkEl: a, linkNodeKey: nodeKey })
    }

    function handleMouseOut(e: MouseEvent) {
      const a = (e.target as HTMLElement).closest("a")
      if (!a) return
      const related = e.relatedTarget as HTMLElement | null
      if (related?.closest("[data-slot='popover-content']")) return
      if (related && a.contains(related)) return
      dismiss()
    }

    return editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("click", handleClick)
      prev?.removeEventListener("mouseover", handleMouseOver)
      prev?.removeEventListener("mouseout", handleMouseOut)
      root?.addEventListener("click", handleClick)
      root?.addEventListener("mouseover", handleMouseOver)
      root?.addEventListener("mouseout", handleMouseOut)
    })
  }, [editor, keyProp, dismiss])

  // ── Popover mouse leave ──
  const onPopoverMouseLeave = useCallback((e: React.MouseEvent) => {
    if (actionInProgress) return
    const related = e.relatedTarget as HTMLElement | null
    if (related && hoverRef.current?.linkEl.contains(related)) return
    dismiss()
  }, [actionInProgress, dismiss])

  // ── ESC dismisses ──
  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => { if (hoverRef.current) { dismiss(); return true } return false },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, dismiss])

  // ── Scroll dismisses ──
  useEffect(() => {
    if (!hoverState) return
    const onScroll = () => dismiss()
    window.addEventListener("scroll", onScroll, true)
    return () => window.removeEventListener("scroll", onScroll, true)
  }, [hoverState, dismiss])

  // ── Core: replace a link node with a block-level replacement ──
  const replaceLink = useCallback(
    (nodeKey: NodeKey, replacement: LexicalNode) => {
      const link = $getLinkByKey(nodeKey)
      if (!link) return

      const parent = link.getParent()
      if (parent && parent.getChildrenSize() === 1) {
        parent.replace(replacement)
      } else {
        link.insertAfter(replacement)
        link.remove()
      }

      const sel = $createNodeSelection()
      sel.add(replacement.getKey())
      $setSelection(sel)
    },
    [],
  )

  /** Push current editor state to undo stack and move cursor to the link.
   *  Undo after conversion will restore cursor here instead of jumping. */
  const snapshotAndFocusLink = useCallback(
    (nodeKey: NodeKey) => {
      editor.update(() => {
        const link = $getLinkByKey(nodeKey)
        if (link) link.selectEnd()
      }, { tag: HISTORY_PUSH_TAG })
    },
    [editor],
  )

  const convertToBookmark = useCallback(async (url: string, nodeKey: NodeKey) => {
    const meta = await window.lychee.invoke("url.fetchMetadata", { url })
    editor.update(() => {
      replaceLink(nodeKey, $createBookmarkNode({
        url: meta.url,
        title: meta.title,
        description: meta.description,
        imageUrl: meta.imageUrl,
        faviconUrl: meta.faviconUrl,
      }))
    }, { tag: HISTORY_PUSH_TAG })
  }, [editor, replaceLink])

  const handleEmbed = useCallback(async () => {
    if (!hoverState) return
    const { url, linkNodeKey } = hoverState
    setActionInProgress("embed")
    snapshotAndFocusLink(linkNodeKey)
    try {
      const result: ResolvedUrlResult = await window.lychee.invoke("url.resolve", { url })
      if (result.type === "image") {
        editor.update(() => {
          replaceLink(linkNodeKey, $createImageNode({
            imageId: result.id,
            src: result.filePath,
            sourceUrl: result.sourceUrl,
            loading: false,
          }))
        }, { tag: HISTORY_PUSH_TAG })
      } else {
        await convertToBookmark(url, linkNodeKey)
      }
    } catch (err) {
      console.error("Failed to embed URL:", err)
    } finally {
      dismiss(true)
    }
  }, [editor, hoverState, replaceLink, convertToBookmark, snapshotAndFocusLink, dismiss])

  const handleBookmark = useCallback(async () => {
    if (!hoverState) return
    const { url, linkNodeKey } = hoverState
    setActionInProgress("bookmark")
    snapshotAndFocusLink(linkNodeKey)
    try {
      await convertToBookmark(url, linkNodeKey)
    } catch (err) {
      console.error("Failed to create bookmark:", err)
    } finally {
      dismiss(true)
    }
  }, [hoverState, convertToBookmark, snapshotAndFocusLink, dismiss])

  const handleOpen = useCallback(() => {
    if (!hoverState) return
    openExternalUrl(hoverState.url)
    dismiss()
  }, [hoverState, dismiss])

  if (!hoverState) return null

  return (
    <Popover open onOpenChange={(open) => { if (!open) dismiss() }}>
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
        onMouseLeave={onPopoverMouseLeave}
      >
        <div className="pt-1.5">
          <div className="rounded-md border border-[hsl(var(--border))] bg-popover p-1 shadow-md">
            {actionInProgress ? (
              <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{actionInProgress === "embed" ? "Embedding..." : "Creating bookmark..."}</span>
              </div>
            ) : (
              <div className="flex items-center gap-0.5">
                <button type="button" className={BTN} onClick={handleBookmark} title="Convert to bookmark">
                  <Bookmark className="h-3 w-3" />
                  Bookmark
                </button>
                <button type="button" className={BTN} onClick={handleEmbed} title="Embed content">
                  <Code className="h-3 w-3" />
                  Embed
                </button>
                <button type="button" className={BTN} onClick={handleOpen} title="Open in browser">
                  <ExternalLink className="h-3 w-3" />
                  Open
                </button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
