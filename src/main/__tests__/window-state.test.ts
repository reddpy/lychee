/**
 * Tests for main-window geometry persistence (src/main/window-state.ts).
 *
 * Covers malformed/undersized records, on-screen validation against the display
 * layout, and off-screen fallback to centered defaults.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb, closeTestDb, getTestDb } from './helpers';

const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

vi.mock('electron', () => ({
  screen: { getAllDisplays: vi.fn(() => [{ workArea }]) },
}));

vi.mock('../db', () => ({
  getDb: () => getTestDb(),
}));

import { setSetting } from '../repos/settings';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  WINDOW_BOUNDS_SETTING_KEY,
  getInitialWindowGeometry,
  parseStoredWindowBounds,
} from '../window-state';

function store(bounds: Record<string, unknown>): void {
  setSetting(WINDOW_BOUNDS_SETTING_KEY, JSON.stringify({ version: 1, ...bounds }));
}

describe('window state', () => {
  beforeEach(() => {
    createTestDb();
  });

  afterEach(() => {
    closeTestDb();
  });

  it('rejects malformed and undersized records', () => {
    expect(parseStoredWindowBounds(null)).toBeNull();
    expect(parseStoredWindowBounds('{not json')).toBeNull();
    expect(parseStoredWindowBounds(JSON.stringify({ width: 800 }))).toBeNull();
    expect(parseStoredWindowBounds(JSON.stringify({ width: 300, height: 200 }))).toBeNull();
  });

  it('parses a valid record with null position when coordinates are absent', () => {
    expect(parseStoredWindowBounds(JSON.stringify({ width: 1000, height: 700 }))).toEqual({
      width: 1000,
      height: 700,
      x: null,
      y: null,
      maximized: false,
    });
  });

  it('falls back to defaults when nothing is stored', () => {
    expect(getInitialWindowGeometry()).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      maximized: false,
    });
  });

  it('restores size and position for an on-screen window', () => {
    store({ width: 1000, height: 700, x: 100, y: 80, maximized: true });
    expect(getInitialWindowGeometry()).toEqual({
      width: 1000,
      height: 700,
      x: 100,
      y: 80,
      maximized: true,
    });
  });

  it('drops an off-screen position but keeps the size', () => {
    store({ width: 1000, height: 700, x: 5000, y: 5000 });
    expect(getInitialWindowGeometry()).toEqual({
      width: 1000,
      height: 700,
      maximized: false,
    });
  });
});
