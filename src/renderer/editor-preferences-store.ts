import { create } from 'zustand';

import {
  DEFAULT_EDITOR_PREFERENCES,
  EDITOR_FONT_FAMILIES,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_CODE_TAB_SIZES,
  EDITOR_LINE_HEIGHTS,
  EDITOR_PAGE_WIDTHS,
  EDITOR_PREFERENCES_SETTING_KEY,
  MAX_HINT_TEXT_LENGTH,
  type EditorFontFamily,
  type EditorLineHeight,
  type EditorPageWidth,
  type EditorPreferences,
  serializeEditorPreferences,
} from './editor-preferences';

/**
 * Apply editor preferences to the document root as CSS custom properties +
 * data attributes. Kept out of the pure preferences module so that stays
 * DOM-free and unit-testable.
 */
export function applyEditorPreferences(preferences: EditorPreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const family =
    EDITOR_FONT_FAMILIES.find((entry) => entry.value === preferences.fontFamily) ??
    EDITOR_FONT_FAMILIES[0];
  const width =
    EDITOR_PAGE_WIDTHS.find((entry) => entry.value === preferences.pageWidth) ??
    EDITOR_PAGE_WIDTHS[0];
  const lineHeight =
    EDITOR_LINE_HEIGHTS.find((entry) => entry.value === preferences.lineHeight) ??
    EDITOR_LINE_HEIGHTS[1];

  root.style.setProperty('--editor-font-family', family.stack);
  root.style.setProperty('--editor-font-size', `${preferences.fontSize}px`);
  root.style.setProperty('--editor-content-max-width', width.maxWidth);
  root.style.setProperty('--editor-line-height', lineHeight.lineHeight);
  root.style.setProperty('--editor-code-tab-size', String(preferences.codeTabSize));
  root.dataset.reduceMotion = preferences.reduceMotion ? 'true' : 'false';
  root.dataset.focusMode = preferences.focusMode ? 'true' : 'false';
}

type EditorPreferencesState = EditorPreferences;

type EditorPreferencesActions = {
  setFontFamily: (value: EditorFontFamily) => void;
  setFontSize: (value: number) => void;
  setPageWidth: (value: EditorPageWidth) => void;
  setLineHeight: (value: EditorLineHeight) => void;
  setShowWordCount: (value: boolean) => void;
  setFocusMode: (value: boolean) => void;
  setTypewriterMode: (value: boolean) => void;
  setReduceMotion: (value: boolean) => void;
  setCodeTabSize: (value: number) => void;
  setAutolink: (value: boolean) => void;
  setSlashMenu: (value: boolean) => void;
  setShowHint: (value: boolean) => void;
  setHintText: (value: string) => void;
  setShowBlockPlaceholders: (value: boolean) => void;
  /** Restore every editor preference to its ship default (persisted). */
  reset: () => void;
  /** Seed state from a persisted snapshot without writing back. */
  applyPreferences: (preferences: EditorPreferences) => void;
};

type EditorPreferencesStore = EditorPreferencesState & EditorPreferencesActions;

function snapshot(state: EditorPreferencesStore): EditorPreferences {
  return {
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    pageWidth: state.pageWidth,
    lineHeight: state.lineHeight,
    showWordCount: state.showWordCount,
    focusMode: state.focusMode,
    typewriterMode: state.typewriterMode,
    reduceMotion: state.reduceMotion,
    codeTabSize: state.codeTabSize,
    autolink: state.autolink,
    slashMenu: state.slashMenu,
    showHint: state.showHint,
    hintText: state.hintText,
    showBlockPlaceholders: state.showBlockPlaceholders,
  };
}

function persist(preferences: EditorPreferences): void {
  try {
    void window.lychee
      .invoke('settings.set', {
        key: EDITOR_PREFERENCES_SETTING_KEY,
        value: serializeEditorPreferences(preferences),
      })
      .catch(() => {
        // Persistence failure should never break the live editor.
      });
  } catch {
    // `window.lychee` is absent in some test/SSR contexts; ignore.
  }
}

export const useEditorPreferencesStore = create<EditorPreferencesStore>((set, get) => {
  const commit = (partial: Partial<EditorPreferences>): void => {
    const next: EditorPreferences = { ...snapshot(get()), ...partial };
    applyEditorPreferences(next);
    set(next);
    persist(next);
  };

  return {
    ...DEFAULT_EDITOR_PREFERENCES,

    setFontFamily: (value) => commit({ fontFamily: value }),
    setFontSize: (value) =>
      commit({
        fontSize: Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(value))),
      }),
    setPageWidth: (value) => commit({ pageWidth: value }),
    setLineHeight: (value) => commit({ lineHeight: value }),
    setShowWordCount: (value) => commit({ showWordCount: value }),
    setFocusMode: (value) => commit({ focusMode: value }),
    setTypewriterMode: (value) => commit({ typewriterMode: value }),
    setReduceMotion: (value) => commit({ reduceMotion: value }),
    setCodeTabSize: (value) =>
      commit({
        codeTabSize: EDITOR_CODE_TAB_SIZES.includes(value)
          ? value
          : DEFAULT_EDITOR_PREFERENCES.codeTabSize,
      }),
    setAutolink: (value) => commit({ autolink: value }),
    setSlashMenu: (value) => commit({ slashMenu: value }),
    setShowHint: (value) => commit({ showHint: value }),
    setHintText: (value) =>
      commit({ hintText: value.slice(0, MAX_HINT_TEXT_LENGTH) }),
    setShowBlockPlaceholders: (value) => commit({ showBlockPlaceholders: value }),

    reset: () => commit({ ...DEFAULT_EDITOR_PREFERENCES }),

    applyPreferences: (preferences) => {
      applyEditorPreferences(preferences);
      set({ ...preferences });
    },
  };
});

/** Seed the store from persisted config and apply before first paint. */
export function hydrateEditorPreferences(preferences: EditorPreferences): void {
  useEditorPreferencesStore.getState().applyPreferences(preferences);
}
