import Database from "better-sqlite3";
import { app } from "electron";
import fs from "fs";
import path from "path";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { runMigrations, LATEST_SCHEMA_VERSION } from "./schema";

const MAX_BACKUPS = 3;
const BACKUP_FILENAME_RE = /^lychee\.sqlite3\.bak-v(\d+)$/;

let db: BetterSqlite3Database | null = null;

function pruneOldBackups(userDataDir: string): void {
  const entries = fs
    .readdirSync(userDataDir)
    .map((name) => {
      const match = BACKUP_FILENAME_RE.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((e): e is { name: string; version: number } => e !== null)
    .sort((a, b) => b.version - a.version);

  for (const entry of entries.slice(MAX_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(userDataDir, entry.name));
    } catch {
      // best-effort
    }
  }
}

// Parse the stored schema_version string. A missing/empty value means an
// unversioned (fresh/legacy) DB → 0. Anything present but not a non-negative
// integer is corruption: throw so the caller can fail closed rather than guess
// a baseline and migrate from the wrong version (which could destroy data).
export function parseSchemaVersion(value: string | undefined): number {
  if (!value) return 0;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`unreadable schema_version ${JSON.stringify(value)}`);
  }
  return version;
}

function readCurrentSchemaVersion(database: BetterSqlite3Database): number {
  let row: { value?: string } | undefined;
  try {
    row = database
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value?: string } | undefined;
  } catch {
    // meta table doesn't exist yet (fresh DB)
    return 0;
  }
  // Parse *outside* the try: a corrupt-version error must propagate, not be
  // mistaken for the missing-table (fresh DB) case above.
  return parseSchemaVersion(row?.value);
}

// Best-effort extraction of a human-meaningful code from a teardown error.
// better-sqlite3 errors carry a string `.code` (e.g. "SQLITE_FULL"); Node fs
// errors carry both `.code` ("EACCES") and a numeric `.errno`. Falls back to
// "unknown" so the log line is always well-formed regardless of error shape.
export function backupErrorCode(err: unknown): string | number {
  const e = err as { code?: string; errno?: number } | null | undefined;
  return e?.code ?? e?.errno ?? "unknown";
}

// Close a handle during error teardown without letting a close failure mask
// the original (actionable) error that triggered the teardown.
function safeClose(database: BetterSqlite3Database): void {
  try {
    database.close();
  } catch {
    // The triggering error is the one worth surfacing; swallow this.
  }
}

// VACUUM INTO produces a consistent snapshot including any pending WAL state,
// unlike `fs.copyFileSync` which would copy only the main file and miss
// uncommitted-but-durable writes in `lychee.sqlite3-wal`. SQLite's path is a
// string literal (not a bindable parameter for VACUUM), so escape and inline.
function vacuumIntoFile(database: BetterSqlite3Database, destPath: string): void {
  // VACUUM INTO refuses to overwrite an existing file
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  const escaped = destPath.replace(/'/g, "''");
  database.exec(`VACUUM INTO '${escaped}'`);
}

export function initDatabase(): { dbPath: string } {
  // If already initialized, return the last known path.
  if (db) {
    // better-sqlite3 exposes `.name` (string) on the db instance (not in typings).
    const existingPath =
      typeof (db as unknown as { name?: unknown }).name === "string"
        ? ((db as unknown as { name: string }).name as string)
        : "lychee.sqlite3";
    return { dbPath: existingPath };
  }

  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });

  const dbPath = path.join(userDataDir, "lychee.sqlite3");
  // Capture *before* opening: `new Database` creates the file if missing,
  // so this is the only reliable fresh-install signal.
  const isFreshInstall = !fs.existsSync(dbPath);

  const database = new Database(dbPath);

  let backupPath: string | null = null;
  if (!isFreshInstall) {
    let currentVersion: number;
    try {
      currentVersion = readCurrentSchemaVersion(database);
    } catch (err) {
      // Fail closed: if the on-disk schema version is unreadable we can't know
      // which migrations apply — migrating from a guessed baseline could
      // corrupt or destroy data. The original DB file is untouched.
      console.error(
        `[db] ${(err as Error).message}: refusing to migrate to protect existing data.`,
      );
      safeClose(database);
      throw err;
    }
    if (currentVersion < LATEST_SCHEMA_VERSION) {
      const dest = path.join(userDataDir, `lychee.sqlite3.bak-v${currentVersion}`);
      backupPath = dest;
      try {
        vacuumIntoFile(database, dest);
      } catch (err) {
        // Fail closed: a failed backup (disk full, permission denied, etc.)
        // must abort launch rather than migrate without a safety net. The
        // original DB file is untouched — VACUUM INTO only writes the backup.
        console.error(
          `[db] backup failed (${backupErrorCode(err)}): refusing to migrate to protect existing data.`,
        );
        // A failed VACUUM INTO can leave a partial/truncated file behind. Drop
        // it so it can't masquerade as a valid backup before the next attempt.
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
        } catch {
          // best-effort
        }
        safeClose(database);
        throw err;
      }
      pruneOldBackups(userDataDir);
      console.log(`[db] backed up to ${backupPath} before migration`);
    }
  }

  try {
    runMigrations(database);
  } catch (err) {
    if (backupPath) {
      console.error(`[db] migration failed. Backup available at: ${backupPath}`);
    }
    safeClose(database);
    throw err;
  }

  db = database;
  return { dbPath };
}

export function getDb(): BetterSqlite3Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function createDatabaseBackup(destination: string): void {
  const database = getDb();
  const source = path.resolve(database.name);
  const resolvedDestination = path.resolve(destination);
  // Windows paths are case-insensitive, so differently-cased spellings of the
  // live DB must still be treated as the same file.
  const comparisonSource = process.platform === "win32" ? source.toLowerCase() : source;
  const comparisonDestination =
    process.platform === "win32" ? resolvedDestination.toLowerCase() : resolvedDestination;
  if (comparisonDestination === comparisonSource) {
    throw new Error("A backup cannot replace Lychee's active database");
  }
  try {
    vacuumIntoFile(database, resolvedDestination);
  } catch (err) {
    // A failed VACUUM INTO can leave a partial file. Never let that artifact
    // look like a usable backup in the location the user selected.
    try {
      if (fs.existsSync(resolvedDestination)) fs.unlinkSync(resolvedDestination);
    } catch {
      // Preserve the original SQLite/filesystem error.
    }
    throw err;
  }
}

export function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}
