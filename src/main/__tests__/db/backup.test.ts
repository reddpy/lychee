/**
 * Tests for pre-migration backup of lychee.sqlite3.
 *
 * Verifies that initDatabase() copies the DB to lychee.sqlite3.bak-v{n}
 * before running migrations when pending migrations exist, prunes old
 * backups, and logs the backup path on migration failure.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpDir) },
}));

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `lychee-backup-test-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function seedPreV1Db(dir: string): string {
  // A DB file with no `meta` table → readSchemaVersion returns 0,
  // which is below LATEST_SCHEMA_VERSION (1), so migrations are "pending".
  const dbPath = path.join(dir, 'lychee.sqlite3');
  const seed = new Database(dbPath);
  seed.exec(`CREATE TABLE marker (id INTEGER);`);
  seed.close();
  return dbPath;
}

function listBackups(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) => /^lychee\.sqlite3\.bak-v\d+$/.test(n))
    .sort();
}

describe('Database backup before migrations', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips backup on fresh install (no DB file exists)', async () => {
    const { initDatabase, closeDatabase } = await import('../../db');

    initDatabase();
    closeDatabase();

    expect(listBackups(tmpDir)).toHaveLength(0);
  });

  it('creates bak-v0 when DB exists below latest schema version', async () => {
    seedPreV1Db(tmpDir);

    const { initDatabase, closeDatabase } = await import('../../db');
    initDatabase();
    closeDatabase();

    const backups = listBackups(tmpDir);
    expect(backups).toEqual(['lychee.sqlite3.bak-v0']);
  });

  it('skips backup when DB is already at latest schema version', async () => {
    // First run: creates the DB at v1.
    const { initDatabase, closeDatabase } = await import('../../db');
    initDatabase();
    closeDatabase();
    expect(listBackups(tmpDir)).toHaveLength(0);

    // Second run on the same DB (already at v1): no backup should be created.
    vi.resetModules();
    const second = await import('../../db');
    second.initDatabase();
    second.closeDatabase();

    expect(listBackups(tmpDir)).toHaveLength(0);
  });

  it('leaves the backup file in place when migrations throw', async () => {
    seedPreV1Db(tmpDir);

    vi.doMock('../../schema', async () => {
      const actual = await vi.importActual<typeof import('../../schema')>('../../schema');
      return {
        ...actual,
        runMigrations: () => {
          throw new Error('forced migration failure');
        },
      };
    });

    const { initDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => initDatabase()).toThrow('forced migration failure');

    const backups = listBackups(tmpDir);
    expect(backups).toEqual(['lychee.sqlite3.bak-v0']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('lychee.sqlite3.bak-v0'),
    );

    errorSpy.mockRestore();
    vi.doUnmock('../../schema');
  });

  it('prunes old backups, keeping only the 3 most recent', async () => {
    // Seed 5 pre-existing backup files at versions 0..4.
    for (const v of [0, 1, 2, 3, 4]) {
      fs.writeFileSync(path.join(tmpDir, `lychee.sqlite3.bak-v${v}`), `v${v}`);
    }
    // Plus a real pre-v1 DB so a new backup will be written.
    seedPreV1Db(tmpDir);

    const { initDatabase, closeDatabase } = await import('../../db');
    initDatabase();
    closeDatabase();

    // After init: bak-v0 is overwritten by the fresh copy (still v0),
    // then pruning keeps the 3 highest version numbers → v4, v3, v2.
    const backups = listBackups(tmpDir);
    expect(backups).toEqual([
      'lychee.sqlite3.bak-v2',
      'lychee.sqlite3.bak-v3',
      'lychee.sqlite3.bak-v4',
    ]);
  });

  it('leaves the original DB usable after a migration failure (transaction rollback)', async () => {
    const dbPath = seedPreV1Db(tmpDir);

    vi.doMock('../../schema', async () => {
      const actual = await vi.importActual<typeof import('../../schema')>('../../schema');
      return {
        ...actual,
        runMigrations: () => {
          throw new Error('forced migration failure');
        },
      };
    });

    const { initDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => initDatabase()).toThrow('forced migration failure');

    // The original (pre-v1) DB still exists with its marker table intact.
    const reopened = new Database(dbPath, { readonly: true });
    const tables = reopened
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='marker'`)
      .all();
    reopened.close();
    expect(tables).toHaveLength(1);

    errorSpy.mockRestore();
    vi.doUnmock('../../schema');
  });
});
