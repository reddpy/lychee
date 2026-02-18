import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { X } from 'lucide-react';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { pointerOutsideOfPreview } from '@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview';
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

import { cn } from '../lib/utils';
import { useDocumentStore } from '../renderer/document-store';
import type { DocumentRow } from '../shared/documents';

function getDocById(documents: DocumentRow[], id: string): DocumentRow | undefined {
  return documents.find((d) => d.id === id);
}

/** Tab pill used inside DragOverlay (no drag handlers, same look). */
function DragOverlayTab({
  title,
  emoji,
}: {
  title: string;
  emoji: string | null;
}) {
  return (
    <div
      className={cn(
        'flex cursor-grabbing items-center gap-1.5 border-b-2 border-b-[hsl(var(--foreground))] border-l border-r border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-[13px] font-medium text-[hsl(var(--foreground))] tab-raised',
        'min-w-0 max-w-[200px] shrink-0 shadow-lg ring-2 ring-[hsl(var(--ring))]/20',
      )}
    >
      <span className="flex flex-1 min-w-0 items-center gap-1.5 truncate">
        {emoji ? (
          <span className="shrink-0 text-base leading-none">{emoji}</span>
        ) : null}
        <span className="min-w-0 truncate">{title && title !== 'Untitled' ? title : 'New Page'}</span>
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center opacity-50">
        <X className="h-3 w-3" />
      </span>
    </div>
  );
}

function SortableTab({
  id,
  title,
  emoji,
  isActive,
  onSelect,
  onClose,
  isDragging,
  dropEdge,
}: {
  id: string;
  title: string;
  emoji: string | null;
  isActive: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  isDragging: boolean;
  dropEdge: Edge | null;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Register as draggable and drop target
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return combine(
      draggable({
        element,
        getInitialData: () => ({ id, type: 'tab' }),
        onGenerateDragPreview({ nativeSetDragImage }) {
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: pointerOutsideOfPreview({
              x: '16px',
              y: '8px',
            }),
            render({ container }) {
              const root = ReactDOM.createRoot(container);
              root.render(<DragOverlayTab title={title} emoji={emoji} />);
              return () => root.unmount();
            },
          });
        },
      }),
      dropTargetForElements({
        element,
        getData({ input, element: el }) {
          return attachClosestEdge(
            { id, type: 'tab' },
            {
              element: el,
              input,
              allowedEdges: ['left', 'right'],
            }
          );
        },
        canDrop({ source }) {
          return source.data.type === 'tab' && source.data.id !== id;
        },
      })
    );
  }, [id, title, emoji]);

  return (
    <div
      ref={ref}
      data-tab-id={id}
      className={cn(
        'relative flex cursor-default select-none items-center gap-1.5 px-3 py-2.5 text-[13px] w-[180px] shrink-0',
        isActive
          ? 'z-10 pb-[calc(0.625rem+1px)] first:border-l-0 border-l border-r border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] font-medium'
          : 'bg-transparent text-[hsl(var(--muted-foreground))]/60 hover:bg-[hsl(var(--muted))]/40 hover:text-[hsl(var(--muted-foreground))]',
        isDragging && 'opacity-5 pointer-events-none',
      )}
      onClick={onSelect}
    >
      {/* Drop indicator - left edge */}
      {dropEdge === 'left' && (
        <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-blue-500 rounded-full -translate-x-1/2" />
      )}
      {/* Drop indicator - right edge */}
      {dropEdge === 'right' && (
        <div className="absolute right-0 top-1 bottom-1 w-0.5 bg-blue-500 rounded-full translate-x-1/2" />
      )}

      <span className="flex flex-1 min-w-0 items-center gap-1.5 truncate">
        {emoji ? (
          <span className={cn('shrink-0 text-base leading-none', !isActive && 'opacity-40 grayscale')}>{emoji}</span>
        ) : null}
        <span className="min-w-0 truncate">{title && title !== 'Untitled' ? title : 'New Page'}</span>
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose(e);
        }}
        aria-label="Close tab"
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm opacity-50 hover:opacity-100 hover:bg-red-500/10 hover:text-red-500 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
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
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);
  const [dropEdge, setDropEdge] = React.useState<Edge | null>(null);

  // Global monitor for tab drag and drop
  React.useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === 'tab',
      onDragStart({ source }) {
        setDraggingId(source.data.id as string);
      },
      onDrag({ location }) {
        const target = location.current.dropTargets[0];
        if (target) {
          const edge = extractClosestEdge(target.data);
          setDropTargetId(target.data.id as string);
          setDropEdge(edge);
        } else {
          setDropTargetId(null);
          setDropEdge(null);
        }
      },
      onDrop({ source, location }) {
        const draggedId = source.data.id as string;
        const target = location.current.dropTargets[0];

        setDraggingId(null);
        setDropTargetId(null);
        setDropEdge(null);

        if (!target) return;

        const targetId = target.data.id as string;
        const edge = extractClosestEdge(target.data);

        if (draggedId === targetId) return;

        const oldIndex = openTabs.indexOf(draggedId);
        let newIndex = openTabs.indexOf(targetId);

        if (oldIndex === -1 || newIndex === -1) return;

        // Adjust index based on edge
        if (edge === 'right') {
          newIndex = newIndex + 1;
        }

        // Adjust for removal of the dragged item
        if (oldIndex < newIndex) {
          newIndex = newIndex - 1;
        }

        if (oldIndex !== newIndex) {
          reorderTabs(oldIndex, newIndex);
        }
      },
    });
  }, [openTabs, reorderTabs]);

  const handleTabSelect = React.useCallback(
    (id: string) => {
      // Don't select tab if a tab drag is in progress
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
      <div
        ref={scrollContainerRef}
        className="flex min-w-0 shrink items-end overflow-x-auto scrollbar-hide"
      >
        {openTabs.map((tabId) => {
          const doc = getDocById(documents, tabId);
          if (!doc) return null;
          const isDropTarget = dropTargetId === tabId;
          return (
            <SortableTab
              key={tabId}
              id={tabId}
              title={doc.title}
              emoji={doc.emoji ?? null}
              isActive={selectedId === tabId}
              onSelect={() => handleTabSelect(tabId)}
              onClose={(e) => handleTabClose(e, tabId)}
              isDragging={draggingId === tabId}
              dropEdge={isDropTarget ? dropEdge : null}
            />
          );
        })}
      </div>
      {/* Empty space after tabs */}
      <div className="flex-1" />
    </div>
  );
}
