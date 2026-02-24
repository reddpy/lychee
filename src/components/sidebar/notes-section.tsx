import * as React from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { ChevronRight, SquarePen } from 'lucide-react';

import type { DocumentRow } from '../../shared/documents';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../ui/sidebar';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { useDocumentStore } from '../../renderer/document-store';
import { NoteTreeItem } from './note-tree-item';
import { TreeDndProvider } from './tree-dnd-provider';

const MAX_NESTING_DEPTH = 4; // root depth 0, deepest child depth 4 (5 levels)

/**
 * Note tree: exit animation (delete/trash). When a nested note is added, expand parent so the new note is visible.
 * Collapse is instant (no animation).
 */
const treeItemExit = {
  opacity: 0,
  transition: { duration: 0.2, ease: 'easeOut' },
};

/** Instant hide when collapsing (item still in tree, just hidden). */
const treeItemExitCollapse = {
  opacity: 0,
  transition: { duration: 0 },
};

type PresenceCustom = { documentIds?: Set<string> };

function getExitVariant(docId: string) {
  return (custom: PresenceCustom) =>
    custom?.documentIds?.has(docId) ? treeItemExitCollapse : treeItemExit;
}

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
  // Sort children by sortOrder
  for (const [, children] of map) {
    children.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return map;
}

function getAncestorIds(documents: DocumentRow[], docId: string): string[] {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const ids: string[] = [];
  let doc = byId.get(docId);
  while (doc?.parentId) {
    ids.push(doc.parentId);
    doc = byId.get(doc.parentId);
  }
  return ids;
}

/** Get all descendant IDs of a document (for preventing circular drops). */
function getDescendantIds(
  childrenByParent: Map<string | null, DocumentRow[]>,
  docId: string,
): Set<string> {
  const descendants = new Set<string>();
  const stack = [docId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const children = childrenByParent.get(id) ?? [];
    for (const child of children) {
      descendants.add(child.id);
      stack.push(child.id);
    }
  }
  return descendants;
}

/** Flat list in preorder so one AnimatePresence tracks all rows for delete exit animation. */
function buildFlatList(
  rootDocs: DocumentRow[],
  childrenByParent: Map<string | null, DocumentRow[]>,
  expandedIds: Set<string>,
): { doc: DocumentRow; depth: number }[] {
  const result: { doc: DocumentRow; depth: number }[] = [];
  function visit(docs: DocumentRow[], depth: number) {
    for (const doc of docs) {
      result.push({ doc, depth });
      if (expandedIds.has(doc.id)) {
        const children = childrenByParent.get(doc.id) ?? [];
        visit(children, depth + 1);
      }
    }
  }
  visit(rootDocs, 0);
  return result;
}

export type DropPosition = 'before' | 'inside' | 'after';

