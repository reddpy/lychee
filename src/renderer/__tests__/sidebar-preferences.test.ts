import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  parseStoredSidebarPreferences,
  serializeSidebarPreferences,
} from '../sidebar-preferences';

describe('sidebar preferences', () => {
  it('uses defaults when storage is missing or malformed', () => {
    expect(parseStoredSidebarPreferences(null)).toEqual({
      open: true,
      width: DEFAULT_SIDEBAR_WIDTH,
    });
    expect(parseStoredSidebarPreferences('{')).toEqual({
      open: true,
      width: DEFAULT_SIDEBAR_WIDTH,
    });
  });

  it('respects the default open fallback', () => {
    expect(parseStoredSidebarPreferences(null, false).open).toBe(false);
    expect(parseStoredSidebarPreferences('{"width":320}', false)).toEqual({
      open: false,
      width: 320,
    });
  });

  it('restores valid open and width values', () => {
    expect(parseStoredSidebarPreferences('{"open":false,"width":336}')).toEqual({
      open: false,
      width: 336,
    });
  });

  it('falls back field-by-field for invalid values', () => {
    expect(parseStoredSidebarPreferences('{"open":"yes","width":"wide"}')).toEqual({
      open: true,
      width: DEFAULT_SIDEBAR_WIDTH,
    });
  });

  it('rounds and clamps widths to safe layout bounds', () => {
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(0)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(10_000)).toBe(MAX_SIDEBAR_WIDTH);
    expect(parseStoredSidebarPreferences('{"open":true,"width":999}').width).toBe(
      MAX_SIDEBAR_WIDTH,
    );
  });

  it('serializes a versioned value suitable for the SQLite settings table', () => {
    expect(JSON.parse(serializeSidebarPreferences({ open: false, width: 340 }))).toEqual({
      version: 1,
      open: false,
      width: 340,
    });
  });
});
