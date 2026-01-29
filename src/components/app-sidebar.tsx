import * as React from 'react';

import { useDocumentStore } from '../renderer/document-store';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader as SidebarHeaderSlot,
} from './ui/sidebar';
import { SidebarHeader } from './sidebar/sidebar-header';
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

  const handleNewNote = React.useCallback(async () => {
    await createDocument(null);
  }, [createDocument]);

  return (
    <Sidebar>
      <SidebarHeaderSlot>
        <SidebarHeader />
      </SidebarHeaderSlot>
      <SidebarContent>
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
