/**
 * Renderer document-store UX flows (src/renderer/document-store.ts).
 *
 * These exercise the store the UI actually drives: creating/opening tabs,
 * optimistic trash, restore/permanent-delete refresh, move reload, and error
 * surfacing. IPC is stubbed so the flows are deterministic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentRow } from '../../shared/documents';

type Router = Record<string, (payload: any) => unknown>;

const invoke = vi.fn();
let routes: Router;

function installLycheeStub() {
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string, payload: any) => {
    const handler = routes[channel];
    if (!handler) throw new Error(`No route for ${channel}`);
    return handler(payload);
  });
  (globalThis as unknown as { window: unknown }).window = {
    lychee: { platform: 'linux', invoke, on: () => () => {} },
  };
}

function doc(partial: Partial<DocumentRow> & { id: string }): DocumentRow {
  return {
    title: '',
    content: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    parentId: null,
    emoji: null,
    deletedAt: null,
    sortOrder: 0,
    metadata: {},
    ...partial,
  };
}

async function loadStore() {
  vi.resetModules();
  return import('../document-store');
}

beforeEach(() => {
  routes = {};
  installLycheeStub();
});

describe('document-store — loading', () => {
  it('populates documents and clears loading', async () => {
    routes['documents.list'] = () => ({ documents: [doc({ id: 'a', title: 'A' })] });
    const { useDocumentStore } = await loadStore();

    await useDocumentStore.getState().loadDocuments();
    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(['a']);
    expect(useDocumentStore.getState().loading).toBe(false);
    expect(useDocumentStore.getState().error).toBeNull();
  });

  it('silent load does not toggle loading (avoids sidebar flash)', async () => {
    routes['documents.list'] = () => ({ documents: [] });
    const { useDocumentStore } = await loadStore();

    await useDocumentStore.getState().loadDocuments(true);
    expect(useDocumentStore.getState().loading).toBe(false);
  });

  it('surfaces a load failure as an error and stops loading', async () => {
    routes['documents.list'] = () => {
      throw new Error('boom');
    };
    const { useDocumentStore } = await loadStore();

    await useDocumentStore.getState().loadDocuments();
    expect(useDocumentStore.getState().error).toBe('boom');
    expect(useDocumentStore.getState().loading).toBe(false);
  });

  it('keeps a selection whose document still exists', async () => {
    routes['documents.list'] = () => ({ documents: [doc({ id: 'a', title: 'A' })] });
    const { useDocumentStore } = await loadStore();

    useDocumentStore.setState({
      openTabs: [{ tabId: 't1', docId: 'a' }],
      selectedId: 't1',
    });
    await useDocumentStore.getState().loadDocuments();
    expect(useDocumentStore.getState().selectedId).toBe('t1');
  });

  it('falls back to the first open tab when nothing is selected', async () => {
    routes['documents.list'] = () => ({ documents: [doc({ id: 'a', title: 'A' })] });
    const { useDocumentStore } = await loadStore();

    useDocumentStore.setState({
      openTabs: [{ tabId: 't1', docId: 'a' }],
      selectedId: null,
    });
    await useDocumentStore.getState().loadDocuments();
    expect(useDocumentStore.getState().selectedId).toBe('t1');
  });
});

describe('document-store — create UX', () => {
  it('prepends the note, opens a selected tab, and maps Untitled to blank', async () => {
    routes['documents.create'] = () => ({ document: doc({ id: 'new', title: 'Untitled' }) });
    const { useDocumentStore, selectActiveDocId } = await loadStore();

    useDocumentStore.setState({ documents: [doc({ id: 'old', title: 'Old' })] });
    await useDocumentStore.getState().createDocument(null);

    const state = useDocumentStore.getState();
    expect(state.documents[0].title).toBe('');
    expect(state.documents[0].id).toBe('new');
    expect(state.openTabs).toHaveLength(1);
    expect(selectActiveDocId(state)).toBe('new');
    expect(state.lastCreatedId).toBe('new');
    expect(invoke).toHaveBeenCalledWith('documents.create', { parentId: null });
  });

  it('keeps the store unchanged and surfaces the error when create fails', async () => {
    routes['documents.create'] = () => {
      throw new Error('Duplicate title');
    };
    const { useDocumentStore } = await loadStore();

    await useDocumentStore.getState().createDocument(null);
    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(useDocumentStore.getState().error).toBe('Duplicate title');
  });
});

describe('document-store — tab UX', () => {
  it('openOrSelectTab reuses an existing tab instead of duplicating', async () => {
    const { useDocumentStore } = await loadStore();
    useDocumentStore.setState({
      documents: [doc({ id: 'a', title: 'A' })],
      openTabs: [{ tabId: 't1', docId: 'a' }],
      selectedId: 't1',
    });

    useDocumentStore.getState().openOrSelectTab('a');
    expect(useDocumentStore.getState().openTabs).toHaveLength(1);
    expect(useDocumentStore.getState().selectedId).toBe('t1');
  });

  it('navigateCurrentTab remounts the tab with a fresh tabId', async () => {
    const { useDocumentStore, selectActiveDocId } = await loadStore();
    useDocumentStore.setState({
      documents: [doc({ id: 'a', title: 'A' }), doc({ id: 'b', title: 'B' })],
      openTabs: [{ tabId: 't1', docId: 'a' }],
      selectedId: 't1',
    });

    useDocumentStore.getState().navigateCurrentTab('b');
    const state = useDocumentStore.getState();
    expect(state.openTabs).toHaveLength(1);
    expect(state.openTabs[0].tabId).not.toBe('t1');
    expect(selectActiveDocId(state)).toBe('b');
  });

  it('closing the active tab selects the neighbour to the right, then left', async () => {
    const { useDocumentStore } = await loadStore();
    useDocumentStore.setState({
      documents: [doc({ id: 'a' }), doc({ id: 'b' }), doc({ id: 'c' })],
      openTabs: [
        { tabId: 'ta', docId: 'a' },
        { tabId: 'tb', docId: 'b' },
        { tabId: 'tc', docId: 'c' },
      ],
      selectedId: 'tb',
    });

    useDocumentStore.getState().closeTab('tb');
    expect(useDocumentStore.getState().selectedId).toBe('tc');
    expect(useDocumentStore.getState().openTabs.map((t) => t.tabId)).toEqual(['ta', 'tc']);
  });

  it('reopenLastClosedTab restores the tab at its original index', async () => {
    const { useDocumentStore } = await loadStore();
    useDocumentStore.setState({
      documents: [doc({ id: 'a' }), doc({ id: 'b' }), doc({ id: 'c' })],
      openTabs: [
        { tabId: 'ta', docId: 'a' },
        { tabId: 'tb', docId: 'b' },
      ],
      selectedId: 'ta',
    });
    useDocumentStore.getState().closeTab('tb');
    expect(useDocumentStore.getState().openTabs).toHaveLength(1);

    useDocumentStore.getState().reopenLastClosedTab();
    const tabs = useDocumentStore.getState().openTabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[1].docId).toBe('b');
  });

  it('reopenLastClosedTab skips entries whose document is gone', async () => {
    const { useDocumentStore } = await loadStore();
    useDocumentStore.setState({
      documents: [doc({ id: 'a' })],
      openTabs: [{ tabId: 'ta', docId: 'a' }],
      selectedId: 'ta',
      recentlyClosed: [{ docId: 'deleted', index: 0 }],
    });

    useDocumentStore.getState().reopenLastClosedTab();
    expect(useDocumentStore.getState().openTabs).toHaveLength(1);
    expect(useDocumentStore.getState().recentlyClosed).toEqual([]);
  });

  it('reorderTabs moves a tab to the requested index', async () => {
    const { useDocumentStore } = await loadStore();
    useDocumentStore.setState({
      openTabs: [
        { tabId: 'ta', docId: 'a' },
        { tabId: 'tb', docId: 'b' },
        { tabId: 'tc', docId: 'c' },
      ],
      selectedId: 'ta',
    });

    useDocumentStore.getState().reorderTabs(0, 2);
    expect(useDocumentStore.getState().openTabs.map((t) => t.tabId)).toEqual(['tb', 'tc', 'ta']);
  });
});

describe('document-store — trash / restore / delete UX', () => {
  it('trash optimistically closes the note\'s tabs and removes its subtree', async () => {
    routes['documents.trash'] = () => ({ trashedIds: ['a', 'child'] });
    const { useDocumentStore } = await loadStore();

    useDocumentStore.setState({
      documents: [doc({ id: 'a' }), doc({ id: 'child', parentId: 'a' }), doc({ id: 'b' })],
      openTabs: [
        { tabId: 'ta', docId: 'a' },
        { tabId: 'tb', docId: 'b' },
      ],
      selectedId: 'ta',
    });

    await useDocumentStore.getState().trashDocument('a');
    const state = useDocumentStore.getState();
    expect(state.documents.map((d) => d.id)).toEqual(['b']);
    expect(state.openTabs.map((t) => t.docId)).toEqual(['b']);
    expect(state.selectedId).toBe('tb');
  });

  it('restore reloads both the document list and the trash list', async () => {
    routes['documents.restore'] = () => ({ document: { id: 'a' }, restoredIds: ['a'] });
    routes['documents.list'] = () => ({ documents: [doc({ id: 'a', title: 'Back' })] });
    routes['documents.listTrashed'] = () => ({ documents: [] });
    const { useDocumentStore } = await loadStore();

    await useDocumentStore.getState().restoreDocument('a');
    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(['a']);
    expect(invoke).toHaveBeenCalledWith('documents.listTrashed', expect.anything());
  });

  it('permanent delete removes the note from trash and closes its tabs', async () => {
    routes['documents.permanentDelete'] = () => ({ deletedIds: ['a'] });
    const { useDocumentStore } = await loadStore();

    useDocumentStore.setState({
      trashedDocuments: [doc({ id: 'a', deletedAt: '2024-01-02T00:00:00.000Z' })],
      openTabs: [{ tabId: 'ta', docId: 'a' }],
      selectedId: 'ta',
    });

    await useDocumentStore.getState().permanentDeleteDocument('a');
    const state = useDocumentStore.getState();
    expect(state.trashedDocuments).toEqual([]);
    expect(state.openTabs).toEqual([]);
    expect(state.selectedId).toBeNull();
  });

  it('move reloads the document list so sibling order refreshes', async () => {
    routes['documents.move'] = () => ({ document: { id: 'a' } });
    routes['documents.list'] = () => ({ documents: [doc({ id: 'a' }), doc({ id: 'b' })] });
    const { useDocumentStore } = await loadStore();

    await useDocumentStore.getState().moveDocument('a', null, 0);
    expect(useDocumentStore.getState().documents).toHaveLength(2);
    expect(useDocumentStore.getState().error).toBeNull();
  });

  it('move reloads the list even when the move is rejected', async () => {
    routes['documents.move'] = () => {
      throw new Error('cycle');
    };
    routes['documents.list'] = () => ({ documents: [doc({ id: 'a' })] });
    const { useDocumentStore } = await loadStore();

    await useDocumentStore.getState().moveDocument('a', 'a', 0);
    expect(useDocumentStore.getState().error).toBe('cycle');
    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(['a']);
  });

  it('updateDocumentInStore merges a patch into the right row', async () => {
    const { useDocumentStore } = await loadStore();
    useDocumentStore.setState({ documents: [doc({ id: 'a', title: 'Old' }), doc({ id: 'b' })] });

    useDocumentStore.getState().updateDocumentInStore('a', { title: 'New', emoji: '📌' });
    expect(useDocumentStore.getState().documents[0]).toMatchObject({ title: 'New', emoji: '📌' });
    expect(useDocumentStore.getState().documents[1].title).toBe('');
  });
});
