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

function DocumentMenuItems({
  Item,
  docId,
  canAddChild,
  onAddPageInside,
}: DocumentMenuProps & {
  Item: React.ComponentType<{ onSelect: () => void; className?: string; children: React.ReactNode }>;
}) {
  const openTab = useDocumentStore((s) => s.openTab);
  const trashDocument = useDocumentStore((s) => s.trashDocument);

  return (
    <>
      <Item onSelect={() => openTab(docId)}>
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Open in new tab</span>
      </Item>
      {canAddChild && onAddPageInside && (
        <Item onSelect={onAddPageInside}>
          <Plus className="h-3.5 w-3.5" />
          <span>Add page inside</span>
        </Item>
      )}
      <Item className="text-destructive focus:text-destructive focus:bg-destructive/10 data-[highlighted]:text-destructive data-[highlighted]:bg-destructive/10" onSelect={() => trashDocument(docId)}>
        <Trash2 className="h-3.5 w-3.5" />
        <span>Move to Trash Bin</span>
      </Item>
    </>
  );
}

export function DocumentContextMenu({
  docId,
  canAddChild,
  onAddPageInside,
  children,
}: DocumentMenuProps & { children: React.ReactNode }) {
  const hoverLock = useHoverLock();

  return (
    <ContextMenu onOpenChange={hoverLock}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <DocumentMenuItems Item={ContextMenuItem} docId={docId} canAddChild={canAddChild} onAddPageInside={onAddPageInside} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function DocumentDropdownMenuContent({
  docId,
  canAddChild,
  onAddPageInside,
}: DocumentMenuProps) {
  return (
    <DropdownMenuContent align="start">
      <DocumentMenuItems Item={DropdownMenuItem} docId={docId} canAddChild={canAddChild} onAddPageInside={onAddPageInside} />
    </DropdownMenuContent>
  );
}
