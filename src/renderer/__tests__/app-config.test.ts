// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAppConfig } from '../app-config';
import { SIDEBAR_PREFERENCES_SETTING_KEY } from '../sidebar-preferences';

const invoke = vi.fn();

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
    });
    expect(invoke).toHaveBeenCalledWith('settings.getAll', {});
  });

  it('uses safe defaults if configuration cannot be loaded', async () => {
    invoke.mockRejectedValue(new Error('database unavailable'));

    await expect(loadAppConfig()).resolves.toEqual({
      sidebar: { open: true, width: 288 },
    });
  });

  it('repairs malformed sidebar metadata in the SQLite settings store', async () => {
    invoke
      .mockResolvedValueOnce({
        settings: { [SIDEBAR_PREFERENCES_SETTING_KEY]: '{not valid json' },
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(loadAppConfig()).resolves.toEqual({
      sidebar: { open: true, width: 288 },
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
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'settings.set', {
      key: SIDEBAR_PREFERENCES_SETTING_KEY,
      value: JSON.stringify({ version: 1, open: false, width: 480 }),
    });
  });
});
