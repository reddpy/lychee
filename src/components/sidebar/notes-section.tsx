import * as React from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type UniqueIdentifier,
  pointerWithin,
  MeasuringStrategy,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import type { DocumentRow } from '../../shared/documents';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '../ui/sidebar';
import { useDocumentStore } from '../../renderer/document-store';
import { NoteTreeItem } from './note-tree-item';
import { DragOverlayItem } from './drag-overlay-item';

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

/** Drop position relative to target item. */
export type DropPosition = 'before' | 'inside' | 'after';

/** Determine drop position based on cursor Y position within element. */
function getDropPosition(
  rect: DOMRect,
  clientY: number,
  canNestInside: boolean,
): DropPosition {
  const relativeY = clientY - rect.top;
  const height = rect.height;

  // Thin edge zones (8px) for reordering, rest is for nesting
  const edgeThreshold = Math.min(8, height * 0.25);

  if (canNestInside) {
    // Default to nesting inside, only reorder at very edges
    if (relativeY < edgeThreshold) return 'before';
    if (relativeY > height - edgeThreshold) return 'after';
    return 'inside';
  } else {
    // Can't nest, so split into before/after
    return relativeY < height * 0.5 ? 'before' : 'after';
  }
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
  const lastCreatedId = useDocumentStore((s) => s.lastCreatedId);
  const moveDocument = useDocumentStore((s) => s.moveDocument);

  // DnD state
  const [activeId, setActiveId] = React.useState<UniqueIdentifier | null>(null);
  const [overId, setOverId] = React.useState<UniqueIdentifier | null>(null);
  const [dropPosition, setDropPosition] = React.useState<DropPosition | null>(null);

  // Track current pointer position for accurate drop zone detection (accumulate delta each move)
  const pointerPositionRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const childrenByParent = React.useMemo(
    () => buildChildrenByParent(documents),
    [documents],
  );

  const docsById = React.useMemo(
    () => new Map(documents.map((d) => [d.id, d])),
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

  // Map from doc id to depth for quick lookup
  const depthById = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const { doc, depth } of flatList) {
      map.set(doc.id, depth);
    }
    return map;
  }, [flatList]);

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

  // DnD handlers
  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
    // Initialize pointer position from the activator event
    const e = event.activatorEvent as PointerEvent;
    pointerPositionRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleDragMove = React.useCallback((event: DragMoveEvent) => {
    const { over, active, delta } = event;

    // Pointer position: delta from dnd-kit is relative to drag start
    const activatorEvent = event.activatorEvent as PointerEvent;
    const currentY = activatorEvent.clientY + delta.y;
    const currentX = activatorEvent.clientX + delta.x;
    pointerPositionRef.current = { x: currentX, y: currentY };

    if (!over || over.id === active.id) {
      setOverId(null);
      setDropPosition(null);
      return;
    }

    // Get the element rect for drop position calculation
    const overElement = document.querySelector(`[data-note-id="${over.id}"]`);
    if (!overElement) {
      setOverId(over.id);
      setDropPosition('after');
      return;
    }

    const activeDoc = docsById.get(active.id as string);
    const overDoc = docsById.get(over.id as string);
    if (!activeDoc || !overDoc) {
      setOverId(over.id);
      setDropPosition('after');
      return;
    }

    // Check if we can nest inside (depth limit and not dropping into descendant)
    const overDepth = depthById.get(over.id as string) ?? 0;
    const activeDescendants = getDescendantIds(childrenByParent, active.id as string);
    const canNestInside =
      overDepth < MAX_NESTING_DEPTH &&
      !activeDescendants.has(over.id as string) &&
      over.id !== active.id;

    const rect = overElement.getBoundingClientRect();
    const position = getDropPosition(rect, currentY, canNestInside);

    setOverId(over.id);
    setDropPosition(position);
  }, [docsById, depthById, childrenByParent, flatList]);

  const handleDragEnd = React.useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      const effectiveOverId = (overId ?? over?.id) as string | null;
      const currentDropPosition = dropPosition;

      setActiveId(null);
      setOverId(null);
      setDropPosition(null);

      if (!over || active.id === over.id || !currentDropPosition || !effectiveOverId) return;

      const activeDoc = docsById.get(active.id as string);
      const overDoc = docsById.get(effectiveOverId);
      if (!activeDoc || !overDoc) return;

      // Prevent dropping into descendants (circular reference)
      const activeDescendants = getDescendantIds(childrenByParent, active.id as string);
      if (activeDescendants.has(effectiveOverId)) return;

      // Check depth constraint for nesting
      const overDepth = depthById.get(effectiveOverId) ?? 0;
      if (currentDropPosition === 'inside' && overDepth >= MAX_NESTING_DEPTH) return;

      let newParentId: string | null;
      let newSortOrder: number;

      if (currentDropPosition === 'inside') {
        // Nest inside the target (becomes child)
        newParentId = effectiveOverId;
        // Add to the end of children
        const existingChildren = childrenByParent.get(newParentId) ?? [];
        newSortOrder = existingChildren.length;
        // Expand parent to show the moved item
        setExpandedIds((prev) => new Set([...prev, effectiveOverId]));
      } else {
        // Reorder as sibling (before or after)
        newParentId = overDoc.parentId;

        // Get siblings at the target level
        const siblings = (childrenByParent.get(newParentId) ?? []).filter(
          (d) => d.id !== activeDoc.id,
        );
        const overIndex = siblings.findIndex((d) => d.id === overDoc.id);

        if (currentDropPosition === 'before') {
          newSortOrder = overIndex >= 0 ? overIndex : 0;
        } else {
          newSortOrder = overIndex >= 0 ? overIndex + 1 : siblings.length;
        }
      }

      await moveDocument(active.id as string, newParentId, newSortOrder);
    },
    [docsById, childrenByParent, depthById, dropPosition, overId, moveDocument, setExpandedIds, flatList],
  );

  const handleDragCancel = React.useCallback(() => {
    setActiveId(null);
    setOverId(null);
    setDropPosition(null);
  }, []);

  // When a nested note is created, expand its parent (and ancestors) so the tree "opens" to show it.
  React.useLayoutEffect(() => {
    if (!lastCreatedId || documents.length === 0) return;
    const ancestorIds = getAncestorIds(documents, lastCreatedId);
    if (ancestorIds.length === 0) return;
    flushSync(() => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        ancestorIds.forEach((a) => next.add(a));
        return next;
      });
    });
  }, [lastCreatedId, documents, setExpandedIds]);

  const activeDoc = activeId ? docsById.get(activeId as string) : null;

  if (!open) return null;

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
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
              measuring={{
                droppable: {
                  strategy: MeasuringStrategy.Always,
                },
              }}
            >
              <div className="min-h-0 flex-1 flex flex-col">
                <div className="notes-scroll min-h-0 flex-1 pr-2 py-1">
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
                      <SortableContext
                        items={flatList.map(({ doc }) => doc.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <AnimatePresence
                          initial={false}
                          custom={{ documentIds: new Set(documents.map((d) => d.id)) }}
                        >
                          {flatList.map(({ doc, depth }, index) => {
                            const children = childrenByParent.get(doc.id) ?? [];
                            const isExpanded = expandedIds.has(doc.id);
                            const canAddChild = depth < MAX_NESTING_DEPTH;
                            const isOver = overId === doc.id;
                            const isDragging = activeId === doc.id;

                            // Show line for "before" always, and "after" when:
                            // - It's the last item in the flat list, OR
                            // - The next item is at a shallower depth (end of nested section)
                            const nextItem = index < flatList.length - 1 ? flatList[index + 1] : null;
                            const isEndOfNestedSection = nextItem && nextItem.depth < depth;
                            const showLine = isOver && dropPosition !== 'inside' && (
                              dropPosition === 'before' ||
                              index === flatList.length - 1 ||
                              (dropPosition === 'after' && isEndOfNestedSection)
                            );

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
                                  isDragging={isDragging}
                                  isOver={isOver}
                                  dropPosition={isOver ? dropPosition : null}
                                  showDropLine={showLine}
                                />
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      </SortableContext>
                    )}
                  </SidebarMenu>
                </div>
              </div>
              <DragOverlay dropAnimation={null}>
                {activeDoc ? (
                  <DragOverlayItem doc={activeDoc} />
                ) : null}
              </DragOverlay>
            </DndContext>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
