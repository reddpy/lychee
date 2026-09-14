import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { withVaultWriteLock, vaultLockPath } from '../vault-lock';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-lock-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function seedLock(relativePath: string, info: unknown): string {
  const lockPath = vaultLockPath(root, relativePath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, typeof info === 'string' ? info : JSON.stringify(info));
  return lockPath;
}

describe('withVaultWriteLock', () => {
  it('runs the callback, returns its value, and releases the lock', () => {
    const lockPath = vaultLockPath(root, 'Note.md');
    let ran = false;
    const result = withVaultWriteLock(root, 'Note.md', () => {
      ran = true;
      return 7;
    });
    expect(ran).toBe(true);
    expect(result).toBe(7);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('keeps lock files under .lychee/locks (a dir the scanner ignores)', () => {
    const relative = path.relative(root, vaultLockPath(root, 'A/B.md')).split(path.sep).join('/');
    expect(relative).toMatch(/^\.lychee\/locks\/[0-9a-f]{24}\.lock$/);
  });

  it('is reentrant on the same path (nested acquire does not deadlock)', () => {
    const value = withVaultWriteLock(root, 'Note.md', () =>
      withVaultWriteLock(root, 'Note.md', () => 'inner'),
    );
    expect(value).toBe('inner');
    expect(fs.existsSync(vaultLockPath(root, 'Note.md'))).toBe(false);
  });

  it('reclaims a lock whose recorded pid is not alive', () => {
    seedLock('Note.md', { pid: 2 ** 30, at: Date.now() });
    const ran = withVaultWriteLock(root, 'Note.md', () => true, { timeoutMs: 500 });
    expect(ran).toBe(true);
  });

  it('reclaims an expired lock even when the recorded pid is alive', () => {
    seedLock('Note.md', { pid: process.pid, at: Date.now() - 60_000 });
    const ran = withVaultWriteLock(root, 'Note.md', () => true, { timeoutMs: 500 });
    expect(ran).toBe(true);
  });

  it('reclaims a corrupt lock file', () => {
    seedLock('Note.md', 'not json');
    const ran = withVaultWriteLock(root, 'Note.md', () => true, { timeoutMs: 500 });
    expect(ran).toBe(true);
  });

  it('does not steal a live lock: fails open and leaves the holder untouched', () => {
    const holder = JSON.stringify({ pid: process.pid, at: Date.now() });
    const lockPath = seedLock('Note.md', holder);

    const ran = withVaultWriteLock(root, 'Note.md', () => 'ran', { timeoutMs: 60 });

    expect(ran).toBe('ran'); // fail-open: the caller still runs
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(holder); // but the lock survives
  });
});
