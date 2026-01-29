import { Settings } from 'lucide-react';

import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '../ui/sidebar';

export function SidebarFooterContent() {
  const { open } = useSidebar();

  return (
    <SidebarFooter>
      <SidebarMenu className="w-full">
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Settings">
            <Settings className="h-4 w-4 shrink-0" />
            {open && <span className="truncate text-xs">Settings</span>}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
