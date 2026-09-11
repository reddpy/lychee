/**
 * Editor preferences (Settings → Editor). App-wide writing/typography defaults.
 *
 * Pure (no DOM/Electron) so the renderer store, the settings UI, and the
 * startup config loader can share one parser. Persisted as JSON in the SQLite
 * `settings` table under one key.
 */

export const EDITOR_PREFERENCES_SETTING_KEY = 'ui.editor';

export type EditorFontFamily = 'sans' | 'serif' | 'mono';
export type EditorPageWidth = 'default' | 'wide' | 'full';
export type EditorLineHeight = 'compact' | 'normal' | 'relaxed';

export const EDITOR_FONT_SIZE_MIN = 14;
export const EDITOR_FONT_SIZE_MAX = 20;

export type EditorPreferences = {
  /** Body font family. */
  fontFamily: EditorFontFamily;
  /** Body font size in px. */
  fontSize: number;
  /** Content column width. */
  pageWidth: EditorPageWidth;
  /** Body line height. */
  lineHeight: EditorLineHeight;
  /** Show a word/character counter. */
  showWordCount: boolean;
  /** Dim all blocks except the one containing the caret. */
  focusMode: boolean;
  /** Keep the caret line vertically centered while typing. */
  typewriterMode: boolean;
  /** Suppress transitions/animations. */
  reduceMotion: boolean;
  /** Spaces per tab inside code blocks. */
  codeTabSize: number;
  /** Turn typed URLs/emails into links automatically. */
  autolink: boolean;
  /** Show the "/" block-insert menu. */
  slashMenu: boolean;
  /** Show the typing hint in empty text blocks (paragraphs/table cells). */
  showHint: boolean;
  /** Custom typing hint. Empty = built-in default. */
  hintText: string;
  /** Show labels in empty headings, quotes, and lists. */
  showBlockPlaceholders: boolean;
};

export const MAX_HINT_TEXT_LENGTH = 120;

/** Selectable code-block tab widths. */
export const EDITOR_CODE_TAB_SIZES: readonly number[] = [1, 2, 4, 8];

export const EDITOR_LINE_HEIGHTS: readonly {
  value: EditorLineHeight;
  label: string;
  lineHeight: string;
}[] = [
  { value: 'compact', label: 'Compact', lineHeight: '1.5' },
  { value: 'normal', label: 'Normal', lineHeight: '1.75' },
  { value: 'relaxed', label: 'Relaxed', lineHeight: '2' },
];

export const EDITOR_FONT_FAMILIES: readonly {
  value: EditorFontFamily;
  label: string;
  stack: string;
}[] = [
  {
    value: 'sans',
    label: 'Sans',
    stack:
      '"Inter Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  {
    value: 'serif',
    label: 'Serif',
    stack: 'Georgia, Cambria, "Times New Roman", Times, serif',
  },
  {
    value: 'mono',
    label: 'Mono',
    stack: 'Menlo, Consolas, Monaco, "Courier New", monospace',
  },
];

export const EDITOR_PAGE_WIDTHS: readonly {
  value: EditorPageWidth;
  label: string;
  maxWidth: string;
}[] = [
  { value: 'default', label: 'Default', maxWidth: '900px' },
  { value: 'wide', label: 'Wide', maxWidth: '1100px' },
  { value: 'full', label: 'Full width', maxWidth: '100%' },
];

export const EDITOR_FONT_SIZES: readonly { value: number; label: string }[] = [
  { value: 14, label: 'Small' },
  { value: 16, label: 'Default' },
  { value: 18, label: 'Large' },
  { value: 20, label: 'Extra large' },
];

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontFamily: 'sans',
  fontSize: 16,
  pageWidth: 'default',
  lineHeight: 'normal',
  showWordCount: false,
  focusMode: false,
  typewriterMode: false,
  reduceMotion: false,
  codeTabSize: 2,
  autolink: true,
  slashMenu: true,
  showHint: true,
  hintText: '',
  showBlockPlaceholders: true,
};

function isFontFamily(value: unknown): value is EditorFontFamily {
  return value === 'sans' || value === 'serif' || value === 'mono';
}

function isPageWidth(value: unknown): value is EditorPageWidth {
  return value === 'default' || value === 'wide' || value === 'full';
}

function isLineHeight(value: unknown): value is EditorLineHeight {
  return value === 'compact' || value === 'normal' || value === 'relaxed';
}

function clampFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_EDITOR_PREFERENCES.fontSize;
  }
  return Math.min(
    EDITOR_FONT_SIZE_MAX,
    Math.max(EDITOR_FONT_SIZE_MIN, Math.round(value)),
  );
}

function normalizeTabSize(value: unknown): number {
  return typeof value === 'number' && EDITOR_CODE_TAB_SIZES.includes(value)
    ? value
    : DEFAULT_EDITOR_PREFERENCES.codeTabSize;
}

function normalizeHintText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, MAX_HINT_TEXT_LENGTH);
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Parse persisted editor preferences, discarding anything malformed. */
export function parseStoredEditorPreferences(raw: string | null): EditorPreferences {
  const fallback = { ...DEFAULT_EDITOR_PREFERENCES };
  if (!raw) return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;

    const value = parsed as Record<string, unknown>;
    // `showPlaceholder` was the pre-split master toggle; honor it as the
    // fallback for both halves when the new keys are absent.
    const legacyShow =
      typeof value.showPlaceholder === 'boolean' ? value.showPlaceholder : undefined;
    return {
      fontFamily: isFontFamily(value.fontFamily) ? value.fontFamily : fallback.fontFamily,
      fontSize: clampFontSize(value.fontSize),
      pageWidth: isPageWidth(value.pageWidth) ? value.pageWidth : fallback.pageWidth,
      lineHeight: isLineHeight(value.lineHeight) ? value.lineHeight : fallback.lineHeight,
      showWordCount: boolOr(value.showWordCount, fallback.showWordCount),
      focusMode: boolOr(value.focusMode, fallback.focusMode),
      typewriterMode: boolOr(value.typewriterMode, fallback.typewriterMode),
      reduceMotion: boolOr(value.reduceMotion, fallback.reduceMotion),
      codeTabSize: normalizeTabSize(value.codeTabSize),
      autolink: boolOr(value.autolink, fallback.autolink),
      slashMenu: boolOr(value.slashMenu, fallback.slashMenu),
      showHint: boolOr(value.showHint, legacyShow ?? fallback.showHint),
      hintText: normalizeHintText(value.hintText ?? value.placeholderText),
      showBlockPlaceholders: boolOr(
        value.showBlockPlaceholders,
        legacyShow ?? fallback.showBlockPlaceholders,
      ),
    };
  } catch {
    return fallback;
  }
}

export function serializeEditorPreferences(preferences: EditorPreferences): string {
  return JSON.stringify({
    version: 2,
    fontFamily: preferences.fontFamily,
    fontSize: clampFontSize(preferences.fontSize),
    pageWidth: preferences.pageWidth,
    lineHeight: preferences.lineHeight,
    showWordCount: preferences.showWordCount,
    focusMode: preferences.focusMode,
    typewriterMode: preferences.typewriterMode,
    reduceMotion: preferences.reduceMotion,
    codeTabSize: normalizeTabSize(preferences.codeTabSize),
    autolink: preferences.autolink,
    slashMenu: preferences.slashMenu,
    showHint: preferences.showHint,
    hintText: normalizeHintText(preferences.hintText),
    showBlockPlaceholders: preferences.showBlockPlaceholders,
  });
}
