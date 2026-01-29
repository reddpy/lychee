import { ExternalLink, Plus } from 'lucide-react';

import { useDocumentStore } from '../../renderer/document-store';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
} from '../ui/context-menu';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
} from '../ui/dropdown-menu';

export type DocumentCommandMenuProps = {
  docId: string;
  canAddChild: boolean;
  onAddPageInside?: () => void;
};

/** Context menu content (right-click on a note). Styled as a command menu. */
export function DocumentContextMenuContent({
  docId,
  canAddChild,
  onAddPageInside,
}: DocumentCommandMenuProps) {
  const openTab = useDocumentStore((s) => s.openTab);

  return (
    <ContextMenuContent className="min-w-[200px]">
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
  );
}

/** Dropdown menu content (ellipsis button on a note). Same as context menu. */
export function DocumentDropdownMenuContent({
  docId,
  canAddChild,
  onAddPageInside,
}: DocumentCommandMenuProps) {
  const openTab = useDocumentStore((s) => s.openTab);

  return (
    <DropdownMenuContent className="min-w-[200px]" align="start">
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
