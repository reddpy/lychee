import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createNote, getNote, listNotes, updateNote } from '../vault-store';

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
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-store-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('vault store — createNote', () => {
  it('creates a root note whose filename is the title', () => {
    const result = createNote(vault, { title: 'Hello World', body: 'first line' });
    expect(result).toMatchObject({ ok: true, relativePath: 'Hello World.md' });
    if (!result.ok) return;

    const note = getNote(vault, result.id)!;
    expect(note.title).toBe('Hello World');
    expect(note.body).toContain('first line');
    expect(fs.existsSync(path.join(vault, 'Hello World.md'))).toBe(true);
  });

  it('creates an untitled note when no title is given', () => {
    const result = createNote(vault, { body: 'draft' });
    expect(result).toMatchObject({ ok: true, relativePath: 'Untitled.md' });
  });

  it('nests the note under a parent folder', () => {
    const parent = createNote(vault, { title: 'Parent' });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;

    const child = createNote(vault, { title: 'Child', parentIdOrPath: parent.id });
    expect(child).toMatchObject({ ok: true, relativePath: 'Parent/Child.md' });
    expect(fs.existsSync(path.join(vault, 'Parent', 'Child.md'))).toBe(true);
  });

  it('dedupes sibling filenames that sanitize to the same stem', () => {
    // Titles stay distinct (so uniqueness passes) but both sanitize to `a-b`.
    expect(createNote(vault, { title: 'A/B' })).toMatchObject({ ok: true, relativePath: 'A-B.md' });
    expect(createNote(vault, { title: 'A:B' })).toMatchObject({
      ok: true,
      relativePath: 'A-B (2).md',
    });
  });

  it('refuses a duplicate title, matching the app and rename', () => {
    createNote(vault, { title: 'Taken' });
    expect(createNote(vault, { title: 'Taken' })).toMatchObject({
      ok: false,
      reason: 'duplicate_title',
    });
  });

  it('refuses a missing parent', () => {
    expect(createNote(vault, { title: 'Orphan', parentIdOrPath: 'nope' })).toMatchObject({
      ok: false,
      reason: 'parent_not_found',
    });
  });

  it('produces a file the rest of the store can edit', () => {
    const created = createNote(vault, { title: 'Editable', body: 'v1' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(updateNote(vault, created.id, 'v2').ok).toBe(true);
    expect(getNote(vault, created.id)!.body).toContain('v2');
    expect(listNotes(vault).map((note) => note.id)).toContain(created.id);
  });
});
