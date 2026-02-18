import * as React from 'react';
import { X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '../lib/utils';
import { useDocumentStore } from '../renderer/document-store';
import type { DocumentRow } from '../shared/documents';

function getDocById(documents: DocumentRow[], id: string): DocumentRow | undefined {
  return documents.find((d) => d.id === id);
}

function SortableTab({
  id,
  title,
  emoji,
  isActive,
  showLeftDivider,
  onSelect,
  onClose,
  isDragging,
}: {
  id: string;
  title: string;
  emoji: string | null;
  isActive: boolean;
  showLeftDivider: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  isDragging: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0, scaleY: 1 } : null),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tab-id={id}
      className={cn(
        'group titlebar-nodrag relative flex cursor-default select-none items-center gap-1.5 rounded-t-xl px-3 py-2.5 text-[13px] w-[180px] shrink-0',
        isActive
          ? 'z-10 pb-[calc(0.625rem+1px)] first:border-l-0 border-l border-r border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] font-medium'
          : 'bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40 hover:text-[hsl(var(--foreground))]',
        isDragging && 'z-50 opacity-80 shadow-lg',
      )}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {showLeftDivider && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[hsl(var(--border))]" />
      )}
      <span className="flex flex-1 min-w-0 items-center gap-1.5 truncate">
        {emoji ? (
          <span className="shrink-0 text-base leading-none">{emoji}</span>
        ) : null}
        <span className="min-w-0 truncate">{title && title !== 'Untitled' ? title : 'New Page'}</span>
      </span>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose(e);
        }}
        aria-label="Close tab"
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
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
    closeTab,
    reorderTabs,
    selectDocument,
  } = useDocumentStore();

  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setDraggingId(event.active.id as string);
  }, []);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = openTabs.indexOf(active.id as string);
      const newIndex = openTabs.indexOf(over.id as string);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        reorderTabs(oldIndex, newIndex);
      }
    },
    [openTabs, reorderTabs],
  );

  const handleTabSelect = React.useCallback(
    (id: string) => {
      if (draggingId) return;
      selectDocument(id);
    },
    [draggingId, selectDocument],
  );

  const handleTabClose = React.useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      closeTab(id);
    },
    [closeTab],
  );

  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (selectedId == null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const tabEl = container.querySelector(`[data-tab-id="${selectedId}"]`);
    if (tabEl) {
      tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [selectedId]);

  if (openTabs.length === 0) {
    return null;
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-stretch bg-[hsl(var(--muted))]/50">
      {/* Bottom border as a pseudo-line behind tabs so active tab can overlap it */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[hsl(var(--border))]" />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={openTabs} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollContainerRef}
            className="flex min-w-0 shrink items-end overflow-x-auto scrollbar-hide"
          >
            {openTabs.map((tabId, index) => {
              const doc = getDocById(documents, tabId);
              if (!doc) return null;
              const isActive = selectedId === tabId;
              const prevIsActive = index > 0 && selectedId === openTabs[index - 1];
              // Show a left divider between two adjacent inactive tabs
              const showLeftDivider = !isActive && index > 0 && !prevIsActive;
              return (
                <SortableTab
                  key={tabId}
                  id={tabId}
                  title={doc.title}
                  emoji={doc.emoji ?? null}
                  isActive={isActive}
                  showLeftDivider={showLeftDivider}
                  onSelect={() => handleTabSelect(tabId)}
                  onClose={(e) => handleTabClose(e, tabId)}
                  isDragging={draggingId === tabId}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      {/* Empty space after tabs */}
      <div className="flex-1" />
    </div>
  );
}
