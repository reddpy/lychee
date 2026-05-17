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

function readCurrentSchemaVersion(database: BetterSqlite3Database): number {
  try {
    const row = database
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value?: string } | undefined;
    return row?.value ? Number(row.value) : 0;
  } catch {
    // meta table doesn't exist yet (fresh DB)
    return 0;
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
    const currentVersion = readCurrentSchemaVersion(database);
    if (currentVersion < LATEST_SCHEMA_VERSION) {
      backupPath = path.join(userDataDir, `lychee.sqlite3.bak-v${currentVersion}`);
      vacuumIntoFile(database, backupPath);
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
    database.close();
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

export function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}
