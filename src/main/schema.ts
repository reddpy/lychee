import type { Database as BetterSqlite3Database } from 'better-sqlite3';

/**
 * Schema migrations — declarative list, applied in order.
 *
 * To add a new schema change: append a `{ version: N, up }` entry. Each
 * migration's `up` is wrapped in its own transaction by runMigrations, and
 * partial progress is preserved across the run (a failure at vN keeps
 * v1..vN-1 committed). `LATEST_SCHEMA_VERSION` is derived from this list —
 * never declare it separately.
 *
 * Pure schema logic — no electron, no filesystem, no singleton state.
 *
 * v1 baseline (squashed from former v1–v9):
 *   meta      (key, value)                                — schema version + future kv
 *   documents (id, title, content, createdAt, updatedAt,
 *              parentId, emoji, deletedAt, sortOrder, metadata)
 *   images    (id, filename, mimeType, width, height, createdAt)
 *   settings  (key, value)                                — app settings
 */
type Migration = {
  version: number;
  up: (db: BetterSqlite3Database) => void;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          parentId TEXT NULL,
          emoji TEXT NULL,
          deletedAt TEXT NULL,
          sortOrder INTEGER DEFAULT 0,
          metadata TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_documents_updatedAt ON documents(updatedAt);
        CREATE INDEX IF NOT EXISTS idx_documents_parentId ON documents(parentId);
        CREATE INDEX IF NOT EXISTS idx_documents_sortOrder ON documents(parentId, sortOrder);

        CREATE TABLE IF NOT EXISTS images (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          mimeType TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          createdAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function setSchemaVersion(db: BetterSqlite3Database, version: number): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(version));
}

export function runMigrations(database: BetterSqlite3Database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const getVersion = database
    .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
    .get() as { value?: string } | undefined;

  const startingVersion = getVersion?.value ? Number(getVersion.value) : 0;

  for (const migration of MIGRATIONS) {
    if (startingVersion >= migration.version) continue;
    const tx = database.transaction(() => {
      migration.up(database);
      setSchemaVersion(database, migration.version);
    });
    tx();
  }
}
