import * as React from 'react';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
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
        'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] min-w-0 max-w-[200px] shrink-0 transition-colors',
        isActive
          ? 'border-b-[hsl(var(--foreground))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] font-medium'
          : 'border-b-transparent bg-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/30',
        isDragging && 'opacity-80 shadow-lg z-10 bg-[hsl(var(--background))]',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 min-w-0 items-center gap-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1 rounded-sm"
        {...attributes}
        {...listeners}
      >
        <span className="truncate">{title || 'Untitled'}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close tab"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm opacity-50 hover:opacity-100 hover:bg-[hsl(var(--muted))] focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
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
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToHorizontalAxis]}
    >
      <SortableContext
        items={openTabs}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex items-stretch overflow-x-auto border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]">
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
