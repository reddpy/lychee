// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAppConfig } from '../app-config';
import { SIDEBAR_PREFERENCES_SETTING_KEY } from '../sidebar-preferences';
import {
  APPEARANCE_SETTING_KEY,
  DEFAULT_HIGHLIGHT_PALETTE,
  type AppearancePreferences,
} from '../appearance-preferences';

const invoke = vi.fn();

const DEFAULT_SIDEBAR = { open: true, width: 288 };
const DEFAULT_APPEARANCE: AppearancePreferences = {
  accent: null,
  highlightPalette: [...DEFAULT_HIGHLIGHT_PALETTE],
};

beforeEach(() => {
  invoke.mockReset();
  window.lychee = { invoke } as unknown as Window['lychee'];
});

describe('loadAppConfig', () => {
  it('loads sidebar metadata from the SQLite-backed settings snapshot', async () => {
    invoke.mockResolvedValue({
      settings: {
        [SIDEBAR_PREFERENCES_SETTING_KEY]: JSON.stringify({
          version: 1,
          open: false,
          width: 352,
        }),
      },
    });

    await expect(loadAppConfig()).resolves.toEqual({
      sidebar: { open: false, width: 352 },
      appearance: DEFAULT_APPEARANCE,
    });
    expect(invoke).toHaveBeenCalledWith('settings.getAll', {});
  });

  it('loads appearance preferences from the settings snapshot', async () => {
    invoke.mockResolvedValue({
      settings: {
        [SIDEBAR_PREFERENCES_SETTING_KEY]: JSON.stringify({
          version: 1,
          open: true,
          width: 288,
        }),
        [APPEARANCE_SETTING_KEY]: JSON.stringify({
          version: 1,
          accent: '#0ea5e9',
          highlightPalette: ['#facc15', '#4ade80'],
        }),
      },
    });

    await expect(loadAppConfig()).resolves.toEqual({
      sidebar: DEFAULT_SIDEBAR,
      appearance: { accent: '#0ea5e9', highlightPalette: ['#facc15', '#4ade80'] },
    });
  });

  it('uses safe defaults if configuration cannot be loaded', async () => {
    invoke.mockRejectedValue(new Error('database unavailable'));

    await expect(loadAppConfig()).resolves.toEqual({
      sidebar: DEFAULT_SIDEBAR,
      appearance: DEFAULT_APPEARANCE,
    });
  });

  it('repairs malformed sidebar metadata in the SQLite settings store', async () => {
    invoke
      .mockResolvedValueOnce({
        settings: { [SIDEBAR_PREFERENCES_SETTING_KEY]: '{not valid json' },
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(loadAppConfig()).resolves.toEqual({
      sidebar: DEFAULT_SIDEBAR,
      appearance: DEFAULT_APPEARANCE,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'settings.set', {
      key: SIDEBAR_PREFERENCES_SETTING_KEY,
      value: JSON.stringify({ version: 1, open: true, width: 288 }),
    });
  });

  it('writes clamped sidebar metadata back to SQLite', async () => {
    invoke
      .mockResolvedValueOnce({
        settings: {
          [SIDEBAR_PREFERENCES_SETTING_KEY]: JSON.stringify({
            version: 1,
            open: false,
            width: 99_999,
          }),
        },
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(loadAppConfig()).resolves.toEqual({
      sidebar: { open: false, width: 480 },
      appearance: DEFAULT_APPEARANCE,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'settings.set', {
      key: SIDEBAR_PREFERENCES_SETTING_KEY,
      value: JSON.stringify({ version: 1, open: false, width: 480 }),
    });
  });

  it('repairs malformed appearance metadata in SQLite', async () => {
    invoke
      .mockResolvedValueOnce({
        settings: {
          [SIDEBAR_PREFERENCES_SETTING_KEY]: JSON.stringify({
            version: 1,
            open: true,
            width: 288,
          }),
          [APPEARANCE_SETTING_KEY]: JSON.stringify({
            version: 1,
            accent: 'not-a-color',
            highlightPalette: ['#zzzzzz', '#4ade80'],
          }),
        },
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(loadAppConfig()).resolves.toEqual({
      sidebar: DEFAULT_SIDEBAR,
      appearance: { accent: null, highlightPalette: ['#4ade80'] },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'settings.set', {
      key: APPEARANCE_SETTING_KEY,
      value: JSON.stringify({
        version: 1,
        accent: null,
        highlightPalette: ['#4ade80'],
      }),
    });
  });
});
