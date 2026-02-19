import * as React from 'react';
import { createPortal } from 'react-dom';
import { FileText, Loader2, RotateCcw, Search, Trash2, X } from 'lucide-react';

import type { DocumentRow } from '../../shared/documents';
import { useDocumentStore } from '../../renderer/document-store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { SidebarMenuItem } from '../ui/sidebar';

function displayTitle(doc: DocumentRow): string {
  return doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page';
}

function TrashItemRow({
  doc,
  parentTitle,
  isChild,
  onRestore,
  onRequestDelete,
}: {
  doc: DocumentRow;
  parentTitle?: string | null;
  isChild?: boolean;
  onRestore: (id: string) => void;
  onRequestDelete: (doc: DocumentRow) => void;
}) {
  const title = displayTitle(doc);
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50',
        isChild && 'pl-7',
      )}
    >
      {doc.emoji ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base">
          {doc.emoji}
        </span>
      ) : (
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1 truncate">
        <span className="block truncate" title={title}>
          {title}
        </span>
        {(parentTitle != null || isChild) && (
          <span className="block truncate text-xs text-muted-foreground" title={parentTitle ?? undefined}>
            in: {parentTitle ?? '…'}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="h-7 w-7 shrink-0 border-[hsl(var(--border))] text-muted-foreground hover:bg-[hsl(var(--accent))] hover:border-[hsl(var(--muted-foreground))]/25 hover:text-foreground"
              onClick={() => onRestore(doc.id)}
              aria-label="Restore"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Restore</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="h-7 w-7 shrink-0 border-[hsl(var(--border))] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Permanently delete"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(doc);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Permanently delete</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function TrashBinPopover() {
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [trashLoading, setTrashLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [pendingDeleteDoc, setPendingDeleteDoc] = React.useState<{
    id: string;
    title: string;
  } | null>(null);

  const {
    documents,
    trashedDocuments,
    loadTrashedDocuments,
    restoreDocument,
    permanentDeleteDocument,
  } = useDocumentStore();

  const TRASH_LOAD_MIN_MS = 120;
  const loadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!popoverOpen) return;
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
  }, [popoverOpen, loadTrashedDocuments]);

  const deferredSearch = React.useDeferredValue(search);

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
      (a, b) => new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime(),
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
    return orderedTrashed.filter((d) =>
      displayTitle(d).toLowerCase().includes(searchQuery),
    );
  }, [orderedTrashed, searchQuery]);

  const handleRestore = React.useCallback(
    async (id: string) => {
      await restoreDocument(id);
    },
    [restoreDocument],
  );

  const handleRequestDelete = React.useCallback((doc: DocumentRow) => {
    setPendingDeleteDoc({ id: doc.id, title: displayTitle(doc) });
  }, []);

  const handleConfirmDelete = React.useCallback(async () => {
    if (!pendingDeleteDoc) return;
    await permanentDeleteDocument(pendingDeleteDoc.id);
    setPendingDeleteDoc(null);
  }, [pendingDeleteDoc, permanentDeleteDocument]);

  const handleCancelDelete = React.useCallback(() => {
    setPendingDeleteDoc(null);
  }, []);

  const closeTrashPopover = React.useCallback(() => {
    setSearch('');
    setPopoverOpen(false);
  }, []);

  const showOverlays = (popoverOpen || pendingDeleteDoc) && document?.body;

  return (
    <>
      {showOverlays &&
        createPortal(
          <>
            {popoverOpen && (
              <div
                className="fixed inset-0 z-[45]"
                aria-hidden
                onClick={(e) =>
                  e.target === e.currentTarget && closeTrashPopover()
                }
              />
            )}
            {pendingDeleteDoc && (
              <div
                className="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
                aria-modal
                role="dialog"
                aria-labelledby="delete-confirm-title"
                onClick={(e) =>
                  e.target === e.currentTarget && handleCancelDelete()
                }
              >
                <div
                  className="z-[51] w-64 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-4 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p
                    id="delete-confirm-title"
                    className="text-center text-sm font-semibold leading-snug text-[hsl(var(--popover-foreground))]"
                  >
                    Are you sure you want to delete this page from Trash?
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-center border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={handleConfirmDelete}
                    >
                      Delete page
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
              </div>
            )}
          </>,
          document.body,
        )}
      <SidebarMenuItem>
        <Popover
          open={popoverOpen}
          onOpenChange={(open) => {
            if (!open) {
              if (pendingDeleteDoc) return;
              closeTrashPopover();
            } else {
              setPopoverOpen(true);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Trash Bin"
              aria-label="Trash Bin"
              data-active="false"
              className={cn(
                'group/menu-button flex w-full items-center justify-start gap-2 rounded-md px-2 py-2 text-sm',
                'hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]',
              )}
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              <span className="truncate text-xs">Trash Bin</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[21rem] p-0 shadow-xl"
            align="end"
            alignOffset={10}
            side="right"
            sideOffset={24}
          >
            <div className="flex h-[20rem] flex-col gap-2 p-2">
              <div className="relative shrink-0">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search trash..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={cn(
                    'h-8 border pl-8 border-transparent focus:border-[1.5px] focus:border-[hsl(var(--ring))] focus:ring-0 focus-visible:border-[1.5px] focus-visible:border-[hsl(var(--ring))] focus-visible:ring-0 focus-visible:outline-none',
                    search.length > 0 && 'pr-8',
                  )}
                />
                {search.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-[hsl(var(--border))]">
                {trashLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground" aria-busy>
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-xs">Loading trash…</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {trashedDocuments.length === 0 ? 'Trash is empty' : 'No matching items'}
                  </div>
                ) : (
                  <div className="p-1 pr-4">
                    {filtered.map((doc) => {
                      const parent = doc.parentId
                        ? allDocsById.get(doc.parentId)
                        : null;
                      const parentTitle = parent
                        ? displayTitle(parent)
                        : null;
                      const isChild = !!doc.parentId && !!parent;
                      return (
                        <TrashItemRow
                          key={doc.id}
                          doc={doc}
                          parentTitle={parentTitle ?? undefined}
                          isChild={isChild}
                          onRestore={handleRestore}
                          onRequestDelete={handleRequestDelete}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    </>
  );
}
