import * as React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

import type { DocumentRow } from '../../shared/documents';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '../ui/sidebar';
import { NoteTreeItem } from './note-tree-item';

const MAX_NESTING_DEPTH = 4; // root depth 0, deepest child depth 4 (5 levels)

export type NotesSectionProps = {
  documents: DocumentRow[];
  selectedId: string | null;
  loading: boolean;
  expandedIds: Set<string>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  createDocument: (parentId?: string | null) => Promise<void>;
};

function buildChildrenByParent(documents: DocumentRow[]) {
  const map = new Map<string | null, DocumentRow[]>();
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
}

function NoteTreeRecursive({
  doc,
  depth,
  childrenByParent,
  expandedIds,
  selectedId,
  onToggleExpanded,
  onAddPageInside,
}: {
  doc: DocumentRow;
  depth: number;
  childrenByParent: Map<string | null, DocumentRow[]>;
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggleExpanded: (id: string) => void;
  onAddPageInside: (parentId: string) => void;
}) {
  const children = childrenByParent.get(doc.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(doc.id);
  const canAddChild = depth < MAX_NESTING_DEPTH;

  return (
    <React.Fragment key={doc.id}>
      <NoteTreeItem
        doc={doc}
        depth={depth}
        children={children}
        isExpanded={isExpanded}
        canAddChild={canAddChild}
        isSelected={selectedId === doc.id}
        onToggleExpanded={onToggleExpanded}
        onAddPageInside={onAddPageInside}
      />
      {hasChildren && isExpanded && (
        <div className="mt-0.5">
          {children.map((child) => (
            <NoteTreeRecursive
              key={child.id}
              doc={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              expandedIds={expandedIds}
              selectedId={selectedId}
              onToggleExpanded={onToggleExpanded}
              onAddPageInside={onAddPageInside}
            />
          ))}
        </div>
      )}
    </React.Fragment>
  );
}

export function NotesSection({
  documents,
  selectedId,
  loading,
  expandedIds,
  setExpandedIds,
  createDocument,
}: NotesSectionProps) {
  const { open } = useSidebar();
  const [notesSectionOpen, setNotesSectionOpen] = React.useState(true);

  const childrenByParent = React.useMemo(
    () => buildChildrenByParent(documents),
    [documents],
  );
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
  }, [setExpandedIds]);

  const handleAddPageInside = React.useCallback(
    (parentId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        return next;
      });
      void createDocument(parentId);
    },
    [setExpandedIds, createDocument],
  );

  if (!open) return null;

  return (
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
            {!loading &&
              rootDocs.map((doc) => (
                <NoteTreeRecursive
                  key={doc.id}
                  doc={doc}
                  depth={0}
                  childrenByParent={childrenByParent}
                  expandedIds={expandedIds}
                  selectedId={selectedId}
                  onToggleExpanded={toggleExpanded}
                  onAddPageInside={handleAddPageInside}
                />
              ))}
          </SidebarMenu>
        </div>
      )}
    </>
  );
}
