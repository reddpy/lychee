import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { resolveWithinVault } from "./vault";

/**
 * Cross-process, per-file write lock for the vault.
 *
 * The app (Electron main), the MCP server, and future sync writers can all write
 * the same note file. Atomic rename prevents torn files, but a read-modify-write
 * across processes can still lose an edit (last writer wins). This lock
 * serializes those critical sections using an on-disk lock file, so writers on
 * different processes coordinate.
 *
 * Design notes:
 * - Locks live under `<vault>/.lychee/locks/` (a dot-dir the vault scanner and
 *   watcher already ignore), one file per case-folded vault path.
 * - Acquisition uses `O_EXCL` (`wx`) create — atomic on every supported OS.
 * - A lock is reclaimed when it is older than {@link STALE_MS} or its recorded
 *   pid is no longer alive, so a crashed writer cannot wedge the vault.
 * - Acquisition is reentrant within a process: nested writes for the same path
 *   on the same call stack reuse the held lock.
 * - Acquisition fails *open* after {@link DEFAULT_TIMEOUT_MS}: the caller still
 *   writes (the write itself is atomic and the revision guard still protects
 *   against clobbering), rather than wedging the UI forever.
 */

const LOCK_DIRECTORY = ".lychee/locks";
const STALE_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const RETRY_MS = 25;

/** Lock files currently held by this process (reentrancy). */
const held = new Set<string>();

function lockPathFor(root: string, relativePath: string): string {
  const digest = createHash("sha1")
    .update(relativePath.replace(/\\/g, "/").toLowerCase())
    .digest("hex")
    .slice(0, 24);
  return resolveWithinVault(root, `${LOCK_DIRECTORY}/${digest}.lock`);
}

function sleepSync(ms: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

/** Best-effort liveness check for the process that recorded the lock. */
function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we cannot signal it — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove an abandoned lock and report whether the path is now free to retry.
 * A lock with no readable metadata is treated as stale (safe: the holder would
 * have written it immediately after creating it).
 */
function reclaimIfStale(lockPath: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch {
    return true; // vanished between attempts; retry the create
  }
  let pid = 0;
  let at = 0;
  try {
    const info = JSON.parse(raw) as { pid?: number; at?: number };
    pid = typeof info.pid === "number" ? info.pid : 0;
    at = typeof info.at === "number" ? info.at : 0;
  } catch {
    // Corrupt lock: reclaim it.
  }
  const expired = at <= 0 || Date.now() - at > STALE_MS;
  if (expired || !processAlive(pid)) {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Another waiter may have already reclaimed it.
    }
    return true;
  }
  return false;
}

/**
 * Run `fn` while holding the write lock for `relativePath` in `root`.
 *
 * Synchronous by design: the vault write path is synchronous (temp → fsync →
 * rename), and callers must not yield inside the critical section.
 */
export function withVaultWriteLock<T>(
  root: string,
  relativePath: string,
  fn: () => T,
  options: { timeoutMs?: number } = {},
): T {
  const lockPath = lockPathFor(root, relativePath);

  // Already held on this call stack: run directly, release happens outermost.
  if (held.has(lockPath)) return fn();

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let acquired = false;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      } finally {
        fs.closeSync(fd);
      }
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (reclaimIfStale(lockPath)) continue;
      if (Date.now() - startedAt >= timeoutMs) {
        // Fail open rather than wedge the UI. Do NOT touch the other holder's
        // lock file. The caller's write is atomic and revision-guarded, so the
        // worst case is a conflict copy, not data loss.
        break;
      }
      sleepSync(RETRY_MS);
    }
  }

  if (!acquired) return fn();

  held.add(lockPath);
  try {
    return fn();
  } finally {
    held.delete(lockPath);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Already reclaimed as stale by another writer.
    }
  }
}

/** Exposed for tests: the lock file a given vault path maps to. */
export function vaultLockPath(root: string, relativePath: string): string {
  return lockPathFor(root, relativePath);
}
