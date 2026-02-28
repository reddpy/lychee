"use client"

import { JSX, useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createNodeSelection,
  $getNodeByKey,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  HISTORY_PUSH_TAG,
  KEY_ESCAPE_COMMAND,
  type LexicalNode,
  type NodeKey,
} from "lexical"
import { $isAutoLinkNode, $isLinkNode } from "@lexical/link"
import { $findCellNode } from "@lexical/table"
import { ExternalLink, Bookmark, Code } from "lucide-react"

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { $createImageNode } from "@/components/editor/nodes/image-node"
import { $createBookmarkNode } from "@/components/editor/nodes/bookmark-node"
import { $createLoadingPlaceholderNode } from "@/components/editor/nodes/loading-placeholder-node"
import { $createYouTubeNode } from "@/components/editor/nodes/youtube-node"
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
  linkEl: HTMLAnchorElement
  linkNodeKey: NodeKey
  /** True when the link is the only child of its parent block (eligible for conversion). */
  canConvert: boolean
}

const BTN =
  "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"

export function LinkClickPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [hoverState, setHoverState] = useState<HoverState | null>(null)
  const hoverRef = useRef(hoverState)
  hoverRef.current = hoverState

  // Virtual anchor for Radix Popover — always points to the live link element
  const anchorRef = useRef<HTMLAnchorElement>(null)
  anchorRef.current = hoverState?.linkEl ?? null

  const keyProp = `__lexicalKey_${(editor as any)._key}`

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const dismiss = useCallback((refocus = false) => {
    clearDismissTimer()
    setHoverState(null)
    if (refocus) editor.getRootElement()?.focus({ preventScroll: true })
  }, [editor, clearDismissTimer])

  const scheduleDismiss = useCallback(() => {
    clearDismissTimer()
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null
      setHoverState(null)
    }, 150)
  }, [clearDismissTimer])

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
      if (!href) return

      if (hoverRef.current?.linkEl === a) {
        if (dismissTimerRef.current !== null) {
          clearTimeout(dismissTimerRef.current)
          dismissTimerRef.current = null
        }
        return
      }

      // Walk DOM to find Lexical node key
      let nodeKey: NodeKey | undefined
      let el: HTMLElement | null = a
      while (el && !nodeKey) {
        nodeKey = (el as any)[keyProp]
        el = el.parentElement
      }
      if (!nodeKey) return

      // Check if the link is the only meaningful content in its parent (eligible for conversion).
      // Whitespace-only text siblings (e.g. trailing space after auto-link) don't count.
      let canConvert = false
      editor.getEditorState().read(() => {
        const link = $getLinkByKey(nodeKey!)
        if (!link) return
        const parent = link.getParent()
        if (!parent) return
        // Don't allow embed/bookmark conversion inside table cells
        if ($findCellNode(link)) return
        canConvert = parent.getChildren().every(
          (child) => child.is(link) || ($isTextNode(child) && child.getTextContent().trim() === ""),
        )
      })

      setHoverState({ url: href, linkEl: a, linkNodeKey: nodeKey, canConvert })
    }

    function handleMouseOut(e: MouseEvent) {
      const a = (e.target as HTMLElement).closest("a")
      if (!a) return
      const related = e.relatedTarget as HTMLElement | null
      if (related?.closest("[data-slot='popover-content']")) return
      if (related && a.contains(related)) return
      scheduleDismiss()
    }

    return editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("click", handleClick)
      prev?.removeEventListener("mouseover", handleMouseOver)
      prev?.removeEventListener("mouseout", handleMouseOut)
      root?.addEventListener("click", handleClick)
      root?.addEventListener("mouseover", handleMouseOver)
      root?.addEventListener("mouseout", handleMouseOut)
    })
  }, [editor, keyProp, scheduleDismiss])

  // ── Popover mouse leave ──
  const onPopoverMouseLeave = useCallback((e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null
    if (related && hoverRef.current?.linkEl.contains(related)) return
    scheduleDismiss()
  }, [scheduleDismiss])

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

  // ── Clean up pending timer on unmount ──
  useEffect(() => clearDismissTimer, [clearDismissTimer])

  // ── Core: replace a link node with a block-level replacement ──
  const replaceLink = useCallback(
    (nodeKey: NodeKey, replacement: LexicalNode) => {
      const link = $getLinkByKey(nodeKey)
      if (!link) return

      const parent = link.getParent()
      if (!parent) return

      // Check if all siblings are just whitespace text (same logic as canConvert)
      const onlyWhitespaceSiblings = parent.getChildren().every(
        (child) => child.is(link) || ($isTextNode(child) && child.getTextContent().trim() === ""),
      )

      if (onlyWhitespaceSiblings) {
        parent.replace(replacement)
      } else {
        link.remove()
        parent.insertAfter(replacement)
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

  /** Replace the link with a loading placeholder inline, run the async work,
   *  then swap the placeholder for the real node. Popover dismisses immediately. */
  const handleEmbed = useCallback(async () => {
    if (!hoverState) return
    const { url, linkNodeKey } = hoverState

    snapshotAndFocusLink(linkNodeKey)

    let placeholderKey: string | undefined
    editor.update(() => {
      const placeholder = $createLoadingPlaceholderNode("Embedding…")
      replaceLink(linkNodeKey, placeholder)
      placeholderKey = placeholder.getKey()
    }, { tag: HISTORY_PUSH_TAG })

    dismiss(true)

    try {
      const result: ResolvedUrlResult = await window.lychee.invoke("url.resolve", { url })

      editor.update(() => {
        const ph = placeholderKey ? $getNodeByKey(placeholderKey) : null
        if (!ph) return

        let replacement: LexicalNode | null = null

        switch (result.type) {
          case "youtube":
            replacement = $createYouTubeNode(result.videoId)
            break
          case "image":
            replacement = $createImageNode({
              imageId: result.id,
              src: result.filePath,
              sourceUrl: result.sourceUrl,
              loading: false,
            })
            break
          case "bookmark":
            replacement = $createBookmarkNode({
              url: result.url,
              title: result.title,
              description: result.description,
              imageUrl: result.imageUrl,
              faviconUrl: result.faviconUrl,
            })
            break
          default:
            ph.remove()
            return
        }

        ph.replace(replacement)
        const sel = $createNodeSelection()
        sel.add(replacement.getKey())
        $setSelection(sel)
      }, { tag: "history-merge" })
    } catch (err) {
      console.error("Failed to embed URL:", err)
      editor.update(() => {
        const ph = placeholderKey ? $getNodeByKey(placeholderKey) : null
        if (ph) ph.remove()
      }, { tag: "history-merge" })
    }
  }, [editor, hoverState, replaceLink, snapshotAndFocusLink, dismiss])

  const handleBookmark = useCallback(async () => {
    if (!hoverState) return
    const { url, linkNodeKey } = hoverState

    snapshotAndFocusLink(linkNodeKey)

    let placeholderKey: string | undefined
    editor.update(() => {
      const placeholder = $createLoadingPlaceholderNode("Creating bookmark…")
      replaceLink(linkNodeKey, placeholder)
      placeholderKey = placeholder.getKey()
    }, { tag: HISTORY_PUSH_TAG })

    dismiss(true)

    try {
      const meta = await window.lychee.invoke("url.fetchMetadata", { url })
      editor.update(() => {
        const ph = placeholderKey ? $getNodeByKey(placeholderKey) : null
        if (!ph) return
        const bm = $createBookmarkNode({
          url: meta.url,
          title: meta.title,
          description: meta.description,
          imageUrl: meta.imageUrl,
          faviconUrl: meta.faviconUrl,
        })
        ph.replace(bm)
        const sel = $createNodeSelection()
        sel.add(bm.getKey())
        $setSelection(sel)
      }, { tag: "history-merge" })
    } catch (err) {
      console.error("Failed to create bookmark:", err)
      editor.update(() => {
        const ph = placeholderKey ? $getNodeByKey(placeholderKey) : null
        if (ph) ph.remove()
      }, { tag: "history-merge" })
    }
  }, [editor, hoverState, replaceLink, snapshotAndFocusLink, dismiss])

  const handleOpen = useCallback(() => {
    if (!hoverState) return
    openExternalUrl(hoverState.url)
    dismiss()
  }, [hoverState, dismiss])

  if (!hoverState) return null

  return (
    <Popover open onOpenChange={(open) => { if (!open) dismiss() }}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        className="w-auto p-0 bg-transparent border-none shadow-none"
        side="bottom"
        align="start"
        sideOffset={0}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={clearDismissTimer}
        onMouseLeave={onPopoverMouseLeave}
      >
        <div className="pt-1.5">
          <div className="rounded-md border border-[hsl(var(--border))] bg-popover p-1 shadow-md">
            <div className="flex items-center gap-0.5">
              {hoverState.canConvert && (
                <>
                  <button type="button" className={BTN} onClick={handleBookmark} title="Convert to bookmark">
                    <Bookmark className="h-3 w-3" />
                    Bookmark
                  </button>
                  <button type="button" className={BTN} onClick={handleEmbed} title="Embed content">
                    <Code className="h-3 w-3" />
                    Embed
                  </button>
                </>
              )}
              <button type="button" className={BTN} onClick={handleOpen} title="Open in browser">
                <ExternalLink className="h-3 w-3" />
                Open
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
