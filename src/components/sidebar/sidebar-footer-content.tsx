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
      <SidebarMenu className="w-full shrink-0 border-t border-[hsl(var(--sidebar-border))] px-1 py-1">
        <TrashBinPopover />
        {!isFloating && (
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings">
              <Settings className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="truncate text-sm font-semibold">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </>
  );
}
