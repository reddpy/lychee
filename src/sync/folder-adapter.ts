import * as Y from "yjs";
import type { SyncAdapter } from "./memory-hub";
import {
  appendNoteUpdate,
  isDeviceUpdateFile,
  listDeviceUpdateFiles,
  listNoteIds,
  listUpdateFiles,
  readUpdateFile,
  removeNoteUpdates,
  replaceDeviceUpdates,
} from "./folder-store";

/**
 * Tier-1 `SyncAdapter`: exchanges opaque Yjs updates through a shared directory
 * (the vault's `.lychee/sync`), which a cloud-folder engine or git carries
 * between devices.
 *
 * Push: every local update becomes an immutable file named for this device.
 * Pull: on subscribe (and on a light poll) every file we have not yet seen is
 * replayed into the caller. Because updates are idempotent, replaying the whole
 * directory is always safe, so no cross-device acknowledgement is needed.
 *
 * There is no live presence channel over files (awareness is ephemeral); those
 * methods are no-ops. Realtime collaboration is Tier 2, over a websocket
 * provider writing to the same Y.Doc.
 */

export interface FolderAdapterOptions {
  /** How often to look for updates written by other devices. */
  pollMs?: number;
}

export class FolderAdapter implements SyncAdapter {
  /** Filenames already delivered (or written by us) per note, to avoid repeats. */
  private readonly seen = new Map<string, Set<string>>();
  private readonly listeners = new Map<
    string,
    { onUpdate: (update: Uint8Array) => void; onPeerJoined?: () => void }
  >();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private closed = false;

  constructor(
    private readonly root: string,
    private readonly deviceId: string,
    private readonly options: FolderAdapterOptions = {},
  ) {}

  subscribe(
    docId: string,
    onUpdate: (update: Uint8Array) => void,
    onPeerJoined?: () => void,
  ): () => void {
    this.listeners.set(docId, { onUpdate, onPeerJoined });
    if (!this.seen.has(docId)) this.seen.set(docId, new Set());
    this.replay(docId, onUpdate);
    if (!this.timers.has(docId)) {
      const timer = setInterval(() => {
        const listener = this.listeners.get(docId);
        if (listener) this.replay(docId, listener.onUpdate);
      }, this.options.pollMs ?? 1000);
      // Never keep the Node process alive just for a poll.
      timer.unref?.();
      this.timers.set(docId, timer);
    }
    return () => this.unsubscribe(docId);
  }

  publish(docId: string, update: Uint8Array): void {
    if (this.closed) return;
    const name = appendNoteUpdate(this.root, docId, this.deviceId, update);
    // Mark our own file seen so the poll never echoes it back into the caller.
    this.seen.get(docId)?.add(name);
  }

  subscribeAwareness(): () => void {
    return () => {};
  }

  publishAwareness(): void {
    // No live channel over files.
  }

  /** Stop watching a note (does not delete its files). */
  unsubscribe(docId: string): void {
    this.listeners.delete(docId);
    // Forget what we delivered: a later re-subscribe replays the directory so
    // updates that arrived while unwatched are picked up.
    this.seen.delete(docId);
    const timer = this.timers.get(docId);
    if (timer) clearInterval(timer);
    this.timers.delete(docId);
  }

  /** Note ids with any stored update (for wiring subscriptions at startup). */
  listDocIds(): string[] {
    return listNoteIds(this.root);
  }

  /**
   * Fold this device's own files for a note into one merged file (lossless, and
   * safe without acknowledgement). Returns true when a merge happened.
   */
  compact(docId: string): boolean {
    const own = listDeviceUpdateFiles(this.root, docId, this.deviceId);
    if (own.length < 2) return false;
    const buffers: Uint8Array[] = [];
    for (const file of own) {
      const buffer = readUpdateFile(this.root, docId, file);
      if (buffer) buffers.push(new Uint8Array(buffer));
    }
    if (buffers.length < 2) return false;
    try {
      const created = replaceDeviceUpdates(this.root, docId, this.deviceId, Y.mergeUpdates(buffers));
      if (created) this.seen.get(docId)?.add(created);
      return created !== null;
    } catch (error) {
      console.error("[sync] folder compaction failed:", error);
      return false;
    }
  }

  /** Permanently forget a note's updates (on delete). */
  removeDoc(docId: string): void {
    this.unsubscribe(docId);
    removeNoteUpdates(this.root, docId);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.listeners.clear();
    this.seen.clear();
  }

  /** Deliver every not-yet-seen file for a note, in filename order. */
  private replay(docId: string, onUpdate: (update: Uint8Array) => void): void {
    const seen = this.seen.get(docId) ?? new Set<string>();
    this.seen.set(docId, seen);
    for (const file of listUpdateFiles(this.root, docId).sort()) {
      if (seen.has(file)) continue;
      // Mark before reading so a concurrent pass cannot double-deliver.
      seen.add(file);
      if (isDeviceUpdateFile(file, this.deviceId)) continue; // our own write
      const buffer = readUpdateFile(this.root, docId, file);
      if (!buffer) {
        seen.delete(file); // unreadable (mid-write); retry next pass
        continue;
      }
      try {
        onUpdate(new Uint8Array(buffer));
      } catch (error) {
        console.error("[sync] folder update replay failed:", error);
      }
    }
  }
}

/** Convenience: total stored update files for a note (diagnostics/tests). */
export function countNoteUpdates(root: string, docId: string): number {
  return listUpdateFiles(root, docId).length;
}
