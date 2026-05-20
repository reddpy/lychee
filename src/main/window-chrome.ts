import { BrowserWindow, nativeTheme } from 'electron';
import { getSetting } from './repos/settings';

export type ResolvedTheme = 'light' | 'dark';

// Approximations of the renderer's --sidebar-background / --sidebar-foreground
// tokens (src/index.css). The native overlay can't read CSS variables, so we
// mirror the resolved hex here. Keep in sync if the tokens move.
const LIGHT = { color: '#F7F3EE', symbolColor: '#5B5249', bg: '#fefefd' } as const;
const DARK = { color: '#1B1B1F', symbolColor: '#B0B0B6', bg: '#1d1816' } as const;

export const TITLEBAR_HEIGHT = 40;

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

export function applyChromeToWindow(win: BrowserWindow, theme: ResolvedTheme = resolveTheme()): void {
  if (process.platform === 'darwin') return;
  const c = chromeFor(theme);
  win.setBackgroundColor(c.bg);
  try {
    win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: TITLEBAR_HEIGHT });
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
