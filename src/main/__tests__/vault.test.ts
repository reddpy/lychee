import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readVaultFile, resolveWithinVault, writeVaultEntries, contentRevision, scanVaultDirectory, writeVaultEntryGuarded } from '../vault';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-vault-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveWithinVault', () => {
  it('resolves a nested relative path inside the root', () => {
    expect(resolveWithinVault(root, 'A/B.md')).toBe(path.join(root, 'A', 'B.md'));
  });

  it('rejects absolute paths', () => {
    expect(() => resolveWithinVault(root, '/etc/passwd')).toThrow(/Invalid vault path/);
  });

  it('rejects parent-directory escapes', () => {
    expect(() => resolveWithinVault(root, '../outside.md')).toThrow(/escapes the vault/);
    expect(() => resolveWithinVault(root, 'A/../../outside.md')).toThrow(/escapes the vault/);
  });
});

describe('writeVaultEntries', () => {
  it('writes nested files with exact contents', () => {
    const written = writeVaultEntries(root, [
      { relativePath: 'Parent Note.md', contents: '# Parent Note\n' },
      { relativePath: 'Parent Note/Child.md', contents: '# Child\n' },
    ]);

    expect(written).toBe(2);
    expect(readVaultFile(path.join(root, 'Parent Note.md'))).toBe('# Parent Note\n');
    expect(readVaultFile(path.join(root, 'Parent Note', 'Child.md'))).toBe('# Child\n');
  });

  it('overwrites an existing file atomically without leaving temp files', () => {
    writeVaultEntries(root, [{ relativePath: 'Note.md', contents: 'first' }]);
    writeVaultEntries(root, [{ relativePath: 'Note.md', contents: 'second' }]);

    expect(readVaultFile(path.join(root, 'Note.md'))).toBe('second');
    const leftovers = fs.readdirSync(root).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('rejects an escaping entry', () => {
    expect(() => writeVaultEntries(root, [{ relativePath: '../escape.md', contents: 'x' }])).toThrow(
      /escapes the vault/,
    );
  });

  it('preserves unicode contents', () => {
    const contents = '# 日本語 🎉\n\ncafé\n';
    writeVaultEntries(root, [{ relativePath: 'ユニコード.md', contents }]);
    expect(readVaultFile(path.join(root, 'ユニコード.md'))).toBe(contents);
  });
});

describe('contentRevision', () => {
  it('is stable for identical contents and differs otherwise', () => {
    expect(contentRevision('a')).toBe(contentRevision('a'));
    expect(contentRevision('a')).not.toBe(contentRevision('b'));
  });
});

describe('writeVaultEntryGuarded', () => {
  it('writes a new file when the expected revision is null', () => {
    const result = writeVaultEntryGuarded(root, { relativePath: 'New.md', contents: 'hi' }, null);
    expect(result).toEqual({ status: 'written', relativePath: 'New.md' });
    expect(readVaultFile(path.join(root, 'New.md'))).toBe('hi');
  });

  it('treats an unexpected existing file as a conflict', () => {
    fs.writeFileSync(path.join(root, 'Existing.md'), 'external');
    const result = writeVaultEntryGuarded(root, { relativePath: 'Existing.md', contents: 'mine' }, null);
    expect(result.status).toBe('conflict');
    expect(readVaultFile(path.join(root, 'Existing.md'))).toBe('external');
  });

  it('overwrites when the revision matches', () => {
    fs.writeFileSync(path.join(root, 'Note.md'), 'v1');
    const revision = contentRevision('v1');
    const result = writeVaultEntryGuarded(root, { relativePath: 'Note.md', contents: 'v2' }, revision);
    expect(result).toEqual({ status: 'written', relativePath: 'Note.md' });
    expect(readVaultFile(path.join(root, 'Note.md'))).toBe('v2');
  });

  it('writes a conflict copy when the file changed underneath', () => {
    fs.writeFileSync(path.join(root, 'Note.md'), 'external edit');
    const result = writeVaultEntryGuarded(
      root,
      { relativePath: 'Note.md', contents: 'my edit' },
      contentRevision('stale'),
      '2026-09-12T10:00:00.000Z',
    );
    expect(result).toEqual({ status: 'conflict', conflictPath: 'Note (conflict 2026-09-12 10-00-00).md' });
    expect(readVaultFile(path.join(root, 'Note.md'))).toBe('external edit');
    expect(readVaultFile(path.join(root, 'Note (conflict 2026-09-12 10-00-00).md'))).toBe('my edit');
  });

  it('de-duplicates conflict copies', () => {
    fs.writeFileSync(path.join(root, 'Note.md'), 'external');
    const first = writeVaultEntryGuarded(root, { relativePath: 'Note.md', contents: 'a' }, 'stale', '2026-09-12T10:00:00.000Z');
    const second = writeVaultEntryGuarded(root, { relativePath: 'Note.md', contents: 'b' }, 'stale', '2026-09-12T10:00:00.000Z');
    expect(first.status).toBe('conflict');
    expect(second.status).toBe('conflict');
    if (first.status === 'conflict' && second.status === 'conflict') {
      expect(second.conflictPath).not.toBe(first.conflictPath);
    }
  });
});

describe('scanVaultDirectory', () => {
  it('reads markdown recursively and parses frontmatter', () => {
    fs.mkdirSync(path.join(root, 'A'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'A', 'B.md'),
      '---\nid: "id-b"\ntitle: "B"\nupdated: "2026-01-01T00:00:00.000Z"\n---\nbody text\n',
    );
    fs.writeFileSync(path.join(root, 'A.md'), '---\nid: "id-a"\ntitle: "A"\n---\nA body\n');

    const { entries, skipped } = scanVaultDirectory(root);
    expect(skipped).toEqual([]);
    const byPath = new Map(entries.map((e) => [e.relativePath, e]));
    expect(byPath.get('A.md')).toMatchObject({ id: 'id-a', title: 'A', body: 'A body\n' });
    expect(byPath.get('A/B.md')).toMatchObject({
      id: 'id-b',
      title: 'B',
      updated: '2026-01-01T00:00:00.000Z',
      body: 'body text\n',
    });
  });

  it('ignores dot-directories and non-markdown files', () => {
    fs.mkdirSync(path.join(root, '.trash'), { recursive: true });
    fs.writeFileSync(path.join(root, '.trash', 'gone.md'), '# gone');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'not markdown');
    fs.writeFileSync(path.join(root, '.Note.md.tmp'), 'temp');
    fs.writeFileSync(path.join(root, 'Real.md'), '# real');

    const { entries } = scanVaultDirectory(root);
    expect(entries.map((e) => e.relativePath)).toEqual(['Real.md']);
  });

  it('returns empty for a non-existent directory', () => {
    expect(scanVaultDirectory(path.join(root, 'nope'))).toEqual({ entries: [], skipped: [] });
  });
});
