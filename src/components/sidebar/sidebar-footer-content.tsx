import { Settings } from "lucide-react";

import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "../ui/sidebar";
import { useSettingsStore } from "../../renderer/settings-store";
import { UpdateDot } from "../update-dot";
import { TrashBinPopover } from "./trash-bin-popover";

export function SidebarFooterContent() {
  const { open, hoverOpen } = useSidebar();
  const isFloating = !open && hoverOpen;
  const openSettings = useSettingsStore((s) => s.openSettings);

  return (
    <>
      <SidebarMenu className="w-full shrink-0 border-t border-[hsl(var(--sidebar-border))] px-1 py-1">
        <TrashBinPopover />
        {!isFloating && (
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" onClick={openSettings}>
              <span className="relative flex shrink-0">
                <Settings className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                <UpdateDot className="absolute -right-1 -top-1" />
              </span>
              <span className="truncate text-sm font-semibold">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </>
  );
}
