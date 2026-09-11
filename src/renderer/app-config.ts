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
import {
  GENERAL_PREFERENCES_SETTING_KEY,
  type GeneralPreferences,
  parseStoredGeneralPreferences,
  serializeGeneralPreferences,
} from '@/shared/general-preferences';
import {
  WORKSPACE_SESSION_SETTING_KEY,
  DEFAULT_WORKSPACE_SESSION,
  parseStoredWorkspaceSession,
  serializeWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';
import {
  EDITOR_PREFERENCES_SETTING_KEY,
  type EditorPreferences,
  parseStoredEditorPreferences,
  serializeEditorPreferences,
} from './editor-preferences';

export type AppConfig = {
  sidebar: SidebarPreferences;
  appearance: AppearancePreferences;
  general: GeneralPreferences;
  editor: EditorPreferences;
  session: WorkspaceSession;
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

    const rawGeneral = settings[GENERAL_PREFERENCES_SETTING_KEY] ?? null;
    const general = parseStoredGeneralPreferences(
      typeof rawGeneral === 'string' ? rawGeneral : null,
    );
    const normalizedGeneral = serializeGeneralPreferences(general);

    // Only rewrite when a stored value was present but malformed; a missing key
    // is already represented by the defaults.
    if (typeof rawGeneral === 'string' && rawGeneral !== normalizedGeneral) {
      await window.lychee
        .invoke('settings.set', {
          key: GENERAL_PREFERENCES_SETTING_KEY,
          value: normalizedGeneral,
        })
        .catch(() => {
          // A failed repair should not prevent the app from opening safely.
        });
    }

    const rawSession = settings[WORKSPACE_SESSION_SETTING_KEY] ?? null;
    const session = parseStoredWorkspaceSession(
      typeof rawSession === 'string' ? rawSession : null,
    );

    const rawEditor = settings[EDITOR_PREFERENCES_SETTING_KEY] ?? null;
    const editor = parseStoredEditorPreferences(
      typeof rawEditor === 'string' ? rawEditor : null,
    );
    const normalizedEditor = serializeEditorPreferences(editor);
    if (typeof rawEditor === 'string' && rawEditor !== normalizedEditor) {
      await window.lychee
        .invoke('settings.set', {
          key: EDITOR_PREFERENCES_SETTING_KEY,
          value: normalizedEditor,
        })
        .catch(() => {
          // A failed repair should not prevent the app from opening safely.
        });
    }

    return { sidebar, appearance, general, editor, session };
  } catch {
    return {
      sidebar: parseStoredSidebarPreferences(null),
      appearance: parseStoredAppearance(null),
      general: parseStoredGeneralPreferences(null),
      editor: parseStoredEditorPreferences(null),
      session: DEFAULT_WORKSPACE_SESSION,
    };
  }
}
