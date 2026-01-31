import * as React from 'react';

export type DropPosition = 'before' | 'inside' | 'after';

export type TreeDragState = {
  /** Currently dragged item ID */
  draggingId: string | null;
  /** Drop target item ID */
  dropTargetId: string | null;
  /** Where to drop relative to target */
  dropPosition: DropPosition | null;
  /** If true, nest as first child instead of last */
  nestAsFirst: boolean;
};

export type TreeDndContextValue = TreeDragState & {
  setDraggingId: (id: string | null) => void;
  setDropTarget: (id: string | null, position: DropPosition | null, nestAsFirst?: boolean) => void;
};

export const TreeDndContext = React.createContext<TreeDndContextValue | null>(null);

export function useTreeDnd() {
  const context = React.useContext(TreeDndContext);
  if (!context) {
    throw new Error('useTreeDnd must be used within TreeDndProvider');
  }
  return context;
}