export function NotesSection({
  documents,
  selectedId,
  loading,
  expandedIds,
  setExpandedIds,
  createDocument,
}: NotesSectionProps) {
  const [notesSectionOpen, setNotesSectionOpen] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastCreatedId = useDocumentStore((s) => s.lastCreatedId);
  const moveDocument = useDocumentStore((s) => s.moveDocument);

  React.useEffect(() => {
    if (!notesSectionOpen) return;
    const el = scrollRef.current;
    if (!el) return;
    const EDGE_THRESHOLD = 16;
    return autoScrollForElements({
      element: el,
      getAllowedAxis: () => 'vertical',
      canScroll: ({ input, element }) => {
        const rect = element.getBoundingClientRect();
        const distFromTop = input.clientY - rect.top;
        const distFromBottom = rect.bottom - input.clientY;
        const atTopEdge = distFromTop < EDGE_THRESHOLD;
        const atBottomEdge = distFromBottom < EDGE_THRESHOLD;
        if (!atTopEdge && !atBottomEdge) return false;
        const { scrollTop, scrollHeight, clientHeight } = element;
        const canScrollDown = scrollTop + clientHeight < scrollHeight - 1;
        const canScrollUp = scrollTop > 1;
        return (atTopEdge && canScrollUp) || (atBottomEdge && canScrollDown);
      },
    });
  }, [notesSectionOpen]);

  const childrenByParent = React.useMemo(
    () => buildChildrenByParent(documents),
    [documents],
  );

  const rootDocs = React.useMemo(() => {
    const ids = new Set(documents.map((d) => d.id));
    return documents
      .filter((d) => d.parentId === null || !ids.has(d.parentId))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [documents]);

  const flatList = React.useMemo(
    () => buildFlatList(rootDocs, childrenByParent, expandedIds),
    [rootDocs, childrenByParent, expandedIds],
  );

  // Precompute descendant sets for each document
  const descendantsByDoc = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const doc of documents) {
      map.set(doc.id, getDescendantIds(childrenByParent, doc.id));
    }
    return map;
  }, [documents, childrenByParent]);

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
      void createDocument(parentId);
    },
    [createDocument],
  );

  const handleExpandParent = React.useCallback((id: string) => {
    setExpandedIds((prev) => new Set([...prev, id]));
  }, [setExpandedIds]);

  // When a nested note is created, expand its parent (and ancestors) so the tree "opens" to show it.
  React.useLayoutEffect(() => {
    if (!lastCreatedId || documents.length === 0) return;
    const ancestorIds = getAncestorIds(documents, lastCreatedId);
    useDocumentStore.setState({ lastCreatedId: null });
    if (ancestorIds.length === 0) return;
    flushSync(() => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        ancestorIds.forEach((a) => next.add(a));
        return next;
      });
    });
  }, [lastCreatedId, documents, setExpandedIds]);

  return (
    <>
      <SidebarGroup>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => setNotesSectionOpen((prev) => !prev)}
            className="px-2 text-xs font-medium uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]"
          >
            <span className="flex flex-1 items-center gap-1.5">
              <motion.span
                className="flex shrink-0 items-center justify-center"
                animate={{ rotate: notesSectionOpen ? 90 : 0 }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 30,
                }}
              >
                <ChevronRight className="h-3 w-3" />
              </motion.span>
              <span className='capitalize'>Notes</span>
            </span>
            <TooltipPrimitive.Root delayDuration={150}>
              <TooltipPrimitive.Trigger asChild>
                <span
                  role="button"
                  tabIndex={0}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent))] hover:bg-[#C14B55]/15 hover:border-[#C14B55]/30 hover:text-[#C14B55] transition-colors"
                  onClick={(e) => { e.stopPropagation(); createDocument(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); createDocument(null); } }}
                  aria-label="New note"
                >
                  <SquarePen className="h-4 w-4" />
                </span>
              </TooltipPrimitive.Trigger>
              <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                  side="top"
                  sideOffset={4}
                  className="z-50 rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-xs text-[hsl(var(--background))] shadow"
                >
                  New Note
                  <TooltipPrimitive.Arrow className="fill-[hsl(var(--foreground))]" />
                </TooltipPrimitive.Content>
              </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <AnimatePresence initial={false}>
        {notesSectionOpen && (
          <motion.div
            className="min-h-0 mt-1 flex-1 overflow-hidden flex flex-col"
            initial={{ opacity: 0, scaleY: 0.97 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0.97 }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 35,
              mass: 0.8,
            }}
            style={{ transformOrigin: 'top' }}
          >
            <TreeDndProvider
              documents={documents}
              childrenByParent={childrenByParent}
              onMove={moveDocument}
              onExpandParent={handleExpandParent}
            >
              <div className="min-h-0 flex-1 flex flex-col">
                <div ref={scrollRef} className="notes-scroll min-h-0 flex-1 pr-2 py-1">
                  <SidebarMenu>
                    {loading ? (
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <span className="h-4 w-4 shrink-0 rounded-full bg-[hsl(var(--muted-foreground))]/20" />
                          <span className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                            Loading…
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ) : (
                      <AnimatePresence
                        initial={false}
                        custom={{ documentIds: new Set(documents.map((d) => d.id)) }}
                      >
                        {flatList.map(({ doc, depth }, index) => {
                          const children = childrenByParent.get(doc.id) ?? [];
                          const isExpanded = expandedIds.has(doc.id);
                          const canAddChild = depth < MAX_NESTING_DEPTH;
                          const canNestInside = depth < MAX_NESTING_DEPTH;

                          return (
                            <motion.div
                              key={doc.id}
                              initial={false}
                              variants={{ exit: getExitVariant(doc.id) }}
                              exit="exit"
                            >
                              <NoteTreeItem
                                doc={doc}
                                depth={depth}
                                children={children}
                                isExpanded={isExpanded}
                                canAddChild={canAddChild}
                                isSelected={selectedId === doc.id}
                                onToggleExpanded={toggleExpanded}
                                onAddPageInside={handleAddPageInside}
                                isRoot={depth === 0}
                                canNestInside={canNestInside}
                                allDescendantsMap={descendantsByDoc}
                                isFirstInList={index === 0}
                              />
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    )}
                  </SidebarMenu>
                </div>
              </div>
            </TreeDndProvider>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
