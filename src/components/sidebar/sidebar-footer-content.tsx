import { Settings } from "lucide-react";

import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "../ui/sidebar";
import { LycheeLogoHorizontal } from "./lychee-logo";
import { TrashBinPopover } from "./trash-bin-popover";

export function SidebarFooterContent() {
  const { open, hoverOpen } = useSidebar();
  const isFloating = !open && hoverOpen;

  return (
    <>
      <SidebarMenu className="w-full shrink-0 border-t border-[hsl(var(--sidebar-border))] px-1 py-1">
        <TrashBinPopover />
        {!isFloating && (
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings">
              <Settings className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate text-sm font-normal">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
      {!isFloating && (
        <SidebarFooter className="h-auto justify-start px-0 py-1.5">
          <div className="flex w-full justify-center" title="Lychee Notes">
            <LycheeLogoHorizontal className="h-10" />
          </div>
        </SidebarFooter>
      )}
    </>
  );
}
