import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { motion } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Plus,
  StickyNote,
} from 'lucide-react';

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

export type NoteTreeItemProps = {
  doc: DocumentRow;
  depth: number;
  children: DocumentRow[];
  isExpanded: boolean;
  canAddChild: boolean;
  isSelected: boolean;
  onToggleExpanded: (id: string) => void;
  onAddPageInside: (parentId: string) => void;
  isHighlighted?: boolean;
  isRoot?: boolean;
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
  isHighlighted,
  isRoot,
}: NoteTreeItemProps) {
  const { openTab, navigateCurrentTab, updateDocumentInStore } =
    useDocumentStore();
  const hasChildren = children.length > 0;

  const handleAddPageInside = React.useCallback(() => {
    onToggleExpanded(doc.id);
    onAddPageInside(doc.id);
  }, [doc.id, onToggleExpanded, onAddPageInside]);

  const iconNode = doc.emoji ? (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base leading-none">
      {doc.emoji}
    </span>
  ) : (
    <StickyNote className="h-4 w-4 shrink-0" />
  );

  return (
    <DocumentContextMenu
      docId={doc.id}
      canAddChild={canAddChild}
      onAddPageInside={handleAddPageInside}
    >
      <span className="block w-full" data-note-id={doc.id}>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={doc.title}
              isActive={isSelected}
              onClick={(e: React.MouseEvent) => {
                if (e.metaKey) {
                  openTab(doc.id);
                } else {
                  navigateCurrentTab(doc.id);
                }
              }}
              onAuxClick={(e: React.MouseEvent) => {
                if (e.button === 1) {
                  e.preventDefault();
                  openTab(doc.id);
                }
              }}
              className="group"
            >
              {isHighlighted ? (
                <motion.div
                  className="flex w-full items-center gap-2"
                  style={{ paddingLeft: depth * 12 }}
                  initial={isRoot ? { opacity: 0, x: -24 } : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={
                    {
                      type: 'tween',
                      duration: 0.18,
                      ease: 'easeOut',
                      delay: 0.08,
                    }
                  }
                >
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
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleExpanded(doc.id);
                        }
                      }}
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      <span className="flex h-4 w-4 items-center justify-center opacity-100 transition-opacity group-hover:opacity-0">
                        {iconNode}
                      </span>
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </span>
                    </span>
                  ) : (
                    iconNode
                  )}
                </span>
                <span className="flex-1 truncate">{doc.title || 'Untitled'}</span>
                <div className="ml-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
                          onClick={async (e) => {
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
              </motion.div>
            ) : (
              <div
                className="flex w-full items-center gap-2"
                style={{ paddingLeft: depth * 12 }}
              >
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
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleExpanded(doc.id);
                        }
                      }}
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      <span className="flex h-4 w-4 items-center justify-center opacity-100 transition-opacity group-hover:opacity-0">
                        {iconNode}
                      </span>
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </span>
                    </span>
                  ) : (
                    iconNode
                  )}
                </span>
                <span className="flex-1 truncate">{doc.title || 'Untitled'}</span>
                <div className="ml-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
                          onClick={async (e) => {
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
            )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </span>
    </DocumentContextMenu>
  );
}
