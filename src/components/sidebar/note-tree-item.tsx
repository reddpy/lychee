import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
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
  ContextMenu,
  ContextMenuTrigger,
} from '../ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  DocumentContextMenuContent,
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
}: NoteTreeItemProps) {
  const { openTab, navigateCurrentTab } = useDocumentStore();
  const hasChildren = children.length > 0;

  const handleAddPageInside = React.useCallback(() => {
    onToggleExpanded(doc.id);
    onAddPageInside(doc.id);
  }, [doc.id, onToggleExpanded, onAddPageInside]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className="block w-full">
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
              <div
                className="flex w-full items-center gap-2"
                style={{ paddingLeft: depth * 12 }}
              >
                {hasChildren ? (
                  <span
                    className="flex h-4 w-4 items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpanded(doc.id);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </span>
                ) : (
                  <span className="h-4 w-4" />
                )}
                <StickyNote className="h-4 w-4 shrink-0" />
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
                            onToggleExpanded(doc.id);
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
        </span>
      </ContextMenuTrigger>
      <DocumentContextMenuContent
        docId={doc.id}
        canAddChild={canAddChild}
        onAddPageInside={handleAddPageInside}
      />
    </ContextMenu>
  );
}
