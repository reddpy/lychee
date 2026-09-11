import { screen, type BrowserWindow } from 'electron';

import { getSetting, setSetting } from './repos/settings';

// Persisted main-window geometry so the app reopens where the user left it.
// Bounds are validated against connected displays on load; an off-screen or
// malformed record falls back to sensible defaults so the window can never be
// restored somewhere the user can't reach it.

export const WINDOW_BOUNDS_SETTING_KEY = 'window.bounds';

export const DEFAULT_WINDOW_WIDTH = 800;
export const DEFAULT_WINDOW_HEIGHT = 600;
export const MIN_WINDOW_WIDTH = 680;
export const MIN_WINDOW_HEIGHT = 480;

const SAVE_DEBOUNCE_MS = 300;

export type WindowBounds = {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
};

type StoredWindowBounds = {
  version?: unknown;
  width?: unknown;
  height?: unknown;
  x?: unknown;
  y?: unknown;
  maximized?: unknown;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parse a persisted bounds record, rejecting malformed or undersized values. */
export function parseStoredWindowBounds(raw: string | null): WindowBounds | null {
  if (!raw) return null;
  let parsed: StoredWindowBounds;
  try {
    parsed = JSON.parse(raw) as StoredWindowBounds;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const width = isFiniteNumber(parsed.width) ? Math.round(parsed.width) : null;
  const height = isFiniteNumber(parsed.height) ? Math.round(parsed.height) : null;
  if (width === null || height === null) return null;
  if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) return null;

  return {
    width,
    height,
    x: isFiniteNumber(parsed.x) ? Math.round(parsed.x) : null,
    y: isFiniteNumber(parsed.y) ? Math.round(parsed.y) : null,
    maximized: parsed.maximized === true,
  };
}

/** True when any part of the rect lands inside a display's work area. */
function isOnSomeDisplay(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): boolean {
  const displays = screen.getAllDisplays();
  return displays.some(({ workArea }) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);
    // Require a reasonably sized visible sliver, not just a 1px intersection.
    return overlapX >= 80 && overlapY >= 40;
  });
}

export type InitialWindowGeometry = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
};

/** Resolve the geometry to open the main window with. */
export function getInitialWindowGeometry(): InitialWindowGeometry {
  const bounds = parseStoredWindowBounds(
    getSetting(WINDOW_BOUNDS_SETTING_KEY),
  );
  if (!bounds) {
    return {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      maximized: false,
    };
  }

  const positioned =
    bounds.x !== null &&
    bounds.y !== null &&
    isOnSomeDisplay({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });

  return {
    width: bounds.width,
    height: bounds.height,
    ...(positioned ? { x: bounds.x as number, y: bounds.y as number } : {}),
    maximized: bounds.maximized,
  };
}

/** Persist the window's normal (un-maximized) geometry while the user moves it. */
export function trackWindowBounds(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = (): void => {
    if (win.isDestroyed()) return;
    try {
      const normal = win.getNormalBounds();
      setSetting(
        WINDOW_BOUNDS_SETTING_KEY,
        JSON.stringify({
          version: 1,
          width: normal.width,
          height: normal.height,
          x: normal.x,
          y: normal.y,
          maximized: win.isMaximized(),
        } satisfies WindowBounds & { version: number }),
      );
    } catch {
      // Best-effort: the DB may already be closed during shutdown.
    }
  };

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    clearTimeout(timer);
    save();
  });
}
