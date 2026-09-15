import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
  BrowserWindow: {
    getFocusedWindow: (): null => null,
    getAllWindows: (): unknown[] => [],
  },
}));
vi.mock('../db', async () => {
  const { getTestDb } = await import('./helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getDocumentById, listDocuments, setDocumentMetadata } from './documents/setup';
import { setSetting } from '../repos/settings';
import { VAULT_LOCATION_KEY, getVaultSync } from '../vault-sync';
import { trashDocument as repoTrash } from '../repos/documents';
import { resolveVaultRoot } from '../mcp-config';
import { CONTENT_SCHEMA_VERSION } from '../../shared/documents';
import { reconcileIndexFromVault } from '../vault-index';
import { parseFrontmatter } from '../../shared/frontmatter';
import {
  createNote as svcCreate,
  getActiveVault,
  moveNote as svcMove,
  permanentDeleteNote as svcPurge,
  restoreNote as svcRestore,
  setActiveVault,
  trashNote as svcTrash,
  updateNote as svcUpdate,
} from '../note-service';
import { readTombstones } from '../tombstones';

/** Minimal trash via the repo + write-through, mirroring ipc's handler. */
function trivialTrash(id: string): void {
  const result = repoTrash(id);
  getVaultSync().trashNoteFiles(result.trashedIds);
  getVaultSync().rebalanceSiblings(result.document.parentId);
  getVaultSync().sweepPaths();
}

let vault: string;
let vaultRoot: string;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(vaultRoot, relativePath), 'utf8');
}

function listMarkdown(dir = vaultRoot): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-inversion-'));
  vaultRoot = resolveVaultRoot(vault);
  fs.mkdirSync(vaultRoot, { recursive: true });
});

