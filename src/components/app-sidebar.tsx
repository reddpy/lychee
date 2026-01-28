import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Plus,
  Settings,
  SquareStack,
  StickyNote,
} from 'lucide-react';

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

const MAX_NESTING_DEPTH = 4; // root depth 0, deepest child depth 4 (5 levels)

export function AppSidebar() {
  const { open } = useSidebar();
  const { documents, selectedId, loading, createDocument, selectDocument, loadDocuments } =
    useDocumentStore();

  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const [menuForId, setMenuForId] = React.useState<string | null>(null);
   const [notesSectionOpen, setNotesSectionOpen] = React.useState(true);

  React.useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleNewNote = React.useCallback(async () => {
    await createDocument(null);
  }, [createDocument]);

  const childrenByParent = React.useMemo(() => {
    const map = new Map<string | null, typeof documents>();
    for (const doc of documents) {
      const key = doc.parentId ?? null;
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(doc);
      } else {
        map.set(key, [doc]);
      }
    }
    return map;
  }, [documents]);

  const rootDocs = childrenByParent.get(null) ?? [];

  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const renderDocNode = React.useCallback(
    (doc: (typeof documents)[number], depth: number): React.ReactNode => {
      const children = childrenByParent.get(doc.id) ?? [];
      const hasChildren = children.length > 0;
      const isExpanded = expandedIds.has(doc.id);
      const canAddChild = depth < MAX_NESTING_DEPTH;

      return (
        <React.Fragment key={doc.id}>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={doc.title}
              isActive={doc.id === selectedId}
              onClick={() => selectDocument(doc.id)}
              className="group"
            >
              <div
                className="flex w-full items-center gap-2"
                style={{ paddingLeft: depth * 12 }}
              >
                {hasChildren ? (
                  <span
                    className="flex h-4 w-4 items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(doc.id);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </span>
                ) : (
                  <span className="h-4 w-4" />
                )}
                <StickyNote className="h-4 w-4 shrink-0" />
                <span className="truncate flex-1">{doc.title || 'Untitled'}</span>
                <div className="ml-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <TooltipPrimitive.Root delayDuration={150}>
                    <TooltipPrimitive.Trigger asChild>
                      <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded border border-transparent hover:border-[hsl(var(--sidebar-border))] hover:bg-[hsl(var(--sidebar-accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuForId((prev) => (prev === doc.id ? null : doc.id));
                        }}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                    </TooltipPrimitive.Trigger>
                    <TooltipPrimitive.Portal>
                      <TooltipPrimitive.Content
                        side="top"
                        sideOffset={4}
                        className="z-50 rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-xs text-[hsl(var(--background))] shadow"
                      >
                        More actions
                        <TooltipPrimitive.Arrow className="fill-[hsl(var(--foreground))]" />
                      </TooltipPrimitive.Content>
                    </TooltipPrimitive.Portal>
                  </TooltipPrimitive.Root>
                  {canAddChild && (
                    <TooltipPrimitive.Root delayDuration={150}>
                      <TooltipPrimitive.Trigger asChild>
                        <button
                          type="button"
                          className="flex h-5 w-5 items-center justify-center rounded border border-transparent hover:border-[hsl(var(--sidebar-border))] hover:bg-[hsl(var(--sidebar-accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]"
                          onClick={async (e) => {
                            e.stopPropagation();
                            // Expand this node and create a child.
                            setExpandedIds((prev) => {
                              const next = new Set(prev);
                              next.add(doc.id);
                              return next;
                            });
                            await createDocument(doc.id);
                          }}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </TooltipPrimitive.Trigger>
                      <TooltipPrimitive.Portal>
                        <TooltipPrimitive.Content
                          side="top"
                          sideOffset={4}
                          className="z-50 rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-xs text-[hsl(var(--background))] shadow"
                        >
                          Add Page Inside
                          <TooltipPrimitive.Arrow className="fill-[hsl(var(--foreground))]" />
                        </TooltipPrimitive.Content>
                      </TooltipPrimitive.Portal>
                    </TooltipPrimitive.Root>
                  )}
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {menuForId === doc.id && (
            <div className="mt-1 pl-6 text-[11px] text-[hsl(var(--muted-foreground))]">
              {/* Placeholder menu; actions to be wired later */}
              <div className="rounded border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-background))] px-2 py-1 shadow-sm">
                <div className="cursor-default">Document menu (coming soon)</div>
              </div>
            </div>
          )}
          {hasChildren && isExpanded && (
            <div className="mt-0.5">
              {children.map((child) => renderDocNode(child, depth + 1))}
            </div>
          )}
        </React.Fragment>
      );
    },
    [childrenByParent, expandedIds, selectedId, selectDocument, toggleExpanded, createDocument, setExpandedIds, menuForId],
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
              <SidebarGroupLabel className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex h-4 w-4 items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  onClick={() => setNotesSectionOpen((prev) => !prev)}
                  aria-label={notesSectionOpen ? 'Collapse notes' : 'Expand notes'}
                >
                  {notesSectionOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
                <span>Notes</span>
              </SidebarGroupLabel>
            </SidebarGroup>
            {notesSectionOpen && (
              <div className="mt-1 min-h-0 flex-1 overflow-y-auto pr-1">
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
                  {!loading && rootDocs.map((doc) => renderDocNode(doc, 0))}
                </SidebarMenu>
              </div>
            )}
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

