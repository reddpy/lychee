import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { PanelLeft } from 'lucide-react';

import { cn } from '../../lib/utils';
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_PREFERENCES_SETTING_KEY,
  clampSidebarWidth,
  serializeSidebarPreferences,
} from '../../renderer/sidebar-preferences';
import { Button } from './button';

type SidebarContextValue = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  width: number;
  setWidth: (width: number) => void;
  commitWidth: () => void;
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
  defaultWidth = DEFAULT_SIDEBAR_WIDTH,
  style,
  className,
  children,
}: React.PropsWithChildren<{
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}>) {
  const [openInternal, setOpenInternal] = React.useState(defaultOpen);
  const [width, setWidthInternal] = React.useState(() =>
    clampSidebarWidth(defaultWidth),
  );
  const open = openProp ?? openInternal;
  const openRef = React.useRef(open);
  const widthRef = React.useRef(width);

  const persistPreferences = React.useCallback(() => {
    void window.lychee
      .invoke('settings.set', {
        key: SIDEBAR_PREFERENCES_SETTING_KEY,
        value: serializeSidebarPreferences({
          open: openRef.current,
          width: widthRef.current,
        }),
      })
      .catch(() => {
        // UI state remains usable if a non-critical preference write fails.
      });
  }, []);

  const setOpen = React.useCallback(
    (next: boolean) => {
      openRef.current = next;
      onOpenChange?.(next);
      if (openProp === undefined) setOpenInternal(next);
      persistPreferences();
    },
    [onOpenChange, openProp, persistPreferences],
  );

  const setWidth = React.useCallback((next: number) => {
    const clamped = clampSidebarWidth(next);
    widthRef.current = clamped;
    setWidthInternal(clamped);
  }, []);

  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  const [hoverIntent, setHoverIntent] = React.useState(false);
  const hoverIntentRef = React.useRef(false);
  const [hoverLockCount, setHoverLockCount] = React.useState(0);
  const hoverLockRef = React.useRef(0);
  const [awaitingPointerDecision, setAwaitingPointerDecision] = React.useState(false);
  const hoverTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointerDecisionHandlerRef = React.useRef<((event: PointerEvent) => void) | null>(null);

  React.useEffect(() => {
    hoverIntentRef.current = hoverIntent;
  }, [hoverIntent]);

  const clearPointerDecisionListener = React.useCallback(() => {
    if (pointerDecisionHandlerRef.current) {
      window.removeEventListener('pointermove', pointerDecisionHandlerRef.current, true);
      pointerDecisionHandlerRef.current = null;
    }
  }, []);

  const beginPointerDecision = React.useCallback(() => {
    clearPointerDecisionListener();
    setAwaitingPointerDecision(true);
    const onPointerMove = (event: PointerEvent) => {
      clearPointerDecisionListener();
      const sidebarEl = document.querySelector('aside[data-sidebar="app"][data-state="collapsed"]');
      if (!sidebarEl) {
        setAwaitingPointerDecision(false);
        return;
      }
      const rect = sidebarEl.getBoundingClientRect();
      const isInsideSidebar =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (isInsideSidebar) {
        setHoverIntent(true);
      }
      setAwaitingPointerDecision(false);
    };
    pointerDecisionHandlerRef.current = onPointerMove;
    window.addEventListener('pointermove', onPointerMove, true);
  }, [clearPointerDecisionListener]);

  const lockHover = React.useCallback(() => {
    hoverLockRef.current += 1;
    setHoverLockCount(hoverLockRef.current);
  }, []);

  const unlockHover = React.useCallback(() => {
    hoverLockRef.current = Math.max(0, hoverLockRef.current - 1);
    setHoverLockCount(hoverLockRef.current);
    if (!open && hoverLockRef.current === 0 && !hoverIntentRef.current) {
      beginPointerDecision();
    }
  }, [open, beginPointerDecision]);

  const isHoverLocked = React.useCallback(() => hoverLockRef.current > 0, []);

  const setHoverOpen = React.useCallback((next: boolean) => {
    clearTimeout(hoverTimeoutRef.current);
    if (next) {
      clearPointerDecisionListener();
      setAwaitingPointerDecision(false);
      setHoverIntent(true);
    } else {
      // Small delay so cursor can move between collapsed strip and sidebar
      hoverTimeoutRef.current = setTimeout(() => {
        setHoverIntent(false);
        if (hoverLockRef.current === 0) {
          setAwaitingPointerDecision(false);
        }
      }, 150);
    }
  }, [clearPointerDecisionListener]);

  React.useEffect(() => {
    if (open) {
      clearTimeout(hoverTimeoutRef.current);
      clearPointerDecisionListener();
      setAwaitingPointerDecision(false);
      setHoverIntent(false);
    }
  }, [open, clearPointerDecisionListener]);

  React.useEffect(() => {
    return () => {
      clearTimeout(hoverTimeoutRef.current);
      clearPointerDecisionListener();
    };
  }, [clearPointerDecisionListener]);

  const hoverOpen = !open && (hoverIntent || hoverLockCount > 0 || awaitingPointerDecision);

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      state: open ? 'expanded' : 'collapsed',
      open,
      setOpen,
      toggleSidebar: () => setOpen(!open),
      width,
      setWidth,
      commitWidth: persistPreferences,
      hoverOpen,
      setHoverOpen,
      lockHover,
      unlockHover,
      isHoverLocked,
    }),
    [
      open,
      setOpen,
      width,
      setWidth,
      persistPreferences,
      hoverOpen,
      setHoverOpen,
      lockHover,
      unlockHover,
      isHoverLocked,
    ],
  );

  return (
    <SidebarContext.Provider value={value}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <div
          className={cn('h-screen w-screen overflow-hidden', className)}
          data-sidebar-provider="true"
          style={{
            ...(style ?? {}),
            ['--sidebar-width' as unknown as keyof React.CSSProperties]: `${width}px`,
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
  const { open, hoverOpen, setHoverOpen } = useSidebar();
  const isFloating = !open && hoverOpen;
  const isPaletteOpen = React.useCallback(() => {
    if (typeof document === 'undefined') return false;
    return document.body.dataset.lycheeCommandPaletteOpen === 'true';
  }, []);

  // When expanded: in-flow flex child that pushes content over
  // When floating (collapsed + hover): absolute overlay
  // When hidden (collapsed, no hover): absolute + off-screen
  return (
    <aside
      data-sidebar="app"
      onMouseEnter={() => {
        if (!open && !isPaletteOpen()) setHoverOpen(true);
      }}
      onMouseLeave={() => {
        if (!open && !isPaletteOpen()) setHoverOpen(false);
      }}
      className={cn(
        'z-30 flex w-[var(--sidebar-width)] flex-col bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))]',
        // Expanded: in-flow flex child
        open && 'relative shrink-0 h-full border-r border-r-[hsl(var(--sidebar-border))]',
        // Collapsed: absolute overlay with transition
        !open && 'absolute transition-[transform,opacity] duration-200 ease-out',
        isFloating && 'left-2 top-16 bottom-24 w-[calc(var(--sidebar-width)-0.5rem)] rounded-xl border border-brand translate-x-0 opacity-100 shadow-xl',
        !open && !isFloating && 'left-0 top-0 h-full border-r border-r-[hsl(var(--sidebar-border))] -translate-x-full opacity-0 shadow-none pointer-events-none',
        className,
      )}
      data-state={open ? 'expanded' : 'collapsed'}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
        {children}
      </div>
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
  tooltip: _tooltip,
  ...rest
}: React.PropsWithChildren<
  {
    tooltip?: string;
    isActive?: boolean;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>) {
  return (
    <button
      {...rest}
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
  const { lockHover, unlockHover } = useSidebar();
  const lockedRef = React.useRef(false);

  // A menu can unmount while open (for example, after trashing its note).
  // Always release the lock it owns, without affecting locks from other UI.
  React.useEffect(() => () => {
    if (lockedRef.current) {
      lockedRef.current = false;
      unlockHover();
    }
  }, [unlockHover]);

  return React.useCallback((isOpen: boolean) => {
    if (isOpen === lockedRef.current) return;

    lockedRef.current = isOpen;
    if (isOpen) {
      lockHover();
    } else {
      unlockHover();
    }
  }, [lockHover, unlockHover]);
}

export function SidebarRail() {
  const {
    open,
    hoverOpen,
    width,
    setWidth,
    commitWidth,
    toggleSidebar,
    lockHover,
    unlockHover,
  } = useSidebar();
  const isFloating = !open && hoverOpen;
  const draggingRef = React.useRef(false);
  const movedRef = React.useRef(false);
  const startXRef = React.useRef(0);
  const providerLeftRef = React.useRef(0);
  const pointerIdRef = React.useRef<number | null>(null);
  const bodyStylesRef = React.useRef<{ cursor: string; userSelect: string } | null>(null);

  const finishDrag = React.useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    unlockHover();
    if (bodyStylesRef.current) {
      document.body.style.cursor = bodyStylesRef.current.cursor;
      document.body.style.userSelect = bodyStylesRef.current.userSelect;
      bodyStylesRef.current = null;
    }
  }, [unlockHover]);

  React.useEffect(() => finishDrag, [finishDrag]);

  const resizeFromClientX = React.useCallback(
    (clientX: number) => {
      if (!draggingRef.current) return;
      if (Math.abs(clientX - startXRef.current) >= 2) {
        movedRef.current = true;
      }
      // Treat sub-threshold pointer movement as click jitter. Without this,
      // clicking the rail could silently alter the persisted width by a pixel.
      if (!movedRef.current) return;
      setWidth(clientX - providerLeftRef.current);
    },
    [setWidth],
  );

  React.useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      resizeFromClientX(event.clientX);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      resizeFromClientX(event.clientX);
      pointerIdRef.current = null;
      finishDrag();
      commitWidth();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      pointerIdRef.current = null;
      finishDrag();
      commitWidth();
    };

    // Window-level tracking keeps floating resize stable even when the sidebar
    // edge moves away from the pointer between fast pointer events.
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
    };
  }, [commitWidth, finishDrag, resizeFromClientX]);

  return (
    <button
      type="button"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={width}
      aria-label="Resize sidebar"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        draggingRef.current = true;
        movedRef.current = false;
        startXRef.current = event.clientX;
        pointerIdRef.current = event.pointerId;
        providerLeftRef.current =
          event.currentTarget
            .closest<HTMLElement>('[data-sidebar-provider="true"]')
            ?.getBoundingClientRect().left ?? 0;
        lockHover();
        bodyStylesRef.current = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onClick={() => {
        if (movedRef.current) {
          movedRef.current = false;
          return;
        }
        toggleSidebar();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setWidth(width - 8);
          commitWidth();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          setWidth(width + 8);
          commitWidth();
        } else if (event.key === 'Home') {
          event.preventDefault();
          setWidth(MIN_SIDEBAR_WIDTH);
          commitWidth();
        } else if (event.key === 'End') {
          event.preventDefault();
          setWidth(MAX_SIDEBAR_WIDTH);
          commitWidth();
        }
      }}
      className={cn(
        'absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none',
        'group/rail opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity',
      )}
      title={`Drag to resize; click to ${open ? 'collapse' : 'expand'}`}
    >
      <span
        style={
          isFloating
            ? {
                top: 'calc(-4rem - 1px)',
                bottom: 'calc(-6rem - 1px)',
              }
            : undefined
        }
        className={cn(
          'pointer-events-none absolute left-1/2 w-1 -translate-x-1/2 bg-brand/70',
          !isFloating && 'top-0 h-full',
        )}
      />
    </button>
  );
}
