import type { SerializedEditorState } from 'lexical';

// Latest serialized content per docId (used to initialize new duplicate tabs)
const latestStates = new Map<string, SerializedEditorState>();

// Listeners: docId → Map<tabId, callback>
const listeners = new Map<string, Map<string, (state: SerializedEditorState) => void>>();

/** Broadcast a content change from the active editor to all sibling tabs. */
export function broadcastEditorState(
  docId: string,
  sourceTabId: string,
  state: SerializedEditorState,
): void {
  latestStates.set(docId, state);
  const docListeners = listeners.get(docId);
  if (!docListeners) return;
  for (const [tabId, cb] of docListeners) {
    if (tabId !== sourceTabId) cb(state);
  }
}

/** Register a callback to receive content sync for (docId, tabId). Returns an unsubscribe fn. */
export function subscribeEditorSync(
  docId: string,
  tabId: string,
  cb: (state: SerializedEditorState) => void,
): () => void {
  if (!listeners.has(docId)) listeners.set(docId, new Map());
  listeners.get(docId)!.set(tabId, cb);
  return () => {
    const docMap = listeners.get(docId);
    if (!docMap) return;
    docMap.delete(tabId);
    if (docMap.size === 0) listeners.delete(docId);
  };
}

/** Get the latest in-memory state for a doc (for initializing new duplicate tabs). */
export function getLatestEditorState(docId: string): SerializedEditorState | undefined {
  return latestStates.get(docId);
}
