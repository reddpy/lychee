import { create } from 'zustand';

import {
  DEFAULT_GENERAL_PREFERENCES,
  type GeneralPreferences,
} from '@/shared/general-preferences';

type GeneralPreferencesState = GeneralPreferences & {
  loaded: boolean;
  error: string | null;
};

type GeneralPreferencesActions = {
  setLaunchAtLogin: (enabled: boolean) => Promise<void>;
  setShowInTray: (enabled: boolean) => Promise<void>;
  setRestoreLastSession: (enabled: boolean) => Promise<void>;
  /** Seed state from a persisted snapshot without writing back. */
  applyPreferences: (preferences: GeneralPreferences) => void;
  /** Drop optimistic state without touching the backend (reset flow). */
  resetLocal: () => void;
};

type GeneralPreferencesStore = GeneralPreferencesState & GeneralPreferencesActions;

export const useGeneralPreferencesStore = create<GeneralPreferencesStore>((set, get) => {
  const commit = async (patch: Partial<GeneralPreferences>): Promise<void> => {
    const previous = get();
    set(patch);
    try {
      const preferences = await window.lychee.invoke('preferences.setGeneral', patch);
      set({ ...preferences, loaded: true, error: null });
    } catch (error) {
      set({
        launchAtLogin: previous.launchAtLogin,
        showInTray: previous.showInTray,
        restoreLastSession: previous.restoreLastSession,
        error: error instanceof Error ? error.message : 'Unable to save preference',
      });
      throw error;
    }
  };

  return {
    ...DEFAULT_GENERAL_PREFERENCES,
    loaded: false,
    error: null,

    setLaunchAtLogin: (enabled) => commit({ launchAtLogin: enabled }),
    setShowInTray: (enabled) => commit({ showInTray: enabled }),
    setRestoreLastSession: (enabled) => commit({ restoreLastSession: enabled }),

    applyPreferences: (preferences) =>
      set({
        launchAtLogin: preferences.launchAtLogin,
        showInTray: preferences.showInTray,
        restoreLastSession: preferences.restoreLastSession,
        loaded: true,
        error: null,
      }),

    resetLocal: () => set({ ...DEFAULT_GENERAL_PREFERENCES, loaded: true, error: null }),
  };
});

export function hydrateGeneralPreferences(preferences: GeneralPreferences): void {
  useGeneralPreferencesStore.getState().applyPreferences(preferences);
}
