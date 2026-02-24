/**
 * Shared test helpers for backend tests.
 *
 * Provides:
 * - createTestDb()  — fresh in-memory SQLite with all migrations applied
 * - insertDoc()     — insert a doc row directly (bypasses createDocument logic)
 * - getAllDocs()     — dump all non-deleted docs ordered by sortOrder
 * - getSortOrders() — get sortOrder values for siblings under a given parentId
 */

import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';

// We need to reach into db.ts internals. The module exports getDb/initDatabase/closeDatabase
// but runMigrations is not exported. We'll call it by initializing a fresh DB and running
// the migration SQL ourselves via the exported initDatabase — but that requires mocking
// electron's app.getPath. Instead, we'll directly create a DB and run migrations manually.

/**
 * Run the same migrations as db.ts on an arbitrary database instance.
 * This is a copy of the migration logic so tests use real SQL against real SQLite.
 */
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

  const columnsAfterV4 = database
    .prepare(`PRAGMA table_info(documents)`)
    .all() as { name: string }[];
  const hasSortOrder = columnsAfterV4.some((col) => col.name === 'sortOrder');

  if (!hasSortOrder) {
    const tx = database.transaction(() => {
      database.exec(`ALTER TABLE documents ADD COLUMN sortOrder INTEGER DEFAULT 0`);
      database.exec(
        `CREATE INDEX IF NOT EXISTS idx_documents_sortOrder ON documents(parentId, sortOrder)`,
      );
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

  const tables = database
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='images'`)
    .get() as { name: string } | undefined;

  if (!tables) {
    const tx = database.transaction(() => {
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
      database
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run('6');
    });
    tx();
  }

  // v8: generic key-value settings table
  const hasSettings = database
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`)
    .get() as { name: string } | undefined;

  if (!hasSettings) {
    const tx = database.transaction(() => {
      database.exec(`
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
        .run('8');
    });
    tx();
  }
}

let testDb: BetterSqlite3Database | null = null;

/**
 * Creates a fresh in-memory SQLite database with all migrations applied.
 * Also mocks getDb() from ../db to return this instance.
 * Call this in beforeEach() for test isolation.
 */
export function createTestDb(): BetterSqlite3Database {
  const db = new Database(':memory:');
  runMigrations(db);
  testDb = db;
  return db;
}

/**
 * Returns the current test database instance.
 * Use this as the mock implementation for getDb().
 */
export function getTestDb(): BetterSqlite3Database {
  if (!testDb) throw new Error('Test DB not initialized. Call createTestDb() first.');
  return testDb;
}

/**
 * Close and discard the test database. Call in afterEach().
 */
export function closeTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

/**
 * Insert a document row directly into the test DB, bypassing createDocument logic.
 * Useful for setting up specific test scenarios without side effects.
 */
export function insertDoc(
  db: BetterSqlite3Database,
  overrides: Partial<{
    id: string;
    title: string;
    content: string;
    createdAt: string;
    updatedAt: string;
    parentId: string | null;
    emoji: string | null;
    deletedAt: string | null;
    sortOrder: number;
  }> = {},
) {
  const now = new Date().toISOString();
  const doc = {
    id: overrides.id ?? randomUUID(),
    title: overrides.title ?? '',
    content: overrides.content ?? '',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    parentId: overrides.parentId ?? null,
    emoji: overrides.emoji ?? null,
    deletedAt: overrides.deletedAt ?? null,
    sortOrder: overrides.sortOrder ?? 0,
  };

  db.prepare(
    `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    doc.id,
    doc.title,
    doc.content,
    doc.createdAt,
    doc.updatedAt,
    doc.parentId,
    doc.emoji,
    doc.deletedAt,
    doc.sortOrder,
  );

  return doc;
}

/**
 * Get all non-deleted documents ordered by sortOrder ASC, updatedAt DESC.
 * Mirrors the listDocuments query for easy assertion.
 */
export function getAllDocs(db: BetterSqlite3Database) {
  return db
    .prepare(
      `SELECT id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder
       FROM documents
       WHERE deletedAt IS NULL
       ORDER BY sortOrder ASC, updatedAt DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    content: string;
    createdAt: string;
    updatedAt: string;
    parentId: string | null;
    emoji: string | null;
    deletedAt: string | null;
    sortOrder: number;
  }>;
}

/**
 * Get sortOrder values for non-deleted siblings under a given parentId.
 * Returns sorted array of sortOrder numbers — useful for verifying contiguous sequences.
 */
export function getSortOrders(
  db: BetterSqlite3Database,
  parentId: string | null,
): number[] {
  const rows = db
    .prepare(
      `SELECT sortOrder FROM documents
       WHERE parentId IS ? AND deletedAt IS NULL
       ORDER BY sortOrder ASC`,
    )
    .all(parentId) as { sortOrder: number }[];
  return rows.map((r) => r.sortOrder);
}

/**
 * Get ALL documents (including trashed) for a parent.
 */
export function getAllDocsForParent(
  db: BetterSqlite3Database,
  parentId: string | null,
) {
  return db
    .prepare(
      `SELECT id, title, sortOrder, deletedAt, parentId
       FROM documents
       WHERE parentId IS ?
       ORDER BY sortOrder ASC`,
    )
    .all(parentId) as Array<{
    id: string;
    title: string;
    sortOrder: number;
    deletedAt: string | null;
    parentId: string | null;
  }>;
}
