import fs from "fs";
import path from "path";

/**
 * Filesystem-backed, append-only store for cross-device Yjs updates.
 *
 * Layout (under `<vault>/.lychee/sync`, a dot-directory the markdown watcher
 * ignores):
 *
 *   <root>/<docId>/<deviceId>-<seq>.bin
 *
 * Each device only ever *creates* files named with its own id — it never
 * rewrites another device's file — so a cloud-sync engine (iCloud/Dropbox/
 * Syncthing) can never produce a conflicting rewrite. Yjs updates are
 * commutative, associative, and idempotent, so applying every file in any order
 * (and re-applying after a partial sync) always converges.
 *
 * Kept free of Electron/better-sqlite3/Yjs so the standalone MCP server and
 * tests can use it directly. Compaction (which needs `Y.mergeUpdates`) is
 * injected by the caller via {@link replaceDeviceUpdates}.
 */

export const CRDT_SYNC_DIRECTORY = ".lychee/sync";

/** Make a value safe as a single path segment (doc ids and device ids). */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "unknown";
}

function noteDir(root: string, docId: string): string {
  return path.join(root, safeSegment(docId));
}

function devicePrefix(deviceId: string): string {
  return `${safeSegment(deviceId)}-`;
}

/** True for a filename belonging to `deviceId` in a note directory. */
export function isDeviceUpdateFile(file: string, deviceId: string): boolean {
  return file.startsWith(devicePrefix(deviceId)) && file.endsWith(".bin");
}

let sequence = 0;

/**
 * Append an update as a new immutable file. Uses `wx` so two concurrent calls
 * can never write the same path; a collision retries with a fresh name.
 * Returns the created filename.
 */
export function appendNoteUpdate(
  root: string,
  docId: string,
  deviceId: string,
  update: Uint8Array,
): string {
  const directory = noteDir(root, docId);
  fs.mkdirSync(directory, { recursive: true });

  const base = `${devicePrefix(deviceId)}${Date.now().toString(36)}-${(sequence++).toString(36)}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const name = attempt === 0 ? `${base}.bin` : `${base}-${attempt}.bin`;
    const filePath = path.join(directory, name);
    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, "wx");
      fs.writeSync(fd, update);
      fs.fsyncSync(fd);
      return name;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // best-effort
        }
      }
    }
  }
  throw lastError ?? new Error("could not allocate an update filename");
}

/** Every `.bin` filename for a note (unsorted). */
export function listUpdateFiles(root: string, docId: string): string[] {
  try {
    return fs.readdirSync(noteDir(root, docId)).filter((file) => file.endsWith(".bin"));
  } catch {
    return [];
  }
}

/** Update files created by `deviceId` for a note. */
export function listDeviceUpdateFiles(root: string, docId: string, deviceId: string): string[] {
  return listUpdateFiles(root, docId).filter((file) => isDeviceUpdateFile(file, deviceId));
}

/** Read one update file, or null when it is gone/unreadable. */
export function readUpdateFile(root: string, docId: string, file: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(noteDir(root, docId), file));
  } catch {
    return null;
  }
}

/**
 * Every stored update for a note, oldest filename first. A file being written
 * concurrently may be briefly unreadable; it is skipped (it will be re-read on
 * the next pass — replay is idempotent).
 */
export function readNoteUpdates(root: string, docId: string): Buffer[] {
  const out: Buffer[] = [];
  for (const file of listUpdateFiles(root, docId).sort()) {
    const buffer = readUpdateFile(root, docId, file);
    if (buffer) out.push(buffer);
  }
  return out;
}

/** Note ids that have at least one stored update. */
export function listNoteIds(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Replace a device's own accumulated files for a note with a single merged
 * `snapshot`. Safe without cross-device acknowledgement: the merged update
 * contains every structure the old files did (Yjs merge is lossless), so a peer
 * that had seen only some of them still converges by reading the replacement.
 * The new file is written first, then the older own files are removed, so a
 * crash mid-compaction never loses data.
 */
export function replaceDeviceUpdates(
  root: string,
  docId: string,
  deviceId: string,
  snapshot: Uint8Array,
): string | null {
  const existing = listDeviceUpdateFiles(root, docId, deviceId);
  if (existing.length === 0) return null;
  const created = appendNoteUpdate(root, docId, deviceId, snapshot);
  for (const file of existing) {
    if (file === created) continue;
    try {
      fs.unlinkSync(path.join(noteDir(root, docId), file));
    } catch {
      // best-effort; a leftover file is harmless (idempotent replay)
    }
  }
  return created;
}

/** Drop every update file for a note (called on permanent delete). */
export function removeNoteUpdates(root: string, docId: string): void {
  try {
    fs.rmSync(noteDir(root, docId), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
