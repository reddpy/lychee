import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createNote,
  getNote,
  listNotes,
  moveNote,
  renameNote,
  restoreNote,
  searchNotes,
  trashNote,
  updateNote,
  updateNoteFields,
} from '../vault-store';
import { parseFrontmatter } from '../../shared/frontmatter';

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

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(vault, relativePath), 'utf8');
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-store-hard-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('createNote — identity', () => {
  it('honors a caller-supplied id and round-trips it', () => {
    const result = createNote(vault, { id: 'custom-id', title: 'Custom' });
    expect(result).toMatchObject({ ok: true, id: 'custom-id' });
    expect(getNote(vault, 'custom-id')!.title).toBe('Custom');
  });

  it('refuses a caller-supplied id that already exists', () => {
    writeNote('Existing.md', { id: 'dup', title: 'Existing' }, 'body');
    expect(createNote(vault, { id: 'dup', title: 'Other' })).toMatchObject({
      ok: false,
      reason: 'duplicate_id',
    });
    expect(fs.existsSync(path.join(vault, 'Other.md'))).toBe(false);
  });

  it('generates an id when the supplied one is blank/whitespace', () => {
    const result = createNote(vault, { id: '   ', title: 'Blank Id' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).not.toBe('');
    expect(result.id.trim()).toBe(result.id);
  });

  it('refuses a duplicate id even when the twin is nested', () => {
    const parent = createNote(vault, { title: 'P' });
    if (!parent.ok) throw new Error('setup failed');
    createNote(vault, { id: 'nested-dup', title: 'Child', parentIdOrPath: parent.id });
    expect(createNote(vault, { id: 'nested-dup', title: 'Other' })).toMatchObject({
      ok: false,
      reason: 'duplicate_id',
    });
  });
});

describe('createNote — title uniqueness', () => {
  it('is case-insensitive, matching the app', () => {
    createNote(vault, { title: 'Hello' });
    expect(createNote(vault, { title: 'hello' })).toMatchObject({
      ok: false,
      reason: 'duplicate_title',
    });
    expect(createNote(vault, { title: 'HELLO' })).toMatchObject({
      ok: false,
      reason: 'duplicate_title',
    });
  });

  it('ignores surrounding whitespace when comparing titles', () => {
    createNote(vault, { title: 'Spaced' });
    expect(createNote(vault, { title: '  Spaced  ' })).toMatchObject({
      ok: false,
      reason: 'duplicate_title',
    });
  });

  it('allows an empty title more than once (untitled notes)', () => {
    const first = createNote(vault, {});
    const second = createNote(vault, {});
    expect(first).toMatchObject({ ok: true, relativePath: 'Untitled.md' });
    expect(second).toMatchObject({ ok: true, relativePath: 'Untitled (2).md' });
  });
});

describe('createNote — parents', () => {
  it('nests under a parent addressed by relative path', () => {
    writeNote('Parent.md', { id: 'p', title: 'Parent' }, 'p');
    expect(createNote(vault, { title: 'Child', parentIdOrPath: 'Parent.md' })).toMatchObject({
      ok: true,
      relativePath: 'Parent/Child.md',
    });
  });

  it('refuses a trashed parent (not an active note)', () => {
    const parent = createNote(vault, { title: 'Gone' });
    if (!parent.ok) throw new Error('setup failed');
    trashNote(vault, parent.id);
    expect(createNote(vault, { title: 'Child', parentIdOrPath: parent.id })).toMatchObject({
      ok: false,
      reason: 'parent_not_found',
    });
  });

  it('deeply nests without breaking paths', () => {
    let parent = createNote(vault, { title: 'L0' });
    expect(parent.ok).toBe(true);
    let lastPath = 'L0.md';
    for (let i = 1; i <= 25; i += 1) {
      if (!parent.ok) throw new Error('chain broke');
      const child = createNote(vault, { title: `L${i}`, parentIdOrPath: parent.id });
      expect(child.ok).toBe(true);
      if (!child.ok) return;
      lastPath = child.relativePath;
      parent = child;
    }
    expect(lastPath.split('/')).toHaveLength(26);
    expect(fs.existsSync(path.join(vault, lastPath))).toBe(true);
  });
});

describe('createNote — filename sanitization', () => {
  it('escapes reserved Windows names', () => {
    expect(createNote(vault, { title: 'CON' })).toMatchObject({
      ok: true,
      relativePath: '_CON.md',
    });
  });

  it('strips illegal characters and trailing dots/spaces', () => {
    const result = createNote(vault, { title: 'a/b:c*d?e"f<g>h|i.' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relativePath).not.toMatch(/[\\/:*?"<>|]/);
    expect(result.relativePath.endsWith('.md')).toBe(true);
  });

  it('never emits a dotfile, even for a leading-dot title', () => {
    const result = createNote(vault, { title: '.hidden' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(path.basename(result.relativePath).startsWith('.')).toBe(false);
  });

  it('caps an over-long title in bytes', () => {
    const result = createNote(vault, { title: 'x'.repeat(500) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stem = result.relativePath.replace(/\.md$/, '');
    expect(Buffer.byteLength(stem, 'utf8')).toBeLessThanOrEqual(200);
  });

  it('preserves unicode titles (emoji + combining marks) in the filename', () => {
    const result = createNote(vault, { title: '日本語 🎉 café' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relativePath).toContain('🎉');
    expect(getNote(vault, result.id)!.title).toBe('日本語 🎉 café');
  });
});

describe('createNote — body and frontmatter', () => {
  it('preserves a body that looks like frontmatter', () => {
    const body = '---\nnot: frontmatter\n---\nafter';
    const result = createNote(vault, { title: 'Tricky', body });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getNote(vault, result.id)!.body).toBe(body);
  });

  it('preserves lychee-* encoded blocks verbatim', () => {
    const body = 'text\n\n```lychee-reference\n{"id":"x"}\n```\n';
    const result = createNote(vault, { title: 'Fences', body });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getNote(vault, result.id)!.body).toContain('```lychee-reference\n{"id":"x"}\n```');
  });

  it('stores emoji and a normalized order in frontmatter', () => {
    const result = createNote(vault, { title: 'Ordered', emoji: '📌', order: 3.9 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = parseFrontmatter(readRaw(result.relativePath));
    expect(data.emoji).toBe('📌');
    expect(data.order).toBe(3);
  });

  it('clamps negative order to 0 and drops non-finite order', () => {
    const negative = createNote(vault, { title: 'Neg', order: -5 });
    const infinite = createNote(vault, { title: 'Inf', order: Number.POSITIVE_INFINITY });
    if (!negative.ok || !infinite.ok) throw new Error('setup failed');
    expect(parseFrontmatter(readRaw(negative.relativePath)).data.order).toBe(0);
    expect(parseFrontmatter(readRaw(infinite.relativePath)).data.order).toBeUndefined();
  });

  it('falls back to a valid timestamp when created/updated are unparseable', () => {
    const result = createNote(vault, {
      title: 'BadDates',
      createdAt: 'not-a-date',
      updatedAt: 'also-bad',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = parseFrontmatter(readRaw(result.relativePath));
    expect(Number.isNaN(Date.parse(data.created!))).toBe(false);
    expect(Number.isNaN(Date.parse(data.updated!))).toBe(false);
  });

  it('creates the vault directory lazily when it does not exist', () => {
    const nested = path.join(vault, 'does', 'not', 'exist');
    const result = createNote(nested, { title: 'Lazy', body: 'x' });
    expect(result).toMatchObject({ ok: true, relativePath: 'Lazy.md' });
    if (!result.ok) return;
    expect(fs.existsSync(path.join(nested, result.relativePath))).toBe(true);
  });
});

describe('vault store — lifecycle round-trip and stress', () => {
  it('keeps identity and body through create → update → rename → move → trash → restore', () => {
    const created = createNote(vault, { title: 'Lifecycle', body: 'v1' });
    if (!created.ok) throw new Error('create failed');
    const id = created.id;

    expect(updateNote(vault, id, 'v2 body').ok).toBe(true);
    expect(renameNote(vault, id, 'Renamed').ok).toBe(true);
    expect(moveNote(vault, id, null).ok).toBe(true);
    expect(trashNote(vault, id).ok).toBe(true);
    expect(listNotes(vault).some((note) => note.id === id)).toBe(false);
    expect(restoreNote(vault, id).ok).toBe(true);

    const final = getNote(vault, id)!;
    expect(final.title).toBe('Renamed');
    expect(final.body).toContain('v2 body');
    expect(searchNotes(vault, 'v2 body').some((hit) => hit.id === id)).toBe(true);
  });

  it('creates 200 notes with colliding stems without losing or overwriting any', () => {
    // Every pair maps to the same sanitized stem; the store must suffix, not clash.
    const pairs = Array.from({ length: 100 }, (_, i) => [`Collide A/${i}`, `Collide A:${i}`]);
    const titles = pairs.flat();
    for (const title of titles) {
      expect(createNote(vault, { title })).toMatchObject({ ok: true });
    }

    const notes = listNotes(vault);
    expect(notes).toHaveLength(200);
    const paths = new Set(notes.map((note) => note.relativePath));
    expect(paths.size).toBe(200);
    for (const note of notes) {
      expect(fs.existsSync(path.join(vault, note.relativePath))).toBe(true);
      expect(getNote(vault, note.id)).not.toBeNull();
    }
  });

  it('keeps a child with its parent when the parent is renamed', () => {
    const parent = createNote(vault, { title: 'P' });
    if (!parent.ok) throw new Error('setup failed');
    const child = createNote(vault, { title: 'C', parentIdOrPath: parent.id });
    if (!child.ok) throw new Error('setup failed');

    expect(renameNote(vault, parent.id, 'P2').ok).toBe(true);
    expect(getNote(vault, child.id)!.relativePath).toBe('P2/C.md');
  });
});

describe('updateNoteFields — combined field patching', () => {
  it('updates body, title, emoji, bookmark and order in one write', () => {
    const created = createNote(vault, { title: 'Before', body: 'old', emoji: '📄' });
    if (!created.ok) throw new Error('setup failed');

    const result = updateNoteFields(vault, created.id, {
      title: 'After',
      emoji: '📌',
      bookmarked: '2026-01-01T00:00:00.000Z',
      order: 4,
      body: 'new body',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relativePath).toBe('After.md');

    const note = getNote(vault, created.id)!;
    expect(note.title).toBe('After');
    expect(note.body).toContain('new body');
    const { data } = parseFrontmatter(readRaw('After.md'));
    expect(data.emoji).toBe('📌');
    expect(data.bookmarked).toBe('2026-01-01T00:00:00.000Z');
    expect(data.order).toBe(4);
    expect(data.id).toBe(created.id);
  });

  it('preserves every field it was not asked to change', () => {
    const created = createNote(vault, {
      title: 'Keep',
      body: 'v1',
      emoji: '📄',
      order: 7,
    });
    if (!created.ok) throw new Error('setup failed');
    updateNoteFields(vault, created.id, { bookmarked: '2026-02-02T00:00:00.000Z' });

    // Now change only the body; emoji/order/bookmark/created must survive.
    const before = parseFrontmatter(readRaw('Keep.md')).data;
    updateNoteFields(vault, created.id, { body: 'v2' });
    const after = parseFrontmatter(readRaw('Keep.md')).data;

    expect(after.emoji).toBe('📄');
    expect(after.order).toBe(7);
    expect(after.bookmarked).toBe('2026-02-02T00:00:00.000Z');
    expect(after.created).toBe(before.created);
    expect(getNote(vault, created.id)!.body).toContain('v2');
  });

  it('writes a new title in place when rename is false', () => {
    const created = createNote(vault, { title: 'PathStays', body: 'x' });
    if (!created.ok) throw new Error('setup failed');

    const result = updateNoteFields(vault, created.id, { title: 'Renamed Later' }, { rename: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.relativePath).toBe('PathStays.md');
    expect(fs.existsSync(path.join(vault, 'PathStays.md'))).toBe(true);
    const { data } = parseFrontmatter(readRaw('PathStays.md'));
    expect(data.title).toBe('Renamed Later');
  });

  it('does not move the child folder when rename is false', () => {
    const parent = createNote(vault, { title: 'Parent' });
    if (!parent.ok) throw new Error('setup failed');
    const child = createNote(vault, { title: 'Child', parentIdOrPath: parent.id });
    if (!child.ok) throw new Error('setup failed');

    updateNoteFields(vault, parent.id, { title: 'Renamed Later' }, { rename: false });

    // The companion folder stays under the old name until a real rename.
    expect(fs.existsSync(path.join(vault, 'Parent', 'Child.md'))).toBe(true);
    expect(getNote(vault, child.id)!.relativePath).toBe('Parent/Child.md');
  });

  it('moves the child folder when a title change renames the file', () => {
    const parent = createNote(vault, { title: 'Parent' });
    if (!parent.ok) throw new Error('setup failed');
    createNote(vault, { title: 'Child', parentIdOrPath: parent.id });

    const result = updateNoteFields(vault, parent.id, { title: 'Renamed' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relativePath).toBe('Renamed.md');
    expect(fs.existsSync(path.join(vault, 'Renamed', 'Child.md'))).toBe(true);
    expect(fs.existsSync(path.join(vault, 'Parent'))).toBe(false);
  });

  it('refuses a duplicate title and leaves the file where it was', () => {
    createNote(vault, { title: 'Taken' });
    const other = createNote(vault, { title: 'Other' });
    if (!other.ok) throw new Error('setup failed');

    expect(updateNoteFields(vault, other.id, { title: 'taken' })).toMatchObject({
      ok: false,
      reason: 'duplicate_title',
    });
    expect(fs.existsSync(path.join(vault, 'Other.md'))).toBe(true);
  });

  it('renames to Untitled and drops the frontmatter title when set empty', () => {
    const created = createNote(vault, { title: 'Was Titled' });
    if (!created.ok) throw new Error('setup failed');

    const result = updateNoteFields(vault, created.id, { title: '  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relativePath).toBe('Untitled.md');
    expect(parseFrontmatter(readRaw('Untitled.md')).data.title).toBeUndefined();
  });

  it('refuses a fence-changing body edit unless explicitly allowed', () => {
    const created = createNote(vault, {
      title: 'Fenced',
      body: 'text\n\n```lychee-reference\n{"id":"x"}\n```\n',
    });
    if (!created.ok) throw new Error('setup failed');

    expect(updateNoteFields(vault, created.id, { body: 'dropped the block' })).toMatchObject({
      ok: false,
      reason: 'fence_conflict',
    });
    expect(
      updateNoteFields(vault, created.id, { body: 'dropped the block' }, { allowFenceChanges: true })
        .ok,
    ).toBe(true);
  });

  it('refuses a stale revision', () => {
    const created = createNote(vault, { title: 'Revs', body: 'x' });
    if (!created.ok) throw new Error('setup failed');
    expect(
      updateNoteFields(vault, created.id, { body: 'y' }, { expectedRevision: 'stale' }),
    ).toMatchObject({ ok: false, reason: 'revision_mismatch' });
  });

  it('writes an explicit content schema version to frontmatter', () => {
    const created = createNote(vault, { title: 'Schema' });
    if (!created.ok) throw new Error('setup failed');
    updateNoteFields(vault, created.id, { body: 'x', contentSchemaVersion: 9 });
    expect(parseFrontmatter(readRaw('Schema.md')).data.contentSchemaVersion).toBe(9);
  });

  it('clamps an out-of-range order', () => {
    const created = createNote(vault, { title: 'Ordered' });
    if (!created.ok) throw new Error('setup failed');
    updateNoteFields(vault, created.id, { order: -3 });
    expect(parseFrontmatter(readRaw('Ordered.md')).data.order).toBe(0);
  });

  it('reports a missing note', () => {
    expect(updateNoteFields(vault, 'nope', { body: 'x' })).toMatchObject({
      ok: false,
      reason: 'note_not_found',
    });
  });
});
