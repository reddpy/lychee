import { BrowserWindow, nativeTheme } from 'electron';
import { getSetting } from './repos/settings';

export type ResolvedTheme = 'light' | 'dark';

// Approximations of the renderer's --sidebar-background / --sidebar-foreground
// tokens (src/index.css). The native overlay can't read CSS variables, so we
// mirror the resolved hex here. Keep in sync if the tokens move.
const LIGHT = { color: '#F7F3EE', symbolColor: '#5B5249', bg: '#fefefd' } as const;
const DARK = { color: '#1B1B1F', symbolColor: '#B0B0B6', bg: '#1d1816' } as const;

export const TITLEBAR_HEIGHT = 40;

// WCO is 1px shorter than the title bar so the renderer's bottom border at
// the title bar's bottom edge remains visible under the min/max/close gutter
// (the OS paints the overlay's color opaquely across its full height).
export const TITLEBAR_OVERLAY_HEIGHT = TITLEBAR_HEIGHT - 1;

export function resolveTheme(): ResolvedTheme {
  try {
    const mode = getSetting('theme');
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function chromeFor(theme: ResolvedTheme) {
  return theme === 'dark' ? DARK : LIGHT;
}

// Renderer dim overlay is bg-black/50 (Radix dialog backdrop). The WCO is painted
// by the OS above the web content and can't be dimmed by anything in the DOM, so
// we mirror the dim by blending the chrome hex toward black by the same alpha.
function blendTowardBlack(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - alpha));
  const g = Math.round(((n >> 8) & 0xff) * (1 - alpha));
  const b = Math.round((n & 0xff) * (1 - alpha));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// Tracks whether a renderer overlay (dialog backdrop) is currently visible.
// Persists across theme changes so applyChromeToWindow stays in sync.
let overlayDimmed = false;

export function setOverlayDimmed(dimmed: boolean): void {
  if (overlayDimmed === dimmed) return;
  overlayDimmed = dimmed;
  applyChromeToAllWindows();
}

export function applyChromeToWindow(win: BrowserWindow, theme: ResolvedTheme = resolveTheme()): void {
  if (process.platform === 'darwin') return;
  const c = chromeFor(theme);
  win.setBackgroundColor(c.bg);
  const color = overlayDimmed ? blendTowardBlack(c.color, 0.5) : c.color;
  const symbolColor = overlayDimmed ? blendTowardBlack(c.symbolColor, 0.5) : c.symbolColor;
  try {
    win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_OVERLAY_HEIGHT });
  } catch {
    // Only valid when window was created with titleBarStyle: 'hidden' + titleBarOverlay
  }
}

export function applyChromeToAllWindows(theme?: ResolvedTheme): void {
  const t = theme ?? resolveTheme();
  for (const win of BrowserWindow.getAllWindows()) {
    applyChromeToWindow(win, t);
  }
}
