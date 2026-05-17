import type { Database as BetterSqlite3Database } from 'better-sqlite3';

/**
 * Schema (v1 baseline — squashed from former v1–v9):
 *   meta      (key, value)                                — schema version + future kv
 *   documents (id, title, content, createdAt, updatedAt,
 *              parentId, emoji, deletedAt, sortOrder, metadata)
 *   images    (id, filename, mimeType, width, height, createdAt)
 *   settings  (key, value)                                — app settings
 *
 * Add new schema changes as v2+ blocks below, gated by feature detection.
 * Pure schema logic — no electron, no filesystem, no singleton state.
 */
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

  const currentVersion = getVersion?.value ? Number(getVersion.value) : 0;

  if (currentVersion < 1) {
    const tx = database.transaction(() => {
      database.exec(`
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

      database
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run('1');
    });

    tx();
  }
}
