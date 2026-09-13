import * as React from "react";
import { create } from "zustand";

import { cn } from "@/lib/utils";

/**
 * Minimal toast system modelled on the shadcn (Base UI) toast API:
 *
 *   toast.add({ title: "Updated", description: "Changed on disk" })
 *   <Toaster />
 *
 * Deliberately dependency-free — the app is on Radix and a second UI runtime
 * for one transient message is not worth it. Rendered bottom-center of the note
 * area by <Toaster/> (see App.tsx).
 */

export interface ToastOptions {
  title: string;
  description?: string;
  /** Auto-dismiss delay in ms. Defaults to 2600. Pass 0 to keep it open. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  leaving: boolean;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (options: ToastOptions) => number;
  close: (id: number) => void;
  remove: (id: number) => void;
}

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const LEAVE_MS = 160;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  add: (options) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, leaving: false, ...options }] }));
    const duration = options.duration ?? 2600;
    if (duration > 0) {
      timers.set(
        id,
        setTimeout(() => get().close(id), duration),
      );
    }
    return id;
  },
  close: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.map((item) =>
        item.id === id ? { ...item, leaving: true } : item,
      ),
    }));
    setTimeout(() => get().remove(id), LEAVE_MS);
  },
  remove: (id) => {
    timers.delete(id);
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },
}));

export const toast = {
  add: (options: ToastOptions) => useToastStore.getState().add(options),
  close: (id: number) => useToastStore.getState().close(id),
};

export function Toaster({ className }: { className?: string }) {
  const toasts = useToastStore((state) => state.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "pointer-events-none absolute bottom-6 left-1/2 z-50 flex w-[min(92%,22rem)] -translate-x-1/2 flex-col items-stretch gap-2",
        className,
      )}
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          data-testid="toast"
          className={cn(
            "toast-item pointer-events-auto flex items-start gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))]/95 px-3.5 py-2.5 text-[hsl(var(--popover-foreground))] shadow-lg shadow-black/5 backdrop-blur-sm",
            item.leaving && "toast-item-leave",
          )}
        >
          <span className="mt-[3px] h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--brand))]" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-tight">{item.title}</p>
            {item.description ? (
              <p className="mt-0.5 truncate text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                {item.description}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
