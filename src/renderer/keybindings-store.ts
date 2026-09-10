import { create } from 'zustand';

import {
  defaultKeybindings,
  type KeybindingMap,
  type ShortcutId,
} from '@/shared/keybindings';

type KeybindingsState = {
  bindings: KeybindingMap;
  loaded: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  setBinding: (id: ShortcutId, binding: string) => Promise<void>;
  resetBinding: (id: ShortcutId) => Promise<void>;
  resetAll: () => Promise<void>;
  applyBindings: (bindings: KeybindingMap) => void;
};

export const useKeybindingsStore = create<KeybindingsState>((set) => ({
  bindings: defaultKeybindings(),
  loaded: false,
  error: null,
  initialize: async () => {
    try {
      const { bindings } = await window.lychee.invoke('keybindings.getAll', {});
      set({ bindings, loaded: true, error: null });
    } catch (error) {
      set({ loaded: true, error: error instanceof Error ? error.message : 'Unable to load shortcuts' });
    }
  },
  setBinding: async (id, binding) => {
    try {
      const response = await window.lychee.invoke('keybindings.set', { id, binding });
      set({ bindings: response.bindings, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to save shortcut' });
      throw error;
    }
  },
  resetBinding: async (id) => {
    try {
      const response = await window.lychee.invoke('keybindings.reset', { id });
      set({ bindings: response.bindings, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to reset shortcut' });
      throw error;
    }
  },
  resetAll: async () => {
    try {
      const response = await window.lychee.invoke('keybindings.resetAll', {});
      set({ bindings: response.bindings, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unable to reset shortcuts' });
      throw error;
    }
  },
  applyBindings: (bindings) => set({ bindings, loaded: true, error: null }),
}));

export function bindingFor(id: ShortcutId): string {
  return useKeybindingsStore.getState().bindings[id];
}
