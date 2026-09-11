import {
  SIDEBAR_PREFERENCES_SETTING_KEY,
  parseStoredSidebarPreferences,
  serializeSidebarPreferences,
  type SidebarPreferences,
} from './sidebar-preferences';
import {
  APPEARANCE_SETTING_KEY,
  type AppearancePreferences,
  parseStoredAppearance,
  serializeAppearance,
} from './appearance-preferences';

export type AppConfig = {
  sidebar: SidebarPreferences;
  appearance: AppearancePreferences;
};

/**
 * Load renderer configuration in one SQLite-backed IPC round trip. New startup
 * settings can be added here without adding one request per preference.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  try {
    const { settings } = await window.lychee.invoke('settings.getAll', {});
    const rawSidebar = settings[SIDEBAR_PREFERENCES_SETTING_KEY] ?? null;
    const sidebar = parseStoredSidebarPreferences(rawSidebar);
    const normalizedSidebar = serializeSidebarPreferences(sidebar);

    // Keep SQLite canonical as well as renderer state. This repairs malformed,
    // incomplete, legacy, and out-of-range metadata during startup.
    if (rawSidebar !== normalizedSidebar) {
      await window.lychee
        .invoke('settings.set', {
          key: SIDEBAR_PREFERENCES_SETTING_KEY,
          value: normalizedSidebar,
        })
        .catch(() => {
          // A failed repair should not prevent the app from opening safely.
        });
    }

    const rawAppearance = settings[APPEARANCE_SETTING_KEY] ?? null;
    const appearance = parseStoredAppearance(
      typeof rawAppearance === 'string' ? rawAppearance : null,
    );
    const normalizedAppearance = serializeAppearance(appearance);

    // Only rewrite when a stored value was present but malformed/out-of-range;
    // a missing key is already represented by the defaults.
    if (typeof rawAppearance === 'string' && rawAppearance !== normalizedAppearance) {
      await window.lychee
        .invoke('settings.set', {
          key: APPEARANCE_SETTING_KEY,
          value: normalizedAppearance,
        })
        .catch(() => {
          // A failed repair should not prevent the app from opening safely.
        });
    }

    return { sidebar, appearance };
  } catch {
    return {
      sidebar: parseStoredSidebarPreferences(null),
      appearance: parseStoredAppearance(null),
    };
  }
}
