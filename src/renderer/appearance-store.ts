import { create } from 'zustand';

import {
  ACCENT_CSS_VARS,
  APPEARANCE_SETTING_KEY,
  type AppearancePreferences,
  DEFAULT_ACCENT_HEX,
  DEFAULT_APPEARANCE,
  DEFAULT_HIGHLIGHT_PALETTE,
  MAX_HIGHLIGHT_COLORS,
  accentCssVars,
  normalizeAppearancePalette,
  normalizeHex,
  serializeAppearance,
} from './appearance-preferences';

/** Normalize an accent hex; the ship-default color maps to `null` (no override). */
function normalizeAccentValue(hex: string | null): string | null {
  const normalized = normalizeHex(hex);
  return normalized === DEFAULT_ACCENT_HEX ? null : normalized;
}

/**
 * Apply (or clear) the accent override on the document root. Inline custom
 * properties win over both `:root` and `.dark`, so this composes with the
 * light/dark mode toggle rather than replacing it. Passing `null` removes the
 * overrides so the ship defaults from `index.css` apply exactly.
 */
export function applyAccent(accent: string | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!accent) {
    for (const name of ACCENT_CSS_VARS) {
      root.style.removeProperty(name);
    }
    return;
  }
  const vars = accentCssVars(accent);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}

type AppearanceState = AppearancePreferences;

type AppearanceActions = {
  setAccent: (hex: string | null) => void;
  resetAccent: () => void;
  setHighlightPalette: (colors: string[]) => void;
  updateHighlightColor: (index: number, hex: string) => void;
  addHighlightColor: (hex: string) => void;
  removeHighlightColor: (index: number) => void;
  resetHighlightPalette: () => void;
  resetAppearance: () => void;
};

type AppearanceStore = AppearanceState & AppearanceActions;

function persist(state: AppearanceState): void {
  try {
    void window.lychee
      .invoke('settings.set', {
        key: APPEARANCE_SETTING_KEY,
        value: serializeAppearance(state),
      })
      .catch(() => {
        // Persistence failure should never break the live UI.
      });
  } catch {
    // `window.lychee` is absent in some test/SSR contexts; ignore.
  }
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => {
  const commit = (partial: Partial<AppearanceState>) => {
    // Normalize every write so bad input can never reach state or SQLite, and
    // the palette can never end up empty.
    const next: AppearanceState = {
      accent:
        partial.accent !== undefined
          ? normalizeAccentValue(partial.accent)
          : get().accent,
      highlightPalette:
        partial.highlightPalette !== undefined
          ? normalizeAppearancePalette(partial.highlightPalette)
          : get().highlightPalette,
    };
    if (partial.accent !== undefined) applyAccent(next.accent);
    set(next);
    persist(next);
  };

  return {
    accent: DEFAULT_APPEARANCE.accent,
    highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE],

    setAccent: (hex) => {
      // Ignore malformed input rather than silently resetting a valid choice.
      if (hex !== null && normalizeHex(hex) === null) return;
      commit({ accent: hex });
    },
    resetAccent: () => commit({ accent: null }),

    setHighlightPalette: (colors) => commit({ highlightPalette: colors }),

    updateHighlightColor: (index, hex) => {
      const normalized = normalizeHex(hex);
      if (!normalized) return;
      const next = [...get().highlightPalette];
      if (index < 0 || index >= next.length) return;
      next[index] = normalized;
      commit({ highlightPalette: next });
    },

    addHighlightColor: (hex) => {
      const normalized = normalizeHex(hex);
      if (!normalized) return;
      const current = get().highlightPalette;
      if (current.includes(normalized) || current.length >= MAX_HIGHLIGHT_COLORS) return;
      commit({ highlightPalette: [...current, normalized] });
    },

    removeHighlightColor: (index) => {
      const current = get().highlightPalette;
      if (index < 0 || index >= current.length) return;
      // Always leave at least one marker swatch in the palette.
      if (current.length <= 1) return;
      commit({ highlightPalette: current.filter((_, i) => i !== index) });
    },

    resetHighlightPalette: () =>
      commit({ highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE] }),

    resetAppearance: () => {
      commit({ accent: null, highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE] });
    },
  };
});

/** Seed the store from persisted config and apply the accent before first paint. */
export function hydrateAppearance(preferences: AppearancePreferences): void {
  applyAccent(preferences.accent);
  useAppearanceStore.setState({
    accent: normalizeAccentValue(preferences.accent),
    highlightPalette: normalizeAppearancePalette(preferences.highlightPalette),
  });
}
