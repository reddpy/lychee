import { Settings } from 'lucide-react';

import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '../ui/sidebar';
import { TrashBinPopover } from './trash-bin-popover';

export function SidebarFooterContent() {
  const { open } = useSidebar();

  return (
    <SidebarFooter className="h-auto items-stretch py-1">
      <SidebarMenu className="w-full">
        <TrashBinPopover />
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
