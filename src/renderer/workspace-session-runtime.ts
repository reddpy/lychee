import { useDocumentStore } from './document-store';
import { useGeneralPreferencesStore } from './general-preferences-store';
import {
  WORKSPACE_SESSION_SETTING_KEY,
  serializeWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';

// Bridges the pure workspace-session parser with the live document store:
// capture the pending session at boot, restore it once documents are loaded,
// then keep the persisted snapshot in sync as the user opens/closes tabs.

const SAVE_DEBOUNCE_MS = 400;

function newTabId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

let pendingSession: WorkspaceSession | null = null;
let restoreAttempted = false;
let persistenceStarted = false;

export function setPendingWorkspaceSession(session: WorkspaceSession): void {
  pendingSession = session;
}

/**
 * Restore the persisted tabs. Call after `loadDocuments()` so deleted/trashed
 * notes can be filtered out. No-ops when the preference is off, nothing was
 * saved, or tabs are already open.
 */
export function restoreWorkspaceSession(): void {
  if (restoreAttempted) return;
  restoreAttempted = true;

  const session = pendingSession;
  pendingSession = null;
  if (!session || session.tabs.length === 0) return;
  if (!useGeneralPreferencesStore.getState().restoreLastSession) return;

  const { documents, openTabs } = useDocumentStore.getState();
  if (openTabs.length > 0) return;

  const existing = new Set(documents.map((doc) => doc.id));
  const restored = session.tabs.filter((id) => existing.has(id));
  if (restored.length === 0) return;

  const tabs = restored.map((docId) => ({ tabId: newTabId(), docId }));
  const index = Math.min(session.selectedIndex, tabs.length - 1);
  useDocumentStore.setState({ openTabs: tabs, selectedId: tabs[index].tabId });
}

/** Persist tab changes to the settings table. Returns an unsubscribe function. */
export function startWorkspaceSessionPersistence(): () => void {
  if (persistenceStarted) return () => {};
  persistenceStarted = true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = (): void => {
    if (!restoreAttempted) return;
    const { openTabs, selectedId } = useDocumentStore.getState();
    const selectedIndex = openTabs.findIndex((tab) => tab.tabId === selectedId);
    window.lychee
      .invoke('settings.set', {
        key: WORKSPACE_SESSION_SETTING_KEY,
        value: serializeWorkspaceSession({
          tabs: openTabs.map((tab) => tab.docId),
          selectedIndex: selectedIndex < 0 ? 0 : selectedIndex,
        }),
      })
      .catch(() => {
        // Session persistence is best-effort; never surface to the user.
      });
  };

  const unsubscribe = useDocumentStore.subscribe((state, prev) => {
    if (state.openTabs === prev.openTabs && state.selectedId === prev.selectedId) return;
    clearTimeout(timer);
    timer = setTimeout(persist, SAVE_DEBOUNCE_MS);
  });

  return () => {
    clearTimeout(timer);
    unsubscribe();
    persistenceStarted = false;
  };
}
