import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { PanelLeft } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from './button';

type SidebarContextValue = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** Whether the sidebar is temporarily visible via hover. */
  hoverOpen: boolean;
  setHoverOpen: (hoverOpen: boolean) => void;
  lockHover: () => void;
  unlockHover: () => void;
  isHoverLocked: () => boolean;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider.');
  return ctx;
}

export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  style,
  className,
  children,
}: React.PropsWithChildren<{
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  style?: React.CSSProperties;
  className?: string;
}>) {
  const [openInternal, setOpenInternal] = React.useState(defaultOpen);
  const open = openProp ?? openInternal;

  const setOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (openProp === undefined) setOpenInternal(next);
    },
    [onOpenChange, openProp],
  );

  const [hoverOpenInternal, setHoverOpenInternal] = React.useState(false);
  const hoverTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverLockRef = React.useRef(0);

  const lockHover = React.useCallback(() => {
    hoverLockRef.current++;
  }, []);

  const unlockHover = React.useCallback(() => {
    hoverLockRef.current = Math.max(0, hoverLockRef.current - 1);
  }, []);

  const isHoverLocked = React.useCallback(() => hoverLockRef.current > 0, []);

  const setHoverOpen = React.useCallback((next: boolean) => {
    clearTimeout(hoverTimeoutRef.current);
    if (next) {
      setHoverOpenInternal(true);
    } else {
      // Small delay so cursor can move between collapsed strip and sidebar
      hoverTimeoutRef.current = setTimeout(() => setHoverOpenInternal(false), 150);
    }
  }, []);

  React.useEffect(() => {
    return () => clearTimeout(hoverTimeoutRef.current);
  }, []);

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      state: open ? 'expanded' : 'collapsed',
      open,
      setOpen,
      toggleSidebar: () => setOpen(!open),
      hoverOpen: hoverOpenInternal,
      setHoverOpen,
      lockHover,
      unlockHover,
      isHoverLocked,
    }),
    [open, setOpen, hoverOpenInternal, setHoverOpen, lockHover, unlockHover, isHoverLocked],
  );

  return (
    <SidebarContext.Provider value={value}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <div
          className={cn('h-screen w-screen overflow-hidden', className)}
          style={{
            ...(style ?? {}),
            ['--sidebar-width' as unknown as keyof React.CSSProperties]: '18rem',
          }}
        >
          {children}
        </div>
      </TooltipPrimitive.Provider>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  const { open, hoverOpen, setHoverOpen, isHoverLocked } = useSidebar();
  const isVisible = open || hoverOpen;
  const isFloating = !open && hoverOpen;
  return (
    <aside
      onMouseEnter={() => { if (!open) setHoverOpen(true); }}
      onMouseLeave={() => { if (!open && !isHoverLocked()) setHoverOpen(false); }}
      className={cn(
        'absolute z-30 flex w-[var(--sidebar-width)] flex-col bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))]',
        'transition-[transform,opacity] duration-200 ease-out',
        isFloating
          ? 'left-2 top-16 bottom-24 w-[calc(var(--sidebar-width)-0.5rem)] rounded-xl border border-[#C14B55] overflow-hidden'
          : 'left-0 top-0 h-full border-r border-r-[hsl(var(--sidebar-border))]',
        isVisible
          ? cn('translate-x-0 opacity-100', isFloating ? 'shadow-xl' : 'shadow-none')
          : '-translate-x-full opacity-0 shadow-none pointer-events-none',
        className,
      )}
      data-state={open ? 'expanded' : 'collapsed'}
    >
      {children}
      <SidebarRail />
    </aside>
  );
}

export function SidebarInset({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('flex h-full min-w-0 flex-1 flex-col', className)}>
      {children}
    </div>
  );
}

export function SidebarHeader({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex h-12 items-center border-b border-[hsl(var(--sidebar-border))] px-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarFooter({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        'flex h-12 flex-shrink-0 items-center border-t border-[hsl(var(--sidebar-border))] px-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarContent({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('min-h-0 flex-1 p-2 flex flex-col', className)}>
      {children}
    </div>
  );
}

export function SidebarGroup({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn('mb-2', className)}>{children}</div>;
}

export function SidebarGroupLabel({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        'px-2 pb-1 text-xs font-medium text-[hsl(var(--muted-foreground))]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarMenu({ className, children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn('space-y-1', className)}>{children}</div>;
}

export function SidebarMenuItem({ className, children }: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn('relative', className)}>{children}</div>;
}

export function SidebarMenuButton({
  isActive,
  className,
  children,
  onClick,
  onAuxClick,
  onContextMenu,
}: React.PropsWithChildren<{
  tooltip?: string;
  isActive?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  onAuxClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}>) {
  return (
    <button
      onClick={onClick}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      data-active={isActive ? 'true' : 'false'}
      className={cn(
        'group/menu-button flex w-full items-center justify-start gap-1.5 rounded-md px-2 py-1.5 text-sm',
        'hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]',
        'data-[active=true]:bg-[hsl(var(--sidebar-accent))] data-[active=true]:text-[hsl(var(--sidebar-accent-foreground))]',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SidebarTrigger({
  className,
  'aria-label': ariaLabel = 'Toggle sidebar',
}: {
  className?: string;
  'aria-label'?: string;
}) {
  const { open, setOpen, setHoverOpen } = useSidebar();
  const suppressHover = React.useRef(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        if (open) {
          // Collapsing: transition to hover/floating state
          suppressHover.current = true;
          setOpen(false);
          setHoverOpen(true);
        } else {
          // Expanding: clear hover state and fully open
          suppressHover.current = false;
          setHoverOpen(false);
          setOpen(true);
        }
      }}
      onMouseEnter={() => { if (!open && !suppressHover.current) setHoverOpen(true); }}
      onMouseLeave={() => { suppressHover.current = false; setHoverOpen(false); }}
      aria-label={ariaLabel}
      className={className}
    >
      <span className="sr-only">{ariaLabel}</span>
      <PanelLeft className="h-[18px] w-[18px]" />
    </Button>
  );
}

export function useHoverLock() {
  const { open, setHoverOpen, lockHover, unlockHover } = useSidebar();
  return React.useCallback((isOpen: boolean) => {
    if (isOpen) {
      lockHover();
    } else {
      unlockHover();
      if (!open) {
        requestAnimationFrame(() => {
          const sidebarEl = document.querySelector('aside[data-state]');
          if (sidebarEl && !sidebarEl.matches(':hover')) {
            setHoverOpen(false);
          }
        });
      }
    }
  }, [open, setHoverOpen, lockHover, unlockHover]);
}

export function SidebarRail() {
  const { open, toggleSidebar } = useSidebar();
  return (
    <button
      onClick={toggleSidebar}
      aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
      className={cn(
        'absolute right-0 top-0 h-full w-1.5',
        'opacity-0 hover:opacity-100 transition-opacity',
      )}
      title={open ? 'Collapse sidebar' : 'Expand sidebar'}
    />
  );
}

