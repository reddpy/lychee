import * as React from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2, RotateCcw, Trash2, X } from "lucide-react";

import type { DocumentRow } from "../../shared/documents";
import { useDocumentStore } from "../../renderer/document-store";
import { Button } from "../ui/button";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  commandDialogShellClassName,
} from "../ui/command";
import { SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { cn } from "../../lib/utils";
import { displayNoteTitle } from "../../shared/note-title";
import { extractPlainText } from "../../shared/search-preview";
import {
  buildHighlightedPreviewState,
  ReadOnlyNotePreview,
} from "../editor/read-only-note-preview";

function displayTitle(doc: DocumentRow): string {
  return displayNoteTitle(doc.title);
}

function formatDeletedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const TRASH_LOAD_MIN_MS = 120;

export function TrashBinDialog() {
  const { open: isSidebarExpanded, setHoverOpen } = useSidebar();
  const {
    documents,
    trashedDocuments,
    loadTrashedDocuments,
    restoreDocument,
    permanentDeleteDocument,
  } = useDocumentStore();

  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [trashLoading, setTrashLoading] = React.useState(false);
  const [pendingDeleteDoc, setPendingDeleteDoc] = React.useState<{
    id: string;
    title: string;
  } | null>(null);
  const [selectedDocId, setSelectedDocId] = React.useState("");
  const dialogContentRef = React.useRef<HTMLDivElement>(null);
  const loadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const bodyTextCacheRef = React.useRef<Map<string, string>>(new Map());
  const lastPointerPosRef = React.useRef<{ x: number; y: number } | null>(null);

  const deferredSearch = React.useDeferredValue(search);

  // While the browser is open, suppress the floating sidebar's hover behavior
  // so it does not fight the modal for focus (same contract as the palette).
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
    if (!open) return;
    setTrashLoading(true);
    const start = Date.now();
    loadTrashedDocuments().finally(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, TRASH_LOAD_MIN_MS - elapsed);
      loadTimeoutRef.current = setTimeout(() => {
        setTrashLoading(false);
      }, remaining);
    });
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [open, loadTrashedDocuments]);

  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const root = dialogContentRef.current;
      const input = root?.querySelector<HTMLInputElement>("[cmdk-input]");
      input?.focus();
      input?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Map of all documents (active + trashed) for parent lookups
  const allDocsById = React.useMemo(() => {
    const m = new Map<string, DocumentRow>();
    documents.forEach((d) => m.set(d.id, d));
    trashedDocuments.forEach((d) => m.set(d.id, d));
    return m;
  }, [documents, trashedDocuments]);

  const orderedTrashed = React.useMemo(() => {
    const ids = new Set(trashedDocuments.map((d) => d.id));
    const parents = trashedDocuments.filter(
      (d) => d.parentId === null || !ids.has(d.parentId),
    );
    const sortedParents = [...parents].sort(
      (a, b) =>
        new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime(),
    );
    const out: DocumentRow[] = [];
    for (const p of sortedParents) {
      out.push(p);
      const children = trashedDocuments
        .filter((d) => d.parentId === p.id)
        .sort(
          (a, b) =>
            new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime(),
        );
      out.push(...children);
    }
    return out;
  }, [trashedDocuments]);

  const searchQuery = deferredSearch.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!searchQuery) return orderedTrashed;
    return orderedTrashed.filter((d) => {
      if (displayTitle(d).toLowerCase().includes(searchQuery)) return true;
      const key = `${d.id}|${d.updatedAt}`;
      let body = bodyTextCacheRef.current.get(key);
      if (body === undefined) {
        body = extractPlainText(d.content).toLowerCase();
        bodyTextCacheRef.current.set(key, body);
      }
      return body.includes(searchQuery);
    });
  }, [orderedTrashed, searchQuery]);

  // Keep a valid selection as filtering/loading changes the visible list.
  React.useEffect(() => {
    setSelectedDocId((current) => {
      if (filtered.length === 0) return "";
      if (current && filtered.some((d) => d.id === current)) return current;
      return filtered[0].id;
    });
  }, [filtered]);

  const previewEntry =
    filtered.find((d) => d.id === selectedDocId) ?? filtered[0];
  const previewState = React.useMemo(
    () =>
      previewEntry
        ? buildHighlightedPreviewState(previewEntry.content, deferredSearch)
        : undefined,
    [previewEntry, deferredSearch],
  );

  const handleRestore = React.useCallback(
    async (id: string) => {
      await restoreDocument(id);
    },
    [restoreDocument],
  );

  const handleRequestDelete = React.useCallback((doc: DocumentRow) => {
    setPendingDeleteDoc({ id: doc.id, title: displayTitle(doc) });
  }, []);

  const closeBrowser = React.useCallback(() => {
    setSearch("");
    setSelectedDocId("");
    setOpen(false);
  }, []);

  const handleConfirmDelete = React.useCallback(async () => {
    if (!pendingDeleteDoc) return;
    await permanentDeleteDocument(pendingDeleteDoc.id);
    setPendingDeleteDoc(null);
    // Match the previous behavior: completing a permanent delete closes the
    // browser entirely (and thereby releases any floating-sidebar state).
    closeBrowser();
  }, [pendingDeleteDoc, permanentDeleteDocument, closeBrowser]);

  const handleCancelDelete = React.useCallback(() => {
    setPendingDeleteDoc(null);
  }, []);

  const handlePointerMove = React.useCallback(
    (id: string, event: React.MouseEvent | React.PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      const last = lastPointerPosRef.current;
      lastPointerPosRef.current = point;
      // Ignore synthetic hover changes caused by scrolling under a stationary cursor.
      if (last && last.x === point.x && last.y === point.y) return;
      setSelectedDocId(id);
    },
    [],
  );

  return (
    <>
      {pendingDeleteDoc &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
            aria-modal
            role="dialog"
            aria-labelledby="delete-confirm-title"
            onClick={(e) =>
              e.target === e.currentTarget && handleCancelDelete()
            }
          >
            <div
              data-testid="trash-delete-confirm"
              className="z-[61] w-64 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p
                id="delete-confirm-title"
                className="text-center text-sm font-semibold leading-snug text-[hsl(var(--popover-foreground))]"
              >
                Are you sure you want to delete this note from Trash?
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={handleConfirmDelete}
                >
                  Delete note
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-center"
                  onClick={handleCancelDelete}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <SidebarMenuItem>
        <button
          type="button"
          title="Trash Bin"
          aria-label="Trash Bin"
          data-active="false"
          onClick={() => setOpen(true)}
          className={cn(
            "group/menu-button flex w-full items-center justify-start gap-1.5 rounded-md px-2 py-1.5 text-sm text-[hsl(var(--sidebar-foreground))]",
            "hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]",
          )}
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-sm font-semibold">Trash Bin</span>
        </button>
      </SidebarMenuItem>

      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            if (pendingDeleteDoc) return;
            closeBrowser();
            return;
          }
          setOpen(true);
        }}
        title="Trash Bin"
        description="Browse, restore, or permanently delete trashed notes."
        shouldFilter={false}
        showCloseButton={false}
        commandValue={selectedDocId}
        onCommandValueChange={setSelectedDocId}
        commandClassName="bg-transparent shadow-none"
        className={
          commandDialogShellClassName + " max-w-[980px] lg:max-w-[1040px]"
        }
      >
        <div ref={dialogContentRef} className="flex min-h-0 flex-1 flex-col px-2">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search trash..."
            autoFocus
            className="h-full py-0 text-sm"
            endAdornment={
              search.length > 0 ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setSearch("")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="inline-flex h-6 items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 px-2 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                  Esc
                </span>
              )
            }
          />
          <div className="mt-1.5 mb-2 flex min-h-0 w-[calc(100%-0.5rem)] flex-1 self-center flex-col overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-[0_18px_38px_-30px_rgba(0,0,0,0.65)]">
            <div
              data-testid="trash-browser"
              className="flex h-[min(560px,68vh)] min-h-0"
            >
              <CommandList className="h-full max-h-none w-[38%] shrink-0">
                {trashLoading ? (
                  <div
                    className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
                    aria-busy
                  >
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-xs">Loading trash…</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {trashedDocuments.length === 0
                      ? "Trash is empty"
                      : "No matching items"}
                  </div>
                ) : (
                  <CommandGroup heading="Deleted notes" className="p-1">
                    {filtered.map((doc) => {
                      const parent = doc.parentId
                        ? allDocsById.get(doc.parentId)
                        : null;
                      const parentTitle = parent ? displayTitle(parent) : null;
                      const isChild = !!doc.parentId && !!parent;
                      const deletedLabel = formatDeletedAt(doc.deletedAt);
                      const subtitleParts: string[] = [];
                      if (isChild) subtitleParts.push(`in: ${parentTitle ?? "…"}`);
                      if (deletedLabel) subtitleParts.push(`Deleted ${deletedLabel}`);
                      return (
                        <CommandItem
                          key={doc.id}
                          value={doc.id}
                          data-doc-id={doc.id}
                          className="rounded-md transition-[transform,background-color,color] duration-100 ease-out data-[selected=true]:bg-[hsl(var(--primary)/0.1)]"
                          onPointerEnter={(event) =>
                            handlePointerMove(doc.id, event)
                          }
                          onPointerMove={(event) =>
                            handlePointerMove(doc.id, event)
                          }
                          onFocus={() => setSelectedDocId(doc.id)}
                        >
                          {doc.emoji ? (
                            <span className="text-base leading-none">
                              {doc.emoji}
                            </span>
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{displayTitle(doc)}</div>
                            {subtitleParts.length > 0 ? (
                              <div className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                                {subtitleParts.join(" · ")}
                              </div>
                            ) : null}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </CommandList>

              <div className="h-full min-w-0 flex-1 border-l border-[hsl(var(--border))] bg-[hsl(var(--background))]/45 p-3">
                {previewEntry ? (
                  <div className="flex h-full flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        Preview
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label="Restore"
                          className="h-7 gap-1.5 border-[hsl(var(--border))] px-2 text-xs"
                          onClick={() => {
                            void handleRestore(previewEntry.id);
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Restore
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label="Permanently delete"
                          className="h-7 gap-1.5 border-destructive px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleRequestDelete(previewEntry)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {previewEntry.emoji ? (
                        <span className="text-xl leading-none">
                          {previewEntry.emoji}
                        </span>
                      ) : null}
                      <div
                        data-testid="trash-preview-title"
                        className="line-clamp-2 flex-1 text-sm font-semibold"
                      >
                        {displayTitle(previewEntry)}
                      </div>
                    </div>
                    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 shadow-sm ring-1 ring-black/5">
                      <div className="h-full overflow-x-hidden overflow-y-scroll rounded-lg border border-[hsl(var(--border))]/65 bg-[hsl(var(--background))] p-4 text-sm text-[hsl(var(--foreground))] shadow-inner [scrollbar-gutter:stable]">
                        {previewState !== undefined ? (
                          <ReadOnlyNotePreview
                            key={previewEntry.id}
                            editorState={previewState}
                            query={deferredSearch}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
                            <FileText className="h-8 w-8 opacity-30" />
                            <span className="text-sm">This note is empty</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
                    Select a note to preview.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </CommandDialog>
    </>
  );
}
