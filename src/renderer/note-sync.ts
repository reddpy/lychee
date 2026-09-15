import type { LexicalEditor } from "lexical";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { syncCursorPositions } from "@lexical/yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  applyRemoteUpdate,
  bindEditorToDoc,
  bootstrapFromMarkdown,
  clearEditor,
  createNoteDoc,
  flushEditor,
  projectDocMarkdown,
  REMOTE_ORIGIN,
} from "@/sync/note-doc";
import { connectDoc, type SyncAdapter } from "@/sync/memory-hub";

/**
 * Renderer-owned per-note Y.Docs, persisted locally in SQLite.
 *
 * The live editor is bound to a Y.Doc so local edits flow into the CRDT and peer
 * edits flow back live. The markdown file stays the durable projection (autosave
 * writes it), and the Y.Doc snapshot + append-only update log preserves CRDT
 * lineage across restarts so offline edits merge instead of duplicating.
 *
 * Transport is the {@link SyncAdapter} seam. Locally a `BroadcastChannel`
 * connects same-origin windows; a separate MCP process will use the socket
 * adapter behind the same interface.
 */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Renderer side of the cross-process bridge: updates are relayed through the
 * main process to/from local socket peers (the MCP server, sync helpers).
 */
class IpcBridgeAdapter implements SyncAdapter {
  private readonly listeners = new Map<
    string,
    { onUpdate: (update: Uint8Array) => void; onPeerJoined?: () => void }
  >();
  private readonly awarenessListeners = new Map<string, Set<(update: Uint8Array) => void>>();
  private readonly offUpdate: () => void;
  private readonly offAwareness: () => void;
  private readonly offPeer: () => void;

  constructor() {
    this.offUpdate = window.lychee.on("bridge:update", ({ docId, update }) => {
      this.listeners.get(docId)?.onUpdate(base64ToBytes(update));
    });
    this.offAwareness = window.lychee.on("bridge:awareness", ({ docId, update }) => {
      for (const cb of this.awarenessListeners.get(docId) ?? []) cb(base64ToBytes(update));
    });
    this.offPeer = window.lychee.on("bridge:peer-joined", ({ docId }) => {
      this.listeners.get(docId)?.onPeerJoined?.();
    });
  }

  subscribe(
    docId: string,
    onUpdate: (update: Uint8Array) => void,
    onPeerJoined?: () => void,
  ): () => void {
    this.listeners.set(docId, { onUpdate, onPeerJoined });
    return () => {
      this.listeners.delete(docId);
    };
  }

  publish(docId: string, update: Uint8Array): void {
    void window.lychee
      .invoke("bridge.publish", { docId, update: bytesToBase64(update) })
      .catch(() => {});
  }

  subscribeAwareness(docId: string, onAwareness: (update: Uint8Array) => void): () => void {
    const set = this.awarenessListeners.get(docId) ?? new Set();
    set.add(onAwareness);
    this.awarenessListeners.set(docId, set);
    return () => {
      set.delete(onAwareness);
    };
  }

  publishAwareness(docId: string, update: Uint8Array): void {
    void window.lychee
      .invoke("bridge.publishAwareness", { docId, update: bytesToBase64(update) })
      .catch(() => {});
  }
}

let adapter: IpcBridgeAdapter | null = null;
function getAdapter(): IpcBridgeAdapter {
  if (!adapter) adapter = new IpcBridgeAdapter();
  return adapter;
}

interface BoundNote {
  doc: Y.Doc;
  editor: LexicalEditor;
  undoManager: Y.UndoManager;
  awareness: Awareness;
  setCursorsContainer(el: HTMLElement | null): void;
  ready: boolean;
  dispose(): void;
}

const bound = new Map<string, BoundNote>();

/**
 * Bind the live editor to its note's Y.Doc and persist CRDT updates.
 *
 * Load: persisted snapshot + update log is the base (CRDT wins) so lineage
 * survives restarts; if the markdown file diverged externally, the file wins
 * (re-bootstrap) per "files are the durable projection". With no persisted
 * state, the doc is bootstrapped from the stored markdown.
 */
