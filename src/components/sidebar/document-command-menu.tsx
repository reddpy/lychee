import * as React from 'react';
import { ExternalLink, Plus } from 'lucide-react';

import { useDocumentStore } from '../../renderer/document-store';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '../ui/context-menu';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
} from '../ui/dropdown-menu';

export type DocumentMenuProps = {
  docId: string;
  canAddChild: boolean;
  onAddPageInside?: () => void;
};

export function DocumentContextMenu({
  docId,
  canAddChild,
  onAddPageInside,
  children,
}: DocumentMenuProps & { children: React.ReactNode }) {
  const openTab = useDocumentStore((s) => s.openTab);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openTab(docId)}>
          <ExternalLink className="h-3.5 w-3.5" />
          <span>Open in new tab</span>
          <ContextMenuShortcut>⌘↵</ContextMenuShortcut>
        </ContextMenuItem>
        {canAddChild && onAddPageInside && (
          <ContextMenuItem onSelect={onAddPageInside}>
            <Plus className="h-3.5 w-3.5" />
            <span>Add page inside</span>
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function DocumentDropdownMenuContent({
  docId,
  canAddChild,
  onAddPageInside,
}: DocumentMenuProps) {
  const openTab = useDocumentStore((s) => s.openTab);

  return (
    <DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={() => openTab(docId)}>
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Open in new tab</span>
        <DropdownMenuShortcut>⌘↵</DropdownMenuShortcut>
      </DropdownMenuItem>
      {canAddChild && onAddPageInside && (
        <DropdownMenuItem onSelect={onAddPageInside}>
          <Plus className="h-3.5 w-3.5" />
          <span>Add page inside</span>
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}
