// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ACCENT_HEX,
  DEFAULT_HIGHLIGHT_PALETTE,
  MAX_HIGHLIGHT_COLORS,
} from '../appearance-preferences';
import { hydrateAppearance, useAppearanceStore } from '../appearance-store';

const invoke = vi.fn();

const store = () => useAppearanceStore.getState();

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ ok: true });
  window.lychee = { invoke } as unknown as Window['lychee'];
  const root = document.documentElement;
  for (const name of [
    '--brand',
    '--brand-hover',
    '--primary',
    '--primary-foreground',
    '--sidebar-primary',
    '--sidebar-ring',
  ]) {
    root.style.removeProperty(name);
  }
  hydrateAppearance({ accent: null, highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE] });
});

describe('appearance store — accent', () => {
  it('applies the accent CSS vars and persists a normalized hex', () => {
    store().setAccent('#ABC');
    expect(store().accent).toBe('#aabbcc');
    expect(document.documentElement.style.getPropertyValue('--primary')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--brand')).not.toBe('');

    const payload = invoke.mock.calls[invoke.mock.calls.length - 1][1] as {
      key: string;
      value: string;
    };
    expect(payload.key).toBe('ui.appearance');
    expect(JSON.parse(payload.value).accent).toBe('#aabbcc');
  });

  it('maps the ship-default accent back to null and clears the overrides', () => {
    store().setAccent('#0ea5e9');
    expect(document.documentElement.style.getPropertyValue('--primary')).not.toBe('');

    store().setAccent(DEFAULT_ACCENT_HEX);
    expect(store().accent).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('');
  });

  it('ignores an invalid accent and keeps the previous value', () => {
    store().setAccent('#0ea5e9');
    store().setAccent('not-a-color');
    expect(store().accent).toBe('#0ea5e9');
  });
});

describe('appearance store — highlight palette', () => {
  it('dedupes and caps the palette', () => {
    const first = store().highlightPalette[0];
    const initialLength = store().highlightPalette.length;
    store().addHighlightColor(first);
    expect(store().highlightPalette).toHaveLength(initialLength);

    for (let i = 0; i < MAX_HIGHLIGHT_COLORS + 5; i++) {
      store().addHighlightColor(`#${(i + 1).toString(16).padStart(6, '0')}`);
    }
    expect(store().highlightPalette.length).toBeLessThanOrEqual(MAX_HIGHLIGHT_COLORS);
  });

  it('never lets the palette become empty', () => {
    store().setHighlightPalette(['#f87171']);
    store().removeHighlightColor(0);
    expect(store().highlightPalette).toEqual(['#f87171']);
  });

  it('reset restores the defaults and drops the accent override', () => {
    store().setAccent('#0ea5e9');
    store().removeHighlightColor(0);
    store().resetAppearance();

    expect(store().accent).toBeNull();
    expect(store().highlightPalette).toEqual([...DEFAULT_HIGHLIGHT_PALETTE]);
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });
});
