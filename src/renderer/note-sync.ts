import type { LexicalEditor } from "lexical";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
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

class BroadcastChannelAdapter implements SyncAdapter {
  private readonly channel: BroadcastChannel | null = null;
  private readonly listeners = new Map<string, Set<(update: Uint8Array) => void>>();

  constructor() {
    if (typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel("lychee-note-sync");
    this.channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { docId?: string; update?: Uint8Array } | undefined;
      if (!data?.docId || !(data.update instanceof Uint8Array)) return;
      for (const callback of this.listeners.get(data.docId) ?? []) callback(data.update);
    };
  }

  subscribe(docId: string, onUpdate: (update: Uint8Array) => void): () => void {
    const set = this.listeners.get(docId) ?? new Set();
    set.add(onUpdate);
    this.listeners.set(docId, set);
    return () => {
      set.delete(onUpdate);
      if (set.size === 0) this.listeners.delete(docId);
    };
  }

  publish(docId: string, update: Uint8Array): void {
    this.channel?.postMessage({ docId, update });
  }
}

let adapter: BroadcastChannelAdapter | null = null;
function getAdapter(): BroadcastChannelAdapter {
  if (!adapter) adapter = new BroadcastChannelAdapter();
  return adapter;
}

interface BoundNote {
  doc: Y.Doc;
  editor: LexicalEditor;
  undoManager: Y.UndoManager;
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
  const { undoManager, dispose: disposeBinding } = bindEditorToDoc({
    id: args.documentId,
    editor: args.editor,
    doc,
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

  let disconnect: (() => void) | null = null;
  let disposed = false;

  const entry: BoundNote = {
    doc,
    editor: args.editor,
    undoManager,
    ready: false,
    dispose() {
      disposed = true;
      flush();
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
