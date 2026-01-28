import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from './button';

type SidebarContextValue = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
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

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      state: open ? 'expanded' : 'collapsed',
      open,
      setOpen,
      toggleSidebar: () => setOpen(!open),
    }),
    [open, setOpen],
  );

  return (
    <SidebarContext.Provider value={value}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <div
          className={cn('h-screen w-screen overflow-hidden', className)}
          style={{
            ...(style ?? {}),
            // Keep compatible with shadcn docs patterns.
            ['--sidebar-width' as unknown as keyof React.CSSProperties]: '16rem',
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
  const { open } = useSidebar();
  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))] overflow-hidden',
        'transition-[width] duration-200 ease-out',
        open ? 'w-[var(--sidebar-width)]' : 'w-[3.25rem]',
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
  const { open } = useSidebar();
  return (
    <div
      className={cn(
        'px-2 pb-1 text-xs font-medium text-[hsl(var(--muted-foreground))]',
        !open && 'opacity-0',
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
  tooltip,
  isActive,
  className,
  children,
  onClick,
}: React.PropsWithChildren<{
  tooltip?: string;
  isActive?: boolean;
  className?: string;
  onClick?: () => void;
}>) {
  const { open } = useSidebar();

  const btn = (
    <button
      onClick={onClick}
      data-active={isActive ? 'true' : 'false'}
      className={cn(
        'group/menu-button flex w-full items-center rounded-md py-2 text-sm',
        open ? 'justify-start gap-2 px-2' : 'justify-center gap-0 px-0',
        'hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]',
        'data-[active=true]:bg-[hsl(var(--sidebar-accent))] data-[active=true]:text-[hsl(var(--sidebar-accent-foreground))]',
        className,
      )}
    >
      {children}
    </button>
  );

  if (open || !tooltip) return btn;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{btn}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          sideOffset={8}
          className={cn(
            'z-50 rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-xs text-[hsl(var(--background))] shadow',
          )}
        >
          {tooltip}
          <TooltipPrimitive.Arrow className="fill-[hsl(var(--foreground))]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function SidebarTrigger({
  className,
  'aria-label': ariaLabel = 'Toggle sidebar',
}: {
  className?: string;
  'aria-label'?: string;
}) {
  const { open, toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      aria-label={ariaLabel}
      className={className}
    >
      <span className="sr-only">{ariaLabel}</span>
      {open ? (
        <PanelLeftClose className="h-4 w-4" />
      ) : (
        <PanelLeftOpen className="h-4 w-4" />
      )}
    </Button>
  );
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

