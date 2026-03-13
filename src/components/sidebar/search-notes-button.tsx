import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  SquareArrowUpRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Search,
} from "lucide-react";

import { useDocumentStore } from "../../renderer/document-store";
import { useSearchHighlightStore } from "../../renderer/search-highlight-store";
import {
  buildHighlightedSnippet,
  countOccurrences,
  extractPlainText,
  normalizedTitle,
  scoreDocument,
} from "../../shared/search-preview";
import {
  buildHighlightedPreviewState,
  ReadOnlyNotePreview,
  type ReadOnlyNotePreviewHandle,
} from "../editor/read-only-note-preview";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../ui/command";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";

type PreparedPreview = {
  state: string | undefined;
};

const SEARCH_PREVIEW_OPEN_SETTING_KEY = "searchPalettePreviewOpen";
const PREVIEW_MIN_WINDOW_WIDTH = 1140;

export function SearchNotesButton() {
  const { open: isSidebarExpanded, setHoverOpen } = useSidebar();
  const documents = useDocumentStore((s) => s.documents);
  const selectedId = useDocumentStore((s) => s.selectedId);
  const openTab = useDocumentStore((s) => s.openTab);
  const openOrCreateTab = useDocumentStore((s) => s.openOrCreateTab);
  const setTransientJump = useSearchHighlightStore((s) => s.setTransientJump);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [isSearching, setIsSearching] = React.useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(true);
  const [isPaletteInitializing, setIsPaletteInitializing] =
    React.useState(false);
  const [commandResetKey, setCommandResetKey] = React.useState("initial");
  const [previewDocId, setPreviewDocId] = React.useState<string | null>(null);
  const [previewMatchCount, setPreviewMatchCount] = React.useState(0);
  const [previewActiveMatchIndex, setPreviewActiveMatchIndex] =
    React.useState(0);
  const previewMatchCountRef = React.useRef(0);
  const previewActiveMatchIndexRef = React.useRef(0);
  const [preparedPreviewStates, setPreparedPreviewStates] = React.useState<
    Record<string, PreparedPreview>
  >({});
  const [isPreparingPreviews, setIsPreparingPreviews] = React.useState(false);
  const [isCompactLayout, setIsCompactLayout] = React.useState(() =>
    typeof window !== "undefined"
      ? window.innerWidth < PREVIEW_MIN_WINDOW_WIDTH
      : false,
  );
  const shouldShowPreview = isPreviewOpen && !isCompactLayout;
  const bodyTextCacheRef = React.useRef<Map<string, string>>(new Map());
  const previewCacheRef = React.useRef<Map<string, string | undefined>>(
    new Map(),
  );
  const previewNavRef = React.useRef<ReadOnlyNotePreviewHandle>(null);
  const resultsContainerRef = React.useRef<HTMLDivElement>(null);
  const dialogContentRef = React.useRef<HTMLDivElement>(null);
  const lastPointerPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const openInNewTabRef = React.useRef(false);

  const indexedDocuments = React.useMemo(() => {
    const nextActiveKeys = new Set<string>();
    const indexed = documents.map((doc) => {
      const key = `${doc.id}|${doc.updatedAt}|${doc.content.length}`;
      nextActiveKeys.add(key);
      const cached = bodyTextCacheRef.current.get(key);
      if (cached !== undefined) {
        return { doc, bodyText: cached };
      }
      const extracted = extractPlainText(doc.content);
      bodyTextCacheRef.current.set(key, extracted);
      return { doc, bodyText: extracted };
    });

    // Prevent cache growth as docs update over time.
    for (const key of bodyTextCacheRef.current.keys()) {
      if (!nextActiveKeys.has(key)) {
        bodyTextCacheRef.current.delete(key);
      }
    }
    return indexed;
  }, [documents]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier || event.shiftKey) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      setOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSidebarExpanded, setHoverOpen]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) {
      document.body.dataset.lycheeCommandPaletteOpen = "true";
      if (!isSidebarExpanded) setHoverOpen(false);
    } else {
      delete document.body.dataset.lycheeCommandPaletteOpen;
    }

    if (!open || isSidebarExpanded) return;

    const closeHoverSidebar = () => setHoverOpen(false);
    window.addEventListener("mousemove", closeHoverSidebar, true);
    window.addEventListener("pointermove", closeHoverSidebar, true);
    return () => {
      window.removeEventListener("mousemove", closeHoverSidebar, true);
      window.removeEventListener("pointermove", closeHoverSidebar, true);
      delete document.body.dataset.lycheeCommandPaletteOpen;
    };
  }, [open, isSidebarExpanded, setHoverOpen]);

  React.useEffect(() => {
    const syncLayoutMode = () => {
      setIsCompactLayout(window.innerWidth < PREVIEW_MIN_WINDOW_WIDTH);
    };
    syncLayoutMode();
    window.addEventListener("resize", syncLayoutMode);
    return () => window.removeEventListener("resize", syncLayoutMode);
  }, []);

  React.useEffect(() => {
    let isMounted = true;
    window.lychee
      .invoke("settings.get", { key: SEARCH_PREVIEW_OPEN_SETTING_KEY })
      .then(({ value }) => {
        if (!isMounted || value == null) return;
        setIsPreviewOpen(value !== "false");
      })
      .catch(() => {
        // Ignore settings lookup failures; keep default open behavior.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const visibleDocuments = React.useMemo(() => {
    const q = query.trim();
    if (!q) {
      return indexedDocuments
        .slice()
        .sort((a, b) => +new Date(b.doc.updatedAt) - +new Date(a.doc.updatedAt))
        .map((entry) => ({
          ...entry,
          score: 0,
          bodyMatchIndex: -1,
          matchCount: 0,
        }))
        .slice(0, 30);
    }

    const lowerQ = q.toLowerCase();
    return indexedDocuments
      .map((entry) => {
        const titleScore = scoreDocument(entry.doc.title, q);
        const bodyMatchIndex = entry.bodyText.toLowerCase().indexOf(lowerQ);
        const titleMatchCount = countOccurrences(normalizedTitle(entry.doc.title), q);
        const bodyMatchCount = countOccurrences(entry.bodyText, q);
        const bodyScore = bodyMatchIndex >= 0 ? 40 : -1;
        return {
          ...entry,
          score: Math.max(titleScore, bodyScore),
          bodyMatchIndex,
          // Avoid double-counting the same term when title and body overlap.
          matchCount: Math.max(titleMatchCount, bodyMatchCount),
        };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        if (a.bodyMatchIndex >= 0 !== b.bodyMatchIndex >= 0) {
          return a.bodyMatchIndex >= 0 ? 1 : -1;
        }
        return +new Date(b.doc.updatedAt) - +new Date(a.doc.updatedAt);
      })
      .slice(0, 50);
  }, [indexedDocuments, query]);

  const [resolvedDocuments, setResolvedDocuments] =
    React.useState(visibleDocuments);
  const [renderedDocuments, setRenderedDocuments] = React.useState<
    typeof resolvedDocuments
  >([]);
  React.useEffect(() => {
    if (!open) return;
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      setResolvedDocuments(visibleDocuments);
      setIsSearching(false);
    }, 90);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, visibleDocuments]);

  React.useEffect(() => {
    if (!open || isPaletteInitializing || isSearching) return;
    const timer = window.setTimeout(() => {
      setRenderedDocuments(resolvedDocuments);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, isPaletteInitializing, isSearching, resolvedDocuments]);

  React.useEffect(() => {
    if (!open || isPaletteInitializing || isSearching) return;
    const firstId = renderedDocuments[0]?.doc.id ?? "none";
    setCommandResetKey(`${query.trim().toLowerCase()}|${firstId}`);
  }, [
    open,
    query,
    renderedDocuments,
    isPaletteInitializing,
    isSearching,
  ]);

  React.useEffect(() => {
    if (!open) return;
    const normalizedQuery = query.trim().toLowerCase();
    const cacheKeyFor = (entry: (typeof resolvedDocuments)[number]) =>
      `${entry.doc.id}|${entry.doc.updatedAt}|${normalizedQuery}`;

    // Instant hydration from cache to avoid flicker when reopening/changing selection.
    const cachedByDocId: Record<string, PreparedPreview> = {};
    for (const entry of resolvedDocuments) {
      const key = cacheKeyFor(entry);
      if (previewCacheRef.current.has(key)) {
        cachedByDocId[entry.doc.id] = {
          state: previewCacheRef.current.get(key),
        };
      }
    }
    if (Object.keys(cachedByDocId).length > 0) {
      setPreparedPreviewStates((prev) => ({ ...prev, ...cachedByDocId }));
    }

    const missing = resolvedDocuments.filter((entry) => {
      const key = cacheKeyFor(entry);
      return !previewCacheRef.current.has(key);
    });
    if (missing.length === 0) {
      setIsPreparingPreviews(false);
      setIsPaletteInitializing(false);
      return;
    }

    setIsPreparingPreviews(true);
    const timer = window.setTimeout(() => {
      const computedByDocId: Record<string, PreparedPreview> = {};
      for (const entry of missing) {
        const key = cacheKeyFor(entry);
        const state = buildHighlightedPreviewState(entry.doc.content, query);
        previewCacheRef.current.set(key, state);
        computedByDocId[entry.doc.id] = { state };
      }
      setPreparedPreviewStates((prev) => ({ ...prev, ...computedByDocId }));
      setIsPreparingPreviews(false);
      setIsPaletteInitializing(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, query, resolvedDocuments]);

  React.useEffect(() => {
    setPreviewDocId((current) => {
      if (renderedDocuments.length === 0) return null;
      if (
        current &&
        renderedDocuments.some((entry) => entry.doc.id === current)
      ) {
        return current;
      }
      return renderedDocuments[0].doc.id;
    });
  }, [renderedDocuments]);

  const maybeTransferPreviewJump = React.useCallback(
    (id: string) => {
      const q = query.trim();
      if (!q) return;
      const resultEntry = renderedDocuments.find((entry) => entry.doc.id === id);
      if (!resultEntry || resultEntry.matchCount <= 0) return;

      // If preview is visible and the opened note is the preview target, preserve
      // chevron-positioned match. Otherwise (e.g. preview hidden), start at first hit.
      const canUsePreviewIndex =
        shouldShowPreview &&
        previewDocId === id &&
        previewMatchCountRef.current > 0;
      const livePreviewState = canUsePreviewIndex
        ? previewNavRef.current?.getMatchState()
        : null;
      const sourceCount =
        livePreviewState && livePreviewState.count > 0
          ? livePreviewState.count
          : canUsePreviewIndex
            ? previewMatchCountRef.current
            : resultEntry.matchCount;
      const sourceIndex =
        livePreviewState && livePreviewState.count > 0
          ? livePreviewState.activeIndex
          : canUsePreviewIndex
            ? previewActiveMatchIndexRef.current
            : 0;
      const index = Math.max(0, Math.min(sourceIndex, sourceCount - 1));
      setTransientJump(id, q, index, 3000);
    },
    [
      previewActiveMatchIndex,
      previewDocId,
      query,
      renderedDocuments,
      setTransientJump,
      shouldShowPreview,
    ],
  );

  const handleSelect = React.useCallback(
    (id: string) => {
      if (openInNewTabRef.current) {
        openTab(id);
        openInNewTabRef.current = false;
        return;
      } else {
        maybeTransferPreviewJump(id);
        openOrCreateTab(id);
      }
      openInNewTabRef.current = false;
      setOpen(false);
      setQuery("");
      setIsSearching(false);
    },
    [maybeTransferPreviewJump, openOrCreateTab, openTab],
  );

  const handlePreviewTarget = React.useCallback((id: string) => {
    setPreviewDocId((current) => (current === id ? current : id));
  }, []);

  const handlePreviewPointerMove = React.useCallback(
    (id: string, event: React.MouseEvent | React.PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      const last = lastPointerPosRef.current;
      lastPointerPosRef.current = point;
      // Ignore synthetic hover changes caused by scrolling under a stationary cursor.
      if (last && last.x === point.x && last.y === point.y) return;
      handlePreviewTarget(id);
    },
    [handlePreviewTarget],
  );

  const focusSearchInput = React.useCallback(() => {
    const root = dialogContentRef.current;
    if (!root) return;
    const input = root.querySelector<HTMLInputElement>("[cmdk-input]");
    input?.focus();
  }, []);

  const openPreviewNote = React.useCallback(
    (id: string, openInBackgroundTab = false) => {
      if (openInBackgroundTab) {
        openTab(id);
        return;
      }
      maybeTransferPreviewJump(id);
      openOrCreateTab(id);
      setOpen(false);
      setQuery("");
      setIsSearching(false);
    },
    [maybeTransferPreviewJump, openOrCreateTab, openTab],
  );

  const syncPreviewWithKeyboardSelection = React.useCallback(() => {
    const container = resultsContainerRef.current;
    if (!container) return;
    const selectedItem = container.querySelector<HTMLElement>(
      '[cmdk-item][data-selected="true"]',
    );
    const id = selectedItem?.getAttribute("data-doc-id");
    if (id) handlePreviewTarget(id);
  }, [handlePreviewTarget]);

  React.useEffect(() => {
    if (!open) return;
    const container = resultsContainerRef.current;
    if (!container) return;

    const observer = new MutationObserver(() => {
      syncPreviewWithKeyboardSelection();
    });
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-selected"],
    });

    // Initial sync when opening/changing query.
    requestAnimationFrame(syncPreviewWithKeyboardSelection);

    return () => observer.disconnect();
  }, [open, query, resolvedDocuments, syncPreviewWithKeyboardSelection]);

  const shortcutLabel =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac")
      ? "⌘P"
      : "Ctrl+P";

  const previewEntry =
    (previewDocId
      ? renderedDocuments.find((entry) => entry.doc.id === previewDocId)
      : undefined) ?? renderedDocuments[0];
  const previewTitle = previewEntry
    ? normalizedTitle(previewEntry.doc.title)
    : "";
  const previewPrepared = previewEntry
    ? preparedPreviewStates[previewEntry.doc.id] !== undefined
    : false;
  const previewEditorState = previewEntry
    ? preparedPreviewStates[previewEntry.doc.id]?.state
    : undefined;
  const isPreviewLoading =
    (isPreparingPreviews && !previewPrepared) || isSearching || isPaletteInitializing;

  const handlePreviewMatchStateChange = React.useCallback(
    (active: number, count: number) => {
      previewActiveMatchIndexRef.current = active;
      previewMatchCountRef.current = count;
      setPreviewActiveMatchIndex((prev) => (prev === active ? prev : active));
      setPreviewMatchCount((prev) => (prev === count ? prev : count));
    },
    [],
  );

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setOpen(true)}>
              <Search className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="truncate text-sm font-semibold">Search</span>
              <span className="ml-auto rounded border border-[hsl(var(--sidebar-border))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                {shortcutLabel}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            if (query.trim().length > 0) {
              setQuery("");
              setIsSearching(false);
              return;
            }
            setOpen(false);
            setIsSearching(false);
            setIsPaletteInitializing(false);
            return;
          }
          setIsPaletteInitializing(true);
          setOpen(true);
        }}
        title="Search notes"
        description="Search and open notes by title or content."
        className={
          shouldShowPreview
            ? "w-[calc(100vw-1.5rem)] max-w-[980px] lg:max-w-[1040px]"
            : "w-[calc(100vw-1.5rem)] max-w-[640px] md:max-w-[700px]"
        }
        commandKey={commandResetKey}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search notes..."
          autoFocus
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp" ||
              event.key === "Home" ||
              event.key === "End"
            ) {
              requestAnimationFrame(() =>
                requestAnimationFrame(syncPreviewWithKeyboardSelection),
              );
            }
          }}
        />
        <div
          ref={dialogContentRef}
          className="flex items-center justify-end border-b border-[hsl(var(--border))] px-2 py-1"
        >
          {!isCompactLayout ? (
            <button
              type="button"
              onMouseDown={(event) => {
                // Keep keyboard navigation on the command input/results.
                event.preventDefault();
              }}
              onClick={() => {
                setIsPreviewOpen((prev) => {
                  const next = !prev;
                  window.lychee
                    .invoke("settings.set", {
                      key: SEARCH_PREVIEW_OPEN_SETTING_KEY,
                      value: String(next),
                    })
                    .catch(() => {
                      // Ignore persistence failures for non-critical UI preference.
                    });
                  return next;
                });
                requestAnimationFrame(focusSearchInput);
              }}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
              aria-label={
                isPreviewOpen ? "Hide preview pane" : "Show preview pane"
              }
            >
              {isPreviewOpen ? (
                <>
                  <PanelRightClose className="h-3.5 w-3.5" />
                  Hide Preview
                </>
              ) : (
                <>
                  <PanelRightOpen className="h-3.5 w-3.5" />
                  Show Preview
                </>
              )}
            </button>
          ) : null}
        </div>
        <div ref={resultsContainerRef} className="flex h-[min(560px,68vh)] min-h-0">
          <CommandList
            className={
              shouldShowPreview
                ? "h-full max-h-none w-[52%]"
                : "h-full max-h-none w-full"
            }
          >
            {isSearching || isPaletteInitializing ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isPaletteInitializing ? "Loading notes..." : "Searching..."}
              </div>
            ) : null}
            {isPaletteInitializing || isSearching ? (
              <div className="space-y-2 px-2 py-2">
                <div className="h-9 animate-pulse rounded-md bg-[hsl(var(--muted))]/70" />
                <div className="h-9 animate-pulse rounded-md bg-[hsl(var(--muted))]/70" />
                <div className="h-9 animate-pulse rounded-md bg-[hsl(var(--muted))]/70" />
                <div className="h-9 animate-pulse rounded-md bg-[hsl(var(--muted))]/70" />
                <div className="h-9 animate-pulse rounded-md bg-[hsl(var(--muted))]/70" />
              </div>
            ) : null}
            <CommandEmpty>No matching notes.</CommandEmpty>
            <CommandGroup heading={query.trim() ? "Matches" : "Recent"}>
              {!isPaletteInitializing &&
                !isSearching &&
                renderedDocuments.map((entry) => {
                  const { doc, bodyText, matchCount } = entry;
                  const title = normalizedTitle(doc.title);
                  const bodySnippet = buildHighlightedSnippet(bodyText, query, shouldShowPreview ? 20 : 44);
                  return (
                    <CommandItem
                      key={doc.id}
                      value={`${title} ${bodyText} ${doc.id}`}
                      data-doc-id={doc.id}
                      onMouseDown={(event) => {
                        openInNewTabRef.current =
                          event.metaKey || event.ctrlKey || event.button === 1;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          openInNewTabRef.current =
                            event.metaKey || event.ctrlKey;
                        }
                      }}
                      onPointerEnter={(event) =>
                        handlePreviewPointerMove(doc.id, event)
                      }
                      onPointerMove={(event) =>
                        handlePreviewPointerMove(doc.id, event)
                      }
                      onMouseEnter={(event) =>
                        handlePreviewPointerMove(doc.id, event)
                      }
                      onMouseMove={(event) =>
                        handlePreviewPointerMove(doc.id, event)
                      }
                      onFocus={() => handlePreviewTarget(doc.id)}
                      onSelect={() => handleSelect(doc.id)}
                    >
                      {doc.emoji ? (
                        <span className="text-base leading-none">
                          {doc.emoji}
                        </span>
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{title}</div>
                        {bodySnippet ? (
                          <div className="line-clamp-2 break-words text-xs text-[hsl(var(--muted-foreground))]">
                            {bodySnippet.before}
                            {bodySnippet.match}
                            {bodySnippet.after}
                          </div>
                        ) : null}
                      </div>
                      {query.trim() && matchCount > 0 ? (
                        <span className="shrink-0 rounded-md border border-[hsl(var(--border))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                          {matchCount}
                        </span>
                      ) : null}
                      {selectedId === doc.id ? (
                        <CommandShortcut>Open</CommandShortcut>
                      ) : null}
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          </CommandList>

          {shouldShowPreview ? (
            <div className="h-full w-[48%] border-l border-[hsl(var(--border))] bg-[hsl(var(--background))]/45 p-3">
              {previewEntry ? (
                <div className="flex h-full flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Preview
                    </div>
                    <TooltipPrimitive.Root delayDuration={150}>
                      <TooltipPrimitive.Trigger asChild>
                        <button
                          type="button"
                          onClick={(event) =>
                            openPreviewNote(
                              previewEntry.doc.id,
                              event.metaKey || event.ctrlKey,
                            )
                          }
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
                          aria-label="Open note"
                        >
                          <SquareArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      </TooltipPrimitive.Trigger>
                      <TooltipPrimitive.Portal>
                        <TooltipPrimitive.Content
                          side="top"
                          sideOffset={6}
                          className="z-50 rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-xs text-[hsl(var(--background))] shadow"
                        >
                          Open
                          <TooltipPrimitive.Arrow className="fill-[hsl(var(--foreground))]" />
                        </TooltipPrimitive.Content>
                      </TooltipPrimitive.Portal>
                    </TooltipPrimitive.Root>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="line-clamp-2 flex-1 text-sm font-semibold">
                      {previewTitle}
                    </div>
                    {query.trim() ? (
                      <div className="flex w-[92px] shrink-0 items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]/95 px-1 py-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        <span>
                          {previewMatchCount > 0
                            ? `${previewActiveMatchIndex + 1}/${previewMatchCount}`
                            : '0/0'}
                        </span>
                        <button
                          type="button"
                          onClick={() => previewNavRef.current?.prevMatch()}
                          disabled={previewMatchCount === 0}
                          className={
                            'inline-flex h-5 w-5 items-center justify-center rounded ' +
                            (previewMatchCount > 0
                              ? 'hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]'
                              : 'opacity-40')
                          }
                          aria-label="Previous match"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => previewNavRef.current?.nextMatch()}
                          disabled={previewMatchCount === 0}
                          className={
                            'inline-flex h-5 w-5 items-center justify-center rounded ' +
                            (previewMatchCount > 0
                              ? 'hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]'
                              : 'opacity-40')
                          }
                          aria-label="Next match"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 shadow-sm ring-1 ring-black/5">
                    <div className="h-full overflow-x-hidden overflow-y-scroll rounded-lg border border-[hsl(var(--border))]/65 bg-[hsl(var(--background))] p-4 text-sm text-[hsl(var(--foreground))] shadow-inner [scrollbar-gutter:stable]">
                    {!isPreviewLoading && previewEntry.doc.emoji ? (
                      <div className="mb-2 px-4 text-6xl leading-none">
                        {previewEntry.doc.emoji}
                      </div>
                    ) : null}
                    {isPreviewLoading ? (
                      <div className="space-y-4 p-2">
                        <div className="h-10 w-24 animate-pulse rounded-md bg-[hsl(var(--muted))]/70" />
                        <div className="h-5 w-2/3 animate-pulse rounded bg-[hsl(var(--muted))]/70" />
                        <div className="h-4 w-full animate-pulse rounded bg-[hsl(var(--muted))]/70" />
                        <div className="h-4 w-5/6 animate-pulse rounded bg-[hsl(var(--muted))]/70" />
                        <div className="h-4 w-4/5 animate-pulse rounded bg-[hsl(var(--muted))]/70" />
                        <div className="h-24 w-full animate-pulse rounded-md bg-[hsl(var(--muted))]/70" />
                        <div className="h-4 w-3/4 animate-pulse rounded bg-[hsl(var(--muted))]/70" />
                      </div>
                    ) : null}
                    {!isPreviewLoading && previewEditorState !== undefined ? (
                      <ReadOnlyNotePreview
                        ref={previewNavRef}
                        key={previewEntry.doc.id}
                        editorState={previewEditorState}
                        query={query}
                        onMatchStateChange={handlePreviewMatchStateChange}
                      />
                    ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
                  Select a note to preview.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </CommandDialog>
    </>
  );
}
