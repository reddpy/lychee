/**
 * Tests for database schema after a fresh migration.
 *
 * Verifies that a brand-new database gets the correct tables, columns,
 * indexes, pragmas, and column defaults after all migrations run.
 */

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, closeTestDb } from '../helpers';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));

describe('Database Schema — Fresh Migration', () => {
  let db: BetterSqlite3Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    closeTestDb();
  });

  it('creates documents table with all 9 columns after fresh migration', () => {
    const columns = db
      .prepare(`PRAGMA table_info(documents)`)
      .all() as { name: string }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('title');
    expect(colNames).toContain('content');
    expect(colNames).toContain('createdAt');
    expect(colNames).toContain('updatedAt');
    expect(colNames).toContain('parentId');
    expect(colNames).toContain('emoji');
    expect(colNames).toContain('deletedAt');
    expect(colNames).toContain('sortOrder');
    expect(colNames).toHaveLength(9);
  });

  it('creates images table with all 6 columns', () => {
    const columns = db
      .prepare(`PRAGMA table_info(images)`)
      .all() as { name: string }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('filename');
    expect(colNames).toContain('mimeType');
    expect(colNames).toContain('width');
    expect(colNames).toContain('height');
    expect(colNames).toContain('createdAt');
    expect(colNames).toHaveLength(6);
  });

  it('sets schema_version to 6 in meta table', () => {
    const row = db
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value: string };
    expect(row.value).toBe('6');
  });

  it('creates all expected indexes', () => {
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL`)
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_documents_updatedAt');
    expect(indexNames).toContain('idx_documents_parentId');
    expect(indexNames).toContain('idx_documents_sortOrder');
  });

  it('sets journal mode pragma without error (memory for in-memory DB)', () => {
    const row = db
      .prepare(`PRAGMA journal_mode`)
      .get() as { journal_mode: string };
    expect(row.journal_mode).toBe('memory');
  });

  it('enables foreign_keys pragma', () => {
    const row = db
      .prepare(`PRAGMA foreign_keys`)
      .get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  it('sortOrder column defaults to 0', () => {
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt)
       VALUES ('test-id', 'Test', '', '2024-01-01', '2024-01-01')`,
    ).run();
    const row = db
      .prepare(`SELECT sortOrder FROM documents WHERE id = 'test-id'`)
      .get() as { sortOrder: number };
    expect(row.sortOrder).toBe(0);
  });

  it('nullable columns default to NULL', () => {
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt)
       VALUES ('null-test', 'Test', '', '2024-01-01', '2024-01-01')`,
    ).run();
    const row = db
      .prepare(`SELECT parentId, emoji, deletedAt FROM documents WHERE id = 'null-test'`)
      .get() as { parentId: string | null; emoji: string | null; deletedAt: string | null };
    expect(row.parentId).toBeNull();
    expect(row.emoji).toBeNull();
    expect(row.deletedAt).toBeNull();
  });
});
