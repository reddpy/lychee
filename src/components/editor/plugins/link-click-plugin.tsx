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
import { ExternalLink, Bookmark, Code, Eye, EyeOff, FileText, X } from "lucide-react"

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { onToolbarExclusive } from "@/components/lexical-editor"
import { $createImageNode } from "@/components/editor/nodes/image-node"
import { $createBookmarkNode } from "@/components/editor/nodes/bookmark-node"
import { ReadOnlyNotePreview } from "@/components/editor/read-only-note-preview"
import { classifyUrl } from "@/shared/classify-url"
import { parseInternalNoteUrl } from "@/shared/internal-note-link"
import { displayNoteTitle } from "@/shared/note-title"
import { extractPlainText } from "@/shared/search-preview"
import { useDocumentStore } from "@/renderer/document-store"

function openExternalUrl(url: string) {
  window.lychee.invoke("shell.openExternal", { url }).catch((err) => {
    console.error("Failed to open URL:", err)
  })
}

function openInternalNote(documentId: string, inNewTab: boolean): boolean {
  const state = useDocumentStore.getState()
  if (!state.documents.some((document) => document.id === documentId)) return false

  if (inNewTab) {
    // This is the explicit new-tab action, so always create a distinct tab —
    // even when the same note is already open elsewhere. `openTab` intentionally
    // leaves the source tab active, matching Cmd/Ctrl-click behavior.
    state.openTab(documentId)
  } else {
    state.openOrSelectTab(documentId)
  }
  return true
}

function getInternalDocumentId(href: string): string | null {
  return parseInternalNoteUrl(href)?.documentId || null
}

/** Build the initial (partial-state) node for an Embed action. Each branch
 *  hands the URL to a node type that knows how to hydrate itself on mount.
 *  Adding a new embed kind: extend `UrlKind` in classify-url.ts and add a
 *  case here — TypeScript will flag the missing branch. */
function createEmbedNode(url: string): LexicalNode {
  const { kind } = classifyUrl(url)
  switch (kind) {
    case "image":
      return $createImageNode({ sourceUrl: url, loading: true })
    case "bookmark":
      return $createBookmarkNode({ url, autoResolve: true })
  }
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
  internalDocumentId: string | null
  internalDocumentTitle: string | null
  internalDocumentEmoji: string | null
  isMissingInternalNote: boolean
  /** True when the link is the only child of its parent block (eligible for conversion). */
  canConvert: boolean
}

const BTN =
  "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"

