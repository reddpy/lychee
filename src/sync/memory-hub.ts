import * as Y from "yjs";
import { REMOTE_ORIGIN } from "./note-doc";

/**
 * Transport seam for note Y.Docs.
 *
 * A `SyncAdapter` moves opaque Yjs updates between peers; everything above it
 * is transport-agnostic. Local development/testing uses {@link MemoryHub}
 * (agents in-process). Cross-process MCP uses a socket/relay adapter and
 * cross-device sync uses append-only update files / object storage — all behind
 * this same interface.
 */
export interface SyncAdapter {
  subscribe(docId: string, onUpdate: (update: Uint8Array) => void): () => void;
  publish(docId: string, update: Uint8Array): void;
}

/** In-process pub/sub hub: lets a local "agent" peer join a note's doc. */
export class MemoryHub implements SyncAdapter {
  private readonly listeners = new Map<string, Set<(update: Uint8Array) => void>>();

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
    for (const callback of this.listeners.get(docId) ?? []) callback(update);
  }
}

/**
 * Bidirectionally connect a doc to an adapter. Updates we *send* are tagged so
 * we never echo them back to ourselves; the current state is published on
 * connect so a late joiner catches up.
 */
export function connectDoc(adapter: SyncAdapter, docId: string, doc: Y.Doc): () => void {
  const offRemote = adapter.subscribe(docId, (update) => {
    try {
      Y.applyUpdate(doc, update, REMOTE_ORIGIN);
    } catch (error) {
      console.error("[sync] remote apply failed:", error);
    }
  });

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return; // don't rebroadcast peer updates
    adapter.publish(docId, update);
  };
  doc.on("update", onUpdate);

  // Catch peers up with everything we already have.
  adapter.publish(docId, Y.encodeStateAsUpdate(doc));

  return () => {
    offRemote();
    doc.off("update", onUpdate);
  };
}
