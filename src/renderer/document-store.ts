import { create } from 'zustand';
import type { DocumentRow } from '../shared/documents';

type DocumentState = {
  documents: DocumentRow[];
  /** Trashed documents (deletedAt set), for trash bin UI. */
  trashedDocuments: DocumentRow[];
  selectedId: string | null;
  /** Ordered list of open tab document IDs (first = leftmost tab). */
  openTabs: string[];
  loading: boolean;
  error: string | null;
  /** ID of the most recently created document (used to auto-expand parent when a nested note is added). */
  lastCreatedId: string | null;
};

type DocumentActions = {
  /** If silent is true, does not set loading state (avoids tree flash on restore). */
  loadDocuments: (silent?: boolean) => Promise<void>;
  selectDocument: (id: string | null) => void;
  /** Open a tab for document id; adds to end if not open, and selects it. */
  openTab: (id: string) => void;
  /** Like openTab but for normal click: if doc is already open, just select that tab; else navigate current tab to it (no duplicate). */
  openOrSelectTab: (id: string) => void;
  /** Navigate the current tab to document id (replaces content). If no tabs open, opens first tab. */
  navigateCurrentTab: (id: string) => void;
  closeTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  createDocument: (parentId?: string | null) => Promise<void>;
  /** Move document to trash (soft delete). Removes from list and closes tab. */
  trashDocument: (id: string) => Promise<void>;
  /** Load trashed documents for trash bin UI. */
  loadTrashedDocuments: () => Promise<void>;
  /** Restore a document (and its nested notes) from trash; refreshes documents and trash list. */
  restoreDocument: (id: string) => Promise<void>;
  /** Permanently delete a document and all descendants; removes from trash list and closes tabs. */
  permanentDeleteDocument: (id: string) => Promise<void>;
  /** Merge updated fields for a document (e.g. after save). */
  updateDocumentInStore: (id: string, patch: Partial<DocumentRow>) => void;
  /** Move document to new parent and/or position. */
  moveDocument: (id: string, parentId: string | null, sortOrder: number) => Promise<void>;
};

type DocumentStore = DocumentState & DocumentActions;

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: [],
  trashedDocuments: [],
  selectedId: null,
  openTabs: [],
  loading: false,
  error: null,
  lastCreatedId: null,

  async loadDocuments(silent = false) {
    try {
      if (!silent) set({ loading: true, error: null });
      const { documents } = await window.lychee.invoke('documents.list', {
        limit: 500,
        offset: 0,
      });
      set((state) => {
        // Keep selection only if it still exists AND has an open tab
        const selectionValid =
          state.selectedId &&
          documents.some((d) => d.id === state.selectedId) &&
          state.openTabs.includes(state.selectedId);
        return {
          documents,
          loading: false,
          selectedId: selectionValid ? state.selectedId : (state.openTabs[0] ?? null),
        };
      });
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

  openOrSelectTab(id) {
    set((state) => {
      const exists = state.openTabs.includes(id);
      if (exists) {
        return { selectedId: id };
      }
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
      const doc = document.title === 'Untitled' ? { ...document, title: '' } : document;
      // Prepend new doc, select it, and open in a tab.
      set((state) => ({
        documents: [doc, ...state.documents],
        selectedId: doc.id,
        openTabs: [...state.openTabs, doc.id],
        lastCreatedId: doc.id,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  async trashDocument(id) {
    try {
      set({ error: null });
      const { trashedIds } = await window.lychee.invoke('documents.trash', { id });
      const trashedSet = new Set(trashedIds);
      set((state) => {
        const nextDocs = state.documents.filter((d) => !trashedSet.has(d.id));
        const nextTabs = state.openTabs.filter((t) => !trashedSet.has(t));
        const nextSelected =
          state.selectedId && !trashedSet.has(state.selectedId)
            ? state.selectedId
            : nextTabs[0] ?? null;
        return {
          documents: nextDocs,
          openTabs: nextTabs,
          selectedId: nextSelected,
        };
      });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  async loadTrashedDocuments() {
    try {
      const { documents } = await window.lychee.invoke('documents.listTrashed', {
        limit: 200,
        offset: 0,
      });
      set({ trashedDocuments: documents });
    } catch (err) {
      set({ trashedDocuments: [], error: (err as Error).message });
    }
  },

  async restoreDocument(id) {
    try {
      set({ error: null });
      await window.lychee.invoke('documents.restore', { id });
      await get().loadDocuments(true);
      await get().loadTrashedDocuments();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  async permanentDeleteDocument(id) {
    try {
      set({ error: null });
      const { deletedIds } = await window.lychee.invoke('documents.permanentDelete', { id });
      const deletedSet = new Set(deletedIds);
      set((state) => {
        const nextTrashed = state.trashedDocuments.filter((d) => !deletedSet.has(d.id));
        const nextTabs = state.openTabs.filter((t) => !deletedSet.has(t));
        const nextSelected =
          state.selectedId && !deletedSet.has(state.selectedId)
            ? state.selectedId
            : nextTabs[0] ?? null;
        return {
          trashedDocuments: nextTrashed,
          openTabs: nextTabs,
          selectedId: nextSelected,
        };
      });
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

  async moveDocument(id, parentId, sortOrder) {
    try {
      set({ error: null });
      await window.lychee.invoke('documents.move', { id, parentId, sortOrder });
      // Reload documents to get the updated sort order for all affected items
      await get().loadDocuments(true);
    } catch (err) {
      set({ error: (err as Error).message });
      // Reload on error to ensure consistent state
      await get().loadDocuments(true);
    }
  },
}));

