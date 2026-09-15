import * as React from "react";
import debounce from "lodash/debounce";
import { ChevronDown, ChevronUp, Search, Smile, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/renderer/document-store";
import { useEditorPreferencesStore } from "@/renderer/editor-preferences-store";
import { useEditorStatsStore } from "@/renderer/editor-stats-store";
import {
  isActiveMatchInView,
  useSearchHighlightStore,
} from "@/renderer/search-highlight-store";
import type { DocumentRow } from "@/shared/documents";
import { CONTENT_SCHEMA_VERSION } from "@/shared/documents";
import type { LexicalEditor as LexicalEditorInstance } from "lexical";

import { Editor } from "@/components/editor/editor";
import { parseDocumentContent, safeComposerState } from "@/components/editor/content-load";
import { exportDocumentMarkdown } from "@/components/editor/markdown-io";
import { NoteTitle, type NoteTitleHandle } from "@/components/editor/note-title";
import { toast } from "@/components/ui/toast";
import { NoteEmojiPicker } from "@/components/sidebar/note-emoji-picker";
import { BreadcrumbBar } from "@/components/breadcrumb-bar";
import { BookmarkButton } from "@/components/editor/plugins/bookmark-button-plugin";

const LEGACY_UNTITLED = "Untitled";

/** Fire to close all other toolbar panels. */
export function emitToolbarExclusive(panel: string) {
  window.dispatchEvent(
    new CustomEvent("lychee-toolbar-panel", { detail: { panel } }),
  );
}

/** Close when another panel opens. Returns cleanup function. */
export function onToolbarExclusive(
  myPanel: string,
  close: () => void,
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.panel !== myPanel) close();
  };
  window.addEventListener("lychee-toolbar-panel", handler);
  return () => window.removeEventListener("lychee-toolbar-panel", handler);
}

