import { create } from 'zustand';
import type { DocumentRow } from '../shared/documents';

type DocumentState = {
  documents: DocumentRow[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
};

type DocumentActions = {
  loadDocuments: () => Promise<void>;
  selectDocument: (id: string | null) => void;
  createDocument: (parentId?: string | null) => Promise<void>;
};

type DocumentStore = DocumentState & DocumentActions;

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: [],
  selectedId: null,
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

  async createDocument(parentId = null) {
    try {
      set({ loading: true, error: null });
      const { document } = await window.lychee.invoke('documents.create', {
        parentId,
      });
      // Prepend new doc and select it.
      set((state) => ({
        documents: [document, ...state.documents],
        selectedId: document.id,
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },
}));

