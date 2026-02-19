import * as React from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';

import { useDocumentStore } from '../../renderer/document-store';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../ui/context-menu';
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import { useHoverLock } from '../ui/sidebar';

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
  const trashDocument = useDocumentStore((s) => s.trashDocument);
  const hoverLock = useHoverLock();

  return (
    <ContextMenu onOpenChange={hoverLock}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openTab(docId)}>
          <ExternalLink className="h-3.5 w-3.5" />
          <span>Open in new tab</span>
        </ContextMenuItem>
        {canAddChild && onAddPageInside && (
          <ContextMenuItem onSelect={onAddPageInside}>
            <Plus className="h-3.5 w-3.5" />
            <span>Add page inside</span>
          </ContextMenuItem>
        )}
        <ContextMenuItem variant="destructive" onSelect={() => trashDocument(docId)}>
          <Trash2 className="h-3.5 w-3.5" />
          <span>Move to Trash Bin</span>
        </ContextMenuItem>
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
  const trashDocument = useDocumentStore((s) => s.trashDocument);

  return (
    <DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={() => openTab(docId)}>
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Open in new tab</span>
      </DropdownMenuItem>
      {canAddChild && onAddPageInside && (
        <DropdownMenuItem onSelect={onAddPageInside}>
          <Plus className="h-3.5 w-3.5" />
          <span>Add page inside</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={() => trashDocument(docId)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span>Move to Trash Bin</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
