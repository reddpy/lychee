import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, closeTestDb, getTestDb } from '../helpers';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));

vi.mock('../../db', () => ({
  getDb: () => getTestDb(),
}));

import { getSetting, setSetting, getAllSettings } from '../../repos/settings';

describe('Settings Repo — Concurrency & Last-Write Contracts', () => {
  beforeEach(() => {
    createTestDb();
  });

  afterEach(() => {
    closeTestDb();
  });

  it('rapid set/get interleaving on one key is deterministic and ends with last write', async () => {
    await Promise.all(
      Array.from({ length: 120 }, (_, i) =>
        Promise.resolve().then(() => {
          setSetting('searchPalettePreviewOpen', i % 2 === 0 ? 'true' : 'false');
          const read = getSetting('searchPalettePreviewOpen');
          expect(read === 'true' || read === 'false').toBe(true);
        }),
      ),
    );

    setSetting('searchPalettePreviewOpen', 'true');
    expect(getSetting('searchPalettePreviewOpen')).toBe('true');
  });

  it('interleaved multi-key upserts keep each key isolated', async () => {
    const keys = ['theme', 'editor.fontSize', 'sidebar.width', 'searchPalettePreviewOpen'];
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        Promise.resolve().then(() => {
          const key = keys[i % keys.length];
          setSetting(key, `${key}-v${i}`);
        }),
      ),
    );

    const all = getAllSettings();
    expect(Object.keys(all)).toEqual(expect.arrayContaining(keys));
    expect(all.theme.startsWith('theme-v')).toBe(true);
    expect(all['editor.fontSize'].startsWith('editor.fontSize-v')).toBe(true);
    expect(all['sidebar.width'].startsWith('sidebar.width-v')).toBe(true);
    expect(all.searchPalettePreviewOpen.startsWith('searchPalettePreviewOpen-v')).toBe(true);
  });

  it('defaults remain available for unset keys despite heavy writes to unrelated keys', () => {
    for (let i = 0; i < 300; i += 1) {
      setSetting(`custom.key.${i}`, `value-${i}`);
    }

    expect(getSetting('theme')).toBe('light');
    expect(getSetting('searchPalettePreviewOpen')).toBe('true');
  });
});
