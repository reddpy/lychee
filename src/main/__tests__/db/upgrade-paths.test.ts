/**
 * Tests for database migration upgrade paths.
 *
 * Verifies that migrations are idempotent, partial upgrades work correctly,
 * the v5 sortOrder backfill is accurate, and existing data survives upgrades.
 */

import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));

import { runMigrationsOn } from './migrations-helper';

describe('Database Migrations — Upgrade Paths', () => {
  it('running migrations twice on same DB does not error', () => {
    const db = new Database(':memory:');

    expect(() => { runMigrationsOn(db); }).not.toThrow();
    expect(() => { runMigrationsOn(db); }).not.toThrow();

    const row = db
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value: string };
    expect(row.value).toBe('6');

    db.close();
  });

  it('partial migration from v3 correctly applies v4-v6', () => {
    const db = new Database(':memory:');

    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        parentId TEXT NULL,
        emoji TEXT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_updatedAt ON documents(updatedAt);
      CREATE INDEX IF NOT EXISTS idx_documents_parentId ON documents(parentId);
      INSERT INTO meta (key, value) VALUES ('schema_version', '3');
    `);

    runMigrationsOn(db);

    const columns = db
      .prepare(`PRAGMA table_info(documents)`)
      .all() as { name: string }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('deletedAt');
    expect(colNames).toContain('sortOrder');

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='images'`)
      .get() as { name: string } | undefined;
    expect(tables).toBeDefined();

    const row = db
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value: string };
    expect(row.value).toBe('6');

    db.close();
  });

  it('v5 migration backfills sortOrder based on updatedAt (newer = lower sort)', () => {
    const db = new Database(':memory:');

    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        parentId TEXT NULL,
        emoji TEXT NULL,
        deletedAt TEXT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_updatedAt ON documents(updatedAt);
      CREATE INDEX IF NOT EXISTS idx_documents_parentId ON documents(parentId);
      INSERT INTO meta (key, value) VALUES ('schema_version', '4');
    `);

    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt)
       VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('old', 'Old Note', '2024-01-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt)
       VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('mid', 'Mid Note', '2024-06-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt)
       VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('new', 'New Note', '2024-12-01T00:00:00.000Z');

    runMigrationsOn(db);

    const rows = db
      .prepare(`SELECT id, sortOrder FROM documents ORDER BY sortOrder ASC`)
      .all() as { id: string; sortOrder: number }[];

    expect(rows[0].id).toBe('new');
    expect(rows[1].id).toBe('mid');
    expect(rows[2].id).toBe('old');

    db.close();
  });

  it('v5 migration assigns sortOrder independently per parent', () => {
    const db = new Database(':memory:');

    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        parentId TEXT NULL,
        emoji TEXT NULL,
        deletedAt TEXT NULL
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '4');
    `);

    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt) VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('root-old', 'Root Old', '2024-01-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt) VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('root-new', 'Root New', '2024-06-01T00:00:00.000Z');

    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId) VALUES (?, ?, '', '2024-01-01', ?, ?)`,
    ).run('child-old', 'Child Old', '2024-02-01T00:00:00.000Z', 'root-old');
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId) VALUES (?, ?, '', '2024-01-01', ?, ?)`,
    ).run('child-new', 'Child New', '2024-09-01T00:00:00.000Z', 'root-old');

    runMigrationsOn(db);

    const rootRows = db
      .prepare(`SELECT id, sortOrder FROM documents WHERE parentId IS NULL ORDER BY sortOrder ASC`)
      .all() as { id: string; sortOrder: number }[];
    expect(rootRows[0]).toEqual({ id: 'root-new', sortOrder: 0 });
    expect(rootRows[1]).toEqual({ id: 'root-old', sortOrder: 1 });

    const childRows = db
      .prepare(`SELECT id, sortOrder FROM documents WHERE parentId = 'root-old' ORDER BY sortOrder ASC`)
      .all() as { id: string; sortOrder: number }[];
    expect(childRows[0]).toEqual({ id: 'child-new', sortOrder: 0 });
    expect(childRows[1]).toEqual({ id: 'child-old', sortOrder: 1 });

    db.close();
  });

  it('existing data survives v4-v6 migrations without corruption', () => {
    const db = new Database(':memory:');

    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        parentId TEXT NULL,
        emoji TEXT NULL
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '3');
    `);

    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId, emoji)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('surv-1', 'My Note', '{"blocks":[]}', '2024-01-01', '2024-06-15', null, '📝');

    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId, emoji)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('surv-2', 'Child', 'hello world', '2024-02-01', '2024-03-01', 'surv-1', null);

    runMigrationsOn(db);

    const doc1 = db.prepare(`SELECT * FROM documents WHERE id = 'surv-1'`).get() as Record<string, unknown>;
    expect(doc1.title).toBe('My Note');
    expect(doc1.content).toBe('{"blocks":[]}');
    expect(doc1.createdAt).toBe('2024-01-01');
    expect(doc1.updatedAt).toBe('2024-06-15');
    expect(doc1.emoji).toBe('📝');
    expect(doc1.parentId).toBeNull();
    expect(doc1.deletedAt).toBeNull();
    expect(typeof doc1.sortOrder).toBe('number');

    const doc2 = db.prepare(`SELECT * FROM documents WHERE id = 'surv-2'`).get() as Record<string, unknown>;
    expect(doc2.title).toBe('Child');
    expect(doc2.content).toBe('hello world');
    expect(doc2.parentId).toBe('surv-1');
    expect(doc2.emoji).toBeNull();

    db.close();
  });

  // The v5 backfill uses COUNT(*) WHERE d2.updatedAt > documents.updatedAt.
  // If two docs have identical timestamps, they get the same sortOrder.
  it('v5 backfill assigns same sortOrder to docs with identical updatedAt', () => {
    const db = new Database(':memory:');

    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        parentId TEXT NULL,
        emoji TEXT NULL,
        deletedAt TEXT NULL
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '4');
    `);

    const sameTime = '2024-06-01T12:00:00.000Z';
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt) VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('doc-a', 'Doc A', sameTime);
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt) VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('doc-b', 'Doc B', sameTime);
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt) VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('doc-c', 'Doc C', sameTime);

    runMigrationsOn(db);

    const rows = db
      .prepare(`SELECT id, sortOrder FROM documents ORDER BY id ASC`)
      .all() as { id: string; sortOrder: number }[];

    // All three have the same updatedAt, so COUNT(*) WHERE d2.updatedAt > X
    // returns 0 for all of them — they all get sortOrder 0.
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[1].sortOrder).toBe(0);
    expect(rows[2].sortOrder).toBe(0);

    db.close();
  });

  // The v5 backfill UPDATE runs on ALL documents — including trashed ones.
  // Trashed docs should also get a valid sortOrder (not left at default 0).
  it('v5 backfill assigns sortOrder to trashed documents too', () => {
    const db = new Database(':memory:');

    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        parentId TEXT NULL,
        emoji TEXT NULL,
        deletedAt TEXT NULL
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '4');
    `);

    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt, deletedAt) VALUES (?, ?, '', '2024-01-01', ?, ?)`,
    ).run('trashed', 'Trashed Note', '2024-03-01T00:00:00.000Z', '2024-04-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO documents (id, title, content, createdAt, updatedAt) VALUES (?, ?, '', '2024-01-01', ?)`,
    ).run('active', 'Active Note', '2024-06-01T00:00:00.000Z');

    runMigrationsOn(db);

    const trashed = db
      .prepare(`SELECT sortOrder FROM documents WHERE id = 'trashed'`)
      .get() as { sortOrder: number };
    const active = db
      .prepare(`SELECT sortOrder FROM documents WHERE id = 'active'`)
      .get() as { sortOrder: number };

    // active has newer updatedAt → lower sortOrder (0)
    // trashed has older updatedAt → higher sortOrder (1)
    // Both get a sortOrder, not just active ones.
    expect(active.sortOrder).toBe(0);
    expect(trashed.sortOrder).toBe(1);

    db.close();
  });

  // Migrations v2-v6 detect presence via column/table checks, not version number.
  // If columns already exist (e.g. from a manual ALTER) but version is low,
  // the migration correctly skips the ALTER and doesn't error.
  it('skips migration when column already exists despite low version', () => {
    const db = new Database(':memory:');

    // Set up v1 schema but manually add the parentId column (as if someone
    // manually altered the table). Version stays at 1.
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        parentId TEXT NULL
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '1');
    `);

    // Run migrations — v2 should be skipped (parentId already exists)
    // but v3-v6 should still apply.
    expect(() => { runMigrationsOn(db); }).not.toThrow();

    const columns = db
      .prepare(`PRAGMA table_info(documents)`)
      .all() as { name: string }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('parentId');
    expect(colNames).toContain('emoji');
    expect(colNames).toContain('deletedAt');
    expect(colNames).toContain('sortOrder');

    // Final version should be 6
    const row = db
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value: string };
    expect(row.value).toBe('6');

    db.close();
  });
});
