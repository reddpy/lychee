import { create } from 'zustand';
import type { DocumentRow } from '../shared/documents';

type DocumentState = {
  documents: DocumentRow[];
  selectedId: string | null;
  /** Ordered list of open tab document IDs (first = leftmost tab). */
  openTabs: string[];
  loading: boolean;
  error: string | null;
};

type DocumentActions = {
  loadDocuments: () => Promise<void>;
  selectDocument: (id: string | null) => void;
  /** Open a tab for document id; adds to end if not open, and selects it. */
  openTab: (id: string) => void;
  /** Navigate the current tab to document id (replaces content). If no tabs open, opens first tab. */
  navigateCurrentTab: (id: string) => void;
  closeTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  createDocument: (parentId?: string | null) => Promise<void>;
  /** Merge updated fields for a document (e.g. after save). */
  updateDocumentInStore: (id: string, patch: Partial<DocumentRow>) => void;
};

type DocumentStore = DocumentState & DocumentActions;

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: [],
  selectedId: null,
  openTabs: [],
  loading: false,
  error: null,

  async loadDocuments() {
    try {
      set({ loading: true, error: null });
      const { documents } = await window.lychee.invoke('documents.list', {
        limit: 500,
        offset: 0,
      });
      set((state) => ({
        documents,
        loading: false,
        // Keep selection if it still exists.
        selectedId:
          state.selectedId && documents.some((d) => d.id === state.selectedId)
            ? state.selectedId
            : documents[0]?.id ?? null,
      }));
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  selectDocument(id) {
    set({ selectedId: id });
  },

  openTab(id) {
    set((state) => {
      const exists = state.openTabs.includes(id);
      const nextTabs = exists ? [...state.openTabs] : [...state.openTabs, id];
      return { openTabs: nextTabs, selectedId: id };
    });
  },

  navigateCurrentTab(id) {
    set((state) => {
      if (state.openTabs.length === 0) {
        return { openTabs: [id], selectedId: id };
      }
      const activeIndex =
        state.openTabs.indexOf(state.selectedId ?? '') >= 0
          ? state.openTabs.indexOf(state.selectedId!)
          : 0;
      const nextTabs = [...state.openTabs];
      nextTabs[activeIndex] = id;
      return { openTabs: nextTabs, selectedId: id };
    });
  },

  closeTab(id) {
    set((state) => {
      const idx = state.openTabs.indexOf(id);
      if (idx === -1) return state;
      const nextTabs = state.openTabs.filter((_t, i) => i !== idx);
      const wasSelected = state.selectedId === id;
      let nextSelected = state.selectedId;
      if (wasSelected) {
        // Prefer tab to the right, then left.
        if (nextTabs[idx] !== undefined) {
          nextSelected = nextTabs[idx];
        } else if (nextTabs[idx - 1] !== undefined) {
          nextSelected = nextTabs[idx - 1];
        } else {
          nextSelected = nextTabs[0] ?? null;
        }
      }
      return { openTabs: nextTabs, selectedId: nextSelected };
    });
  },

  reorderTabs(fromIndex, toIndex) {
    set((state) => {
      if (fromIndex < 0 || fromIndex >= state.openTabs.length) return state;
      if (toIndex < 0 || toIndex >= state.openTabs.length) return state;
      const next = [...state.openTabs];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return { openTabs: next };
    });
  },

  async createDocument(parentId = null) {
    try {
      set({ error: null });
      const { document } = await window.lychee.invoke('documents.create', {
        parentId,
      });
      // Prepend new doc, select it, and open in a tab.
      set((state) => ({
        documents: [document, ...state.documents],
        selectedId: document.id,
        openTabs: [...state.openTabs, document.id],
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  updateDocumentInStore(id, patch) {
    set((state) => ({
      documents: state.documents.map((d) =>
        d.id === id ? { ...d, ...patch } : d,
      ),
    }));
  },
}));