function SearchBar({ tabId }: { tabId: string }) {
  const isOpen = useSearchHighlightStore(
    (s) => s.states[tabId]?.isOpen ?? false,
  );
  const query = useSearchHighlightStore(
    (s) => s.states[tabId]?.query ?? "",
  );
  const activeIndex = useSearchHighlightStore(
    (s) => s.states[tabId]?.activeIndex ?? 0,
  );
  const matchCount = useSearchHighlightStore(
    (s) => s.states[tabId]?.matchCount ?? 0,
  );
  const openHighlight = useSearchHighlightStore((s) => s.openHighlight);
  const setQuery = useSearchHighlightStore((s) => s.setQuery);
  const setActiveIndex = useSearchHighlightStore((s) => s.setActiveIndex);
  const clearHighlight = useSearchHighlightStore((s) => s.clearHighlight);
  const requestScroll = useSearchHighlightStore((s) => s.requestScroll);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Focus + select input when search opens. Sync (not setTimeout) — the input
  // is already in the DOM by the time this effect runs, and any delay risks
  // racing with a follow-up user click that should have kept focus elsewhere.
  React.useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isOpen]);

  const toggle = React.useCallback(() => {
    if (isOpen) {
      clearHighlight(tabId);
    } else {
      openHighlight(tabId);
    }
  }, [isOpen, tabId, clearHighlight, openHighlight]);

  // Typing highlights the first match but intentionally does not scroll to it.
  // Before stepping, reveal the current match if it is off-screen so the first
  // Enter/chevron lands on the first match instead of skipping past it.
  const revealIfActiveMatchOffscreen = React.useCallback(() => {
    if (isActiveMatchInView(tabId)) return false;
    requestScroll(tabId);
    return true;
  }, [tabId, requestScroll]);

  const handlePrev = React.useCallback(() => {
    if (matchCount <= 0) return;
    if (revealIfActiveMatchOffscreen()) return;
    const next = (activeIndex - 1 + matchCount) % matchCount;
    if (next === activeIndex) {
      requestScroll(tabId);
    } else {
      setActiveIndex(tabId, next);
    }
  }, [
    activeIndex,
    matchCount,
    tabId,
    setActiveIndex,
    requestScroll,
    revealIfActiveMatchOffscreen,
  ]);

  const handleNext = React.useCallback(() => {
    if (matchCount <= 0) return;
    if (revealIfActiveMatchOffscreen()) return;
    const next = (activeIndex + 1) % matchCount;
    if (next === activeIndex) {
      requestScroll(tabId);
    } else {
      setActiveIndex(tabId, next);
    }
  }, [
    activeIndex,
    matchCount,
    tabId,
    setActiveIndex,
    requestScroll,
    revealIfActiveMatchOffscreen,
  ]);

  return (
    <div
      className={cn(
        "flex items-center rounded-full transition-all duration-200 ease-out cursor-default",
        isOpen
          ? "bg-[hsl(var(--muted))]/60 border border-[hsl(var(--border))]"
          : "border border-transparent",
      )}
    >
      {/* Controls that expand out to the left */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          isOpen ? "max-w-80" : "max-w-0",
        )}
      >
        <div className={cn(
          "flex items-center whitespace-nowrap pl-2 pr-0.5 gap-0.5",
          !isOpen && "invisible",
        )}>
          <input
            ref={inputRef}
            data-testid="note-find-input"
            value={query}
            onChange={(e) => {
              setQuery(tabId, e.target.value.normalize("NFC"));
              setActiveIndex(tabId, 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                clearHighlight(tabId);
                inputRef.current?.blur();
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) handlePrev();
                else handleNext();
              }
            }}
            className="h-6 w-32 bg-transparent text-xs text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]/50"
            placeholder="Find..."
            aria-label="Find in note"
          />
          <span
            data-testid="note-find-counter"
            className="w-10 shrink-0 text-center text-[10px] text-[hsl(var(--muted-foreground))]"
          >
            {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : "0/0"}
          </span>
          <div className="h-3.5 w-px bg-[hsl(var(--border))] shrink-0" />
          <button
            type="button"
            data-testid="note-find-prev"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handlePrev}
            disabled={matchCount === 0}
            className={
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 " +
              (matchCount > 0
                ? "cursor-pointer text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground))]/10"
                : "text-[hsl(var(--muted-foreground))]/30 cursor-default")
            }
            aria-label="Previous match"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="note-find-next"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleNext}
            disabled={matchCount === 0}
            className={
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 " +
              (matchCount > 0
                ? "cursor-pointer text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground))]/10"
                : "text-[hsl(var(--muted-foreground))]/30 cursor-default")
            }
            aria-label="Next match"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="note-find-close"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery(tabId, "");
              setActiveIndex(tabId, 0);
              inputRef.current?.focus();
            }}
            disabled={!query}
            className={
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 " +
              (query
                ? "cursor-pointer text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground))]/10"
                : "text-[hsl(var(--muted-foreground))]/30 cursor-default")
            }
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Search icon — always visible, right end of the pill */}
      <button
        type="button"
        data-testid="note-find-trigger"
        onClick={toggle}
        aria-label="Find in note"
        aria-expanded={isOpen}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-200 cursor-pointer",
          isOpen
            ? "bg-brand/15 text-brand border-brand/30"
            : "border-transparent bg-transparent text-[hsl(var(--muted-foreground))]/65 hover:bg-brand/15 hover:text-brand hover:border-brand/30",
        )}
      >
        <Search className="h-4 w-4" />
      </button>
    </div>
  );
}

