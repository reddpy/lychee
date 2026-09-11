import { defaultKeybindings } from '@/shared/keybindings';

import { useAppearanceStore } from './appearance-store';
import { DEFAULT_EDITOR_PREFERENCES } from './editor-preferences';
import { useEditorPreferencesStore } from './editor-preferences-store';
import { useGeneralPreferencesStore } from './general-preferences-store';
import { useKeybindingsStore } from './keybindings-store';
import { useThemeStore } from './theme-store';
import { emitPreferencesReset } from './preferences-reset-event';

/**
 * Restore every preference to its ship default. Main owns the persisted SQLite
 * rows and OS integration; the renderer owns the DOM-derived state (theme
 * class, accent CSS vars, layout). Rejects if the main process cannot clear its
 * settings; renderer state is only touched after that succeeds so a failed
 * reset can't leave the UI out of sync with storage.
 */
export async function resetAllSettings(): Promise<void> {
  await window.lychee.invoke('preferences.resetAll', {});

  useThemeStore.getState().setMode('light');
  useAppearanceStore.getState().resetAppearance();
  useKeybindingsStore.getState().applyBindings(defaultKeybindings());
  useGeneralPreferencesStore.getState().resetLocal();
  useEditorPreferencesStore.getState().applyPreferences({ ...DEFAULT_EDITOR_PREFERENCES });
  emitPreferencesReset();
}
