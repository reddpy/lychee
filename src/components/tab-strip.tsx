import * as React from 'react';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';

import { cn } from '../lib/utils';
import { useDocumentStore } from '../renderer/document-store';
import type { DocumentRow } from '../shared/documents';

function getDocById(documents: DocumentRow[], id: string): DocumentRow | undefined {
  return documents.find((d) => d.id === id);
}

function SortableTab({
  id,
  title,
  isActive,
  onSelect,
  onClose,
}: {
  id: string;
  title: string;
  isActive: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1.5 rounded-t-lg border border-b-0 border-[hsl(var(--border))] px-3 py-2 text-[13px] min-w-0 max-w-[180px] shrink-0',
        'bg-[hsl(var(--muted))]/50',
        isActive && 'border-b-0 bg-[hsl(var(--background))] -mb-px',
        isDragging && 'opacity-80 shadow-md z-10',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex flex-1 min-w-0 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1',
          !isActive && 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
        )}
        {...attributes}
        {...listeners}
      >
        <span className="truncate">{title || 'Untitled'}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close tab"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-60 hover:opacity-100 hover:bg-[hsl(var(--muted))] focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function TabStrip() {
  const {
    documents,
    openTabs,
    selectedId,
    openTab,
    closeTab,
    reorderTabs,
    selectDocument,
  } = useDocumentStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = openTabs.indexOf(active.id as string);
      const newIndex = openTabs.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderTabs(oldIndex, newIndex);
    },
    [openTabs, reorderTabs],
  );

  const handleTabSelect = React.useCallback(
    (id: string) => {
      selectDocument(id);
    },
    [selectDocument],
  );

  const handleTabClose = React.useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      closeTab(id);
    },
    [closeTab],
  );

  if (openTabs.length === 0) {
    return null;
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext
        items={openTabs}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex items-end gap-0.5 overflow-x-auto pl-1 pr-2">
          {openTabs.map((tabId) => {
            const doc = getDocById(documents, tabId);
            if (!doc) return null;
            return (
              <SortableTab
                key={tabId}
                id={tabId}
                title={doc.title}
                isActive={selectedId === tabId}
                onSelect={() => handleTabSelect(tabId)}
                onClose={(e) => handleTabClose(e, tabId)}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
