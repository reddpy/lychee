import { Settings } from "lucide-react";

import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "../ui/sidebar";
import { TrashBinPopover } from "./trash-bin-popover";

export function SidebarFooterContent() {
  const { open, hoverOpen } = useSidebar();
  const isFloating = !open && hoverOpen;

  return (
    <>
      <SidebarMenu className="w-full shrink-0 border-t border-white/10 bg-[#C14B55] px-1 py-1">
        <TrashBinPopover />
        {!isFloating && (
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" className="text-white/80 hover:!bg-white/15 hover:!text-white">
              <Settings className="h-3.5 w-3.5 shrink-0 text-white/80" />
              <span className="truncate text-sm font-semibold text-white/80">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </>
  );
}