export function LinkClickPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [hoverState, setHoverState] = useState<HoverState | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const hoveredInternalDocument = useDocumentStore((state) => {
    if (!hoverState?.internalDocumentId) return undefined
    return state.documents.find((document) => document.id === hoverState.internalDocumentId)
  })
  const hoverRef = useRef(hoverState)
  hoverRef.current = hoverState
  const pinnedRef = useRef(isPinned)
  pinnedRef.current = isPinned

  // Virtual anchor for Radix Popover — always points to the live link element
  const anchorRef = useRef<HTMLAnchorElement>(null)
  anchorRef.current = hoverState?.linkEl ?? null
  const popoverContentRef = useRef<HTMLDivElement>(null)

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
    setIsPreviewOpen(false)
    setIsPinned(false)
    setHoverState(null)
    if (refocus) editor.getRootElement()?.focus({ preventScroll: true })
  }, [editor, clearDismissTimer])

  const scheduleDismiss = useCallback(() => {
    if (pinnedRef.current) return
    clearDismissTimer()
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null
      if (pinnedRef.current) return
      setIsPreviewOpen(false)
      setIsPinned(false)
      setHoverState(null)
    }, 150)
  }, [clearDismissTimer])

  // ── DOM events: Cmd+click, hover in/out ──
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!e.metaKey && !e.ctrlKey) return
      const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null
      const href = a?.getAttribute("href")
      if (!href) return
      e.preventDefault()
      e.stopPropagation()

      const internalDocumentId = getInternalDocumentId(href)
      if (internalDocumentId) {
        openInternalNote(internalDocumentId, true)
        return
      }
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
      if (pinnedRef.current) return

      // Walk DOM to find Lexical node key
      let nodeKey: NodeKey | undefined
      let el: HTMLElement | null = a
      while (el && !nodeKey) {
        nodeKey = (el as any)[keyProp]
        el = el.parentElement
      }
      if (!nodeKey) return

      const internalDocumentId = getInternalDocumentId(href)
      const internalDocument = internalDocumentId
        ? useDocumentStore.getState().documents.find(
          (document) => document.id === internalDocumentId,
        )
        : undefined
      const isMissingInternalNote = internalDocumentId !== null && !internalDocument

      // Check if the link is the only meaningful content in its parent (eligible for conversion).
      // Whitespace-only text siblings (e.g. trailing space after auto-link) don't count.
      let canConvert = false
      if (!internalDocumentId) {
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
      }

      setIsPreviewOpen(false)
      setIsPinned(false)
      setHoverState({
        url: href,
        linkEl: a,
        linkNodeKey: nodeKey,
        internalDocumentId,
        internalDocumentTitle: internalDocument
          ? displayNoteTitle(internalDocument.title)
          : null,
        internalDocumentEmoji: internalDocument?.emoji || null,
        isMissingInternalNote,
        canConvert,
      })
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
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && popoverContentRef.current?.contains(target)) return
      dismiss()
    }
    window.addEventListener("scroll", onScroll, true)
    return () => window.removeEventListener("scroll", onScroll, true)
  }, [hoverState, dismiss])

  // ── Clean up pending timer on unmount ──
  useEffect(() => clearDismissTimer, [clearDismissTimer])

  // ── Dismiss on tab switch so popover doesn't bleed into duplicate tabs ──
  useEffect(() => {
    return onToolbarExclusive("__link-hover__", () => dismiss())
  }, [dismiss])

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

  /** Classify the URL synchronously and insert the final node in a partial
   *  state. The node's component takes over hydration on mount — so the URL
   *  is always durable from the moment the link is replaced, even if the
   *  note is closed mid-hydration. */
  const handleEmbed = useCallback(() => {
    if (!hoverState) return
    const { url, linkNodeKey } = hoverState

    snapshotAndFocusLink(linkNodeKey)
    editor.update(() => {
      replaceLink(linkNodeKey, createEmbedNode(url))
    }, { tag: HISTORY_PUSH_TAG })

    dismiss(true)
  }, [editor, hoverState, replaceLink, snapshotAndFocusLink, dismiss])

  const handleBookmark = useCallback(() => {
    if (!hoverState) return
    const { url, linkNodeKey } = hoverState

    snapshotAndFocusLink(linkNodeKey)
    editor.update(() => {
      const node = $createBookmarkNode({ url })
      replaceLink(linkNodeKey, node)
    }, { tag: HISTORY_PUSH_TAG })

    dismiss(true)
  }, [editor, hoverState, replaceLink, snapshotAndFocusLink, dismiss])

  const handleOpen = useCallback(() => {
    if (!hoverState) return
    if (hoverState.internalDocumentId) {
      if (!openInternalNote(hoverState.internalDocumentId, false)) return
    } else {
      openExternalUrl(hoverState.url)
    }
    dismiss()
  }, [hoverState, dismiss])

  const handleOpenInNewTab = useCallback(() => {
    if (!hoverState?.internalDocumentId) return
    if (!openInternalNote(hoverState.internalDocumentId, true)) return
    dismiss()
  }, [hoverState, dismiss])

  const handlePreviewToggle = useCallback(() => {
    if (!hoveredInternalDocument) return
    clearDismissTimer()
    setIsPinned(true)
    setIsPreviewOpen((open) => !open)
  }, [clearDismissTimer, hoveredInternalDocument])

  const hasPreviewContent = hoveredInternalDocument
    ? extractPlainText(hoveredInternalDocument.content).length > 0
    : false

  if (!hoverState) return null

  return (
    <Popover open onOpenChange={(open) => { if (!open) dismiss() }}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        ref={popoverContentRef}
        className="w-auto p-0 bg-transparent border-none shadow-none"
        side="bottom"
        align="start"
        sideOffset={0}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={clearDismissTimer}
        onMouseLeave={onPopoverMouseLeave}
      >
        <div className="pt-1.5">
          {hoverState.internalDocumentId ? (
            <div
              data-internal-note-hover-card
              className="w-80 overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-popover shadow-lg"
            >
              <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-sm">
                  {hoverState.internalDocumentEmoji ? (
                    <span className="leading-none">{hoverState.internalDocumentEmoji}</span>
                  ) : (
                    <FileText className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Linked note
                  </div>
                  <div
                    className="truncate text-sm font-medium text-[hsl(var(--foreground))]"
                    title={hoverState.internalDocumentTitle ?? "Missing note"}
                  >
                    {hoverState.internalDocumentTitle ?? "Missing note"}
                  </div>
                </div>
                {isPinned && (
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
                    onClick={() => dismiss()}
                    title="Close note card"
                    aria-label="Close note card"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/25 p-1.5">
                <button
                  type="button"
                  className="inline-flex h-8 w-[78px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] disabled:pointer-events-none disabled:opacity-50"
                  onClick={handlePreviewToggle}
                  disabled={hoverState.isMissingInternalNote}
                  aria-pressed={isPreviewOpen}
                >
                  {isPreviewOpen ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {isPreviewOpen ? "Hide" : "Preview"}
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 text-xs font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 disabled:pointer-events-none disabled:opacity-50"
                  onClick={handleOpen}
                  disabled={hoverState.isMissingInternalNote}
                >
                  <FileText className="h-3.5 w-3.5" />
                  {hoverState.isMissingInternalNote ? "Unavailable" : "Open"}
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] disabled:pointer-events-none disabled:opacity-50"
                  onClick={handleOpenInNewTab}
                  disabled={hoverState.isMissingInternalNote}
                  title="Open in new tab"
                  aria-label="Open in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
              {isPreviewOpen && (
                <div
                  data-note-link-preview
                  className="h-52 overflow-x-hidden overflow-y-auto border-t border-[hsl(var(--border))] bg-[hsl(var(--background))]"
                >
                  {hasPreviewContent && hoveredInternalDocument ? (
                    <div className="text-sm [&_.ContentEditable\_\_root]:!leading-relaxed [&_.ContentEditable\_\_root]:!text-[hsl(var(--foreground))] [&>div>div]:!px-3 [&>div>div]:!py-2">
                      <ReadOnlyNotePreview editorState={hoveredInternalDocument.content} />
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))]">
                      <FileText className="h-6 w-6 opacity-30" />
                      <span className="text-xs">This note is empty</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
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
                <button
                  type="button"
                  className={BTN}
                  onClick={handleOpen}
                  title="Open in browser"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
