import { create } from 'zustand';
import type { DocumentRow } from '../shared/documents';
import { useSearchHighlightStore } from './search-highlight-store';

function newTabId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/** A single open tab instance. tabId is unique per instance; docId is the document being shown. */
export type TabEntry = { tabId: string; docId: string };

type DocumentState = {
  documents: DocumentRow[];
  /** Trashed documents (deletedAt set), for trash bin UI. */
  trashedDocuments: DocumentRow[];
  /** ID of the currently selected tab (tabId, not docId). */
  selectedId: string | null;
  /** Ordered list of open tab instances (first = leftmost tab). */
  openTabs: TabEntry[];
  loading: boolean;
  error: string | null;
  /** ID of the most recently created document (used to auto-expand parent when a nested note is added). */
  lastCreatedId: string | null;
};

type DocumentActions = {
  /** If silent is true, does not set loading state (avoids tree flash on restore). */
  loadDocuments: (silent?: boolean) => Promise<void>;
  /** Select a tab by its tabId. */
  selectDocument: (tabId: string | null) => void;
  /** Always open a new tab for docId (appended, not selected — for Cmd+Click / middle-click). */
  openTab: (docId: string) => void;
  /** Normal click: if doc is already open in a tab, just select that tab; else navigate current tab to it. */
  openOrSelectTab: (docId: string) => void;
  /** If doc is already open, select first matching tab; otherwise append a new tab and select it. */
  openOrCreateTab: (docId: string) => void;
  /** Navigate the current tab to docId (replaces content, remounts editor). If no tabs open, opens first tab. */
  navigateCurrentTab: (docId: string) => void;
  closeTab: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  createDocument: (parentId?: string | null) => Promise<void>;
  /** Move document to trash (soft delete). Closes all tabs for this doc. */
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
        // Keep selection only if it still exists AND the tab's doc still exists
        const selectedTab = state.openTabs.find((t) => t.tabId === state.selectedId);
        const selectionValid =
          selectedTab != null && documents.some((d) => d.id === selectedTab.docId);
        return {
          documents,
          loading: false,
          selectedId: selectionValid ? state.selectedId : (state.openTabs[0]?.tabId ?? null),
        };
      });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  selectDocument(tabId) {
    set((state) => {
      if (tabId != null && !state.openTabs.some((t) => t.tabId === tabId)) return state;
      return { selectedId: tabId };
    });
  },

  openTab(docId) {
    const tabId = newTabId();
    set((state) => ({
      openTabs: [...state.openTabs, { tabId, docId }],
    }));
  },

  openOrSelectTab(docId) {
    set((state) => {
      const matches = state.openTabs.filter((t) => t.docId === docId);
      if (matches.length > 0) {
        // Prefer the match closest to the currently active tab
        const activeIndex = state.openTabs.findIndex((t) => t.tabId === state.selectedId);
        const nearest = matches.reduce((best, t) => {
          const tIdx = state.openTabs.indexOf(t);
          const bestIdx = state.openTabs.indexOf(best);
          return Math.abs(tIdx - activeIndex) < Math.abs(bestIdx - activeIndex) ? t : best;
        });
        return { selectedId: nearest.tabId };
      }
      if (state.openTabs.length === 0) {
        const tabId = newTabId();
        return { openTabs: [{ tabId, docId }], selectedId: tabId };
      }
      // Replace current tab at its position (new tabId so editor remounts)
      const activeIndex =
        state.openTabs.findIndex((t) => t.tabId === state.selectedId) >= 0
          ? state.openTabs.findIndex((t) => t.tabId === state.selectedId)
          : 0;
      const tabId = newTabId();
      const nextTabs = [...state.openTabs];
      nextTabs[activeIndex] = { tabId, docId };
      return { openTabs: nextTabs, selectedId: tabId };
    });
  },

  openOrCreateTab(docId) {
    set((state) => {
      const matches = state.openTabs.filter((t) => t.docId === docId);
      if (matches.length > 0) {
        const activeIndex = state.openTabs.findIndex((t) => t.tabId === state.selectedId);
        const nearest = matches.reduce((best, t) => {
          const tIdx = state.openTabs.indexOf(t);
          const bestIdx = state.openTabs.indexOf(best);
          return Math.abs(tIdx - activeIndex) < Math.abs(bestIdx - activeIndex) ? t : best;
        });
        return { selectedId: nearest.tabId };
      }
      const tabId = newTabId();
      return { openTabs: [...state.openTabs, { tabId, docId }], selectedId: tabId };
    });
  },

  navigateCurrentTab(docId) {
    const oldTabId = (() => {
      const state = get();
      if (state.openTabs.length === 0) return null;
      const activeIndex =
        state.openTabs.findIndex((t) => t.tabId === state.selectedId) >= 0
          ? state.openTabs.findIndex((t) => t.tabId === state.selectedId)
          : 0;
      if (state.openTabs[activeIndex]?.docId === docId) return null; // no-op
      return state.openTabs[activeIndex]?.tabId ?? null;
    })();
    set((state) => {
      if (state.openTabs.length === 0) {
        const tabId = newTabId();
        return { openTabs: [{ tabId, docId }], selectedId: tabId };
      }
      const activeIndex =
        state.openTabs.findIndex((t) => t.tabId === state.selectedId) >= 0
          ? state.openTabs.findIndex((t) => t.tabId === state.selectedId)
          : 0;
      // No-op if already showing this doc
      if (state.openTabs[activeIndex]?.docId === docId) return state;
      // Generate new tabId so the editor remounts with fresh state for the new doc
      const tabId = newTabId();
      const nextTabs = [...state.openTabs];
      nextTabs[activeIndex] = { tabId, docId };
      return { openTabs: nextTabs, selectedId: tabId };
    });
    // Clean up search state for the replaced tab.
    if (oldTabId) {
      useSearchHighlightStore.getState().removeTabState(oldTabId);
    }
  },

  closeTab(tabId) {
    set((state) => {
      const idx = state.openTabs.findIndex((t) => t.tabId === tabId);
      if (idx === -1) return state;
      const nextTabs = state.openTabs.filter((_, i) => i !== idx);
      const wasSelected = state.selectedId === tabId;
      let nextSelected = state.selectedId;
      if (wasSelected) {
        // Prefer tab to the right, then left.
        if (nextTabs[idx] !== undefined) {
          nextSelected = nextTabs[idx].tabId;
        } else if (nextTabs[idx - 1] !== undefined) {
          nextSelected = nextTabs[idx - 1].tabId;
        } else {
          nextSelected = nextTabs[0]?.tabId ?? null;
        }
      }
      return { openTabs: nextTabs, selectedId: nextSelected };
    });
    // Clean up per-tab search state to prevent stale accumulation.
    useSearchHighlightStore.getState().removeTabState(tabId);
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
      const tabId = newTabId();
      // Prepend new doc, select it, and open in a tab.
      set((state) => ({
        documents: [doc, ...state.documents],
        selectedId: tabId,
        openTabs: [...state.openTabs, { tabId, docId: doc.id }],
        lastCreatedId: doc.id,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  async trashDocument(id) {
    try {
      set({ error: null });
      // Optimistically close all tabs showing this document before the async IPC call.
      const tabsToClose = get().openTabs.filter((t) => t.docId === id).map((t) => t.tabId);
      for (const tabId of tabsToClose) get().closeTab(tabId);
      const { trashedIds } = await window.lychee.invoke('documents.trash', { id });
      const trashedSet = new Set(trashedIds);
      set((state) => {
        const nextDocs = state.documents.filter((d) => !trashedSet.has(d.id));
        const nextTabs = state.openTabs.filter((t) => !trashedSet.has(t.docId));
        const currentSelectedValid =
          state.selectedId != null && nextTabs.some((t) => t.tabId === state.selectedId);
        const nextSelected = currentSelectedValid
          ? state.selectedId
          : (nextTabs[0]?.tabId ?? null);
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
        const nextTabs = state.openTabs.filter((t) => !deletedSet.has(t.docId));
        const currentSelectedValid =
          state.selectedId != null && nextTabs.some((t) => t.tabId === state.selectedId);
        const nextSelected = currentSelectedValid
          ? state.selectedId
          : (nextTabs[0]?.tabId ?? null);
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

/** Selector: returns the docId of the currently selected tab, or null. */
export function selectActiveDocId(state: DocumentStore): string | null {
  const tab = state.openTabs.find((t) => t.tabId === state.selectedId);
  return tab?.docId ?? null;
}

// Expose store for e2e testing so drag-and-drop helpers can call moveDocument
// (Playwright synthetic DragEvents don't trigger atlaskit's internal state machine)
if (typeof window !== 'undefined') {
  (window as any).__documentStore = useDocumentStore;
}
