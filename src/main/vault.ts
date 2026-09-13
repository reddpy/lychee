import fs from "fs";
import path from "path";
import type { VaultWriteEntry } from "../shared/vault-path";
import { conflictCopyPath } from "../shared/vault-path";
import { parseFrontmatter } from "../shared/frontmatter";
import { revisionOf } from "../shared/hash";
import type { ScannedVaultEntry } from "../shared/vault-import";

/**
 * Filesystem side of the vault. Writes are atomic per file:
 *   write temp (same dir) -> fsync file -> rename over target -> fsync dir.
 *
 * The temp file lives in the same directory as the target so `rename` stays on
 * one filesystem (atomic on POSIX/Windows). It is dot-prefixed and `.tmp`-suffixed
 * so a future file watcher can ignore it.
 */

/** Resolve `relativePath` under `root`, rejecting absolute paths and escapes. */
export function resolveWithinVault(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid vault path: ${relativePath}`);
  }
  if (relativePath.split(/[\\/]+/).some((segment) => segment === "..")) {
    throw new Error(`Vault path escapes the vault: ${relativePath}`);
  }
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, relativePath);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (target !== rootResolved && !target.startsWith(prefix)) {
    throw new Error(`Vault path escapes the vault: ${relativePath}`);
  }
  return target;
}

function fsyncDirectory(directory: string): void {
  try {
    const fd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Directory fsync is unsupported / unnecessary on some platforms (Windows).
  }
}

/** Transient sharing-violation style errors (chiefly Windows / sync clients). */
const RETRYABLE_FS_ERRORS = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);

/** Synchronous sleep without spinning (used only for fs retry backoff). */
function sleepSync(ms: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

/**
 * Retry a synchronous filesystem operation when it fails with a transient
 * sharing/access error. On Windows an antivirus or cloud-sync scanner can hold a
 * file handle mid-write, making a rename/delete fail once; on macOS/Linux this
 * effectively never fires. Persistent failures are rethrown.
 */
function withFsRetry<T>(operation: () => T, attempts = 5): T {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_FS_ERRORS.has(code) || attempt === attempts - 1) {
        throw error;
      }
      sleepSync(20 * (attempt + 1));
    }
  }
  throw lastError;
}

interface WriteOptions {
  /**
   * fsync the file + directory before returning. Durable, but a synchronous
   * disk flush; intermediate autosaves skip it and rely on the atomic rename.
   */
  fsync?: boolean;
}

function atomicWriteFile(
  filePath: string,
  contents: string | Buffer,
  options: WriteOptions = {},
): void {
  const fsync = options.fsync !== false;
  const directory = path.dirname(filePath);
  withFsRetry(() => fs.mkdirSync(directory, { recursive: true }));

  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`,
  );

  const fd = fs.openSync(tempPath, "w");
  try {
    if (typeof contents === "string") {
      fs.writeSync(fd, contents);
    } else {
      fs.writeSync(fd, contents);
    }
    if (fsync) fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
  fs.closeSync(fd);

  try {
    withFsRetry(() => fs.renameSync(tempPath, filePath));
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
  if (fsync) fsyncDirectory(directory);
}

/** Write every entry atomically. Returns the number of files written. */
export function writeVaultEntries(root: string, entries: VaultWriteEntry[]): number {
  let written = 0;
  for (const entry of entries) {
    const target = resolveWithinVault(root, entry.relativePath);
    atomicWriteFile(target, entry.contents);
    written += 1;
  }
  return written;
}

/** Write a single vault file atomically (path-escape guarded). */
export function writeVaultFile(
  root: string,
  relativePath: string,
  contents: string,
  options: WriteOptions = {},
): void {
  atomicWriteFile(resolveWithinVault(root, relativePath), contents, options);
}

/** Write a single vault file atomically from raw bytes (assets). */
export function writeVaultBinaryFile(root: string, relativePath: string, contents: Buffer): void {
  atomicWriteFile(resolveWithinVault(root, relativePath), contents);
}

/** Read a vault markdown file as UTF-8. */
export function readVaultFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function vaultEntryExists(root: string, relativePath: string): boolean {
  return fs.existsSync(resolveWithinVault(root, relativePath));
}

const TRASH_DIRECTORY = ".trash";

/**
 * Move a note's file (and its companion folder of children, if any) from one
 * vault-relative path to another. No-op when the source is gone or the target
 * already exists. Uses atomic rename; the watcher ignores the delete half.
 */
export function renameVaultEntry(root: string, fromRel: string, toRel: string): void {
  if (!fromRel || !toRel || fromRel === toRel) return;

  const fromFile = resolveWithinVault(root, fromRel);
  const toFile = resolveWithinVault(root, toRel);
  withFsRetry(() => fs.mkdirSync(path.dirname(toFile), { recursive: true }));

  if (fs.existsSync(fromFile) && !fs.existsSync(toFile)) {
    withFsRetry(() => fs.renameSync(fromFile, toFile));
  }

  // Folder-per-note layout: the note's children live in a sibling directory
  // named after the file's stem. Renaming the note must move that too.
  const fromDir = resolveWithinVault(root, fromRel.replace(/\.md$/i, ""));
  const toDir = resolveWithinVault(root, toRel.replace(/\.md$/i, ""));
  if (fs.existsSync(fromDir) && !fs.existsSync(toDir)) {
    withFsRetry(() => fs.mkdirSync(path.dirname(toDir), { recursive: true }));
    withFsRetry(() => fs.renameSync(fromDir, toDir));
  }
}

/** Move a vault entry into `<vault>/.trash/`, preserving its relative path. */
export function trashVaultEntry(root: string, relativePath: string): void {
  const fromFile = resolveWithinVault(root, relativePath);
  if (!fs.existsSync(fromFile)) return;
  const targetRel = `${TRASH_DIRECTORY}/${relativePath}`;
  const targetFile = resolveWithinVault(root, targetRel);
  withFsRetry(() => fs.mkdirSync(path.dirname(targetFile), { recursive: true }));
  if (!fs.existsSync(targetFile)) {
    withFsRetry(() => fs.renameSync(fromFile, targetFile));
  }
}

/** Move an entry back out of `.trash` to the given vault-relative path. */
export function restoreVaultEntry(root: string, relativePath: string): void {
  const fromFile = resolveWithinVault(root, `${TRASH_DIRECTORY}/${relativePath}`);
  if (!fs.existsSync(fromFile)) return;
  const targetFile = resolveWithinVault(root, relativePath);
  withFsRetry(() => fs.mkdirSync(path.dirname(targetFile), { recursive: true }));
  if (!fs.existsSync(targetFile)) {
    withFsRetry(() => fs.renameSync(fromFile, targetFile));
  }
}

/** Permanently delete an entry from `.trash`. */
export function purgeVaultEntry(root: string, relativePath: string): void {
  const target = resolveWithinVault(root, `${TRASH_DIRECTORY}/${relativePath}`);
  if (!fs.existsSync(target)) return;
  withFsRetry(() => fs.rmSync(target, { recursive: true, force: true }));
}

/** Stable content revision — the optimistic-concurrency and watcher baseline. */
export function contentRevision(contents: string): string {
  return revisionOf(contents);
}

export type GuardedWriteResult =
  | { status: "written"; relativePath: string }
  | { status: "conflict"; conflictPath: string };

/**
 * Write only if the target still matches `expectedRevision`. On mismatch, the
 * incoming content becomes a sibling conflict copy instead of clobbering the
 * external change. `expectedRevision === null` means "expect it not to exist";
 * if it does exist, that is also a conflict.
 */
export function writeVaultEntryGuarded(
  root: string,
  entry: VaultWriteEntry,
  expectedRevision: string | null,
  timestamp: string = new Date().toISOString(),
): GuardedWriteResult {
  const target = resolveWithinVault(root, entry.relativePath);
  const exists = fs.existsSync(target);
  const currentRevision = exists ? contentRevision(fs.readFileSync(target, "utf8")) : null;

  const matches =
    expectedRevision === null ? !exists : currentRevision === expectedRevision && exists;

  if (!matches) {
    let conflictPath = conflictCopyPath(entry.relativePath, timestamp);
    let suffix = 1;
    while (fs.existsSync(resolveWithinVault(root, conflictPath))) {
      suffix += 1;
      conflictPath = conflictPath.replace(/\.md$/, ` ${suffix}.md`);
    }
    atomicWriteFile(resolveWithinVault(root, conflictPath), entry.contents);
    return { status: "conflict", conflictPath };
  }

  atomicWriteFile(target, entry.contents);
  return { status: "written", relativePath: entry.relativePath };
}

export interface VaultScanResult {
  entries: ScannedVaultEntry[];
  skipped: Array<{ relativePath: string; reason: string }>;
}

/**
 * Recursively read every `.md` file under `root`, skipping dot-directories
 * (e.g. `.trash`) and temp files. Unreadable files are reported, not fatal.
 */
export function scanVaultDirectory(root: string): VaultScanResult {
  const entries: ScannedVaultEntry[] = [];
  const skipped: Array<{ relativePath: string; reason: string }> = [];

  if (!fs.existsSync(root)) return { entries, skipped };

  const walk = (directory: string): void => {
    const dirents = fs.readdirSync(directory, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.name.startsWith(".")) continue;
      const absolute = path.join(directory, dirent.name);
      if (dirent.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!dirent.isFile() || !dirent.name.toLowerCase().endsWith(".md")) continue;

      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      try {
        const raw = fs.readFileSync(absolute, "utf8");
        const { data, body } = parseFrontmatter(raw);
        entries.push({
          relativePath,
          id: data.id,
          title: data.title,
          emoji: data.emoji,
          bookmarked: data.bookmarked,
          created: data.created,
          updated: data.updated,
          contentSchemaVersion: data.contentSchemaVersion,
          order: data.order,
          revision: revisionOf(raw),
          body,
        });
      } catch (error) {
        skipped.push({ relativePath, reason: (error as Error).message });
      }
    }
  };

  walk(root);
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { entries, skipped };
}
