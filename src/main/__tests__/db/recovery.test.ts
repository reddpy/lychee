/**
 * A corrupt/unusable SQLite index is a non-event: files are the source of
 * truth, so `initDatabase()` quarantines the bad file and starts a fresh index
 * that the vault then repopulates. This is the property that lets a synced
 * device (or a recovered install) come up from files alone.
 *
 * Fail-closed safety is unchanged and covered in `backup.test.ts`: an
 * unreadable schema version, a failed backup, or a failed migration still
 * throw. Only file-level corruption (SQLITE_CORRUPT / SQLITE_NOTADB) recovers.
 */

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
  const dir = path.join(os.tmpdir(), `lychee-recovery-test-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Database corruption recovery', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('quarantines a non-database file and starts a fresh, openable index', async () => {
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    fs.writeFileSync(dbPath, 'this is not a sqlite database');

    const { initDatabase, getDb, closeDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = initDatabase();
    expect(result.dbPath).toBe(dbPath);
    expect(result.recovered).toBeTruthy();

    // The bad file was preserved for forensics under a `.corrupt-` name.
    const quarantined = fs
      .readdirSync(tmpDir)
      .filter((name) => name.startsWith('lychee.sqlite3.corrupt-'));
    expect(quarantined).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmpDir, quarantined[0]), 'utf8')).toContain(
      'this is not a sqlite database',
    );

    // A fresh, migrated index now exists at the canonical path.
    const names = (
      getDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(names).toContain('documents');
    expect(names).toContain('meta');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[db\] index unusable \(.+\): quarantined to /),
    );

    closeDatabase();
    errorSpy.mockRestore();
  });

  it('returns the recovery path only when the file was unusable', async () => {
    const { initDatabase, closeDatabase } = await import('../../db');
    const result = initDatabase();
    expect(result.recovered).toBeUndefined();
    closeDatabase();
  });

  it('quarantines the corrupt file (sidecars best-effort)', async () => {
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    fs.writeFileSync(dbPath, 'this is not a sqlite database');
    fs.writeFileSync(`${dbPath}-wal`, 'orphan wal');
    fs.writeFileSync(`${dbPath}-shm`, 'orphan shm');

    const { initDatabase, closeDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = initDatabase();
    expect(result.recovered).toBeTruthy();

    // The main file is preserved for forensics. SQLite may already have removed
    // the orphan sidecars on close, so their presence is not guaranteed here —
    // `quarantineDatabase` moves any that remain (covered directly below).
    const quarantined = fs
      .readdirSync(tmpDir)
      .filter((name) => name.startsWith('lychee.sqlite3.corrupt-'));
    expect(quarantined.some((name) => !name.endsWith('-wal') && !name.endsWith('-shm'))).toBe(true);

    closeDatabase();
    errorSpy.mockRestore();
  });

  it('recovers from a truncated database file', async () => {
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    const seed = new (await import('better-sqlite3')).default(dbPath);
    seed.exec(`CREATE TABLE marker (id INTEGER); INSERT INTO marker VALUES (1);`);
    seed.close();
    fs.truncateSync(dbPath, Math.max(1, Math.floor(fs.statSync(dbPath).size / 2)));

    const { initDatabase, getDb, closeDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = initDatabase();
    expect(result.recovered).toBeTruthy();
    expect(
      (getDb().prepare(`SELECT name FROM sqlite_master`).all() as unknown[]).length,
    ).toBeGreaterThan(0);

    closeDatabase();
    errorSpy.mockRestore();
  });

  it('still removes the unusable file when quarantine rename is not possible', async () => {
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    fs.writeFileSync(dbPath, 'garbage');

    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });

    const { initDatabase, getDb, closeDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = initDatabase();
    expect(result.recovered).toBeTruthy();
    // Rename failed, so the guard deleted the original to unblock the retry.
    expect(fs.existsSync(dbPath)).toBe(true); // the fresh DB now lives here
    expect(
      (getDb().prepare(`SELECT name FROM sqlite_master`).all() as unknown[]).length,
    ).toBeGreaterThan(0);

    closeDatabase();
    renameSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not quarantine a fail-closed migration error', async () => {
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
    expect(
      fs.readdirSync(tmpDir).filter((name) => name.includes('.corrupt-')),
    ).toHaveLength(0);

    errorSpy.mockRestore();
    vi.doUnmock('../../schema');
  });

  it('does not quarantine an unopenable path (e.g. a directory), it fails closed', async () => {
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    fs.mkdirSync(dbPath); // cannot open a directory as a database

    const { initDatabase } = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => initDatabase()).toThrow();
    expect(
      fs.readdirSync(tmpDir).filter((name) => name.includes('.corrupt-')),
    ).toHaveLength(0);

    errorSpy.mockRestore();
  });

  it('reports recovery only on the launch that recovered', async () => {
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    fs.writeFileSync(dbPath, 'garbage');

    const first = await import('../../db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(first.initDatabase().recovered).toBeTruthy();
    first.closeDatabase();

    vi.resetModules();
    const second = await import('../../db');
    expect(second.initDatabase().recovered).toBeUndefined();
    second.closeDatabase();
    errorSpy.mockRestore();
  });
});

describe('quarantineDatabase', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves the main file and any WAL/SHM sidecars under one stamp', async () => {
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    fs.writeFileSync(dbPath, 'main');
    fs.writeFileSync(`${dbPath}-wal`, 'wal');
    fs.writeFileSync(`${dbPath}-shm`, 'shm');

    const { quarantineDatabase } = await import('../../db');
    const base = quarantineDatabase(dbPath);

    expect(base.startsWith(`${dbPath}.corrupt-`)).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.readFileSync(base, 'utf8')).toBe('main');
    expect(fs.readFileSync(`${base}-wal`, 'utf8')).toBe('wal');
    expect(fs.readFileSync(`${base}-shm`, 'utf8')).toBe('shm');
  });

  it('removes the original instead of failing when rename is not possible', async () => {
    const dbPath = path.join(tmpDir, 'lychee.sqlite3');
    fs.writeFileSync(dbPath, 'main');

    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });

    const { quarantineDatabase } = await import('../../db');
    quarantineDatabase(dbPath);
    expect(fs.existsSync(dbPath)).toBe(false);

    renameSpy.mockRestore();
  });

  it('is a no-op for a path that does not exist', async () => {
    const { quarantineDatabase } = await import('../../db');
    expect(() => quarantineDatabase(path.join(tmpDir, 'lychee.sqlite3'))).not.toThrow();
  });
});
