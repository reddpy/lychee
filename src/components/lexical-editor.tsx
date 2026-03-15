import * as React from "react";
import debounce from "lodash/debounce";
import { ChevronDown, ChevronUp, Search, Smile, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/renderer/document-store";
import { useSearchHighlightStore } from "@/renderer/search-highlight-store";
import type { DocumentRow } from "@/shared/documents";
import type { EditorState, SerializedEditorState } from "lexical";

import { Editor } from "@/components/editor/editor";
import { NoteEmojiPicker } from "@/components/sidebar/note-emoji-picker";
import { NoteContext } from "@/renderer/note-context";
import { BreadcrumbPill } from "@/components/breadcrumb-pill";
import { BookmarkButton } from "@/components/editor/plugins/bookmark-button-plugin";

function getSerializedState(
  content: string | undefined,
): SerializedEditorState | undefined {
  if (!content || content.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.root) return parsed;
  } catch {
    // ignore invalid JSON
  }
  return undefined;
}

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

function SearchBar({ documentId }: { documentId: string }) {
  const isOpen = useSearchHighlightStore(
    (s) => s.states[documentId]?.isOpen ?? false,
  );
  const query = useSearchHighlightStore(
    (s) => s.states[documentId]?.query ?? "",
  );
  const activeIndex = useSearchHighlightStore(
    (s) => s.states[documentId]?.activeIndex ?? 0,
  );
  const matchCount = useSearchHighlightStore(
    (s) => s.states[documentId]?.matchCount ?? 0,
  );
  const openHighlight = useSearchHighlightStore((s) => s.openHighlight);
  const setQuery = useSearchHighlightStore((s) => s.setQuery);
  const setActiveIndex = useSearchHighlightStore((s) => s.setActiveIndex);
  const clearHighlight = useSearchHighlightStore((s) => s.clearHighlight);
  const requestScroll = useSearchHighlightStore((s) => s.requestScroll);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Focus + select input when search opens
  React.useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const toggle = React.useCallback(() => {
    if (isOpen) {
      clearHighlight(documentId);
    } else {
      openHighlight(documentId);
    }
  }, [isOpen, documentId, clearHighlight, openHighlight]);

  const handlePrev = React.useCallback(() => {
    if (matchCount <= 0) return;
    const next = (activeIndex - 1 + matchCount) % matchCount;
    if (next === activeIndex) {
      requestScroll(documentId);
    } else {
      setActiveIndex(documentId, next);
    }
  }, [activeIndex, matchCount, documentId, setActiveIndex, requestScroll]);

  const handleNext = React.useCallback(() => {
    if (matchCount <= 0) return;
    const next = (activeIndex + 1) % matchCount;
    if (next === activeIndex) {
      requestScroll(documentId);
    } else {
      setActiveIndex(documentId, next);
    }
  }, [activeIndex, matchCount, documentId, setActiveIndex, requestScroll]);

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
              setQuery(documentId, e.target.value.normalize("NFC"));
              setActiveIndex(documentId, 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                clearHighlight(documentId);
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
              setQuery(documentId, "");
              setActiveIndex(documentId, 0);
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
            ? "bg-[#C14B55]/15 text-[#C14B55] border-[#C14B55]/30"
            : "border-transparent bg-transparent text-[hsl(var(--muted-foreground))]/65 hover:bg-[#C14B55]/15 hover:text-[#C14B55] hover:border-[#C14B55]/30",
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
}: {
  documentId: string;
  document: DocumentRow;
  hidden: boolean;
}) {
  const [emojiPickerOpen, setEmojiPickerOpen] = React.useState(false);
  const [addIconPickerOpen, setAddIconPickerOpen] = React.useState(false);
  const updateDocumentInStore = useDocumentStore(
    (s) => s.updateDocumentInStore,
  );

  const noteContextValue = React.useMemo(
    () => ({ documentId, title: document.title || "" }),
    [documentId, document.title],
  );

  const editorSerializedState = React.useMemo(
    () => getSerializedState(document.content),
    [documentId, document.content],
  );

  const initialTitle = React.useMemo(() => {
    const title = document.title;
    if (title == null || title === "" || title === LEGACY_UNTITLED) {
      return "";
    }
    return title;
  }, [document.title]);

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

  const saveContent = React.useMemo(
    () =>
      debounce(
        (
          id: string,
          editorState: EditorState,
          onSaved?: (doc: DocumentRow) => void,
        ) => {
          const json = editorState.toJSON();
          json.root.children = (json.root as any).children.filter(
            (child: any) => child.type !== "loading-placeholder",
          );
          const content = JSON.stringify(json);
          window.lychee
            .invoke("documents.update", { id, content })
            .then(({ document: doc }) => {
              updateDocumentInStore(doc.id, {
                content: doc.content,
                updatedAt: doc.updatedAt,
              });
              onSaved?.(doc);
            })
            .catch((err) => console.error("Save failed:", err));
        },
        600,
      ),
    [updateDocumentInStore],
  );

  const saveTitle = React.useMemo(
    () =>
      debounce((id: string, newTitle: string) => {
        window.lychee
          .invoke("documents.update", { id, title: newTitle })
          .then(({ document: doc }) => {
            updateDocumentInStore(doc.id, { title: doc.title });
          })
          .catch((err) => console.error("Title save failed:", err));
      }, 500),
    [updateDocumentInStore],
  );

  const debouncedStoreUpdate = React.useMemo(
    () =>
      debounce((id: string, title: string) => {
        updateDocumentInStore(id, { title });
      }, 300),
    [updateDocumentInStore],
  );

  React.useEffect(() => {
    return () => {
      saveContent.flush();
      saveTitle.flush();
      debouncedStoreUpdate.flush();
    };
  }, [saveContent, saveTitle, debouncedStoreUpdate]);

  const handleEditorStateChange = React.useCallback(
    (editorState: EditorState) => {
      saveContent(documentId, editorState);
    },
    [documentId, saveContent],
  );

  const handleTitleChange = React.useCallback(
    (title: string) => {
      debouncedStoreUpdate(documentId, title);
      saveTitle(documentId, title);
    },
    [documentId, debouncedStoreUpdate, saveTitle],
  );

  return (
    <main
      className="h-full flex-1 bg-[hsl(var(--background))] border-t-0 overflow-auto cursor-text"
      style={hidden ? { display: "none" } : undefined}
    >
      {/* Sticky note toolbar */}
      <div className="sticky top-0 z-40 bg-[hsl(var(--background))]">
        <div className="mx-auto max-w-225 px-8 flex items-center justify-end gap-0.5 py-1">
          <SearchBar documentId={documentId} />
          <div
            data-toolbar-id={documentId}
            className="flex items-center gap-0.5"
          />
          <BreadcrumbPill />
          <BookmarkButton documentId={documentId} />
        </div>
      </div>

      <div className="mx-auto max-w-225 px-8 py-20">
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
        <NoteContext.Provider value={noteContextValue}>
          <Editor
            documentId={documentId}
            isActive={!hidden}
            editorSerializedState={editorSerializedState}
            onEditorStateChange={handleEditorStateChange}
            initialTitle={initialTitle}
            onTitleChange={handleTitleChange}
          />
        </NoteContext.Provider>
      </div>
    </main>
  );
}
