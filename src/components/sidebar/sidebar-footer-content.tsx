import { Settings } from 'lucide-react';

import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '../ui/sidebar';
import { LycheeLogoHorizontal } from './lychee-logo';
import { TrashBinPopover } from './trash-bin-popover';

export function SidebarFooterContent() {
  const { open, hoverOpen } = useSidebar();
  const isFloating = !open && hoverOpen;

  return (
    <>
      <SidebarMenu className="w-full flex-shrink-0 border-t border-[hsl(var(--sidebar-border))] px-1 py-1">
        <TrashBinPopover />
        {!isFloating && (
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings">
              <Settings className="h-4 w-4 shrink-0" />
              <span className="truncate text-xs">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
      {!isFloating && (
        <SidebarFooter className="h-auto justify-start px-0 py-1.5">
          <div className="px-2" title="Lychee Notes">
            <LycheeLogoHorizontal className="h-8" />
          </div>
        </SidebarFooter>
      )}
    </>
  );
}
