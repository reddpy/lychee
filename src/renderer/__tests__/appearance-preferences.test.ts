import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HIGHLIGHT_PALETTE,
  MAX_HIGHLIGHT_COLORS,
  accentCssVars,
  highlightBackground,
  hexToHsv,
  hsvToHex,
  normalizeHex,
  normalizeAppearancePalette,
  parseStoredAppearance,
  serializeAppearance,
} from '../appearance-preferences';

describe('normalizeHex', () => {
  it('expands shorthand and lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('0EA5E9')).toBe('#0ea5e9');
  });

  it('rejects malformed values', () => {
    expect(normalizeHex('not-a-color')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('#zzzzzz')).toBeNull();
    expect(normalizeHex(123)).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('accentCssVars', () => {
  it('emits HSL triplets for the brand/primary tokens', () => {
    const vars = accentCssVars('#0ea5e9');
    expect(vars['--brand']).toMatch(/^\d+ \d+% \d+%$/);
    expect(vars['--primary']).toBe(vars['--brand']);
    expect(vars['--sidebar-primary']).toBe(vars['--brand']);
    // hover is darker than the base accent
    expect(vars['--brand-hover']).not.toBe(vars['--brand']);
  });

  it('picks a dark foreground for light accents and white for dark ones', () => {
    expect(accentCssVars('#fde047')['--primary-foreground']).toBe('20 15% 8%');
    expect(accentCssVars('#1e3a8a')['--primary-foreground']).toBe('0 0% 100%');
  });
});

describe('highlightBackground', () => {
  it('returns a translucent rgba string', () => {
    expect(highlightBackground('#facc15')).toBe('rgba(250, 204, 21, 0.35)');
  });
});

describe('hexToHsv / hsvToHex', () => {
  it('maps primary colors correctly', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 1 });
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
  });

  it('round-trips hex → hsv → hex', () => {
    for (const hex of ['#c14b55', '#0ea5e9', '#fde047', '#123456', '#4ade80']) {
      const { h, s, v } = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    }
  });
});

describe('normalizeAppearancePalette', () => {
  it('filters invalid entries, dedupes, and falls back when empty', () => {
    expect(
      normalizeAppearancePalette(['#FACC15', 'nope', '#facc15', '#4ade80', 42]),
    ).toEqual(['#facc15', '#4ade80']);
    expect(normalizeAppearancePalette([])).toEqual([...DEFAULT_HIGHLIGHT_PALETTE]);
    expect(normalizeAppearancePalette('x')).toEqual([...DEFAULT_HIGHLIGHT_PALETTE]);
  });
});

describe('parseStoredAppearance', () => {
  it('returns defaults for missing or malformed input', () => {
    for (const raw of [null, '', '{bad', '[]', '"str"']) {
      const parsed = parseStoredAppearance(raw);
      expect(parsed.accent).toBeNull();
      expect(parsed.highlightPalette).toEqual([...DEFAULT_HIGHLIGHT_PALETTE]);
    }
  });

  it('validates the accent and normalizes the palette', () => {
    const parsed = parseStoredAppearance(
      JSON.stringify({
        version: 1,
        accent: '#ABC',
        highlightPalette: ['#facc15', 'nope', '#facc15', '#4ade80'],
      }),
    );
    expect(parsed.accent).toBe('#aabbcc');
    expect(parsed.highlightPalette).toEqual(['#facc15', '#4ade80']);
  });

  it('caps the palette length', () => {
    const many = Array.from({ length: 40 }, (_, i) => `#${(i + 1).toString(16).padStart(6, '0')}`);
    const parsed = parseStoredAppearance(JSON.stringify({ highlightPalette: many }));
    expect(parsed.highlightPalette).toHaveLength(MAX_HIGHLIGHT_COLORS);
  });

  it('round-trips through serialize', () => {
    const preferences = { accent: '#0ea5e9', highlightPalette: ['#facc15'] };
    expect(parseStoredAppearance(serializeAppearance(preferences))).toEqual(preferences);
  });
});
