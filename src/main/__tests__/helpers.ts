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
import { runMigrations } from '../schema';

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
