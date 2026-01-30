import * as React from 'react';
import { createPortal } from 'react-dom';
import { FileText, RotateCcw, Search, Trash2 } from 'lucide-react';

import type { DocumentRow } from '../../shared/documents';
import { useDocumentStore } from '../../renderer/document-store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';
import { SidebarMenuItem, useSidebar } from '../ui/sidebar';

function displayTitle(doc: DocumentRow): string {
  return doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page';
}

function TrashItemRow({
  doc,
  onRestore,
  onRequestDelete,
}: {
  doc: DocumentRow;
  onRestore: (id: string) => void;
  onRequestDelete: (doc: DocumentRow) => void;
}) {
  const title = displayTitle(doc);
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
      {doc.emoji ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base">
          {doc.emoji}
        </span>
      ) : (
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          className="h-7 w-7 shrink-0 border-[hsl(var(--border))] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => onRestore(doc.id)}
          aria-label="Restore"
          title="Restore"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          className="h-7 w-7 shrink-0 border-[hsl(var(--border))] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Permanently delete"
          title="Permanently delete"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(doc);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function TrashBinPopover() {
  const { open } = useSidebar();
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [pendingDeleteDoc, setPendingDeleteDoc] = React.useState<{
    id: string;
    title: string;
  } | null>(null);

  const {
    trashedDocuments,
    loadTrashedDocuments,
    restoreDocument,
    permanentDeleteDocument,
  } = useDocumentStore();

  React.useEffect(() => {
    if (popoverOpen) {
      void loadTrashedDocuments();
    }
  }, [popoverOpen, loadTrashedDocuments]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trashedDocuments;
    return trashedDocuments.filter((d) =>
      displayTitle(d).toLowerCase().includes(q),
    );
  }, [trashedDocuments, search]);

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
                'group/menu-button flex w-full items-center rounded-md py-2 text-sm',
                'hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]',
                open ? 'justify-start gap-2 px-2' : 'justify-center gap-0 px-0',
              )}
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              {open ? <span className="truncate text-xs">Trash Bin</span> : null}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 p-0"
            align="start"
            side={open ? 'right' : 'top'}
            sideOffset={8}
          >
            <div className="flex h-[20rem] flex-col gap-2 p-2">
              <div className="relative shrink-0">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search trash..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                {filtered.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {trashedDocuments.length === 0 ? 'Trash is empty' : 'No matching items'}
                  </div>
                ) : (
                  <div className="p-1">
                    {filtered.map((doc) => (
                      <TrashItemRow
                        key={doc.id}
                        doc={doc}
                        onRestore={handleRestore}
                        onRequestDelete={handleRequestDelete}
                      />
                    ))}
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
