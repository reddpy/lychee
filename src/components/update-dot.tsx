import { cn } from '@/lib/utils';
import { useUpdateStore } from '@/renderer/update-store';

// Small red indicator shown on Settings entry points (and the About nav item)
// whenever an update is actionable. Renders nothing otherwise. The caller is
// responsible for positioning via `className` (the parent should be relative).
export function UpdateDot({ className }: { className?: string }) {
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  if (!hasUpdate) return null;
  return (
    <span
      aria-label="Update available"
      className={cn(
        'pointer-events-none h-2 w-2 rounded-full bg-[hsl(var(--destructive))] ring-2 ring-[hsl(var(--background))]',
        className,
      )}
    />
  );
}
