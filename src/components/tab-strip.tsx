import * as React from 'react';
import * as ReactDOM from 'react-dom';
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
import { ReadOnlyNotePreview } from './editor/read-only-note-preview';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getDocById(documents: DocumentRow[], id: string): DocumentRow | undefined {
  return documents.find((d) => d.id === id);
}

/* ------------------------------------------------------------------ */
/*  Preview popup (rendered once in TabStrip, reads content lazily)   */
/* ------------------------------------------------------------------ */

const PREVIEW_POPUP_WIDTH = 280;

const TabPreviewPopup = React.memo(function TabPreviewPopup({
  docId,
  anchorRect,
}: {
  docId: string;
  anchorRect: DOMRect;
}) {
  const doc = useDocumentStore((s) => s.documents.find((d) => d.id === docId));

  const hasTitle = doc ? (doc.title && doc.title !== 'Untitled') : false;
  const displayTitle = hasTitle ? doc!.title : 'New Page';
  const emoji = doc?.emoji ?? null;

  const hasContent = React.useMemo(() => {
    const content = doc?.content;
    if (!content || content.trim() === '') return false;
    try {
      const root = JSON.parse(content)?.root;
      if (!root?.children?.length) return false;
      return root.children.some(function walk(node: any): boolean {
        if (typeof node.text === 'string' && node.text.trim() !== '') return true;
        return Array.isArray(node.children) && node.children.some(walk);
      });
    } catch {
      return false;
    }
  }, [doc?.content]);

  if (!doc) return null;

  const isEmpty = !hasTitle && !hasContent;

  const left = Math.max(
    4,
    Math.min(
      anchorRect.left + anchorRect.width / 2 - PREVIEW_POPUP_WIDTH / 2,
      window.innerWidth - PREVIEW_POPUP_WIDTH - 4,
    ),
  );
  const top = anchorRect.bottom + 6;

  return ReactDOM.createPortal(
    <div
      style={{ left, top, width: PREVIEW_POPUP_WIDTH }}
      className="fixed z-[9999] flex flex-col bg-[hsl(var(--background))] border border-[hsl(var(--primary))]/40 rounded-lg shadow-xl overflow-hidden pointer-events-none animate-in fade-in-0 zoom-in-95 duration-100"
    >
      <div className="px-2.5 pt-2 pb-1.5 shrink-0">
        <span className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1 truncate">
          <span className="shrink-0 text-xs leading-none">{emoji ?? '📄'}</span>
          <span className="truncate">{displayTitle}</span>
        </span>
      </div>
      <div className="h-[140px] overflow-hidden border-t border-[hsl(var(--border))]/40">
        {hasContent ? (
          <div className="[&_.ContentEditable\_\_root]:!leading-[1.35] [&_*]:!my-0 [&_*]:!py-0 [&_*]:!mb-0.5">
            <div className="scale-[0.7] origin-top-left w-[400px] [&>div]:!px-2 [&>div]:!py-1.5 [&>div>div]:!px-0">
              <ReadOnlyNotePreview editorState={doc.content} />
            </div>
          </div>
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-[11px] italic text-[hsl(var(--muted-foreground))]/40">Empty page</span>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
});

/* ------------------------------------------------------------------ */
/*  SortableTab (no content prop — preview is handled by parent)      */
/* ------------------------------------------------------------------ */

function SortableTab({
  id,
  title,
  emoji,
  isActive,
  isDuplicate,
  showLeftDivider,
  onSelect,
  onClose,
  isDragging,
  onPreviewShow,
  onPreviewHide,
}: {
  id: string;
  title: string;
  emoji: string | null;
  isActive: boolean;
  isDuplicate: boolean;
  showLeftDivider: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
  isDragging: boolean;
  onPreviewShow: (tabId: string, rect: DOMRect) => void;
  onPreviewHide: (tabId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  const tabRef = React.useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = React.useRef(false);

  const showPreview = React.useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      const el = tabRef.current;
      if (el) onPreviewShow(id, el.getBoundingClientRect());
    }, 500);
  }, [id, onPreviewShow]);

  const hidePreview = React.useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    onPreviewHide(id);
  }, [id, onPreviewHide]);

  const handleMouseEnter = React.useCallback(() => {
    isHoveredRef.current = true;
    if (!isDragging && !isActive) showPreview();
  }, [isDragging, isActive, showPreview]);

  const handleMouseLeave = React.useCallback(() => {
    isHoveredRef.current = false;
    hidePreview();
  }, [hidePreview]);

  // Clear on active / dismiss+restart on drag end
  React.useEffect(() => {
    if (isActive || isDragging) {
      hidePreview();
    } else if (isHoveredRef.current) {
      showPreview();
    }
  }, [isActive, isDragging, hidePreview, showPreview]);

  React.useEffect(() => {
    return () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); };
  }, []);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0, scaleY: 1 } : null),
    transition,
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        tabRef.current = node;
      }}
      style={style}
      data-tab-id={id}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'group titlebar-nodrag relative flex cursor-default select-none items-center gap-1.5 px-3 py-2.5 text-[13px] w-[180px] shrink-0 border-x border-x-transparent first:!border-l-transparent',
        isActive
          ? 'z-10 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] font-medium border-x-[hsl(var(--border))]'
          : 'bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-foreground/5 hover:text-[hsl(var(--foreground))]',
        isDragging && 'z-50 opacity-80 shadow-lg',
      )}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {showLeftDivider && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-px bg-foreground/10" />
      )}
      <span className="flex flex-1 min-w-0 items-center gap-1.5 truncate">
        {emoji ? (
          <span className="shrink-0 text-base leading-none">{emoji}</span>
        ) : null}
        <span className="min-w-0 truncate">{title && title !== 'Untitled' ? title : 'New Page'}</span>
        {isDuplicate && (
          <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-current opacity-40" />
        )}
      </span>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose(e);
        }}
        aria-label="Close tab"
        className={cn(
          "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm opacity-0 group-hover:opacity-50 hover:!opacity-100 focus-visible:opacity-100 focus-visible:ring-1",
          isActive
            ? "hover:bg-[#C14B55]/10 hover:text-[#C14B55] focus-visible:ring-[hsl(var(--ring))]"
            : "hover:bg-foreground/5 hover:text-[hsl(var(--foreground))] focus-visible:ring-foreground/20",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TabStrip                                                          */
/* ------------------------------------------------------------------ */

type PreviewState = { tabId: string; docId: string; rect: DOMRect } | null;

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
  const [preview, setPreview] = React.useState<PreviewState>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const tabIds = React.useMemo(() => openTabs.map((t) => t.tabId), [openTabs]);

  // Clear preview if the previewed tab was closed
  React.useEffect(() => {
    if (preview && !openTabs.some((t) => t.tabId === preview.tabId)) {
      setPreview(null);
    }
  }, [preview, openTabs]);

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setDraggingId(event.active.id as string);
  }, []);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = tabIds.indexOf(active.id as string);
      const newIndex = tabIds.indexOf(over.id as string);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        reorderTabs(oldIndex, newIndex);
      }
    },
    [tabIds, reorderTabs],
  );

  const handleTabSelect = React.useCallback(
    (tabId: string) => {
      if (draggingId) return;
      selectDocument(tabId);
    },
    [draggingId, selectDocument],
  );

  const handleTabClose = React.useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      closeTab(tabId);
    },
    [closeTab],
  );

  // Preview callbacks — reads from store directly to avoid depending on openTabs
  const handlePreviewShow = React.useCallback(
    (tabId: string, rect: DOMRect) => {
      const tab = useDocumentStore.getState().openTabs.find((t) => t.tabId === tabId);
      if (tab) setPreview({ tabId, docId: tab.docId, rect });
    },
    [],
  );

  const handlePreviewHide = React.useCallback(
    (tabId: string) => {
      setPreview((prev) => (prev?.tabId === tabId ? null : prev));
    },
    [],
  );

  // Single scroll listener — dismiss any active preview
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => setPreview(null);
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

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
    <div className="relative flex min-w-0 flex-1 items-stretch bg-transparent">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollContainerRef}
            className="flex min-w-0 shrink items-end overflow-x-auto scrollbar-hide"
          >
            {openTabs.map(({ tabId, docId }, index) => {
              const doc = getDocById(documents, docId);
              if (!doc) return null;
              const isActive = selectedId === tabId;
              const prevIsActive = index > 0 && selectedId === openTabs[index - 1].tabId;
              // Show a left divider between two adjacent inactive tabs
              const showLeftDivider = !isActive && index > 0 && !prevIsActive;
              const isDuplicate = openTabs.some((t, i) => i !== index && t.docId === docId);
              return (
                <SortableTab
                  key={tabId}
                  id={tabId}
                  title={doc.title}
                  emoji={doc.emoji ?? null}
                  isActive={isActive}
                  isDuplicate={isDuplicate}
                  showLeftDivider={showLeftDivider}
                  onSelect={() => handleTabSelect(tabId)}
                  onClose={(e) => handleTabClose(e, tabId)}
                  isDragging={draggingId === tabId}
                  onPreviewShow={handlePreviewShow}
                  onPreviewHide={handlePreviewHide}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      {/* Empty space after tabs */}
      <div className="flex-1" />
      {/* Single preview popup instance */}
      {preview && (
        <TabPreviewPopup docId={preview.docId} anchorRect={preview.rect} />
      )}
    </div>
  );
}