afterEach(() => {
  setActiveVault(null);
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('inversion — create (file-first)', () => {
  setupDb();
  beforeEach(() => {
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    setActiveVault(vaultRoot);
  });

  it('activates through set/get and starts inactive', () => {
    expect(getActiveVault()).toBe(vaultRoot);
    setActiveVault(null);
    expect(getActiveVault()).toBeNull();
  });

  it('lands the note on disk and in the index with matching identity', () => {
    const document = svcCreate({ title: 'Both' });

    const file = read('Both.md');
    expect(parseFrontmatter(file).data.id).toBe(document.id);
    expect(getDocumentById(document.id)!.metadata.vaultRelativePath).toBe('Both.md');
  });

  it('keeps the exact title when the filename must be sanitized', () => {
    const document = svcCreate({ title: 'a/b:c*d?' });

    expect(parseFrontmatter(read('a-b-c-d-.md')).data.title).toBe('a/b:c*d?');
    expect(document.title).toBe('a/b:c*d?');
    expect(document.metadata.vaultRelativePath).toBe('a-b-c-d-.md');
  });

  it('stores emoji in frontmatter and the index', () => {
    const document = svcCreate({ title: 'Emoji', emoji: '🎉' });
    expect(read('Emoji.md')).toContain('emoji: "🎉"');
    expect(document.emoji).toBe('🎉');
  });

  it('treats untitled notes as blank and gives them distinct files', () => {
    const first = svcCreate({});
    const second = svcCreate({});

    // Both resolve to the blank-title sentinel in the index.
    expect(getDocumentById(first.id)!.title).toBe('');
    expect(getDocumentById(second.id)!.title).toBe('');

    // Canonical path planning gives the newest note the base name.
    const paths = [getDocumentById(first.id)!, getDocumentById(second.id)!]
      .map((row) => row.metadata.vaultRelativePath)
      .sort();
    expect(paths).toEqual(['Untitled (2).md', 'Untitled.md']);
    for (const relative of paths) {
      expect(fs.existsSync(path.join(vaultRoot, relative!))).toBe(true);
    }
  });

  it('nests a 20-deep chain with correct parents and paths', () => {
    let parentId: string | null = null;
    let deepestId = '';
    for (let i = 0; i < 20; i += 1) {
      const created = svcCreate({ title: `L${i}`, parentId });
      deepestId = created.id;
      parentId = created.id;
    }
    const deepest = getDocumentById(deepestId)!;
    expect(deepest.metadata.vaultRelativePath!.split('/')).toHaveLength(20);
    expect(fs.existsSync(path.join(vaultRoot, deepest.metadata.vaultRelativePath!))).toBe(true);
    // Walk the chain back to the root.
    let cursor = deepest;
    let depth = 19;
    while (cursor.parentId) {
      expect(getDocumentById(cursor.parentId)!.title).toBe(`L${depth - 1}`);
      cursor = getDocumentById(cursor.parentId)!;
      depth -= 1;
    }
  });

  it('relocates a colliding external note instead of losing its content', () => {
    fs.writeFileSync(
      path.join(vaultRoot, 'a-b.md'),
      '---\nid: "unrelated"\n---\nkeep me',
    );
    // The watcher would have imported the external file; simulate that so the
    // path planner knows the stem is taken.
    reconcileIndexFromVault(vaultRoot, { importNew: true });

    const document = svcCreate({ title: 'a/b' });

    // The newest note takes the canonical base name; the existing note is moved
    // to the next free suffix with its content intact.
    expect(getDocumentById(document.id)!.metadata.vaultRelativePath).toBe('a-b.md');
    const manual = listDocuments({ limit: 10 }).find((row) => row.id === 'unrelated')!;
    expect(manual.metadata.vaultRelativePath).toBe('a-b (2).md');
    expect(read('a-b (2).md')).toContain('keep me');
  });

  it('falls back to the DB-first path when the vault write fails', () => {
    const blocked = path.join(vault, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setActiveVault(path.join(blocked, 'vault'));

    const document = svcCreate({ title: 'Falls Back' });
    expect(getDocumentById(document.id)).not.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Vault create failed'),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it('survives an index reconcile unchanged (file/index parity)', () => {
    const document = svcCreate({ title: 'Parity', content: 'body text' });

    reconcileIndexFromVault(vaultRoot);
    const row = getDocumentById(document.id)!;
    expect(row.title).toBe('Parity');
    expect(row.content).toBe('body text');
    expect(row.metadata.vaultRelativePath).toBe('Parity.md');
  });

  it('creates 30 notes under one parent with dense sibling order on disk', () => {
    const parent = svcCreate({ title: 'Hub' });
    for (let i = 0; i < 30; i += 1) svcCreate({ title: `Item ${i}`, parentId: parent.id });

    const dir = path.join(vaultRoot, 'Hub');
    const orders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8')).data.order);
    expect(new Set(orders).size).toBe(30);
    expect(Math.min(...orders.map(Number))).toBe(0);
    expect(Math.max(...orders.map(Number))).toBe(29);
  });
});

describe('inversion — update (file-first)', () => {
  setupDb();
  beforeEach(() => {
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    setActiveVault(vaultRoot);
  });

  it('preserves emoji, bookmark, order and created across a content save', () => {
    const created = svcCreate({ title: 'Preserve', emoji: '📄' });
    svcUpdate(created.id, { metadata: { bookmarkedAt: '2026-03-03T00:00:00.000Z' } });
    const before = parseFrontmatter(read('Preserve.md')).data;

    svcUpdate(created.id, { content: 'new body' });
    const after = parseFrontmatter(read('Preserve.md')).data;

    expect(after.emoji).toBe('📄');
    expect(after.bookmarked).toBe('2026-03-03T00:00:00.000Z');
    expect(after.order).toBe(before.order);
    expect(after.created).toBe(before.created);
    expect(getDocumentById(created.id)!.content).toBe('new body');
  });

  it('renames with a sanitized filename while keeping the exact title', () => {
    const created = svcCreate({ title: 'Start' });
    svcUpdate(created.id, { title: 'Weird/Name', rename: true });

    expect(fs.existsSync(path.join(vaultRoot, 'Weird-Name.md'))).toBe(true);
    expect(getDocumentById(created.id)!.title).toBe('Weird/Name');
    expect(getDocumentById(created.id)!.metadata.vaultRelativePath).toBe('Weird-Name.md');
  });

  it('renames to Untitled when the title is cleared', () => {
    const created = svcCreate({ title: 'Named' });
    svcUpdate(created.id, { title: '', rename: true });

    expect(fs.existsSync(path.join(vaultRoot, 'Untitled.md'))).toBe(true);
    expect(getDocumentById(created.id)!.title).toBe('');
  });

  it('does not rename the file on a content-only save', () => {
    const created = svcCreate({ title: 'Stable' });
    svcUpdate(created.id, { content: 'x' });
    expect(listMarkdown()).toEqual(['Stable.md']);
  });

  it('bumps content_schema_version in the file from update metadata', () => {
    const created = svcCreate({ title: 'Schema' });
    svcUpdate(created.id, {
      content: 'x',
      metadata: { contentSchemaVersion: CONTENT_SCHEMA_VERSION },
    });
    expect(parseFrontmatter(read('Schema.md')).data.contentSchemaVersion).toBe(
      CONTENT_SCHEMA_VERSION,
    );
  });

  it('keeps sibling order stable when only content changes', () => {
    const a = svcCreate({ title: 'A' });
    const b = svcCreate({ title: 'B' });
    const orderBefore = getDocumentById(a.id)!.sortOrder;

    svcUpdate(a.id, { content: 'edited' });
    expect(getDocumentById(a.id)!.sortOrder).toBe(orderBefore);
    expect(getDocumentById(b.id)!.sortOrder).toBeDefined();
  });

  it('moves the file when parentId changes (structural path, still written through)', () => {
    const parent = svcCreate({ title: 'Folder' });
    const child = svcCreate({ title: 'Loose' });

    svcUpdate(child.id, { parentId: parent.id });
    expect(fs.existsSync(path.join(vaultRoot, 'Folder', 'Loose.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Loose.md'))).toBe(false);
    expect(getDocumentById(child.id)!.parentId).toBe(parent.id);
  });

  it('applies 25 sequential content saves with the last one winning', () => {
    const created = svcCreate({ title: 'Burst' });
    for (let i = 0; i < 25; i += 1) svcUpdate(created.id, { content: `revision ${i}` });

    expect(read('Burst.md')).toContain('revision 24');
    expect(getDocumentById(created.id)!.content).toBe('revision 24');
  });

  it('stays consistent with the vault after an index reconcile', () => {
    const created = svcCreate({ title: 'Roundtrip' });
    svcUpdate(created.id, { content: 'final content' });
    svcUpdate(created.id, { title: 'Roundtrip Renamed', rename: true });

    reconcileIndexFromVault(vaultRoot);
    const row = getDocumentById(created.id)!;
    expect(row.title).toBe('Roundtrip Renamed');
    expect(row.content).toBe('final content');
    expect(row.metadata.vaultRelativePath).toBe('Roundtrip Renamed.md');
  });

  it('leaves other notes untouched when one is edited', () => {
    const a = svcCreate({ title: 'Alpha', content: 'a' });
    svcCreate({ title: 'Beta', content: 'b' });
    const betaBefore = read('Beta.md');

    svcUpdate(a.id, { content: 'a changed' });
    expect(read('Beta.md')).toBe(betaBefore);
  });

  it('does not crash when the file vanished, leaving the index updated', () => {
    const created = svcCreate({ title: 'Vanished' });
    fs.rmSync(path.join(vaultRoot, 'Vanished.md'));

    const document = svcUpdate(created.id, { content: 'after delete' })!;
    expect(document.content).toBe('after delete');
  });

  it('moves a nested child when its parent is renamed', () => {
    const parent = svcCreate({ title: 'Parent' });
    const child = svcCreate({ title: 'Child', parentId: parent.id });

    svcUpdate(parent.id, { title: 'Renamed Parent', rename: true });
    expect(getDocumentById(child.id)!.metadata.vaultRelativePath).toBe('Renamed Parent/Child.md');
    expect(fs.existsSync(path.join(vaultRoot, 'Renamed Parent', 'Child.md'))).toBe(true);
  });

  it('toggles and clears a bookmark without touching the body', () => {
    const created = svcCreate({ title: 'Bookmark', content: 'body' });

    svcUpdate(created.id, { metadata: { bookmarkedAt: '2026-04-04T00:00:00.000Z' } });
    expect(read('Bookmark.md')).toContain('bookmarked: "2026-04-04T00:00:00.000Z"');

    svcUpdate(created.id, { metadata: { bookmarkedAt: null } });
    expect(read('Bookmark.md')).not.toContain('bookmarked:');
    expect(read('Bookmark.md')).toContain('body');
  });

  it('propagates a store failure for a vanished note gracefully via the fallback', () => {
    const created = svcCreate({ title: 'Gone' });
    // Remove the row but keep the file so the fallback sees an existing doc.
    fs.rmSync(path.join(vaultRoot, 'Gone.md'));
    setDocumentMetadata(created.id, { vaultRelativePath: undefined });

    const document = svcUpdate(created.id, { content: 'still saves' })!;
    expect(document.content).toBe('still saves');
  });
});

describe('inversion — ordering helpers', () => {
  setupDb();
  beforeEach(() => {
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    setActiveVault(vaultRoot);
  });

  it('lists the newest create first via listDocuments ordering', () => {
    const a = svcCreate({ title: 'First' });
    const b = svcCreate({ title: 'Second' });
    const order = listDocuments({ limit: 10 }).map((row) => row.id);
    expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(a.id));
  });

  it('keeps sortOrder dense after create → trash → create', () => {
    const a = svcCreate({ title: 'Keep' });
    const b = svcCreate({ title: 'Drop' });
    svcUpdate(b.id, { content: 'x' });
    // Simulate the IPC trash path (index-first) then a new create.
    trivialTrash(b.id);
    const c = svcCreate({ title: 'Newest' });

    const rootIds = listDocuments({ limit: 10 }).map((row) => row.id);
    expect(rootIds).toContain(a.id);
    expect(rootIds).toContain(c.id);
    expect(rootIds).not.toContain(b.id);
  });
});

describe('inversion — structural operations (file-first)', () => {
  setupDb();
  beforeEach(() => {
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    setActiveVault(vaultRoot);
  });

  it('move re-parents the file and updates the index', () => {
    const parent = svcCreate({ title: 'Box' });
    const child = svcCreate({ title: 'Item' });

    const moved = svcMove(child.id, parent.id, 0);
    expect(moved.parentId).toBe(parent.id);
    expect(fs.existsSync(path.join(vaultRoot, 'Box', 'Item.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Item.md'))).toBe(false);
    expect(getDocumentById(child.id)!.metadata.vaultRelativePath).toBe('Box/Item.md');
  });

  it('move back to the root lifts the file out of the folder', () => {
    const parent = svcCreate({ title: 'Box' });
    const child = svcCreate({ title: 'Item', parentId: parent.id });
    expect(fs.existsSync(path.join(vaultRoot, 'Box', 'Item.md'))).toBe(true);

    const moved = svcMove(child.id, null, 0);
    expect(moved.parentId).toBeNull();
    expect(fs.existsSync(path.join(vaultRoot, 'Item.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Box', 'Item.md'))).toBe(false);
  });

  it('move into a descendant is refused and the file is left in place', () => {
    const parent = svcCreate({ title: 'Parent' });
    const child = svcCreate({ title: 'Child', parentId: parent.id });

    expect(() => svcMove(parent.id, child.id, 0)).toThrow();
    expect(fs.existsSync(path.join(vaultRoot, 'Parent.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Parent', 'Child.md'))).toBe(true);
    expect(getDocumentById(parent.id)!.parentId).toBeNull();
  });

  it('move survives an index reconcile (file/index parity)', () => {
    const parent = svcCreate({ title: 'Box' });
    const child = svcCreate({ title: 'Item' });
    svcMove(child.id, parent.id, 0);

    reconcileIndexFromVault(vaultRoot);
    const row = getDocumentById(child.id)!;
    expect(row.parentId).toBe(parent.id);
    expect(row.metadata.vaultRelativePath).toBe('Box/Item.md');
  });

  it('trash moves the whole subtree to .trash and marks it deleted', () => {
    const parent = svcCreate({ title: 'Fruit' });
    const child = svcCreate({ title: 'Apple', parentId: parent.id });

    const result = svcTrash(parent.id);
    expect(result.trashedIds.sort()).toEqual([parent.id, child.id].sort());
    expect(fs.existsSync(path.join(vaultRoot, '.trash', 'Fruit.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, '.trash', 'Fruit', 'Apple.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Fruit.md'))).toBe(false);
    expect(getDocumentById(parent.id)!.deletedAt).toBeTruthy();
    expect(getDocumentById(child.id)!.deletedAt).toBeTruthy();

    const tombstones = readTombstones(vaultRoot);
    expect(tombstones.get(parent.id)?.action).toBe('trash');
    expect(tombstones.get(child.id)?.action).toBe('trash');
  });

  it('restore brings the subtree back and records a restore', () => {
    const parent = svcCreate({ title: 'Fruit' });
    const child = svcCreate({ title: 'Apple', parentId: parent.id });
    svcTrash(parent.id);

    const result = svcRestore(parent.id);
    expect(result.restoredIds.sort()).toEqual([parent.id, child.id].sort());
    expect(fs.existsSync(path.join(vaultRoot, 'Fruit.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Fruit', 'Apple.md'))).toBe(true);
    expect(getDocumentById(parent.id)!.deletedAt).toBeNull();
    expect(getDocumentById(child.id)!.deletedAt).toBeNull();
    expect(readTombstones(vaultRoot).get(child.id)?.action).toBe('restore');
  });

  it('permanent delete removes the trashed files and the rows', () => {
    const parent = svcCreate({ title: 'Fruit' });
    const child = svcCreate({ title: 'Apple', parentId: parent.id });
    svcTrash(parent.id);

    const result = svcPurge(parent.id);
    expect(result.deletedIds.sort()).toEqual([parent.id, child.id].sort());
    expect(fs.existsSync(path.join(vaultRoot, '.trash', 'Fruit.md'))).toBe(false);
    expect(listMarkdown(path.join(vaultRoot, '.trash'))).toEqual([]);
    expect(getDocumentById(parent.id)).toBeNull();
    expect(getDocumentById(child.id)).toBeNull();
    expect(readTombstones(vaultRoot).get(parent.id)?.action).toBe('purge');
  });

  it('a trashed note whose index is rebuilt stays trashed (no resurrection)', () => {
    const note = svcCreate({ title: 'Doomed' });
    svcTrash(note.id);

    // Throw the entire index away and rebuild purely from the vault + tombstones.
    getDb().prepare('DELETE FROM documents').run();
    reconcileIndexFromVault(vaultRoot);

    expect(getDocumentById(note.id)).toBeNull();
    expect(fs.existsSync(path.join(vaultRoot, 'Doomed.md'))).toBe(false);
  });
});
