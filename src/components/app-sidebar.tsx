import * as React from 'react';
import { Reorder } from 'framer-motion';
import { SquarePen } from 'lucide-react';

import { useDocumentStore, selectActiveDocId } from '../renderer/document-store';
import { useSidebarSectionOrder, type SidebarSectionId } from '../renderer/sidebar-section-order';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from './ui/sidebar';
import { NotesSection } from './sidebar/notes-section';
import { BookmarksSection } from './sidebar/bookmarks-section';
import { SearchNotesButton } from './sidebar/search-notes-button';
import { SidebarFooterContent } from './sidebar/sidebar-footer-content';
import { SidebarSectionDnd } from './sidebar/sidebar-section-dnd';

export function AppSidebar() {
  const {
    documents,
    loading,
    createDocument,
    loadDocuments,
  } = useDocumentStore();
  const activeDocId = useDocumentStore(selectActiveDocId);
  const { order, setOrder } = useSidebarSectionOrder();

  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const [bookmarksOpen, setBookmarksOpen] = React.useState(true);
  const [notesOpen, setNotesOpen] = React.useState(true);

  React.useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  // Keep expandedIds in sync when documents change (e.g. after trash: remove ids that no longer exist)
  React.useEffect(() => {
    const docIds = new Set(documents.map((d) => d.id));
    setExpandedIds((prev) => {
      const next = new Set([...prev].filter((id) => docIds.has(id)));
      return next.size === prev.size && [...next].every((id) => prev.has(id))
        ? prev
        : next;
    });
  }, [documents]);

  const toggleBookmarks = React.useCallback(() => setBookmarksOpen((prev) => !prev), []);
  const toggleNotes = React.useCallback(() => setNotesOpen((prev) => !prev), []);

  const hasBookmarks = React.useMemo(
    () => documents.some((d) => !!d.metadata?.bookmarkedAt),
    [documents],
  );

  const handleReorder = React.useCallback((newVisibleOrder: SidebarSectionId[]) => {
    setOrder((prev) => {
      const hidden = prev.filter((id) => !newVisibleOrder.includes(id));
      return [...newVisibleOrder, ...hidden];
    });
  }, [setOrder]);

  // Layout animation on Reorder.Item is only enabled mid-drag so that section
  // expand/collapse and inner-tree expansion don't trigger sibling reflow animations.
  const [isReordering, setIsReordering] = React.useState(false);
  const handleSectionDragStart = React.useCallback(() => setIsReordering(true), []);
  const handleSectionDragEnd = React.useCallback(() => setIsReordering(false), []);

  const sectionRenderers: Record<SidebarSectionId, { visible: boolean; render: () => React.ReactNode }> = {
    bookmarks: {
      visible: hasBookmarks,
      render: () => (
        <BookmarksSection
          documents={documents}
          isOpen={bookmarksOpen}
          onToggleOpen={toggleBookmarks}
        />
      ),
    },
    notes: {
      visible: true,
      render: () => (
        <NotesSection
          documents={documents}
          selectedId={activeDocId}
          loading={loading}
          expandedIds={expandedIds}
          setExpandedIds={setExpandedIds}
          createDocument={createDocument}
          isOpen={notesOpen}
          onToggleOpen={toggleNotes}
        />
      ),
    },
  };

  const visibleOrder = React.useMemo(
    () => order.filter((id) => sectionRenderers[id].visible),
    // sectionRenderers.bookmarks.visible follows hasBookmarks; notes is always visible.
    [order, hasBookmarks],
  );

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => createDocument(null)}
                aria-label="New note"
                className="group cursor-pointer"
              >
                <SquarePen className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                <span className="truncate text-sm font-semibold">New Note</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SearchNotesButton />
        <Reorder.Group
          as="div"
          axis="y"
          values={visibleOrder}
          onReorder={handleReorder}
          data-sidebar-scroll="true"
          className="sidebar-panel notes-scroll min-h-0 flex-1 pr-2 py-1"
        >
          {visibleOrder.map((id) => (
            <SidebarSectionDnd
              key={id}
              id={id}
              isReordering={isReordering}
              onDragStart={handleSectionDragStart}
              onDragEnd={handleSectionDragEnd}
            >
              {sectionRenderers[id].render()}
            </SidebarSectionDnd>
          ))}
        </Reorder.Group>
      </SidebarContent>
      <SidebarFooterContent />
    </Sidebar>
  );
}
