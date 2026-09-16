import path from "path";
import { deliverBridgeUpdate } from "./bridge";
import { getDeviceId } from "./tombstones";
import { getVaultDirectory } from "./vault-location";
import { CRDT_SYNC_DIRECTORY, readNoteUpdates } from "../sync/folder-store";
import { FolderAdapter } from "../sync/folder-adapter";

/**
 * Runs a vault-folder Yjs peer in the main process (Tier-1 cross-device sync).
 *
 * The folder is the transport: updates the renderer publishes (over the existing
 * `bridge.publish` IPC) are also appended as immutable per-device files under
 * `<vault>/.lychee/sync/<docId>/`, and updates written there by another device
 * are replayed into the renderer over the existing `bridge:update` channel. The
 * markdown watcher ignores the dot-directory, so files and CRDT state coexist.
 *
 * Gated behind Yjs mode alongside the local bridge (`LYCHEE_YJS=1`).
 */

let adapter: FolderAdapter | null = null;
/** Active folder subscriptions, keyed by note id. */
const watched = new Map<string, () => void>();
const compactTimers = new Map<string, ReturnType<typeof setTimeout>>();

function syncRoot(): string {
  return path.join(getVaultDirectory(), CRDT_SYNC_DIRECTORY);
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function ensureWatched(docId: string): void {
  if (!adapter || watched.has(docId)) return;
  const off = adapter.subscribe(docId, (update) => {
    deliverBridgeUpdate(docId, bytesToBase64(update));
  });
  watched.set(docId, off);
}

function scheduleCompact(docId: string): void {
  const existing = compactTimers.get(docId);
  if (existing) clearTimeout(existing);
  compactTimers.set(
    docId,
    setTimeout(() => {
      compactTimers.delete(docId);
      adapter?.compact(docId);
    }, 2000),
  );
}

export function startVaultCrdtPeer(): void {
  if (adapter) return;
  const root = syncRoot();
  adapter = new FolderAdapter(root, getDeviceId(), { pollMs: 1500 });
  // Watch notes already present so cross-device edits stream in even before a
  // note is opened; updates for unbound notes are dropped by the renderer.
  for (const docId of adapter.listDocIds()) ensureWatched(docId);
  console.log(`[vault-crdt] syncing through ${root}`);
}

export function stopVaultCrdtPeer(): void {
  for (const timer of compactTimers.values()) clearTimeout(timer);
  compactTimers.clear();
  watched.clear();
  adapter?.close();
  adapter = null;
}

/** Append a renderer-originated update to the folder (called from `bridge.publish`). */
export function publishVaultCrdt(docId: string, updateBase64: string): void {
  if (!adapter) return;
  ensureWatched(docId);
  adapter.publish(docId, Buffer.from(updateBase64, "base64"));
  scheduleCompact(docId);
}

/** Drop a note's folder updates (called on permanent delete). */
export function removeVaultCrdt(docId: string): void {
  if (!adapter) return;
  watched.get(docId)?.();
  watched.delete(docId);
  const timer = compactTimers.get(docId);
  if (timer) clearTimeout(timer);
  compactTimers.delete(docId);
  adapter.removeDoc(docId);
}

/** All stored cross-device updates for a note, base64 (renderer loads before bind). */
export function readVaultCrdtUpdates(docId: string): string[] {
  if (!adapter) return [];
  return readNoteUpdates(syncRoot(), docId).map((buf) => buf.toString("base64"));
}

export function isVaultCrdtPeerRunning(): boolean {
  return adapter !== null;
}
