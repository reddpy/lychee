import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GENERAL_PREFERENCES,
  parseStoredGeneralPreferences,
  serializeGeneralPreferences,
} from '../general-preferences';

describe('general preferences', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(parseStoredGeneralPreferences(null)).toEqual(DEFAULT_GENERAL_PREFERENCES);
    expect(parseStoredGeneralPreferences('{not json')).toEqual(
      DEFAULT_GENERAL_PREFERENCES,
    );
    expect(parseStoredGeneralPreferences('"a string"')).toEqual(
      DEFAULT_GENERAL_PREFERENCES,
    );
    expect(parseStoredGeneralPreferences('[1,2]')).toEqual(DEFAULT_GENERAL_PREFERENCES);
  });

  it('parses a valid stored object', () => {
    expect(
      parseStoredGeneralPreferences(
        JSON.stringify({
          version: 1,
          launchAtLogin: true,
          showInTray: true,
          restoreLastSession: false,
        }),
      ),
    ).toEqual({
      launchAtLogin: true,
      showInTray: true,
      restoreLastSession: false,
    });
  });

  it('defaults restoreLastSession to true when absent', () => {
    expect(
      parseStoredGeneralPreferences(JSON.stringify({ launchAtLogin: true }))
        .restoreLastSession,
    ).toBe(true);
  });

  it('falls back per-field when a value has the wrong type', () => {
    expect(
      parseStoredGeneralPreferences(
        JSON.stringify({
          launchAtLogin: 'yes',
          showInTray: 1,
          restoreLastSession: 'nope',
        }),
      ),
    ).toEqual(DEFAULT_GENERAL_PREFERENCES);
  });

  it('round-trips through serialize/parse', () => {
    const preferences = {
      launchAtLogin: true,
      showInTray: false,
      restoreLastSession: false,
    };
    expect(parseStoredGeneralPreferences(serializeGeneralPreferences(preferences))).toEqual(
      preferences,
    );
  });
});