export function bindLiveNote(args: {
  documentId: string;
  editor: LexicalEditor;
  markdown: string;
}): void {
  unbindLiveNote(args.documentId);

  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  // Local presence. (A real user profile / display name arrives with accounts.)
  awareness.setLocalState({
    name: "You",
    color: "#0ea5e9",
    focusing: false,
  });

  const { binding, undoManager, provider, dispose: disposeBinding } = bindEditorToDoc({
    id: args.documentId,
    editor: args.editor,
    doc,
    awareness,
  });

  const pending: Uint8Array[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    for (const update of pending.splice(0)) {
      void window.lychee
        .invoke("crdt.append", { id: args.documentId, update: bytesToBase64(update) })
        .catch(() => {});
    }
  };
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_ORIGIN) return;
    // Include peer-applied content in our local log too.
    pending.push(update);
    if (!flushTimer) flushTimer = setTimeout(flush, 300);
  };
  doc.on("update", onUpdate);

  // ── Presence / awareness ──────────────────────────────────────────
  const adapter = getAdapter();
  const REMOTE_AWARENESS = "lychee-remote-awareness";
  const publishLocalAwareness = (): void => {
    try {
      adapter.publishAwareness(
        args.documentId,
        encodeAwarenessUpdate(awareness, [awareness.clientID]),
      );
    } catch {
      // best-effort
    }
  };
  const onAwarenessUpdate = (_changes: unknown, origin: unknown): void => {
    if (origin === REMOTE_AWARENESS) return;
    publishLocalAwareness();
  };
  awareness.on("update", onAwarenessUpdate);
  const offAwareness = adapter.subscribeAwareness(args.documentId, (update) => {
    applyAwarenessUpdate(awareness, update, REMOTE_AWARENESS);
  });
  const onAwarenessChange = (): void => {
    syncCursorPositions(binding, provider as never);
  };
  awareness.on("change", onAwarenessChange);
  // Periodic heartbeat so peers joining later (and stale-state expiry) converge.
  const awarenessHeartbeat = setInterval(publishLocalAwareness, 5000);

  let disconnect: (() => void) | null = null;
  let disposed = false;

  const entry: BoundNote = {
    doc,
    editor: args.editor,
    undoManager,
    awareness,
    setCursorsContainer(el) {
      binding.cursorsContainer = el;
      syncCursorPositions(binding, provider as never);
    },
    ready: false,
    dispose() {
      disposed = true;
      flush();
      clearInterval(awarenessHeartbeat);
      awareness.off("update", onAwarenessUpdate);
      awareness.off("change", onAwarenessChange);
      offAwareness();
      doc.off("update", onUpdate);
      disposeBinding();
      disconnect?.();
      try {
        const snapshot = Y.encodeStateAsUpdate(doc);
        void window.lychee
          .invoke("crdt.compact", {
            id: args.documentId,
            snapshot: bytesToBase64(snapshot),
          })
          .catch(() => {});
      } catch {
        // best-effort
      }
      awareness.destroy();
      doc.destroy();
    },
  };
  bound.set(args.documentId, entry);

  void (async () => {
    let updates: string[] = [];
    try {
      updates = (await window.lychee.invoke("crdt.load", { id: args.documentId })).updates;
    } catch {
      updates = [];
    }
    if (disposed) return;

    if (updates.length > 0) {
      // Drop the editor's pre-binding default paragraph, then hydrate from the
      // persisted CRDT state (applying updates fires the binding observer).
      clearEditor(args.editor);
      for (const encoded of updates) applyRemoteUpdate(doc, base64ToBytes(encoded));
      flushEditor(args.editor);
      // If the markdown file changed since our last projection, the file wins.
      const projected = projectDocMarkdown(doc);
      if (args.markdown.trim().length > 0 && projected.trim() !== args.markdown.trim()) {
        bootstrapFromMarkdown(args.editor, args.markdown);
      }
    } else {
      bootstrapFromMarkdown(args.editor, args.markdown);
    }

    if (disposed) return;
    disconnect = connectDoc(getAdapter(), args.documentId, doc);
    entry.ready = true;
    publishLocalAwareness();
    installNoteSyncTestHook();
  })();
}

export function unbindLiveNote(documentId: string): void {
  const existing = bound.get(documentId);
  if (!existing) return;
  bound.delete(documentId);
  existing.dispose();
}

/** Apply an update from a peer into the live doc (editor reflects it). */
export function applyPeerUpdate(documentId: string, update: Uint8Array): boolean {
  const note = bound.get(documentId);
  if (!note) return false;
  applyRemoteUpdate(note.doc, update);
  return true;
}

export function isNoteBound(documentId: string): boolean {
  return bound.has(documentId);
}

/** The per-origin undo manager for a bound note, or null. */
export function getNoteUndoManager(documentId: string): Y.UndoManager | null {
  return bound.get(documentId)?.undoManager ?? null;
}

/** Attach the DOM container the binding renders remote cursors into. */
export function setNoteCursorsContainer(documentId: string, el: HTMLElement | null): void {
  bound.get(documentId)?.setCursorsContainer(el);
}

/** Peer presence states for a bound note (excluding the local client). */
export function getRemoteAwareness(
  documentId: string,
): Array<{ clientID: number; state: Record<string, unknown> }> | null {
  const note = bound.get(documentId);
  if (!note) return null;
  const out: Array<{ clientID: number; state: Record<string, unknown> }> = [];
  for (const [clientID, state] of note.awareness.getStates()) {
    if (clientID === note.awareness.clientID) continue;
    out.push({ clientID, state: state as Record<string, unknown> });
  }
  return out;
}

/**
 * E2E hook: simulate an external peer (agent/MCP) that joins the live doc,
 * edits, and sends its update back — exactly what a real peer adapter does.
 */
export function installNoteSyncTestHook(): void {
  if (typeof window === "undefined") return;
  if (!window.lychee?.flags?.yjs) return;

  (window as unknown as Record<string, unknown>).__lycheeNoteSync = {
    isBound: (documentId: string): boolean => isNoteBound(documentId),
    isReady: (documentId: string): boolean => bound.get(documentId)?.ready ?? false,
    awareness: (documentId: string) => getRemoteAwareness(documentId),
    /** The live doc's markdown projection (diagnostics). */
    snapshot: (documentId: string): string | null => {
      const note = bound.get(documentId);
      return note ? projectDocMarkdown(note.doc) : null;
    },
    /** Simulate an agent appending a paragraph to the live doc. */
    agentEdit: (documentId: string, text: string): boolean => {
      const note = bound.get(documentId);
      if (!note) return false;
      // A peer joins by binding an EMPTY doc first, then receiving the state, so
      // the binding hydrates its editor from the shared document.
      const peer = createNoteDoc(`peer-${documentId}`);
      Y.applyUpdate(peer.doc, Y.encodeStateAsUpdate(note.doc));
      flushEditor(peer.editor);
      peer.editor.update(
        () => {
          $getRoot().append($createParagraphNode().append($createTextNode(text)));
        },
        { discrete: true },
      );
      applyRemoteUpdate(note.doc, Y.encodeStateAsUpdate(peer.doc));
      peer.dispose();
      return true;
    },
  };
}
