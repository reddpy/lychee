import * as React from 'react';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

import { TreeDndContext, type TreeDndContextValue, type DropPosition } from './tree-dnd-context';
import type { DocumentRow } from '../../shared/documents';

export type TreeDndProviderProps = {
  children: React.ReactNode;
  documents: DocumentRow[];
  childrenByParent: Map<string | null, DocumentRow[]>;
  onMove: (id: string, newParentId: string | null, newSortOrder: number) => Promise<void>;
  onExpandParent: (id: string) => void;
};

export function TreeDndProvider({
  children,
  documents,
  childrenByParent,
  onMove,
  onExpandParent,
}: TreeDndProviderProps) {
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);
  const [dropPosition, setDropPosition] = React.useState<DropPosition | null>(null);
  const [nestAsFirst, setNestAsFirst] = React.useState<boolean>(false);

  // Fallback when location.current.dropTargets is empty (known atlaskit bug in edge cases)
  const lastDropTargetRef = React.useRef<{
    targetId: string;
    position: DropPosition;
    nestAsFirst: boolean;
  } | null>(null);

  const setDropTarget = React.useCallback(
    (id: string | null, position: DropPosition | null, asFirst: boolean = false) => {
      setDropTargetId(id);
      setDropPosition(position);
      setNestAsFirst(asFirst);
      if (id && position !== null) {
        lastDropTargetRef.current = { targetId: id, position, nestAsFirst: asFirst };
      } else {
        lastDropTargetRef.current = null;
      }
    },
    []
  );

  // Use refs to always have current data in callbacks (avoids stale closure issues)
  const docsRef = React.useRef(documents);
  const childrenByParentRef = React.useRef(childrenByParent);
  const onMoveRef = React.useRef(onMove);
  const onExpandParentRef = React.useRef(onExpandParent);

  React.useEffect(() => {
    docsRef.current = documents;
  }, [documents]);

  React.useEffect(() => {
    childrenByParentRef.current = childrenByParent;
  }, [childrenByParent]);

  React.useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  React.useEffect(() => {
    onExpandParentRef.current = onExpandParent;
  }, [onExpandParent]);

  // Global monitor for handling drop completion
  React.useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === 'tree-item',
      onDrop({ source, location }) {
        const draggedId = source.data.id as string;
        const target = location.current.dropTargets[0];
        const fallback = lastDropTargetRef.current;

        // Reset state first
        setDraggingId(null);
        setDropTarget(null, null, false);

        // Use fallback when dropTargets is empty (known atlaskit bug in edge cases)
        const effectiveTarget = target ?? (fallback && {
          data: {
            id: fallback.targetId,
            dropPosition: fallback.position,
            nestAsFirst: fallback.nestAsFirst,
          },
        });

        if (!effectiveTarget) {
          return;
        }

        const targetId = effectiveTarget.data.id as string;
        const position = effectiveTarget.data.dropPosition as DropPosition;

        if (!targetId || !position) return;
        if (draggedId === targetId) return;

        // Use current refs for data
        const docs = docsRef.current;
        const childrenMap = childrenByParentRef.current;
        const docsById = new Map(docs.map((d) => [d.id, d]));
        const targetDoc = docsById.get(targetId);
        if (!targetDoc) return;

        let newParentId: string | null;
        let newSortOrder: number;

        const draggedDoc = docsById.get(draggedId);

        if (position === 'inside') {
          newParentId = targetId;
          const existingChildren = childrenMap.get(newParentId) ?? [];
          const insertAsFirst = effectiveTarget.data.nestAsFirst as boolean;
          if (insertAsFirst) {
            newSortOrder = 0;
          } else {
            // Use max sortOrder + 1 to ensure we're truly at the end
            const maxSortOrder = existingChildren.reduce((max, c) => Math.max(max, c.sortOrder), -1);
            newSortOrder = maxSortOrder + 1;
          }
          onExpandParentRef.current(targetId);
        } else {
          // Reordering as sibling (before or after target)
          newParentId = targetDoc.parentId;

          // Find target's actual sortOrder (not filtered index)
          const targetSortOrder = targetDoc.sortOrder;

          if (position === 'before') {
            newSortOrder = targetSortOrder;
          } else {
            // 'after' - insert after target's current position
            newSortOrder = targetSortOrder + 1;
          }

          // If dragging within same parent and from before target, adjust for the gap
          if (draggedDoc && draggedDoc.parentId === newParentId && draggedDoc.sortOrder < targetSortOrder) {
            // When moving down, the target's effective position shifts up by 1 after we remove the dragged item
            newSortOrder = newSortOrder - 1;
          }
        }

        void onMoveRef.current(draggedId, newParentId, newSortOrder);
      },
    });
  }, [setDropTarget]);

  const contextValue: TreeDndContextValue = React.useMemo(
    () => ({
      draggingId,
      dropTargetId,
      dropPosition,
      nestAsFirst,
      setDraggingId,
      setDropTarget,
    }),
    [draggingId, dropTargetId, dropPosition, nestAsFirst, setDropTarget]
  );

  return (
    <TreeDndContext.Provider value={contextValue}>
      {children}
    </TreeDndContext.Provider>
  );
}
