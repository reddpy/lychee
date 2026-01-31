import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { ChevronRight, MoreHorizontal, Plus, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSortable } from '@dnd-kit/sortable';

import type { DocumentRow } from '../../shared/documents';
import {
  SidebarMenuButton,
  SidebarMenuItem,
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
import type { DropPosition } from './notes-section';
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
  isDragging?: boolean;
  isOver?: boolean;
  dropPosition?: DropPosition | null;
  showDropLine?: boolean;
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
  isDragging,
  isOver,
  dropPosition,
  showDropLine,
}: NoteTreeItemProps) {
  const { openTab, openOrSelectTab } = useDocumentStore();
  const hasChildren = children.length > 0;

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging: isSortableDragging,
  } = useSortable({ id: doc.id });

  // Don't apply transform - we don't want items to shift during drag
  // We handle drop indicators manually instead

  const handleAddPageInside = React.useCallback(() => {
    onToggleExpanded(doc.id);
    onAddPageInside(doc.id);
  }, [doc.id, onToggleExpanded, onAddPageInside]);

  const handleClick = React.useCallback((e: React.MouseEvent) => {
    if (e.metaKey) {
      openTab(doc.id);
    } else {
      openOrSelectTab(doc.id);
    }
  }, [doc.id, openTab, openOrSelectTab]);

  const handleAuxClick = React.useCallback((e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      openTab(doc.id);
    }
  }, [doc.id, openTab]);

  const iconNode = doc.emoji ? (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base leading-none">
      {doc.emoji}
    </span>
  ) : (
    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
  );

  const isBeingDragged = isDragging || isSortableDragging;
  const showNestIndicator = isOver && dropPosition === 'inside';
  const linePosition = dropPosition === 'before' ? 'top' : 'bottom';

  return (
    <DocumentContextMenu
      docId={doc.id}
      canAddChild={canAddChild}
      onAddPageInside={handleAddPageInside}
    >
      <div
        ref={setNodeRef}
        className={cn(
          'relative',
          isBeingDragged && 'opacity-5',
        )}
        data-note-id={doc.id}
        {...attributes}
        {...listeners}
      >
        {/* Drop line indicator - centered between items */}
        {showDropLine && (
          <div
            className={cn(
              "absolute left-0 right-0 z-30 flex items-center pointer-events-none px-2 -translate-y-1/2",
              linePosition === 'top' ? "top-0" : "bottom-0 translate-y-1/2"
            )}
          >
            <div className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" />
            <div className="h-[3px] flex-1 bg-blue-500 rounded-full" />
          </div>
        )}

        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page'}
            isActive={isSelected && !showNestIndicator}
            onClick={handleClick}
            onAuxClick={handleAuxClick}
            className={cn(
              'group cursor-grab active:cursor-grabbing',
              showNestIndicator && 'bg-blue-500/20 !text-blue-600 dark:!text-blue-400 rounded-md',
            )}
          >
            <div
              className="flex w-full items-center gap-2 rounded-md transition-colors duration-200"
              style={{ paddingLeft: depth * 12 }}
            >
              {/* Icon / Expand toggle */}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {hasChildren ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="group/icon relative flex h-5 w-5 items-center justify-center rounded border border-transparent text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:border-black/60 hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpanded(doc.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleExpanded(doc.id);
                      }
                    }}
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    <span className="flex h-4 w-4 items-center justify-center opacity-100 transition-opacity group-hover/icon:opacity-0">
                      {iconNode}
                    </span>
                    <motion.span
                      className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/icon:opacity-100"
                      animate={{ rotate: isExpanded ? 90 : 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 30,
                      }}
                    >
                      <ChevronRight className="h-3 w-3" />
                    </motion.span>
                  </span>
                ) : (
                  iconNode
                )}
              </span>

              {/* Title */}
              <span className="flex-1 truncate select-none">
                {doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page'}
              </span>

              {/* Action buttons */}
              <div
                className="ml-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <span
                      role="button"
                      tabIndex={0}
                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-transparent hover:border-[hsl(var(--sidebar-border))] hover:bg-[hsl(var(--sidebar-accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </span>
                  </DropdownMenuTrigger>
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
                        className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-transparent hover:border-[hsl(var(--sidebar-border))] hover:bg-[hsl(var(--sidebar-accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddPageInside(doc.id);
                        }}
                      >
                        <Plus className="h-3 w-3" />
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
