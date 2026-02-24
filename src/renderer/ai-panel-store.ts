import { create } from 'zustand';

type AIPanelStore = {
  /** Whether AI features are enabled globally */
  aiEnabled: boolean;
  setAIEnabled: (enabled: boolean) => void;
  /** Which documents have the AI panel open */
  openPanels: Record<string, boolean>;
  togglePanel: (docId: string) => void;
  closePanel: (docId: string) => void;
  isPanelOpen: (docId: string) => boolean;
};

export const useAIPanelStore = create<AIPanelStore>((set, get) => ({
  aiEnabled: false, // default off until loaded from settings
  setAIEnabled: (enabled) => set(enabled ? { aiEnabled: true } : { aiEnabled: false, openPanels: {} }),
  openPanels: {},
  togglePanel: (docId) =>
    set((s) => ({
      openPanels: { ...s.openPanels, [docId]: !s.openPanels[docId] },
    })),
  closePanel: (docId) =>
    set((s) => ({
      openPanels: { ...s.openPanels, [docId]: false },
    })),
  isPanelOpen: (docId) => !!get().openPanels[docId],
}));
