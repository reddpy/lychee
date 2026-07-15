import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const settings = new Map<string, string>();
  return {
    settings,
    locale: 'en-US',
    available: ['en-US', 'en-GB', 'es-ES'],
    setEnabled: vi.fn(),
    setLanguages: vi.fn(),
    send: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: { getLocale: () => mocks.locale },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: mocks.send,
        },
      },
    ],
  },
  session: {
    defaultSession: {
      get availableSpellCheckerLanguages() {
        return mocks.available;
      },
      setSpellCheckerEnabled: mocks.setEnabled,
      setSpellCheckerLanguages: mocks.setLanguages,
    },
  },
}));

vi.mock('../repos/settings', () => ({
  getSetting: (key: string) => mocks.settings.get(key) ?? null,
  setSetting: (key: string, value: string) => mocks.settings.set(key, value),
}));

import {
  applySpellCheckPreferences,
  getSpellCheckState,
  setSpellCheckEnabled,
  setSpellCheckLanguages,
} from '../spellcheck';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  mocks.settings.clear();
  mocks.locale = 'en-US';
  mocks.available = ['en-US', 'en-GB', 'es-ES'];
  vi.clearAllMocks();
  setPlatform('win32');
});

afterEach(() => setPlatform(originalPlatform));

describe('cross-platform spellcheck preferences', () => {
  it('defaults to enabled and resolves the exact OS locale on Windows/Linux', () => {
    mocks.locale = 'en-GB';
    expect(getSpellCheckState()).toEqual({
      enabled: true,
      canChooseLanguages: true,
      languages: ['en-GB'],
      availableLanguages: ['en-GB', 'en-US', 'es-ES'],
    });
  });

  it('falls back to a supported regional variant for the OS language', () => {
    mocks.locale = 'es-MX';
    expect(getSpellCheckState().languages).toEqual(['es-ES']);
  });

  it('keeps multiple stored languages and drops unavailable entries', () => {
    mocks.settings.set('spellCheckLanguages', JSON.stringify(['es-ES', 'xx-XX', 'en-US']));
    expect(getSpellCheckState().languages).toEqual(['es-ES', 'en-US']);
  });

  it('applies enabled state and languages to the Chromium session', () => {
    mocks.settings.set('spellCheckEnabled', 'false');
    mocks.settings.set('spellCheckLanguages', JSON.stringify(['en-US', 'es-ES']));
    applySpellCheckPreferences();
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
    expect(mocks.setLanguages).toHaveBeenCalledWith(['en-US', 'es-ES']);
  });

  it('persists changes and broadcasts one shared state to every window', () => {
    const state = setSpellCheckEnabled(false);
    expect(mocks.settings.get('spellCheckEnabled')).toBe('false');
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
    expect(mocks.send).toHaveBeenCalledWith('spellcheck:state', state);
  });

  it('requires at least one supported spelling language', () => {
    expect(() => setSpellCheckLanguages([])).toThrow(
      'Select at least one supported spelling language',
    );
    expect(() => setSpellCheckLanguages(['xx-XX'])).toThrow(
      'Select at least one supported spelling language',
    );
  });

  it('defers language selection to macOS', () => {
    setPlatform('darwin');
    const state = applySpellCheckPreferences();
    expect(state).toMatchObject({
      canChooseLanguages: false,
      languages: [],
      availableLanguages: [],
    });
    expect(mocks.setLanguages).not.toHaveBeenCalled();
  });
});
