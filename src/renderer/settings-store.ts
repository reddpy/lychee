import { create } from 'zustand';

type SettingsState = {
  isSettingsOpen: boolean;
};

type SettingsActions = {
  openSettings: () => void;
  closeSettings: () => void;
};

type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>((set) => ({
  isSettingsOpen: false,
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
}));
