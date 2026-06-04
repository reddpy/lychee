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

// Backup names that are actual regular files — excludes the directory we plant
// at a backup path to simulate a write failure (which shares the naming).
function listBackupFiles(dir: string): string[] {
  return listBackups(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile());
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

  it('fails closed with a clear log when the backup cannot be written', async () => {
    const dbPath = seedPreV1Db(tmpDir);

    // Force vacuumIntoFile to fail: a directory at the backup path makes both
    // the unlink and VACUUM INTO write throw (EISDIR/EPERM), standing in for
    // disk-full / permission-denied during backup.
    fs.mkdirSync(path.join(tmpDir, 'lychee.sqlite3.bak-v0'));

    const { initDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Fail closed: launch aborts rather than migrating without a backup.
    expect(() => initDatabase()).toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[db\] backup failed \(.+\): refusing to migrate/),
    );
    // The logged code is a real filesystem code, never the "unknown" fallback.
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('backup failed (unknown)'),
    );

    // The original (pre-v1) DB is untouched: no migration ran, marker intact.
    const reopened = new Database(dbPath, { readonly: true });
    const tables = reopened
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as { name: string }[];
    reopened.close();
    const names = tables.map((t) => t.name);
    expect(names).toContain('marker');
    expect(names).not.toContain('meta');

    errorSpy.mockRestore();
  });

  it('logs the SQLite error code and removes the partial backup on disk-full', async () => {
    const dbPath = seedPreV1Db(tmpDir);
    const partialPath = path.join(tmpDir, 'lychee.sqlite3.bak-v0');

    // Re-import better-sqlite3 from the freshly reset module registry so it is
    // the SAME class db.ts will import — then spy on its `exec` to simulate a
    // VACUUM INTO that writes a truncated file and fails with SQLITE_FULL.
    const Bsq = (await import('better-sqlite3')).default;
    const realExec = Bsq.prototype.exec;
    const execSpy = vi
      .spyOn(Bsq.prototype, 'exec')
      .mockImplementation(function (this: unknown, source: string) {
        if (typeof source === 'string' && source.includes('VACUUM INTO')) {
          fs.writeFileSync(partialPath, 'truncated-garbage'); // partial write
          const e = new Error('database or disk is full') as Error & {
            code: string;
          };
          e.code = 'SQLITE_FULL';
          throw e;
        }
        return (realExec as (s: string) => unknown).call(this, source);
      } as typeof realExec);

    const { initDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => initDatabase()).toThrow(/disk is full/);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[db] backup failed (SQLITE_FULL)'),
    );

    // The truncated backup must not be left masquerading as a valid snapshot.
    expect(fs.existsSync(partialPath)).toBe(false);

    // Original DB still intact and un-migrated.
    const reopened = new Database(dbPath, { readonly: true });
    const names = (
      reopened
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((t) => t.name);
    reopened.close();
    expect(names).toContain('marker');
    expect(names).not.toContain('meta');

    execSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('leaves the module uninitialized after a failed backup (getDb throws, close is a no-op)', async () => {
    seedPreV1Db(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'lychee.sqlite3.bak-v0'));

    const { initDatabase, getDb, closeDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => initDatabase()).toThrow();

    // db global was never assigned → callers see a clear "not initialized".
    expect(() => getDb()).toThrow(/not initialized/);
    // closeDatabase must not double-close / throw when init never completed.
    expect(() => closeDatabase()).not.toThrow();

    errorSpy.mockRestore();
  });

  it('recovers on a later launch once the backup destination is writable again', async () => {
    seedPreV1Db(tmpDir);
    const obstacle = path.join(tmpDir, 'lychee.sqlite3.bak-v0');
    fs.mkdirSync(obstacle); // first launch: backup destination blocked

    const first = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => first.initDatabase()).toThrow();
    expect(listBackupFiles(tmpDir)).toHaveLength(0); // no real backup yet

    // Disk freed / permission fixed before the next launch.
    fs.rmdirSync(obstacle);
    vi.resetModules();
    const second = await import('../../db');
    expect(() => second.initDatabase()).not.toThrow();
    second.closeDatabase();

    // The retry produced a real, openable backup snapshot.
    expect(listBackups(tmpDir)).toEqual(['lychee.sqlite3.bak-v0']);
    const backup = new Database(obstacle, { readonly: true });
    const names = (
      backup
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((t) => t.name);
    backup.close();
    expect(names).toContain('marker');

    errorSpy.mockRestore();
  });

  it('fails closed reliably across repeated launches without leaking state', async () => {
    seedPreV1Db(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'lychee.sqlite3.bak-v0'));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Every launch under a persistent backup failure must abort the same way —
    // no accumulated state, no eventual "success" that skips the backup.
    for (let i = 0; i < 25; i++) {
      vi.resetModules();
      const { initDatabase, getDb } = await import('../../db');
      expect(() => initDatabase()).toThrow();
      expect(() => getDb()).toThrow(/not initialized/);
    }

    // Never created a real backup and never partially migrated the original DB
    // (the obstacle directory keeps the bak-v0 name, but it is not a file).
    expect(listBackupFiles(tmpDir)).toHaveLength(0);
    const reopened = new Database(path.join(tmpDir, 'lychee.sqlite3'), {
      readonly: true,
    });
    const names = (
      reopened
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((t) => t.name);
    reopened.close();
    expect(names).toContain('marker');
    expect(names).not.toContain('meta');

    errorSpy.mockRestore();
  });

  it('fails closed when the on-disk schema version is unreadable', async () => {
    // A DB whose meta.schema_version is corrupt (non-numeric): we can't tell
    // which migrations apply, so launch must abort rather than guess.
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    const seed = new Database(dbPath);
    seed.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    seed
      .prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`)
      .run('not-a-number');
    seed.exec(`CREATE TABLE marker (id INTEGER);`);
    seed.close();

    const { initDatabase, getDb } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => initDatabase()).toThrow(/unreadable schema_version/);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[db\] unreadable schema_version .*: refusing to migrate/,
      ),
    );

    // Refused before backup/migration: no backup written, module uninitialized,
    // and the original DB (marker + meta) is left exactly as it was.
    expect(listBackupFiles(tmpDir)).toHaveLength(0);
    expect(() => getDb()).toThrow(/not initialized/);

    const reopened = new Database(dbPath, { readonly: true });
    const names = (
      reopened
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((t) => t.name);
    reopened.close();
    expect(names).toContain('marker');
    expect(names).toContain('meta');

    errorSpy.mockRestore();
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

describe('backupErrorCode', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('prefers the string code (better-sqlite3 / fs errors)', async () => {
    const { backupErrorCode } = await import('../../db');
    expect(backupErrorCode({ code: 'SQLITE_FULL' })).toBe('SQLITE_FULL');
    // fs errors carry both; the readable string wins over the numeric errno.
    expect(backupErrorCode({ code: 'EACCES', errno: -13 })).toBe('EACCES');
  });

  it('falls back to the numeric errno when no code is present', async () => {
    const { backupErrorCode } = await import('../../db');
    expect(backupErrorCode({ errno: -28 })).toBe(-28);
  });

  it('returns "unknown" for codeless or non-object errors', async () => {
    const { backupErrorCode } = await import('../../db');
    expect(backupErrorCode(new Error('boom'))).toBe('unknown');
    expect(backupErrorCode(null)).toBe('unknown');
    expect(backupErrorCode(undefined)).toBe('unknown');
    expect(backupErrorCode('a bare string')).toBe('unknown');
  });
});

describe('parseSchemaVersion', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('treats a missing or empty value as an unversioned (fresh) DB', async () => {
    const { parseSchemaVersion } = await import('../../db');
    expect(parseSchemaVersion(undefined)).toBe(0);
    expect(parseSchemaVersion('')).toBe(0);
    expect(parseSchemaVersion('0')).toBe(0);
  });

  it('parses valid non-negative integer versions', async () => {
    const { parseSchemaVersion } = await import('../../db');
    expect(parseSchemaVersion('1')).toBe(1);
    expect(parseSchemaVersion('1000')).toBe(1000);
  });

  it('throws on corrupt, fractional, or negative versions', async () => {
    const { parseSchemaVersion } = await import('../../db');
    expect(() => parseSchemaVersion('abc')).toThrow(/unreadable schema_version/);
    expect(() => parseSchemaVersion('1.5')).toThrow(/unreadable schema_version/);
    expect(() => parseSchemaVersion('-1')).toThrow(/unreadable schema_version/);
    expect(() => parseSchemaVersion('NaN')).toThrow(/unreadable schema_version/);
  });
});
