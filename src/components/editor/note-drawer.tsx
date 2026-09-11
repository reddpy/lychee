"use client"

import { $isAutoLinkNode, $isLinkNode } from "@lexical/link"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical"
import {
  Bookmark,
  Check,
  Copy,
  CornerUpRight,
  ExternalLink,
  FileText,
  Highlighter,
  Link2,
  SquareLibrary,
  Trash2,
  X,
} from "lucide-react"
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { $isBookmarkNode } from "@/components/editor/nodes/bookmark-node"
import { $isNoteBookmarkNode } from "@/components/editor/nodes/note-bookmark-node"
import {
  $getBookmarkBlockForNode,
  removeBookmarkByKey,
} from "@/components/editor/plugins/note-bookmark-plugin"
import { HIGHLIGHT_BLOCK_COMMAND } from "@/components/editor/plugins/block-highlight-plugin"
import { emitToolbarExclusive, onToolbarExclusive } from "@/components/lexical-editor"
import { cn } from "@/lib/utils"
import { useDocumentStore } from "@/renderer/document-store"
import { useEditorStatsStore } from "@/renderer/editor-stats-store"
import { parseInternalNoteUrl } from "@/shared/internal-note-link"
import { displayNoteTitle } from "@/shared/note-title"

type TabId = "links" | "highlights" | "bookmarks"

type LinkFilter = "all" | "links" | "notes" | "other"

const LINK_FILTERS: { id: LinkFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "links", label: "Links" },
  { id: "notes", label: "Notes" },
  { id: "other", label: "Other" },
]

function matchesLinkFilter(link: LinkInfo, filter: LinkFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "notes":
      return link.internalDocumentId !== null
    case "links":
      return link.internalDocumentId === null && link.kind === "link"
    case "other":
      return link.internalDocumentId === null && link.kind === "bookmark"
  }
}

interface LinkInfo {
  key: NodeKey
  url: string
  text: string
  kind: "link" | "bookmark"
  title: string
  faviconUrl: string
  /** Set when the link points at another note inside Lychee. */
  internalDocumentId: string | null
}

interface HighlightInfo {
  key: NodeKey
  text: string
}

interface BookmarkInfo {
  key: NodeKey
  label: string
  createdAt: string
}

interface NoteData {
  links: LinkInfo[]
  highlights: HighlightInfo[]
  bookmarks: BookmarkInfo[]
}

const EMPTY_DATA: NoteData = { links: [], highlights: [], bookmarks: [] }

function readNoteData(editor: LexicalEditor): NoteData {
  const links: LinkInfo[] = []
  const highlights: HighlightInfo[] = []
  const bookmarks: BookmarkInfo[] = []

  editor.getEditorState().read(() => {
    const root = $getRoot()

    const visit = (node: LexicalNode) => {
      if ($isLinkNode(node) || $isAutoLinkNode(node)) {
        const url = node.getURL()
        if (url) {
          links.push({
            key: node.getKey(),
            url,
            text: node.getTextContent() || url,
            kind: "link",
            title: "",
            faviconUrl: "",
            internalDocumentId: parseInternalNoteUrl(url)?.documentId ?? null,
          })
        }
      } else if ($isBookmarkNode(node)) {
        links.push({
          key: node.getKey(),
          url: node.getUrl(),
          text: node.getTitle() || node.getUrl(),
          kind: "bookmark",
          title: node.getTitle(),
          faviconUrl: node.getFaviconUrl(),
          internalDocumentId: parseInternalNoteUrl(node.getUrl())?.documentId ?? null,
        })
      } else if ($isNoteBookmarkNode(node)) {
        bookmarks.push({
          key: node.getKey(),
          label: node.getLabel(),
          createdAt: node.getCreatedAt(),
        })
      }

      if ($isTextNode(node) && node.hasFormat("highlight")) {
        const text = node.getTextContent()
        if (text.trim()) highlights.push({ key: node.getKey(), text })
      }

      if ($isElementNode(node)) {
        for (const child of node.getChildren()) visit(child)
      }
    }

    for (const child of root.getChildren()) visit(child)
  })

  return { links, highlights, bookmarks }
}

