import * as React from 'react';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
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
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

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
    transition: isDragging ? transition : 'none',
  };

  return (
    <div
      ref={setNodeRef}
      data-tab-id={id}
      style={style}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] min-w-0 max-w-[200px] shrink-0 transition-all duration-150',
        isActive
          ? 'relative z-10 tab-raised border-b-[hsl(var(--foreground))] border-l border-r border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] font-medium'
          : 'border-b-transparent bg-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/30',
        isDragging && 'opacity-0 pointer-events-none',
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
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm opacity-50 hover:opacity-100 hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Tab pill used inside DragOverlay (no drag handlers, same look). */
function DragOverlayTab({ title }: { title: string }) {
  return (
    <div
      className={cn(
        'flex cursor-grabbing items-center gap-1.5 border-b-2 border-b-[hsl(var(--foreground))] border-l border-r border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-[13px] font-medium text-[hsl(var(--foreground))] tab-raised',
        'min-w-0 max-w-[200px] shrink-0 shadow-lg ring-2 ring-[hsl(var(--ring))]/20',
      )}
    >
      <span className="flex-1 truncate">{title || 'Untitled'}</span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center opacity-50">
        <X className="h-3 w-3" />
      </span>
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

  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = openTabs.indexOf(active.id as string);
      const newIndex = openTabs.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderTabs(oldIndex, newIndex);
    },
    [openTabs, reorderTabs],
  );

  const handleDragCancel = React.useCallback(() => {
    setActiveDragId(null);
  }, []);

  const activeDragDoc = activeDragId ? getDocById(documents, activeDragId) : null;

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

  const activeIndex =
    selectedId != null ? openTabs.indexOf(selectedId) : -1;
  const canGoLeft = activeIndex > 0;
  const canGoRight = activeIndex >= 0 && activeIndex < openTabs.length - 1;

  const handlePrevTab = React.useCallback(() => {
    if (!canGoLeft) return;
    const prevId = openTabs[activeIndex - 1];
    if (prevId) selectDocument(prevId);
  }, [canGoLeft, activeIndex, openTabs, selectDocument]);

  const handleNextTab = React.useCallback(() => {
    if (!canGoRight) return;
    const nextId = openTabs[activeIndex + 1];
    if (nextId) selectDocument(nextId);
  }, [canGoRight, activeIndex, openTabs, selectDocument]);

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
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      modifiers={[restrictToHorizontalAxis]}
    >
      <SortableContext
        items={openTabs}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex items-stretch border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]">
          <div
            ref={scrollContainerRef}
            className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-hide"
          >
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
          <div className="flex shrink-0 items-center border-l border-[hsl(var(--border))] pl-0.5 pr-1">
            <button
              type="button"
              onClick={handlePrevTab}
              disabled={!canGoLeft}
              aria-label="Previous tab"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-sm text-[hsl(var(--muted-foreground))] transition-colors',
                canGoLeft
                  ? 'hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]'
                  : 'cursor-not-allowed opacity-40',
              )}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleNextTab}
              disabled={!canGoRight}
              aria-label="Next tab"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-sm text-[hsl(var(--muted-foreground))] transition-colors',
                canGoRight
                  ? 'hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]'
                  : 'cursor-not-allowed opacity-40',
              )}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </SortableContext>
      <DragOverlay
        dropAnimation={null}
        modifiers={[restrictToHorizontalAxis]}
      >
        {activeDragDoc ? (
          <DragOverlayTab title={activeDragDoc.title} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
