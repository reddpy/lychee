// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentRow } from '../../shared/documents';

const invoke = vi.fn();

function doc(id: string, overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id,
    title: id,
    content: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    parentId: null,
    emoji: null,
    deletedAt: null,
    sortOrder: 0,
    metadata: {},
    ...overrides,
  };
}

// Module-level state (pending session / restore-once flag / persistence guard)
// means each test needs a fresh module graph.
async function loadRuntime() {
  vi.resetModules();
  const runtime = await import('../workspace-session-runtime');
  const { useDocumentStore } = await import('../document-store');
  const { useGeneralPreferencesStore } = await import('../general-preferences-store');
  return { runtime, useDocumentStore, useGeneralPreferencesStore };
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ ok: true });
  window.lychee = {
    invoke,
    platform: 'linux',
    on: () => () => {},
  } as unknown as Window['lychee'];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('workspace session runtime — restore', () => {
  it('reopens saved tabs, drops missing docs, and clamps the selected index', async () => {
    const { runtime, useDocumentStore, useGeneralPreferencesStore } = await loadRuntime();
    useDocumentStore.setState({
      documents: [doc('a'), doc('b')],
      openTabs: [],
      selectedId: null,
    });
    useGeneralPreferencesStore.setState({ restoreLastSession: true });

    runtime.setPendingWorkspaceSession({
      tabs: ['a', 'missing', 'b'],
      selectedIndex: 2,
    });
    runtime.restoreWorkspaceSession();

    const state = useDocumentStore.getState();
    expect(state.openTabs.map((tab) => tab.docId)).toEqual(['a', 'b']);
    expect(state.openTabs.findIndex((tab) => tab.tabId === state.selectedId)).toBe(1);
  });

  it('does nothing when the preference is disabled', async () => {
    const { runtime, useDocumentStore, useGeneralPreferencesStore } = await loadRuntime();
    useDocumentStore.setState({ documents: [doc('a')], openTabs: [], selectedId: null });
    useGeneralPreferencesStore.setState({ restoreLastSession: false });

    runtime.setPendingWorkspaceSession({ tabs: ['a'], selectedIndex: 0 });
    runtime.restoreWorkspaceSession();

    expect(useDocumentStore.getState().openTabs).toEqual([]);
  });

  it('does not clobber tabs that are already open', async () => {
    const { runtime, useDocumentStore, useGeneralPreferencesStore } = await loadRuntime();
    const existing = { tabId: 't0', docId: 'a' };
    useDocumentStore.setState({
      documents: [doc('a')],
      openTabs: [existing],
      selectedId: 't0',
    });
    useGeneralPreferencesStore.setState({ restoreLastSession: true });

    runtime.setPendingWorkspaceSession({ tabs: ['a'], selectedIndex: 0 });
    runtime.restoreWorkspaceSession();

    expect(useDocumentStore.getState().openTabs).toEqual([existing]);
    expect(useDocumentStore.getState().selectedId).toBe('t0');
  });

  it('only restores once per session', async () => {
    const { runtime, useDocumentStore, useGeneralPreferencesStore } = await loadRuntime();
    useDocumentStore.setState({
      documents: [doc('a'), doc('b')],
      openTabs: [],
      selectedId: null,
    });
    useGeneralPreferencesStore.setState({ restoreLastSession: true });

    runtime.setPendingWorkspaceSession({ tabs: ['a'], selectedIndex: 0 });
    runtime.restoreWorkspaceSession();
    runtime.setPendingWorkspaceSession({ tabs: ['b'], selectedIndex: 0 });
    runtime.restoreWorkspaceSession();

    expect(useDocumentStore.getState().openTabs.map((tab) => tab.docId)).toEqual(['a']);
  });
});

describe('workspace session runtime — persistence', () => {
  it('writes the open tabs to settings after a change', async () => {
    vi.useFakeTimers();
    const { runtime, useDocumentStore, useGeneralPreferencesStore } = await loadRuntime();
    useDocumentStore.setState({ documents: [doc('a')], openTabs: [], selectedId: null });
    useGeneralPreferencesStore.setState({ restoreLastSession: true });

    runtime.setPendingWorkspaceSession({ tabs: [], selectedIndex: 0 });
    runtime.restoreWorkspaceSession();
    const stop = runtime.startWorkspaceSessionPersistence();

    useDocumentStore.setState({
      openTabs: [{ tabId: 't1', docId: 'a' }],
      selectedId: 't1',
    });
    vi.advanceTimersByTime(500);

    const call = invoke.mock.calls.find(([channel]) => channel === 'settings.set');
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].value)).toEqual({
      version: 1,
      tabs: ['a'],
      selectedIndex: 0,
    });
    stop();
  });

  it('does not persist before the initial restore has run', async () => {
    vi.useFakeTimers();
    const { runtime, useDocumentStore } = await loadRuntime();
    const stop = runtime.startWorkspaceSessionPersistence();

    useDocumentStore.setState({
      openTabs: [{ tabId: 't1', docId: 'a' }],
      selectedId: 't1',
    });
    vi.advanceTimersByTime(500);

    expect(invoke).not.toHaveBeenCalled();
    stop();
  });
});
