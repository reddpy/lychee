/**
 * Appearance preferences: accent color + highlight marker palette.
 *
 * Kept as pure functions (no DOM) so they are easy to unit test and can be
 * reused by the renderer store, the settings UI, and the floating toolbar.
 * Colors are stored as hex strings; CSS custom properties are emitted as HSL
 * triplets to match the token format in `src/index.css`.
 */

export const APPEARANCE_SETTING_KEY = 'ui.appearance';

/** The ship-default accent (Lychee brand red). Stored as `null` so the CSS
 *  defaults are used verbatim and "reset" is exact. */
export const DEFAULT_ACCENT_HEX = '#c14b55';

export const MAX_HIGHLIGHT_COLORS = 12;

/** Default marker palette (red, orange, yellow, green, sky, purple). */
export const DEFAULT_HIGHLIGHT_PALETTE: readonly string[] = [
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#38bdf8',
  '#c084fc',
];

/** Curated accent presets. `hex: null` is the ship default. */
export const ACCENT_PRESETS: readonly { name: string; hex: string | null }[] = [
  { name: 'Lychee', hex: null },
  { name: 'Rose', hex: '#e11d48' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Slate', hex: '#64748b' },
];

export type AppearancePreferences = {
  /** Hex accent, or null for the ship default. */
  accent: string | null;
  /** Ordered marker colors (hex). */
  highlightPalette: string[];
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  accent: null,
  highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE],
};

/** Expand `#abc` / `#aabbcc` to lowercase `#aabbcc`; returns null if invalid. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return `#${value.toLowerCase()}`;
  }
  return null;
}

export function isValidHex(input: unknown): boolean {
  return normalizeHex(input) !== null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex) ?? DEFAULT_ACCENT_HEX;
  const value = parseInt(normalized.slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const delta = max - min;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rr:
        h = ((gg - bb) / delta) % 6;
        break;
      case gg:
        h = (bb - rr) / delta + 2;
        break;
      default:
        h = (rr - gg) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * CSS custom properties to override for a given accent hex. Emitted as the raw
 * HSL triplet form the tokens expect (e.g. `"355 49% 53%"`). Light accents get
 * a dark foreground so solid primary buttons stay legible.
 */
export function accentCssVars(hex: string): Record<string, string> {
  const rgb = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const accent = `${h} ${s}% ${l}%`;
  const hover = `${h} ${s}% ${Math.max(0, l - 8)}%`;
  const primaryForeground = relativeLuminance(rgb) > 0.55 ? '20 15% 8%' : '0 0% 100%';
  return {
    '--brand': accent,
    '--brand-hover': hover,
    '--primary': accent,
    '--primary-foreground': primaryForeground,
    '--sidebar-primary': accent,
    '--sidebar-ring': accent,
  };
}

/** The CSS custom properties the accent override owns (used to reset). */
export const ACCENT_CSS_VARS = [
  '--brand',
  '--brand-hover',
  '--primary',
  '--primary-foreground',
  '--sidebar-primary',
  '--sidebar-ring',
] as const;

/** How opaque a marker color is when applied over text. Kept translucent so
 *  highlighted text stays readable in both light and dark themes. */
export const HIGHLIGHT_ALPHA = 0.35;

export function highlightBackground(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${HIGHLIGHT_ALPHA})`;
}

/** Convert a hex color to HSV (h: 0–360, s/v: 0–1). Used by the color picker. */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hex);
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    switch (max) {
      case rr:
        h = ((gg - bb) / delta) % 6;
        break;
      case gg:
        h = (bb - rr) / delta + 2;
        break;
      default:
        h = (rr - gg) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function dedupePalette(colors: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const color of colors) {
    const normalized = normalizeHex(color);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= MAX_HIGHLIGHT_COLORS) break;
  }
  return result;
}

export function normalizeAppearancePalette(colors: unknown): string[] {
  if (!Array.isArray(colors)) return [...DEFAULT_HIGHLIGHT_PALETTE];
  const normalized = dedupePalette(colors as string[]);
  return normalized.length > 0 ? normalized : [...DEFAULT_HIGHLIGHT_PALETTE];
}

/** Parse persisted appearance JSON, discarding anything malformed/out-of-range. */
export function parseStoredAppearance(raw: string | null): AppearancePreferences {
  if (!raw) return { ...DEFAULT_APPEARANCE, highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE] };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_APPEARANCE, highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE] };
    }
    const value = parsed as Record<string, unknown>;
    const accent = normalizeHex(value.accent);
    const highlightPalette = normalizeAppearancePalette(value.highlightPalette);
    return { accent, highlightPalette };
  } catch {
    return { ...DEFAULT_APPEARANCE, highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE] };
  }
}

export function serializeAppearance(preferences: AppearancePreferences): string {
  return JSON.stringify({
    version: 1,
    accent: normalizeHex(preferences.accent),
    highlightPalette: normalizeAppearancePalette(preferences.highlightPalette),
  });
}
