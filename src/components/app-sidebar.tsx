import * as React from 'react';
import { SquarePen } from 'lucide-react';

import { useDocumentStore } from '../renderer/document-store';
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

export function AppSidebar() {
  const {
    documents,
    selectedId,
    loading,
    createDocument,
    loadDocuments,
  } = useDocumentStore();

  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

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

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => createDocument(null)}
                className="group cursor-pointer"
              >
                <SquarePen className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                <span className="truncate text-sm font-semibold">New Note</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SearchNotesButton />
        <BookmarksSection documents={documents} />
        <NotesSection
          documents={documents}
          selectedId={selectedId}
          loading={loading}
          expandedIds={expandedIds}
          setExpandedIds={setExpandedIds}
          createDocument={createDocument}
        />
      </SidebarContent>
      <SidebarFooterContent />
    </Sidebar>
  );
}
