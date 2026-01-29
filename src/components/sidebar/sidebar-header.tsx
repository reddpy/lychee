import { cn } from '../../lib/utils';
import { useSidebar } from '../ui/sidebar';
import { LycheeLogo } from './lychee-logo';

export function SidebarHeader() {
  const { open } = useSidebar();

  return (
    <div className="flex w-full items-center gap-2 overflow-hidden">
      <button
        type="button"
        className="flex h-6 w-6 flex-none items-center justify-center rounded-md border border-[hsl(var(--sidebar-border))] bg-white/70"
        title="Lychee Notes"
        aria-label="Lychee Notes"
      >
        <LycheeLogo />
      </button>
      <div
        className={cn(
          'min-w-0 flex-1 truncate text-sm font-semibold transition-opacity duration-150',
          open ? 'opacity-100' : 'opacity-0',
        )}
        title="Lychee Notes"
      >
        Lychee Notes
      </div>
    </div>
  );
}
