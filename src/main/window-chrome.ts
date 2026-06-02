import { BrowserWindow, nativeTheme } from 'electron';
import { getSetting } from './repos/settings';

export type ResolvedTheme = 'light' | 'dark';

export type ChromeColors = {
  /** WCO gutter background — must equal hsl(var(--sidebar-background)) */
  color: string;
  /** WCO icon (min/max/close glyph) color — equals hsl(var(--sidebar-foreground)) */
  symbolColor: string;
};

// Bootstrap fallback used ONLY for the BrowserWindow's initial paint, before
// the renderer mounts and ships its CSS-resolved colors via app.updateChrome.
// After that, the cache (populated by setChromeColors) is the source of truth.
// These should stay close to the design tokens but exactness isn't required —
// the flash window is ~one frame. `bg` is the BrowserWindow's backgroundColor;
// it's hidden under the renderer once it paints, so there's no token to mirror.
const BOOTSTRAP: Record<ResolvedTheme, ChromeColors & { bg: string }> = {
  light: { color: '#F9F7F6', symbolColor: '#5B5249', bg: '#fefefd' },
  dark: { color: '#1A1A1E', symbolColor: '#B0B0B6', bg: '#1d1816' },
};

// Latest renderer-supplied colors per resolved theme. The renderer probes its
// own CSS tokens, so this stays exact across token edits — no main-side HSL
// math or hand-mirrored hex to drift. Empty until the first updateChrome call.
const colorCache: Partial<Record<ResolvedTheme, ChromeColors>> = {};

export const TITLEBAR_HEIGHT = 40;

// WCO is 1px shorter than the title bar so the renderer's bottom border at
// the title bar's bottom edge remains visible under the min/max/close gutter
// (the OS paints the overlay's color opaquely across its full height).
export const TITLEBAR_OVERLAY_HEIGHT = TITLEBAR_HEIGHT - 1;

function readThemeMode(): 'light' | 'dark' | 'system' {
  try {
    const mode = getSetting('theme');
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    return 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(): ResolvedTheme {
  const mode = readThemeMode();
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** Bootstrap colors for the BrowserWindow constructor — replaced once the
 *  renderer attaches and calls setChromeColors. */
export function bootstrapChromeFor(theme: ResolvedTheme) {
  return BOOTSTRAP[theme];
}

/** Store renderer-resolved colors for a theme. Subsequent applyChromeToWindow
 *  calls (theme changes, dim toggles) read from this cache. */
export function setChromeColors(theme: ResolvedTheme, colors: ChromeColors): void {
  colorCache[theme] = colors;
}

function colorsFor(theme: ResolvedTheme): ChromeColors {
  return colorCache[theme] ?? BOOTSTRAP[theme];
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
  // Windows derives the min/max caption-button hover tint from nativeTheme,
  // not from our overlay color. If themeSource stays 'system' while the app
  // theme diverges from the OS, hover becomes invisible (e.g. system dark +
  // app light paints a light hover on our light overlay). Align it so the
  // tint contrasts with our overlay.
  const desiredSource = readThemeMode();
  if (nativeTheme.themeSource !== desiredSource) {
    nativeTheme.themeSource = desiredSource;
  }
  const c = colorsFor(theme);
  // bg is the BrowserWindow paint behind the renderer — only visible during
  // the boot flash, so the bootstrap value is fine; no need to mirror tokens.
  win.setBackgroundColor(BOOTSTRAP[theme].bg);
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
