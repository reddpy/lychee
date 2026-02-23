/**
 * Shared migration runner for DB tests.
 *
 * Duplicates the migration logic from db.ts so tests can run migrations
 * on arbitrary database instances (e.g. partially-migrated DBs).
 */

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

export function runMigrationsOn(database: BetterSqlite3Database) {
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
    database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_documents_updatedAt ON documents(updatedAt);
      `);
      database.prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run('1');
    })();
  }

  const columns = database.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === 'parentId')) {
    database.transaction(() => {
      database.exec(`ALTER TABLE documents ADD COLUMN parentId TEXT NULL;`);
      database.exec(`CREATE INDEX IF NOT EXISTS idx_documents_parentId ON documents(parentId);`);
      database.prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run('2');
    })();
  }

  const cols2 = database.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
  if (!cols2.some((c) => c.name === 'emoji')) {
    database.transaction(() => {
      database.exec(`ALTER TABLE documents ADD COLUMN emoji TEXT NULL`);
      database.prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run('3');
    })();
  }

  const cols3 = database.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
  if (!cols3.some((c) => c.name === 'deletedAt')) {
    database.transaction(() => {
      database.exec(`ALTER TABLE documents ADD COLUMN deletedAt TEXT NULL`);
      database.prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run('4');
    })();
  }

  const cols4 = database.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[];
  if (!cols4.some((c) => c.name === 'sortOrder')) {
    database.transaction(() => {
      database.exec(`ALTER TABLE documents ADD COLUMN sortOrder INTEGER DEFAULT 0`);
      database.exec(`CREATE INDEX IF NOT EXISTS idx_documents_sortOrder ON documents(parentId, sortOrder)`);
      database.exec(`
        UPDATE documents SET sortOrder = (
          SELECT COUNT(*) FROM documents d2
          WHERE d2.parentId IS documents.parentId
          AND d2.updatedAt > documents.updatedAt
        )
      `);
      database.prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run('5');
    })();
  }

  const tbl = database
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='images'`)
    .get() as { name: string } | undefined;
  if (!tbl) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE images (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          mimeType TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          createdAt TEXT NOT NULL
        );
      `);
      database.prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run('6');
    })();
  }
}
