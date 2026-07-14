import {
  SIDEBAR_PREFERENCES_SETTING_KEY,
  parseStoredSidebarPreferences,
  serializeSidebarPreferences,
  type SidebarPreferences,
} from './sidebar-preferences';

export type AppConfig = {
  sidebar: SidebarPreferences;
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

    return { sidebar };
  } catch {
    return { sidebar: parseStoredSidebarPreferences(null) };
  }
}
