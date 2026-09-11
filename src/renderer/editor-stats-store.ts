import { create } from 'zustand';

/** Word/character counts for the currently open notes, keyed by document id. */
export type EditorStats = { words: number; characters: number };

type EditorStatsState = {
  byDoc: Record<string, EditorStats>;
  setStats: (documentId: string, stats: EditorStats) => void;
  clearStats: (documentId: string) => void;
};

export const useEditorStatsStore = create<EditorStatsState>((set) => ({
  byDoc: {},

  setStats: (documentId, stats) =>
    set((state) => {
      const current = state.byDoc[documentId];
      if (current && current.words === stats.words && current.characters === stats.characters) {
        return state; // avoid a re-render on every keystroke with no change
      }
      return { byDoc: { ...state.byDoc, [documentId]: stats } };
    }),

  clearStats: (documentId) =>
    set((state) => {
      if (!(documentId in state.byDoc)) return state;
      const next = { ...state.byDoc };
      delete next[documentId];
      return { byDoc: next };
    }),
}));
