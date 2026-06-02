import { create } from 'zustand';

type Mode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

type ThemeState = {
  mode: Mode;
  resolvedTheme: ResolvedTheme;
};

type ThemeActions = {
  setMode: (mode: Mode) => void;
};

type ThemeStore = ThemeState & ThemeActions;

const STORAGE_KEY = 'lychee-theme';

const mql = window.matchMedia('(prefers-color-scheme: dark)');

function resolve(mode: Mode): ResolvedTheme {
  if (mode === 'system') return mql.matches ? 'dark' : 'light';
  return mode;
}

function applyClass(resolved: ResolvedTheme, animate = false) {
  const el = document.documentElement;
  if (animate) {
    el.classList.add('theme-transition');
    // Remove after transition completes
    setTimeout(() => el.classList.remove('theme-transition'), 350);
  }
  el.classList.toggle('dark', resolved === 'dark');
}

function readStoredMode(): Mode {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'light';
}

/** Write theme to SQLite via IPC (source of truth for main process backgroundColor) */
function persistToDb(mode: Mode) {
  window.lychee.invoke('settings.set', { key: 'theme', value: mode });
}

// Probe the browser-resolved color of a CSS expression. Lets the renderer act
// as the single source of truth for theme colors — main process receives exact
// hex with no HSL math or hardcoded mirrors of CSS tokens.
function resolveCssColor(cssExpr: string): string {
  const probe = document.createElement('span');
  probe.style.cssText = `color: ${cssExpr}; display: none;`;
  // Append to documentElement (always present) rather than body, which may not
  // exist yet if this module evaluates before body is parsed.
  document.documentElement.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(computed);
  if (!m) return '#000000';
  const hex = (n: string) => parseInt(n, 10).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

/** Repaint native title-bar overlay (Win/Linux) to match the resolved theme. */
function notifyChromeChange(resolved: ResolvedTheme) {
  const color = resolveCssColor('hsl(var(--sidebar-background))');
  const symbolColor = resolveCssColor('hsl(var(--sidebar-foreground))');
  void window.lychee.invoke('app.updateChrome', { resolvedTheme: resolved, color, symbolColor });
}

const initialMode = readStoredMode();
const initialResolved = resolve(initialMode);
applyClass(initialResolved);

// Reconcile: ensure both stores have the resolved mode.
// Handles empty/invalid localStorage and first launch after migration.
localStorage.setItem(STORAGE_KEY, initialMode);
persistToDb(initialMode);
notifyChromeChange(initialResolved);

export const useThemeStore = create<ThemeStore>((set, get) => {
  mql.addEventListener('change', () => {
    const { mode } = get();
    if (mode !== 'system') return;
    const resolved = resolve('system');
    applyClass(resolved, true);
    notifyChromeChange(resolved);
    set({ resolvedTheme: resolved });
  });

  return {
    mode: initialMode,
    resolvedTheme: initialResolved,
    setMode: (mode: Mode) => {
      localStorage.setItem(STORAGE_KEY, mode);
      persistToDb(mode);
      const resolved = resolve(mode);
      applyClass(resolved, true);
      notifyChromeChange(resolved);
      set({ mode, resolvedTheme: resolved });
    },
  };
});
