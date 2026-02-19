import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { ChevronRight, MoreHorizontal, Plus, FileText } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { pointerOutsideOfPreview } from '@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview';

import type { DocumentRow } from '../../shared/documents';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useHoverLock,
} from '../ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  DocumentContextMenu,
  DocumentDropdownMenuContent,
} from './document-command-menu';
import { useDocumentStore } from '../../renderer/document-store';
import { useTreeDnd, type DropPosition } from './tree-dnd-context';
import { DragOverlayItem } from './drag-overlay-item';
import { cn } from '../../lib/utils';

export type NoteTreeItemProps = {
  doc: DocumentRow;
  depth: number;
  children: DocumentRow[];
  isExpanded: boolean;
  canAddChild: boolean;
  isSelected: boolean;
  onToggleExpanded: (id: string) => void;
  onAddPageInside: (parentId: string) => void;
  isRoot?: boolean;
  canNestInside: boolean;
  /** Map from doc id to its descendants - used for circular drop prevention */
  allDescendantsMap: Map<string, Set<string>>;
  /** True if this is the first item in the visible flat list */
  isFirstInList?: boolean;
};

export function NoteTreeItem({
  doc,
  depth,
  children,
  isExpanded,
  canAddChild,
  isSelected,
  onToggleExpanded,
  onAddPageInside,
  canNestInside,
  allDescendantsMap,
  isFirstInList = false,
}: NoteTreeItemProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { openTab, openOrSelectTab } = useDocumentStore();
  const hoverLock = useHoverLock();
  const { draggingId, dropTargetId, dropPosition, nestAsFirst, setDraggingId, setDropTarget } = useTreeDnd();
  const hasChildren = children.length > 0;

  const [isDragging, setIsDragging] = React.useState(false);
  const [optionsTooltip, setOptionsTooltip] = React.useState(false);
  // Track when drag just ended to prevent click-after-drag
  const justDraggedRef = React.useRef(false);

  // Register as draggable and drop target
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return combine(
      // Register as draggable
      draggable({
        element,
        getInitialData: () => ({
          id: doc.id,
          type: 'tree-item',
          parentId: doc.parentId,
        }),
        onGenerateDragPreview({ nativeSetDragImage }) {
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: pointerOutsideOfPreview({
              x: '16px',
              y: '8px',
            }),
            render({ container }) {
              const root = ReactDOM.createRoot(container);
              root.render(<DragOverlayItem doc={doc} />);
              return () => root.unmount();
            },
          });
        },
        onDragStart() {
          setIsDragging(true);
          setDraggingId(doc.id);
        },
        onDrop() {
          setIsDragging(false);
          // Prevent click-after-drag for a short window
          justDraggedRef.current = true;
          setTimeout(() => {
            justDraggedRef.current = false;
          }, 100);
        },
      }),

      // Register as drop target
      dropTargetForElements({
        element,
        getData({ input, element: el }) {
          // Calculate drop position based on pointer position
          const rect = el.getBoundingClientRect();
          const relativeY = input.clientY - rect.top;
          const height = rect.height;
          const edgeThreshold = Math.min(8, height * 0.25);

          let position: DropPosition;
          let nestAsFirst = false;

          if (canNestInside) {
            if (relativeY < edgeThreshold) {
              position = 'before';
            } else if (relativeY > height - edgeThreshold) {
              if (isExpanded) {
                // Bottom edge of expanded parent: insert as first child
                position = 'inside';
                nestAsFirst = true;
              } else {
                position = 'after';
              }
            } else {
              // Middle zone: nest as last child
              position = 'inside';
            }
          } else {
            position = relativeY < height * 0.5 ? 'before' : 'after';
          }

          return { id: doc.id, type: 'tree-item', dropPosition: position, isExpanded, nestAsFirst };
        },
        canDrop({ source }) {
          const draggedId = source.data.id as string;
          // Can't drop on self
          if (draggedId === doc.id) {
            return false;
          }
          // Can't drop into own descendants (prevent circular reference)
          const draggedDescendants = allDescendantsMap.get(draggedId) ?? new Set();
          if (draggedDescendants.has(doc.id)) {
            return false;
          }
          return true;
        },
        onDragEnter({ self }) {
          const position = self.data.dropPosition as DropPosition;
          const asFirst = self.data.nestAsFirst as boolean;
          setDropTarget(doc.id, position, asFirst);
        },
        onDrag({ self }) {
          // Update position as pointer moves within element
          // getData recalculates position each time, so always update
          const position = self.data.dropPosition as DropPosition;
          const asFirst = self.data.nestAsFirst as boolean;
          setDropTarget(doc.id, position, asFirst);
        },
        onDragLeave() {
          setDropTarget(null, null, false);
        },
        onDrop() {
          // Drop handled by monitor in provider
        },
      })
    );
  }, [doc, canNestInside, isExpanded, allDescendantsMap, setDraggingId, setDropTarget]);

  const handleAddPageInside = React.useCallback(() => {
    onToggleExpanded(doc.id);
    onAddPageInside(doc.id);
  }, [doc.id, onToggleExpanded, onAddPageInside]);

  const handleClick = React.useCallback((e: React.MouseEvent) => {
    // Don't open note if any drag is in progress or just ended
    if (draggingId || justDraggedRef.current) return;
    if (e.metaKey) {
      openTab(doc.id);
    } else {
      openOrSelectTab(doc.id);
    }
  }, [doc.id, draggingId, openTab, openOrSelectTab]);

  const handleAuxClick = React.useCallback((e: React.MouseEvent) => {
    // Don't open note if any drag is in progress or just ended
    if (draggingId || justDraggedRef.current) return;
    if (e.button === 1) {
      e.preventDefault();
      openTab(doc.id);
    }
  }, [doc.id, draggingId, openTab]);

  const iconNode = doc.emoji ? (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base leading-none">
      {doc.emoji}
    </span>
  ) : (
    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
  );

  // Derive visual state from context
  const isOver = dropTargetId === doc.id && draggingId !== doc.id;
  // Blue background highlight for nesting inside parent (last child) - not when nest-as-first
  const showNestIndicator = isOver && dropPosition === 'inside' && !nestAsFirst;
  // Indented line for nesting as first child (bottom edge of expanded parent)
  const showFirstChildLine = isOver && dropPosition === 'inside' && nestAsFirst;
  // Show drop line: "after" always shows at bottom, "before" only shows at top for first item
  // This prevents double indicators when pointer is between two items
  const showDropLine = isOver && (dropPosition === 'after' || (dropPosition === 'before' && isFirstInList));
  const linePosition = dropPosition === 'before' ? 'top' : 'bottom';

  return (
    <DocumentContextMenu
      docId={doc.id}
      canAddChild={canAddChild}
      onAddPageInside={handleAddPageInside}
    >
      <div
        ref={ref}
        className={cn(
          'relative',
          isDragging && 'opacity-5',
        )}
        data-note-id={doc.id}
      >
        {/* Sibling drop line: horizontal line = "insert as same-level sibling". Indent by depth so line width cues placement level. */}
        {showDropLine && (
          <div
            className={cn(
              'absolute left-0 right-0 z-30 flex items-center pointer-events-none px-2 -translate-y-1/2',
              linePosition === 'top' ? 'top-0' : 'bottom-0 translate-y-1/2',
            )}
            style={{ paddingLeft: depth * 12 }}
            title="Insert as sibling"
          >
            <div className="h-2 w-2 rounded-full border-2 border-blue-500 shrink-0 bg-[hsl(var(--background))]" />
            <div className="h-0.5 flex-1 bg-blue-500 rounded-full" />
          </div>
        )}

        {/* First child drop line: shows below expanded parent, indented to child level */}
        {showFirstChildLine && (
          <div
            className="absolute left-0 right-0 z-30 flex items-center pointer-events-none px-2 bottom-0 translate-y-1/2"
            style={{ paddingLeft: (depth + 1) * 12 }}
            title="Insert as first child"
          >
            <div className="h-2 w-2 rounded-full border-2 border-blue-500 shrink-0 bg-[hsl(var(--background))]" />
            <div className="h-0.5 flex-1 bg-blue-500 rounded-full" />
          </div>
        )}

        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page'}
            isActive={isSelected && !showNestIndicator}
            onClick={handleClick}
            onAuxClick={handleAuxClick}
            className={cn(
              'group cursor-pointer text-sm',
              showNestIndicator && 'bg-blue-500/20 !text-blue-600 dark:!text-blue-400 rounded-md',
            )}
          >
            <div
              className="flex w-full min-w-0 items-center gap-2 rounded-md transition-colors duration-200 text-left"
              style={{ paddingLeft: depth * 12 }}
            >
              {/* Icon / Expand toggle */}
              <span
                className={cn(
                  'relative flex h-6 w-6 shrink-0 items-center justify-center',
                  hasChildren && 'rounded-md border border-transparent text-[hsl(var(--muted-foreground))] outline-hidden hover:scale-110 hover:shadow-lg hover:border-[hsl(var(--border))] hover:text-[hsl(var(--foreground))] transition-[transform,box-shadow,border-color,color]',
                )}
                role={hasChildren ? 'button' : undefined}
                tabIndex={hasChildren ? 0 : undefined}
                onClick={hasChildren ? (e) => { e.stopPropagation(); onToggleExpanded(doc.id); } : undefined}
                onPointerDown={hasChildren ? (e) => e.stopPropagation() : undefined}
                onKeyDown={hasChildren ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleExpanded(doc.id);
                  }
                } : undefined}
                aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
              >
                <span className={cn(
                  'flex h-4 w-4 items-center justify-center',
                  hasChildren && 'group-hover:hidden',
                )}>
                  {iconNode}
                </span>
                <span className={cn(
                  'absolute inset-0 flex items-center justify-center hidden',
                  hasChildren && 'group-hover:flex',
                )}>
                  <ChevronRight className={cn('h-4 w-4', isExpanded && 'rotate-90')} />
                </span>
              </span>

              {/* Title */}
              <span className={cn("flex-1 truncate select-none text-[hsl(var(--muted-foreground))]", isSelected && "font-extrabold text-[hsl(var(--foreground))]")}>
                {doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page'}
              </span>

              {/* Action buttons */}
              <div
                className="ml-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu onOpenChange={(open) => { hoverLock(open); if (open) setOptionsTooltip(false); }}>
                  <TooltipPrimitive.Root open={optionsTooltip} onOpenChange={setOptionsTooltip} delayDuration={150}>
                    <TooltipPrimitive.Trigger asChild>
                      <DropdownMenuTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md outline-hidden border border-transparent hover:scale-110 hover:shadow-lg hover:border-[hsl(var(--border))] hover:text-[hsl(var(--foreground))] transition-[transform,box-shadow,border-color,color]"
                          onClick={(e) => e.stopPropagation()}
                          onFocus={(e) => e.preventDefault()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </span>
                      </DropdownMenuTrigger>
                    </TooltipPrimitive.Trigger>
                    <TooltipPrimitive.Portal>
                      <TooltipPrimitive.Content
                        side="top"
                        sideOffset={4}
                        className="z-50 rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-xs text-[hsl(var(--background))] shadow"
                      >
                        Options
                        <TooltipPrimitive.Arrow className="fill-[hsl(var(--foreground))]" />
                      </TooltipPrimitive.Content>
                    </TooltipPrimitive.Portal>
                  </TooltipPrimitive.Root>
                  <DocumentDropdownMenuContent
                    docId={doc.id}
                    canAddChild={canAddChild}
                    onAddPageInside={handleAddPageInside}
                  />
                </DropdownMenu>
                {canAddChild && (
                  <TooltipPrimitive.Root delayDuration={150}>
                    <TooltipPrimitive.Trigger asChild>
                      <span
                        role="button"
                        tabIndex={0}
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md outline-hidden border border-transparent hover:scale-110 hover:shadow-lg hover:border-[hsl(var(--border))] hover:text-[hsl(var(--foreground))] transition-[transform,box-shadow,border-color,color]"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddPageInside(doc.id);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </span>
                    </TooltipPrimitive.Trigger>
                    <TooltipPrimitive.Portal>
                      <TooltipPrimitive.Content
                        side="top"
                        sideOffset={4}
                        className="z-50 rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-xs text-[hsl(var(--background))] shadow"
                      >
                        Add Page Inside
                        <TooltipPrimitive.Arrow className="fill-[hsl(var(--foreground))]" />
                      </TooltipPrimitive.Content>
                    </TooltipPrimitive.Portal>
                  </TooltipPrimitive.Root>
                )}
              </div>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </div>
    </DocumentContextMenu>
  );
}