export function LexicalEditor({
  documentId,
  document,
  hidden,
  activeTabId,
}: {
  documentId: string;
  document: DocumentRow;
  hidden: boolean;
  activeTabId: string | null;
}) {
  const [emojiPickerOpen, setEmojiPickerOpen] = React.useState(false);
  const [addIconPickerOpen, setAddIconPickerOpen] = React.useState(false);
  const mainRef = React.useRef<HTMLElement>(null);
  const scrollPositions = React.useRef<Map<string, number>>(new Map());
  const prevActiveTabId = React.useRef<string | null>(null);
  const updateDocumentInStore = useDocumentStore(
    (s) => s.updateDocumentInStore,
  );
  const showWordCount = useEditorPreferencesStore((s) => s.showWordCount);
  const editorStats = useEditorStatsStore((s) => s.byDoc[documentId]);

  // The sidebar list intentionally omits large `content` blobs (the IPC payload
  // would be enormous). Load the open note's full content here before mounting
  // the editor, so large notes still open correctly.
  const [fullContent, setFullContent] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setFullContent(null);
    window.lychee
      .invoke("documents.get", { id: documentId })
      .then(({ document: doc }) => {
        if (alive) setFullContent(doc?.content ?? "");
      })
      .catch(() => {
        if (alive) setFullContent("");
      });
    return () => {
      alive = false;
    };
  }, [documentId]);

  const contentForLoad = fullContent ?? "";

  const loadResult = React.useMemo(
    () =>
      parseDocumentContent({
        content: contentForLoad,
        contentSchemaVersion: document.metadata?.contentSchemaVersion,
      }),
    [documentId, contentForLoad, document.metadata?.contentSchemaVersion],
  );

  const composerState =
    loadResult.status === "ready" ? safeComposerState(loadResult.editorState) : undefined;

  /** Never mount the editor — and therefore never autosave — when the stored
   *  content could not be parsed/validated, or was written by a newer content
   *  schema. Mounting with partial/empty state is what caused #286 truncation. */
  const contentBlocked =
    loadResult.status === "error" ||
    (loadResult.status === "ready" &&
      (loadResult.schemaAhead || composerState === undefined));

  const initialTitle = React.useMemo(() => {
    const title = document.title;
    if (title == null || title === "" || title === LEGACY_UNTITLED) {
      return "";
    }
    return title;
  }, [document.title]);

  const [titleConflict, setTitleConflict] = React.useState(false);
  /** Mirror of `titleConflict` so we only setState when the value actually
   *  flips (React re-renders once even when a setter is called with the same
   *  value, which would otherwise re-render the whole editor). */
  const titleConflictRef = React.useRef(false);
  const applyTitleConflict = React.useCallback((next: boolean) => {
    if (titleConflictRef.current === next) return;
    titleConflictRef.current = next;
    setTitleConflict(next);
  }, []);

  /**
   * Titles are unique (trimmed, case-insensitive). Checked only on commit — not
   * per keystroke — so typing stays cheap and the title is written once.
   */
  const hasTitleConflict = React.useCallback(
    (title: string) => {
      const normalized = title.trim().toLowerCase();
      if (!normalized) return false;
      return useDocumentStore
        .getState()
        .documents.some(
          (d) => d.id !== documentId && d.title.trim().toLowerCase() === normalized,
        );
    },
    [documentId],
  );

  // Clear a stale duplicate error when navigating to another note.
  React.useEffect(() => {
    applyTitleConflict(false);
  }, [documentId, applyTitleConflict]);

  const handleEmojiSelect = React.useCallback(
    async (native: string) => {
      try {
        const { document: updated } = await window.lychee.invoke(
          "documents.update",
          { id: documentId, emoji: native },
        );
        updateDocumentInStore(documentId, { emoji: updated.emoji });
      } catch {
        // ignore
      }
    },
    [documentId, updateDocumentInStore],
  );

  const removeEmoji = React.useCallback(async () => {
    try {
      const { document: updated } = await window.lychee.invoke(
        "documents.update",
        { id: documentId, emoji: null },
      );
      updateDocumentInStore(documentId, { emoji: updated.emoji });
    } catch {
      // ignore
    }
  }, [documentId, updateDocumentInStore]);

  const handleRemoveEmojiClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeEmoji();
    },
    [removeEmoji],
  );

  const unsavedRef = React.useRef(false);
  const isRestoringScroll = React.useRef(false);
  const titleRef = React.useRef<NoteTitleHandle | null>(null);
  /** Set just before a forced flush so the next write is durable (fsync). */
  const fsyncNextRef = React.useRef(false);
  /** Last title the server rejected as a duplicate, to avoid repeat toasts. */
  const rejectedTitleRef = React.useRef<string | null>(null);

  const saveContent = React.useMemo(
    () =>
      debounce((id: string, editor: LexicalEditorInstance) => {
        const content = exportDocumentMarkdown(editor);
        const flush = fsyncNextRef.current;
        fsyncNextRef.current = false;
        window.lychee
          .invoke("documents.update", {
            id,
            content,
            metadata: { contentSchemaVersion: CONTENT_SCHEMA_VERSION },
            flush,
            rename: false,
          })
          .then(({ document: doc }) => {
            unsavedRef.current = false;
            updateDocumentInStore(doc.id, {
              content: doc.content,
              updatedAt: doc.updatedAt,
              metadata: doc.metadata,
            });
          })
          .catch((err) => console.error("Save failed:", err));
      }, 200),
    [updateDocumentInStore],
  );

  const handleTitleWriteError = React.useCallback(
    (id: string, title: string, err: unknown) => {
      const message = String((err as Error)?.message ?? err);
      if (message.includes("Duplicate title")) {
        // A collision the local list missed (e.g. a note beyond the loaded
        // window). Surface it once, then reconcile the field with the stored value.
        const normalized = title.trim().toLowerCase();
        if (rejectedTitleRef.current !== normalized) {
          rejectedTitleRef.current = normalized;
          toast.add({
            title: "Title already in use",
            description: "Every note needs a unique title.",
          });
        }
        window.lychee
          .invoke("documents.get", { id })
          .then(({ document: doc }) => {
            if (!doc) return;
            updateDocumentInStore(doc.id, { title: doc.title });
            titleRef.current?.setText(doc.title);
            applyTitleConflict(false);
          })
          .catch(() => {});
      } else {
        console.error("Title save failed:", err);
      }
    },
    [updateDocumentInStore, applyTitleConflict],
  );

  /**
   * Live input: nothing is persisted or shown until commit. This keeps the
   * field, the tab/sidebar, and storage in agreement — an unconfirmed edit can
   * never leak out through a reload. Just clear any stale duplicate error.
   */
  const handleTitleChange = React.useCallback(
    () => {
      applyTitleConflict(false);
    },
    [applyTitleConflict],
  );

  /**
   * Explicit commit (✓ / Enter / blur): validate uniqueness, persist, and rename
   * the file. Returns false when blocked so the field can keep the draft.
   */
  const handleTitleCommit = React.useCallback(
    (title: string): boolean => {
      if (hasTitleConflict(title)) {
        applyTitleConflict(true);
        return false;
      }
      applyTitleConflict(false);
      updateDocumentInStore(documentId, { title });
      window.lychee
        .invoke("documents.update", { id: documentId, title, flush: true, rename: true })
        .then(({ document: doc }) => {
          updateDocumentInStore(doc.id, { title: doc.title });
        })
        .catch((err) => handleTitleWriteError(documentId, title, err));
      return true;
    },
    [
      documentId,
      updateDocumentInStore,
      handleTitleWriteError,
      hasTitleConflict,
      applyTitleConflict,
    ],
  );

  /** Save now, make it durable, and commit any pending file rename. */
  const flushSaves = React.useCallback(() => {
    if (unsavedRef.current) fsyncNextRef.current = true;
    saveContent.flush();
    titleRef.current?.commit();
  }, [saveContent]);

  /** Move focus from the title field into the body. */
  const focusEditor = React.useCallback(() => {
    mainRef.current?.querySelector<HTMLElement>(".ContentEditable__root")?.focus();
  }, []);

  React.useEffect(() => {
    return () => flushSaves();
  }, [flushSaves]);

  // Save immediately (and durably) when the window loses focus or is closing,
  // so an edit is never stuck inside the debounce window. Only the visible note
  // flushes: hidden tabs were already flushed on tab switch, and letting every
  // mounted editor commit a rename on blur races concurrent renames.
  React.useEffect(() => {
    if (hidden) return;
    const onBlur = () => flushSaves();
    const onBeforeUnload = () => flushSaves();
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flushSaves, hidden]);

  const [reloadNonce, setReloadNonce] = React.useState(0);

  // Bidirectional edits: when the vault watcher applies an external change to
  // this note, refresh the open editor. Skip while a save is pending so an
  // in-flight edit is never silently discarded, and preserve scroll position.
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (!detail || detail.id !== documentId) return;
      if (unsavedRef.current) return;
      const scrollTop = mainRef.current?.scrollTop ?? 0;
      window.lychee
        .invoke("documents.get", { id: documentId })
        .then(({ document: doc }) => {
          setFullContent(doc?.content ?? "");
          setReloadNonce((nonce) => nonce + 1);
          isRestoringScroll.current = true;
          const restore = () => {
            if (mainRef.current) mainRef.current.scrollTop = scrollTop;
          };
          requestAnimationFrame(() => {
            restore();
            requestAnimationFrame(() => {
              restore();
              isRestoringScroll.current = false;
            });
          });
          toast.add({ title: "Updated", description: "Changed on disk" });
        })
        .catch(() => {});
    };
    window.addEventListener("lychee-vault-applied", handler);
    return () => window.removeEventListener("lychee-vault-applied", handler);
  }, [documentId]);

  // Per-tab scroll preservation.
  //
  // Save: a capture-phase `scroll` listener on `document` records el.scrollTop
  // into scrollPositions[tabId] whenever scroll events target our <main>.
  // We use document-capture instead of `el.addEventListener("scroll", ...)`
  // because an element-bound bubble listener was observed missing fires in one
  // specific session (Mac dev mode, post close+reopen) even though the element
  // clearly scrolled and a sibling document-capture listener on the same target
  // fired. A subsequent diagnostic build with both listeners attached could not
  // reproduce the miss — element-fires matched capture-fires 1:1 across many
  // scrolls and multiple close+reopen cycles, with stable DOM identity. The
  // original miss was likely a Heisenbug (HMR state / Chromium dispatch glitch)
  // that we cannot reliably re-trigger. Capture-phase dispatch from document is
  // robust regardless and matches the convention used by other scroll listeners
  // in this codebase (floating-toolbar, link-click, table-action-menu all use
  // window/document capture). Saving continuously also avoids reading from a
  // hidden <main> in the useLayoutEffect: Chromium 41+ reports scrollTop=0 for
  // display:none.
  //
  // Restore: on activeTabId change, set scrollTop synchronously, then re-apply
  // across two animation frames to defeat TabSelectionPlugin's deferred
  // editor.update — which can trigger scrollIntoView toward the caret on a
  // different node. `isRestoringScroll` suppresses the save listener during
  // that window so the caret-driven scroll can't poison the cache.
  React.useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = (e: Event) => {
      if (e.target !== el) return;
      if (isRestoringScroll.current) return;
      const id = prevActiveTabId.current;
      if (id != null) scrollPositions.current.set(id, el.scrollTop);
    };
    globalThis.document.addEventListener("scroll", onScroll, true);
    return () => globalThis.document.removeEventListener("scroll", onScroll, true);
  }, []);

  React.useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const prev = prevActiveTabId.current;
    const curr = activeTabId;
    if (prev === curr) return;

    prevActiveTabId.current = curr;
    flushSaves();
    emitToolbarExclusive("__tab-switch__");
    setEmojiPickerOpen(false);
    setAddIconPickerOpen(false);

    if (curr == null) return;

    // Target resolution:
    //   - Saved value for curr → restore it.
    //   - No saved value AND prev was null (initial mount or coming back from
    //     a display:none background) → leave scrollTop alone. Chromium
    //     preserves scrollTop across display:none; clobbering with 0 would
    //     destroy that preserved position. (Fresh mount is also fine because
    //     scrollTop is already 0.)
    //   - No saved value AND prev was a different tabId → this is a new tab
    //     view of the same doc (e.g. a duplicate tab). Reset to 0.
    let target: number;
    if (scrollPositions.current.has(curr)) {
      target = scrollPositions.current.get(curr)!;
    } else if (prev == null) {
      return;
    } else {
      target = 0;
    }

    isRestoringScroll.current = true;
    el.scrollTop = target;

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      el.scrollTop = target;
      raf2 = requestAnimationFrame(() => {
        isRestoringScroll.current = false;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [activeTabId, flushSaves]);

  const handleEditorChange = React.useCallback(
    (editor: LexicalEditorInstance) => {
      unsavedRef.current = true;
      saveContent(documentId, editor);
    },
    [documentId, saveContent],
  );

  return (
    <main
      ref={mainRef}
      className="h-full flex-1 bg-[hsl(var(--background))] border-t-0 overflow-auto cursor-text"
      style={hidden ? { display: "none" } : undefined}
    >
      {/* Sticky note toolbar */}
      <div className="sticky top-0 z-40 bg-[hsl(var(--background))]">
        <div className="flex items-center gap-0.5 py-1 px-3">
          <BreadcrumbBar />
          <div className="flex-1" />
          <SearchBar tabId={activeTabId ?? documentId} />
          <div
            data-toolbar-id={documentId}
            className="flex items-center gap-0.5"
          />
          <BookmarkButton documentId={documentId} />
        </div>
      </div>

      <div
        data-testid="editor-content"
        className="mx-auto px-8 py-20"
        style={{ maxWidth: "var(--editor-content-max-width, 900px)" }}
      >
        {/* Emoji above editor */}
        {document.emoji && (
          <div className="pl-8 mb-2">
            <div className="group/emoji relative inline-flex items-end rounded w-fit">
              <NoteEmojiPicker
                docId={documentId}
                currentEmoji={document.emoji}
                onSelect={handleEmojiSelect}
                open={emojiPickerOpen}
                onOpenChange={setEmojiPickerOpen}
                trigger={
                  <button
                    type="button"
                    className={cn(
                      "flex h-20 w-20 items-center justify-center rounded-lg bg-transparent text-6xl leading-none transition-colors",
                      "hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                    )}
                    title="Change icon"
                    aria-label="Change note icon"
                  >
                    {document.emoji}
                  </button>
                }
              />
              <button
                type="button"
                onClick={handleRemoveEmojiClick}
                className="absolute right-0 top-0 flex h-6 w-6 translate-x-3 -translate-y-2 items-center justify-center rounded-full bg-[hsl(var(--background))] p-0.5 text-[hsl(var(--muted-foreground))] opacity-0 shadow-sm transition-opacity group-hover/emoji:opacity-100 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                title="Remove icon"
                aria-label="Remove note icon"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Add Icon button — visible when hovering above or on the title */}
        {!document.emoji && (
          <div className="add-icon-zone pl-8 pb-2 -mt-20 pt-20">
            <NoteEmojiPicker
              docId={documentId}
              currentEmoji={document.emoji}
              onSelect={handleEmojiSelect}
              open={addIconPickerOpen}
              onOpenChange={setAddIconPickerOpen}
              trigger={
                <button
                  type="button"
                  className={cn(
                    "add-icon-btn inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-opacity text-sm text-[hsl(var(--muted-foreground))]",
                    "hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                    "opacity-0",
                  )}
                  title="Add Icon"
                  aria-label="Add note icon"
                >
                  <Smile className="h-4 w-4" />
                  <span>Add Icon</span>
                </button>
              }
            />
          </div>
        )}

        {/* Editor with title as first block */}
        {fullContent === null ? null : contentBlocked ? (
          <div
            data-testid="content-load-blocked"
            role="alert"
            className="mx-auto my-6 max-w-xl rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-4 text-sm text-[hsl(var(--foreground))]"
          >
            <p className="font-medium">
              {loadResult.status === "ready" && loadResult.schemaAhead
                ? "This note was created by a newer version of Lychee."
                : "This note couldn't be opened safely."}
            </p>
            <p className="mt-1 text-[hsl(var(--muted-foreground))]">
              {loadResult.status === "ready" && loadResult.schemaAhead
                ? "Editing is disabled to prevent newer content from being overwritten. Update Lychee, or open this note on the device that created it."
                : `${loadResult.status === "error" ? loadResult.reason + " " : ""}Editing is disabled so the stored content isn't overwritten.`}
            </p>
          </div>
        ) : (
          <>
            <NoteTitle
              ref={titleRef}
              value={initialTitle}
              conflict={titleConflict}
              onChange={handleTitleChange}
              onCommit={handleTitleCommit}
              onEnter={focusEditor}
            />
            <Editor
              key={`${documentId}-${reloadNonce}`}
              documentId={documentId}
              tabId={activeTabId ?? documentId}
              activeTabId={activeTabId}
              isActive={!hidden}
              editorState={composerState}
              noteMarkdown={contentForLoad}
              onEditorChange={handleEditorChange}
            />
          </>
        )}
      </div>

      {showWordCount && editorStats && (
        <div className="pointer-events-none sticky bottom-3 z-30 flex justify-end px-6 pt-2">
          <div
            data-testid="word-count"
            className="flex flex-col items-end gap-0.5 rounded-lg bg-[hsl(var(--muted))]/90 px-2.5 py-1.5 text-[11px] leading-tight text-[hsl(var(--muted-foreground))]"
          >
            <span>{editorStats.words.toLocaleString()} words</span>
            <span>{editorStats.characters.toLocaleString()} characters</span>
          </div>
        </div>
      )}
    </main>
  );
}
