import { Plus } from 'lucide-react';

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '../ui/sidebar';

export type SidebarActionsProps = {
  onNewNote: () => void;
};

export function SidebarActions({ onNewNote }: SidebarActionsProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Actions</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="New note" onClick={onNewNote}>
            <Plus className="h-4 w-4 shrink-0" />
            <span className="truncate">New note</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
