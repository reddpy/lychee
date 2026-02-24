import { Settings } from 'lucide-react';

import { useSidebar } from './ui/sidebar';
import { useSettingsStore } from '../renderer/settings-store';
import { LycheeLogo } from './sidebar/lychee-logo';

export function CollapsedSidebarWidget() {
  const { open, setHoverOpen } = useSidebar();
  const openSettings = useSettingsStore((s) => s.openSettings);

  if (open) return null;

  return (
    <>
      {/* Thin edge trigger — hover the left edge to reveal the floating sidebar.
          Excludes the bottom 128px where the settings/logo icons live. */}
      <div
        className="absolute left-0 top-0 bottom-32 z-20 w-1.5"
        onMouseEnter={() => setHoverOpen(true)}
        onMouseLeave={() => setHoverOpen(false)}
      />
      {/* Collapsed icons — always visible, clickable without triggering sidebar */}
      <div className="absolute left-0 bottom-0 z-20 flex w-[3.25rem] flex-col items-center gap-2 pb-4">
        <button
          type="button"
          onClick={openSettings}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
        <div title="Lychee Notes">
          <LycheeLogo className="h-5 w-5" />
        </div>
      </div>
    </>
  );
}
