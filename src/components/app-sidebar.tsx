import * as React from 'react';
import { Plus, Search, Settings, SquareStack, StickyNote } from 'lucide-react';

import { cn } from '../lib/utils';
import { useDocumentStore } from '../renderer/document-store';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from './ui/sidebar';

// Temporary logo placeholder. We'll swap this for a custom SVG later.
function LycheeLogo() {
  return <SquareStack className="h-3 w-3" />;
}

export function AppSidebar() {
  const { open } = useSidebar();
  const { documents, selectedId, loading, createDocument, selectDocument, loadDocuments } =
    useDocumentStore();

  React.useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleNewNote = React.useCallback(async () => {
    await createDocument(null);
  }, [createDocument]);

  const rootDocs = React.useMemo(
    () => documents.filter((d) => d.parentId == null),
    [documents],
  );

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex w-full items-center gap-2 overflow-hidden">
          <button
            type="button"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-white/70 border border-[hsl(var(--sidebar-border))]"
            title="Lychee Notes"
            aria-label="Lychee Notes"
          >
            <LycheeLogo />
          </button>
          <div
            className={cn(
              'min-w-0 flex-1 text-sm font-semibold truncate transition-opacity duration-150',
              open ? 'opacity-100' : 'opacity-0',
            )}
            title="Lychee Notes"
          >
            Lychee Notes
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Actions</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="New note" onClick={handleNewNote}>
                <Plus className="h-4 w-4 shrink-0" />
                <span className={cn('truncate', !open && 'sr-only')}>New note</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        {open && (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Notes</SidebarGroupLabel>
            </SidebarGroup>
            <div className="mt-1 max-h-56 overflow-y-auto pr-1">
              <SidebarMenu>
                {loading && (
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <span className="h-4 w-4 shrink-0 rounded-full bg-[hsl(var(--muted-foreground))]/20" />
                      <span className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                        Loading…
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {!loading &&
                  rootDocs.map((doc) => (
                    <SidebarMenuItem key={doc.id}>
                      <SidebarMenuButton
                        tooltip={doc.title}
                        isActive={doc.id === selectedId}
                        onClick={() => selectDocument(doc.id)}
                      >
                        <StickyNote className="h-4 w-4 shrink-0" />
                        <span className="truncate">{doc.title || 'Untitled'}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </div>
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu className="w-full">
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings">
              <Settings className="h-4 w-4 shrink-0" />
              {open && <span className="truncate text-xs">Settings</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

