/**
 * General app preferences (Settings → General).
 *
 * Kept as pure functions (no Electron/DOM) so the renderer store, the settings
 * UI, and the main process startup path can all share one parser. Values are
 * persisted as JSON in the SQLite `settings` table under one key so a reset is
 * a single row delete.
 */

export const GENERAL_PREFERENCES_SETTING_KEY = 'ui.general';

export type GeneralPreferences = {
  /** Register Lychee to start when the user signs in. */
  launchAtLogin: boolean;
  /** Show a menu bar (macOS) / system tray (Win/Linux) icon. */
  showInTray: boolean;
  /** Reopen the tabs that were open when the app last quit. */
  restoreLastSession: boolean;
};

export const DEFAULT_GENERAL_PREFERENCES: GeneralPreferences = {
  launchAtLogin: false,
  showInTray: false,
  restoreLastSession: true,
};

/** Parse persisted general preferences, discarding anything malformed. */
export function parseStoredGeneralPreferences(raw: string | null): GeneralPreferences {
  const fallback: GeneralPreferences = { ...DEFAULT_GENERAL_PREFERENCES };
  if (!raw) return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;

    const value = parsed as Record<string, unknown>;
    return {
      launchAtLogin:
        typeof value.launchAtLogin === 'boolean'
          ? value.launchAtLogin
          : fallback.launchAtLogin,
      showInTray:
        typeof value.showInTray === 'boolean' ? value.showInTray : fallback.showInTray,
      restoreLastSession:
        typeof value.restoreLastSession === 'boolean'
          ? value.restoreLastSession
          : fallback.restoreLastSession,
    };
  } catch {
    return fallback;
  }
}

export function serializeGeneralPreferences(preferences: GeneralPreferences): string {
  return JSON.stringify({
    version: 1,
    launchAtLogin: preferences.launchAtLogin,
    showInTray: preferences.showInTray,
    restoreLastSession: preferences.restoreLastSession,
  });
}
