import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';

let db: BetterSqlite3Database | null = null;

function runMigrations(database: BetterSqlite3Database) {
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

  // v1: documents table
  if (currentVersion < 1) {
    const tx = database.transaction(() => {
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

      database
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run('1');
    });

    tx();
  }

  // v2: add parentId for nested documents (idempotent if column already exists)
  const columns = database
    .prepare(`PRAGMA table_info(documents)`)
    .all() as { name: string }[];
  const hasParentId = columns.some((col) => col.name === 'parentId');

  if (!hasParentId) {
    const tx = database.transaction(() => {
      database.exec(`
        ALTER TABLE documents ADD COLUMN parentId TEXT NULL;
        CREATE INDEX IF NOT EXISTS idx_documents_parentId ON documents(parentId);
      `);

      database
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run('2');
    });

    tx();
  }

  // v3: add emoji for note icon
  const columnsAfterV2 = database
    .prepare(`PRAGMA table_info(documents)`)
    .all() as { name: string }[];
  const hasEmoji = columnsAfterV2.some((col) => col.name === 'emoji');

  if (!hasEmoji) {
    const tx = database.transaction(() => {
      database.exec(`ALTER TABLE documents ADD COLUMN emoji TEXT NULL`);

      database
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run('3');
    });

    tx();
  }

  // v4: add deletedAt for trash (soft delete)
  const columnsAfterV3 = database
    .prepare(`PRAGMA table_info(documents)`)
    .all() as { name: string }[];
  const hasDeletedAt = columnsAfterV3.some((col) => col.name === 'deletedAt');

  if (!hasDeletedAt) {
    const tx = database.transaction(() => {
      database.exec(`ALTER TABLE documents ADD COLUMN deletedAt TEXT NULL`);
      database
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run('4');
    });

    tx();
  }

  // v5: add sortOrder for manual ordering within siblings
  const columnsAfterV4 = database
    .prepare(`PRAGMA table_info(documents)`)
    .all() as { name: string }[];
  const hasSortOrder = columnsAfterV4.some((col) => col.name === 'sortOrder');

  if (!hasSortOrder) {
    const tx = database.transaction(() => {
      database.exec(`ALTER TABLE documents ADD COLUMN sortOrder INTEGER DEFAULT 0`);
      database.exec(`CREATE INDEX IF NOT EXISTS idx_documents_sortOrder ON documents(parentId, sortOrder)`);
      // Initialize sortOrder for existing documents based on updatedAt (newer = lower sortOrder = appears first)
      database.exec(`
        UPDATE documents SET sortOrder = (
          SELECT COUNT(*) FROM documents d2
          WHERE d2.parentId IS documents.parentId
          AND d2.updatedAt > documents.updatedAt
        )
      `);
      database
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run('5');
    });

    tx();
  }
}

export function initDatabase(): { dbPath: string } {
  // If already initialized, return the last known path.
  if (db) {
    // better-sqlite3 exposes `.name` (string) on the db instance (not in typings).
    const existingPath =
      typeof (db as unknown as { name?: unknown }).name === 'string'
        ? ((db as unknown as { name: string }).name as string)
        : 'lychee.sqlite3';
    return { dbPath: existingPath };
  }

  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });

  const dbPath = path.join(userDataDir, 'lychee.sqlite3');
  const database = new Database(dbPath);

  runMigrations(database);

  db = database;
  return { dbPath };
}

export function getDb(): BetterSqlite3Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}

