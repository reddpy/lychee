import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appendToNote,
  findBacklinks,
  getNote,
  listNotes,
  moveNote,
  renameNote,
  restoreNote,
  searchNotes,
  trashNote,
  updateNote,
} from '../vault-tools';
import { appendTombstone } from '../../main/tombstone-io';

let vault: string;

function writeNote(relativePath: string, frontmatter: Record<string, string>, body: string): void {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push('---');
  const absolute = path.join(vault, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${lines.join('\n')}\n${body}\n`);
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-mcp-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('vault tools — read', () => {
  it('lists notes with id, title and path', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, '# Hello\n\napples');
    writeNote('A/Child.md', { id: 'note-2', title: 'Child' }, '# Child');

    const notes = listNotes(vault);
    const byId = new Map(notes.map((note) => [note.id, note]));
    expect(byId.get('note-1')).toMatchObject({ title: 'Hello', relativePath: 'Hello.md' });
    expect(byId.get('note-2')).toMatchObject({ title: 'Child', relativePath: 'A/Child.md' });
  });

  it('gets a note by id or relative path', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, '# Hello\n\nbody');
    const byId = getNote(vault, 'note-1')!;
    expect(byId.body).toContain('# Hello');
    expect(byId.revision).toBeTruthy();
    expect(getNote(vault, 'Hello.md')!.id).toBe('note-1');
    expect(getNote(vault, 'missing')).toBeNull();
  });

  it('searches titles and bodies', () => {
    writeNote('One.md', { id: 'a', title: 'Apples' }, 'body');
    writeNote('Two.md', { id: 'b', title: 'Other' }, 'about apples too');
    const hits = searchNotes(vault, 'apples');
    expect(hits.map((hit) => hit.id).sort()).toEqual(['a', 'b']);
    expect(searchNotes(vault, 'zzz')).toEqual([]);
  });

  it('finds backlinks via the internal note URL', () => {
    writeNote('Target.md', { id: 'target', title: 'Target' }, '# Target');
    writeNote(
      'Linker.md',
      { id: 'linker', title: 'Linker' },
      'See [Target](https://note.lychee.invalid/target).',
    );
    expect(findBacklinks(vault, 'target').map((link) => link.id)).toEqual(['linker']);
  });

  it('excludes tombstoned notes', () => {
    writeNote('Gone.md', { id: 'gone', title: 'Gone' }, '# Gone');
    appendTombstone(vault, 'gone', 'trash', 'device-a', '2026-01-01T00:00:00.000Z');
    expect(listNotes(vault)).toEqual([]);
    expect(getNote(vault, 'gone')).toBeNull();
  });
});

describe('vault tools — write', () => {
  it('replaces the body while preserving frontmatter', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, '# Hello\n\nold body');
    const result = updateNote(vault, 'note-1', '# Hello\n\nnew body');
    expect(result.ok).toBe(true);

    const reread = getNote(vault, 'note-1')!;
    expect(reread.id).toBe('note-1');
    expect(reread.title).toBe('Hello');
    expect(reread.body).toContain('new body');
    expect(reread.body).not.toContain('old body');
  });

  it('refuses a stale write when expectedRevision does not match', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, 'body');
    const result = updateNote(vault, 'note-1', 'new', 'stale-revision');
    expect(result).toMatchObject({ ok: false, reason: 'revision_mismatch' });
    expect(getNote(vault, 'note-1')!.body).toContain('body');
  });

  it('accepts a write with the current revision', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, 'body');
    const revision = getNote(vault, 'note-1')!.revision;
    expect(updateNote(vault, 'note-1', 'updated', revision).ok).toBe(true);
  });

  it('reports a missing note', () => {
    expect(updateNote(vault, 'nope', 'x')).toMatchObject({ ok: false, reason: 'note_not_found' });
  });

  it('appends to a note', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, 'first');
    const result = appendToNote(vault, 'note-1', 'second');
    expect(result.ok).toBe(true);
    const body = getNote(vault, 'note-1')!.body;
    expect(body.indexOf('first')).toBeLessThan(body.indexOf('second'));
  });
});

describe('vault tools — rename', () => {
  it('renames the file to the new title, preserving contents', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, 'body text');

    const result = renameNote(vault, 'note-1', 'Goodbye');
    expect(result).toMatchObject({ ok: true, relativePath: 'Goodbye.md' });
    expect(fs.existsSync(path.join(vault, 'Hello.md'))).toBe(false);

    const reread = getNote(vault, 'note-1')!;
    expect(reread.relativePath).toBe('Goodbye.md');
    expect(reread.body).toContain('body text');
  });

  it('moves the companion child folder', () => {
    writeNote('Parent.md', { id: 'parent', title: 'Parent' }, 'p');
    writeNote('Parent/Child.md', { id: 'child', title: 'Child' }, 'c');

    expect(renameNote(vault, 'parent', 'Renamed').ok).toBe(true);
    expect(getNote(vault, 'child')!.relativePath).toBe('Renamed/Child.md');
  });

  it('refuses to rename to an existing title (titles are unique)', () => {
    writeNote('Hello.md', { id: 'a', title: 'Hello' }, 'a');
    writeNote('Other.md', { id: 'b', title: 'Other' }, 'b');

    expect(renameNote(vault, 'b', 'Hello')).toMatchObject({
      ok: false,
      reason: 'duplicate_title',
    });
  });

  it('refuses on a stale revision and on a missing note', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, 'body');
    expect(renameNote(vault, 'note-1', 'X', 'stale')).toMatchObject({
      ok: false,
      reason: 'revision_mismatch',
    });
    expect(renameNote(vault, 'nope', 'X')).toMatchObject({ ok: false, reason: 'note_not_found' });
  });
});

describe('vault tools — move / trash / restore', () => {
  it('moves a note under a parent and back to the root', () => {
    writeNote('Parent.md', { id: 'parent', title: 'Parent' }, 'p');
    writeNote('Child.md', { id: 'child', title: 'Child' }, 'c');

    expect(moveNote(vault, 'child', 'parent')).toMatchObject({
      ok: true,
      relativePath: 'Parent/Child.md',
    });
    expect(fs.existsSync(path.join(vault, 'Parent', 'Child.md'))).toBe(true);

    expect(moveNote(vault, 'child', null)).toMatchObject({ ok: true, relativePath: 'Child.md' });
    expect(fs.existsSync(path.join(vault, 'Child.md'))).toBe(true);
  });

  it('refuses to move a note into its own descendant', () => {
    writeNote('Parent.md', { id: 'parent', title: 'Parent' }, 'p');
    writeNote('Parent/Child.md', { id: 'child', title: 'Child' }, 'c');
    expect(moveNote(vault, 'parent', 'child')).toMatchObject({ ok: false, reason: 'cycle' });
  });

  it('trashes and restores a note with tombstones', () => {
    writeNote('Hello.md', { id: 'note-1', title: 'Hello' }, 'body');

    expect(trashNote(vault, 'note-1')).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(vault, 'Hello.md'))).toBe(false);
    expect(fs.existsSync(path.join(vault, '.trash', 'Hello.md'))).toBe(true);
    expect(listNotes(vault)).toEqual([]);

    expect(restoreNote(vault, 'note-1')).toMatchObject({ ok: true, relativePath: 'Hello.md' });
    expect(fs.existsSync(path.join(vault, 'Hello.md'))).toBe(true);
    expect(listNotes(vault).map((note) => note.id)).toEqual(['note-1']);
  });
});
