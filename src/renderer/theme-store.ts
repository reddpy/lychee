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

const initialMode = readStoredMode();
const initialResolved = resolve(initialMode);
applyClass(initialResolved);

// Reconcile: ensure both stores have the resolved mode.
// Handles empty/invalid localStorage and first launch after migration.
localStorage.setItem(STORAGE_KEY, initialMode);
persistToDb(initialMode);

export const useThemeStore = create<ThemeStore>((set, get) => {
  mql.addEventListener('change', () => {
    const { mode } = get();
    if (mode !== 'system') return;
    const resolved = resolve('system');
    applyClass(resolved, true);
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
      set({ mode, resolvedTheme: resolved });
    },
  };
});
