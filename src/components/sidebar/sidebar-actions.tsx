import { Plus } from 'lucide-react';

import { cn } from '../../lib/utils';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '../ui/sidebar';

export type SidebarActionsProps = {
  onNewNote: () => void;
};

export function SidebarActions({ onNewNote }: SidebarActionsProps) {
  const { open } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Actions</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="New note" onClick={onNewNote}>
            <Plus className="h-4 w-4 shrink-0" />
            <span className={cn('truncate', !open && 'sr-only')}>New note</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