function noteDataEqual(a: NoteData, b: NoteData): boolean {
  if (a.links.length !== b.links.length) return false
  if (a.highlights.length !== b.highlights.length) return false
  if (a.bookmarks.length !== b.bookmarks.length) return false
  for (let i = 0; i < a.links.length; i++) {
    if (
      a.links[i].key !== b.links[i].key ||
      a.links[i].url !== b.links[i].url ||
      a.links[i].text !== b.links[i].text
    ) {
      return false
    }
  }
  for (let i = 0; i < a.highlights.length; i++) {
    if (a.highlights[i].key !== b.highlights[i].key || a.highlights[i].text !== b.highlights[i].text) {
      return false
    }
  }
  for (let i = 0; i < a.bookmarks.length; i++) {
    if (
      a.bookmarks[i].key !== b.bookmarks[i].key ||
      a.bookmarks[i].label !== b.bookmarks[i].label
    ) {
      return false
    }
  }
  return true
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`
  } catch {
    return url
  }
}

const TABS: { id: TabId; label: string; icon: typeof Link2 }[] = [
  { id: "links", label: "Links", icon: Link2 },
  { id: "highlights", label: "Highlights", icon: Highlighter },
  { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
]

interface PanelRect {
  top: number
  maxHeight: number
}

/** Breathing room between the floating panel and the toolbar / viewport edges. */
const PANEL_GAP = 10

/**
 * Toolbar trigger + floating panel that gathers everything worth navigating
 * to in a note: every link/bookmark embed, highlighted text, and user-made
 * in-note bookmark. It reads as a themed popover (rounded, bordered, shadowed)
 * rather than a full-height sidebar, and caps its own height so it never
 * overflows the editor viewport.
 */
export function NoteDrawerPlugin({ documentId }: { documentId: string }): ReactElement | null {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>("links")
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all")
  const [toolbarEl, setToolbarEl] = useState<Element | null>(null)
  const [data, setData] = useState<NoteData>(EMPTY_DATA)
  const [panelRect, setPanelRect] = useState<PanelRect | null>(null)
  const [copiedKey, setCopiedKey] = useState<NodeKey | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stats = useEditorStatsStore((s) => s.byDoc[documentId])
  const documents = useDocumentStore((s) => s.documents)

  const noteTitles = useMemo(() => {
    const map = new Map<string, string>()
    for (const doc of documents) map.set(doc.id, doc.title)
    return map
  }, [documents])

  const visibleLinks = useMemo(
    () => data.links.filter((link) => matchesLinkFilter(link, linkFilter)),
    [data.links, linkFilter],
  )

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    setToolbarEl(document.querySelector(`[data-toolbar-id="${documentId}"]`))
  }, [documentId])

  // Close when another toolbar panel opens, and on tab switch.
  useEffect(() => {
    return onToolbarExclusive("note-drawer", () => setIsOpen(false))
  }, [])

  // Keep the drawer contents in sync with the note.
  useEffect(() => {
    const read = () => {
      const next = readNoteData(editor)
      setData((prev) => (noteDataEqual(prev, next) ? prev : next))
    }
    read()
    return editor.registerUpdateListener(() => read())
  }, [editor])

  // Anchor the drawer below the sticky note toolbar, spanning the editor viewport.
  const computePanelRect = useCallback(() => {
    const mainEl = editor.getRootElement()?.closest("main") as HTMLElement | null
    if (!mainEl) return
    const mainRect = mainEl.getBoundingClientRect()
    const toolbar = (toolbarEl as HTMLElement | null)?.closest(".sticky") as HTMLElement | null
    const top = (toolbar ? toolbar.getBoundingClientRect().bottom : mainRect.top) + PANEL_GAP
    setPanelRect({ top, maxHeight: Math.max(0, mainRect.bottom - top - PANEL_GAP) })
  }, [editor, toolbarEl])

  useEffect(() => {
    if (!isOpen) return
    computePanelRect()
    window.addEventListener("resize", computePanelRect)
    return () => window.removeEventListener("resize", computePanelRect)
  }, [isOpen, computePanelRect])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen])

  const toggle = useCallback(() => {
    if (isOpen) {
      setIsOpen(false)
      return
    }
    computePanelRect()
    emitToolbarExclusive("note-drawer")
    setIsOpen(true)
  }, [isOpen, computePanelRect])

  const jumpToNode = useCallback(
    (key: NodeKey, selectText = false) => {
      const dom = editor.getElementByKey(key)
      if (dom) {
        dom.scrollIntoView({ behavior: "smooth", block: "center" })
        editor.dispatchCommand(HIGHLIGHT_BLOCK_COMMAND, dom)
      }
      if (selectText) {
        editor.update(() => {
          const node = $getNodeByKey(key)
          if ($isTextNode(node)) node.select(0, node.getTextContentSize())
        })
      }
    },
    [editor],
  )

  const jumpToBookmark = useCallback(
    (key: NodeKey) => {
      let blockKey: NodeKey | null = null
      editor.getEditorState().read(() => {
        const node = $getNodeByKey(key)
        if ($isNoteBookmarkNode(node)) {
          const block = $getBookmarkBlockForNode(node)
          if (block) blockKey = block.getKey()
        }
      })
      if (blockKey) jumpToNode(blockKey)
    },
    [editor, jumpToNode],
  )

  const removeBookmark = useCallback(
    (key: NodeKey) => {
      removeBookmarkByKey(editor, key)
    },
    [editor],
  )

  const openExternal = useCallback((url: string) => {
    window.lychee.invoke("shell.openExternal", { url }).catch((err) => {
      console.error("Failed to open URL:", err)
    })
  }, [])

  const openInternalNote = useCallback((targetDocumentId: string) => {
    const state = useDocumentStore.getState()
    if (!state.documents.some((doc) => doc.id === targetDocumentId)) return
    state.openOrCreateTab(targetDocumentId)
  }, [])

  const copyLink = useCallback((url: string, key: NodeKey) => {
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopiedKey(key)
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
        copyTimerRef.current = setTimeout(() => setCopiedKey(null), 1400)
      })
      .catch((err) => {
        console.error("Failed to copy link:", err)
      })
  }, [])

  if (!toolbarEl) return null

  return (
    <>
      {createPortal(
        <button
          type="button"
          onClick={toggle}
          aria-label="Open note drawer"
          aria-expanded={isOpen}
          className={cn(
            "flex h-8 w-8 items-center justify-center cursor-pointer rounded-full border transition-all duration-200 group select-none",
            isOpen
              ? "border-brand/30 bg-brand/15 text-brand"
              : "border-transparent bg-transparent text-[hsl(var(--muted-foreground))]/65 hover:bg-brand/15 hover:text-brand hover:border-brand/30",
          )}
        >
          <SquareLibrary className="h-4 w-4" />
        </button>,
        toolbarEl,
      )}

      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <aside
            data-testid="note-drawer"
            data-document-id={documentId}
            role="dialog"
            aria-label="Note Drawer"
            style={panelRect ? { top: panelRect.top, maxHeight: panelRect.maxHeight } : undefined}
            className="note-drawer-enter fixed right-3 top-3 z-50 flex w-[320px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg"
          >
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
              <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Drawer</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close note drawer"
                className="flex h-6 w-6 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div role="tablist" aria-label="Note Drawer sections" className="flex items-center gap-0.5 px-3">
              {TABS.map((tab) => {
                const Icon = tab.icon
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`note-drawer-tab-${tab.id}`}
                    aria-selected={active}
                    aria-controls={`note-drawer-panel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs font-medium transition-colors",
                      active
                        ? "border-brand text-brand"
                        : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                )
              })}
            </div>

            {activeTab === "links" && (
              <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
                {LINK_FILTERS.map((filter) => {
                  const active = linkFilter === filter.id
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      data-testid="link-filter"
                      data-filter={filter.id}
                      onClick={() => setLinkFilter(filter.id)}
                      aria-pressed={active}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                        active
                          ? "border-brand/30 bg-brand/15 text-brand"
                          : "border-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]",
                      )}
                    >
                      {filter.label}
                    </button>
                  )
                })}
              </div>
            )}

            <div
              role="tabpanel"
              id={`note-drawer-panel-${activeTab}`}
              aria-labelledby={`note-drawer-tab-${activeTab}`}
              className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
            >
              {activeTab === "links" &&
                (data.links.length === 0 ? (
                  <DrawerEmpty icon={Link2} title="No links yet" hint="Link text or embed a URL and it will show up here." />
                ) : visibleLinks.length === 0 ? (
                  <DrawerEmpty icon={Link2} title="Nothing here" hint="No items match this filter." />
                ) : (
                  visibleLinks.map((link) => {
                    const internalId = link.internalDocumentId
                    const internalTitle = internalId ? noteTitles.get(internalId) : undefined
                    const internalMissing = internalId !== null && internalTitle === undefined
                    const label = internalId
                      ? internalMissing
                        ? "Missing note"
                        : displayNoteTitle(internalTitle)
                      : link.text || prettyUrl(link.url)
                    return (
                      <div
                        key={link.key}
                        data-testid="drawer-link-row"
                        data-link-url={link.url}
                        data-internal={internalId ?? ""}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[hsl(var(--accent))]"
                      >
                        <button
                          type="button"
                          onClick={() => jumpToNode(link.key)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title={internalId ? label : link.url}
                        >
                          {internalId ? (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                          ) : link.kind === "bookmark" ? (
                            <Bookmark className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-[hsl(var(--foreground))]">
                              {label}
                            </span>
                            <span className="block truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                              {internalId ? "Note link" : prettyUrl(link.url)}
                            </span>
                          </span>
                        </button>
                        {!internalId && (
                          <button
                            type="button"
                            data-testid="drawer-link-copy"
                            onClick={() => copyLink(link.url, link.key)}
                            aria-label={`Copy ${link.url}`}
                            className={cn(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-[hsl(var(--background))] hover:text-brand",
                              copiedKey === link.key
                                ? "text-brand opacity-100"
                                : "text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100",
                            )}
                          >
                            {copiedKey === link.key ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        {internalId ? (
                          !internalMissing && (
                            <button
                              type="button"
                              data-testid="drawer-link-open-internal"
                              onClick={() => openInternalNote(internalId)}
                              aria-label={`Open ${label}`}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-[hsl(var(--background))] hover:text-brand group-hover:opacity-100"
                            >
                              <CornerUpRight className="h-3.5 w-3.5" />
                            </button>
                          )
                        ) : (
                          isExternalUrl(link.url) && (
                            <button
                              type="button"
                              data-testid="drawer-link-open-external"
                              onClick={() => openExternal(link.url)}
                              aria-label={`Open ${link.url}`}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-[hsl(var(--background))] hover:text-brand group-hover:opacity-100"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    )
                  })
                ))}

              {activeTab === "highlights" &&
                (data.highlights.length === 0 ? (
                  <DrawerEmpty icon={Highlighter} title="No highlights yet" hint="Highlight text and it will collect here." />
                ) : (
                  data.highlights.map((highlight) => (
                    <button
                      key={highlight.key}
                      type="button"
                      data-testid="drawer-highlight-row"
                      onClick={() => jumpToNode(highlight.key, true)}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--accent))]"
                    >
                      {highlight.text}
                    </button>
                  ))
                ))}

              {activeTab === "bookmarks" &&
                (data.bookmarks.length === 0 ? (
                  <DrawerEmpty
                    icon={Bookmark}
                    title="No bookmarks yet"
                    hint="Select text or place your cursor, then use the bookmark action or shortcut."
                  />
                ) : (
                  data.bookmarks.map((bookmark) => (
                    <div
                      key={bookmark.key}
                      data-testid="drawer-bookmark-row"
                      data-bookmark-key={bookmark.key}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[hsl(var(--accent))]"
                    >
                      <button
                        type="button"
                        onClick={() => jumpToBookmark(bookmark.key)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title={bookmark.label}
                      >
                        <Bookmark className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                        <span className="min-w-0 truncate text-sm text-[hsl(var(--foreground))]">
                          {bookmark.label}
                        </span>
                      </button>
                      <button
                        type="button"
                        data-testid="drawer-bookmark-delete"
                        onClick={() => removeBookmark(bookmark.key)}
                        aria-label={`Remove bookmark ${bookmark.label}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-[hsl(var(--background))] hover:text-brand focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                ))}
            </div>

            <div
              data-testid="drawer-stats"
              className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-4 py-2 text-[11px] text-[hsl(var(--muted-foreground))]"
            >
              <span>{stats ? `${stats.words} words` : "\u00a0"}</span>
              <span>{stats ? `${stats.characters} characters` : ""}</span>
            </div>
          </aside>,
          document.body,
        )}
    </>
  )
}

function DrawerEmpty({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Link2
  title: string
  hint: string
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <Icon className="h-5 w-5 text-[hsl(var(--muted-foreground))]/50" />
      <span className="text-sm text-[hsl(var(--muted-foreground))]">{title}</span>
      <span className="text-xs text-[hsl(var(--muted-foreground))]/70">{hint}</span>
    </div>
  )
}
