import * as React from 'react';

import { useDocumentStore } from '../renderer/document-store';
import {
  Sidebar,
  SidebarContent,
  useSidebar,
} from './ui/sidebar';
import { LycheeLogo } from './sidebar/lychee-logo';
import { SidebarActions } from './sidebar/sidebar-actions';
import { NotesSection } from './sidebar/notes-section';
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

  const handleNewNote = React.useCallback(async () => {
    await createDocument(null);
  }, [createDocument]);

  const { open } = useSidebar();

  return (
    <Sidebar>
      <SidebarContent>
        {/* Logo row at top of sidebar */}
        <div className="flex items-center gap-2 px-1 mb-8">
          <div
            className="flex h-6 w-6 flex-none items-center justify-center rounded-md border border-[hsl(var(--sidebar-border))] bg-white/70"
            title="Lychee Notes"
          >
            <LycheeLogo />
          </div>
          {open && (
            <span className="truncate text-sm font-semibold text-[hsl(var(--sidebar-foreground))]">
              Lychee Notes
            </span>
          )}
        </div>
        <SidebarActions onNewNote={handleNewNote} />
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
