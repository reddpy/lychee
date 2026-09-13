import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, importDocument, getDocumentById, updateDocument } from './setup';
import { applyIndexFields } from '../../repos/documents';
import { setSetting } from '../../repos/settings';
import { reconcileIndexFromVault } from '../../vault-index';
import { VAULT_LOCATION_KEY, getVaultSync } from '../../vault-sync';

let vault: string;

function writeNote(relativePath: string, frontmatter: Record<string, string | number>, body = ''): void {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(typeof value === 'string' ? `${key}: ${JSON.stringify(value)}` : `${key}: ${value}`);
  }
  lines.push('---');
  const absolute = path.join(vault, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${lines.join('\n')}\n${body}\n`);
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-index-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('reconcileIndexFromVault', () => {
  setupDb();

  it('makes frontmatter authoritative for metadata', () => {
    importDocument({
      id: 'a',
      title: 'Old title',
      content: 'x',
      sortOrder: 9,
    });

    writeNote('Note.md', {
      id: 'a',
      title: 'New title',
      emoji: '📄',
      bookmarked: '2026-05-01T00:00:00.000Z',
      order: 2,
    });

    const result = reconcileIndexFromVault(vault);
    expect(result.updated).toBe(1);

    const row = getDocumentById('a')!;
    expect(row.title).toBe('New title');
    expect(row.emoji).toBe('📄');
    expect(row.sortOrder).toBe(2);
    expect(row.metadata.bookmarkedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(row.content).toBe('x'); // content untouched
  });

  it('derives hierarchy from the folder layout', () => {
    importDocument({ id: 'parent', title: 'Parent', content: 'p' });
    importDocument({ id: 'child', title: 'Child', content: 'c', parentId: null });

    writeNote('Parent.md', { id: 'parent', title: 'Parent' });
    writeNote('Parent/Child.md', { id: 'child', title: 'Child' });

    reconcileIndexFromVault(vault);
    expect(getDocumentById('child')!.parentId).toBe('parent');
  });

  it('does not clear emoji when the file omits the field', () => {
    importDocument({ id: 'a', title: 'A', content: 'x' });
    applyIndexFields('a', { emoji: '📄' });

    writeNote('A.md', { id: 'a', title: 'A' }); // no emoji in frontmatter

    reconcileIndexFromVault(vault);
    expect(getDocumentById('a')!.emoji).toBe('📄');
  });

  it('migrates legacy Lexical JSON content from the file body', () => {
    importDocument({
      id: 'legacy',
      title: 'Legacy',
      content: JSON.stringify({ root: { children: [], type: 'root', version: 1 } }),
    });
    writeNote('Legacy.md', { id: 'legacy', title: 'Legacy' }, '# Legacy\n\nHello world');

    reconcileIndexFromVault(vault);
    expect(getDocumentById('legacy')!.content).toBe('Hello world\n');
  });

  it('adopts the file body as content (files are the source of truth)', () => {
    importDocument({ id: 'md', title: 'Md', content: 'stale markdown' });
    writeNote('Md.md', { id: 'md', title: 'Md' }, '# Md\n\ncurrent body');

    reconcileIndexFromVault(vault);
    expect(getDocumentById('md')!.content).toBe('current body\n');
    // The adopted file revision is baselined so the watcher does not re-apply it.
    expect(getDocumentById('md')!.metadata.vaultFileRevision).toBeDefined();
  });

  it('does not wipe content when the file body is empty', () => {
    importDocument({ id: 'empty', title: 'Empty', content: '# Kept' });
    writeNote('Empty.md', { id: 'empty', title: 'Empty' }, '');

    reconcileIndexFromVault(vault);
    expect(getDocumentById('empty')!.content).toBe('# Kept');
  });

  it('ignores files whose id has no database row (watcher imports those)', () => {
    writeNote('New.md', { id: 'brand-new', title: 'New' });
    const result = reconcileIndexFromVault(vault);
    expect(result.updated).toBe(0);
    expect(getDocumentById('brand-new')).toBeNull();
  });

  it('drops a self-referencing parent to avoid a cycle', () => {
    importDocument({ id: 'self', title: 'Self', content: 'x' });
    writeNote('Self/Self.md', { id: 'self', title: 'Self' });

    reconcileIndexFromVault(vault);
    expect(getDocumentById('self')!.parentId).toBeNull();
  });
  it('renames the file when the title changes (no orphan left behind)', () => {
    importDocument({ id: 'r', title: 'Old', content: '# Old\n\nbody' });
    const vaultRoot = path.join(vault, 'Lychee');
    setSetting(VAULT_LOCATION_KEY, vaultRoot);

    const sync = getVaultSync();
    sync.invalidatePaths();
    sync.writeNoteToVault('r');
    expect(fs.existsSync(path.join(vaultRoot, 'Old.md'))).toBe(true);

    updateDocument('r', { title: 'New' });
    sync.writeNoteToVault('r');

    expect(fs.existsSync(path.join(vaultRoot, 'New.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Old.md'))).toBe(false);
  });

  it('keeps the body heading as content (titles come from the filename)', () => {
    importDocument({ id: 'agent', title: 'Old Title', content: '# Old Title\n\nbody' });
    writeNote('Old Title.md', { id: 'agent', title: 'Old Title' }, '# New Title\n\nbody');

    reconcileIndexFromVault(vault);

    expect(getDocumentById('agent')!.title).toBe('Old Title');
    expect(getDocumentById('agent')!.content).toBe('# New Title\n\nbody\n');
  });

  it('keeps the newest duplicate-id file and trashes older orphans', () => {
    importDocument({ id: 'dup', title: 'Dup', content: 'x' });
    writeNote(
      'Dup.md',
      { id: 'dup', title: 'Dup', updated: '2026-01-01T00:00:00.000Z' },
      '# old',
    );
    writeNote(
      'Dup New.md',
      { id: 'dup', title: 'Dup New', updated: '2026-02-01T00:00:00.000Z' },
      '# new',
    );

    reconcileIndexFromVault(vault);

    // The newest file wins; its H1 is ordinary content.
    expect(getDocumentById('dup')!.content).toBe('# new\n');
    expect(fs.existsSync(path.join(vault, 'Dup.md'))).toBe(false);
    expect(fs.existsSync(path.join(vault, '.trash', 'Dup.md'))).toBe(true);
  });

  it('falls back to created when updated is absent', () => {
    importDocument({ id: 'cdup', title: 'Cdup', content: 'x' });
    writeNote('Cdup A.md', { id: 'cdup', title: 'A', created: '2026-01-01T00:00:00.000Z' });
    writeNote('Cdup B.md', { id: 'cdup', title: 'B', created: '2026-02-01T00:00:00.000Z' });

    reconcileIndexFromVault(vault);

    // Neither has `updated`, so `created` decides: the newer one wins.
    expect(getDocumentById('cdup')!.title).toBe('B');
    expect(fs.existsSync(path.join(vault, 'Cdup A.md'))).toBe(false);
    expect(fs.existsSync(path.join(vault, '.trash', 'Cdup A.md'))).toBe(true);
  });

  it('still converges to one note when updated and created are both absent', () => {
    importDocument({ id: 'tdup', title: 'Tdup', content: 'x' });
    writeNote('Tdup A.md', { id: 'tdup', title: 'A' });
    writeNote('Tdup B.md', { id: 'tdup', title: 'B' });

    reconcileIndexFromVault(vault);

    // One survives (renamed to its title by the self-heal), the other is trashed.
    const winners = ['A.md', 'B.md'].filter((name) =>
      fs.existsSync(path.join(vault, name)),
    );
    const trashed = ['Tdup A.md', 'Tdup B.md'].filter((name) =>
      fs.existsSync(path.join(vault, '.trash', name)),
    );
    expect(winners.length).toBe(1);
    expect(trashed.length).toBe(1);
  });
});

describe('VaultSync.writeNoteToVault', () => {
  setupDb();

  it('writes frontmatter plus the stored markdown body', () => {
    importDocument({ id: 'w', title: 'Written', content: '# Written\n\nhello world' });
    const vaultRoot = path.join(vault, 'Lychee');
    setSetting(VAULT_LOCATION_KEY, vaultRoot);

    getVaultSync().invalidatePaths();
    getVaultSync().writeNoteToVault('w');

    const contents = fs.readFileSync(path.join(vaultRoot, 'Written.md'), 'utf8');
    expect(contents).toContain('id: "w"');
    // The title lives in frontmatter; the body carries no title line.
    expect(contents).toContain('title: "Written"');
    expect(contents).not.toContain('# Written');
    expect(contents).toContain('hello world');
  });

  it('commitNote renames after a deferred (autosave) title change', () => {
    importDocument({ id: 'c', title: 'Old', content: '# Old\n\nbody' });
    const vaultRoot = path.join(vault, 'Lychee');
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    const sync = getVaultSync();

    sync.invalidatePaths();
    sync.writeNoteToVault('c');
    updateDocument('c', { title: 'New' });

    // Autosave writes in place (rename: false): still at the old name.
    sync.writeNoteToVault('c', true, false);
    expect(fs.existsSync(path.join(vaultRoot, 'Old.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'New.md'))).toBe(false);

    // Commit performs the move.
    sync.commitNote('c');
    expect(fs.existsSync(path.join(vaultRoot, 'New.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Old.md'))).toBe(false);
  });

  it('sweepPaths relocates a sibling when a rename frees its suffix', () => {
    importDocument({ id: 'a', title: 'Meeting', content: 'a' });
    importDocument({ id: 'b', title: 'Meeting', content: 'b' });
    const vaultRoot = path.join(vault, 'Lychee');
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    const sync = getVaultSync();

    sync.invalidatePaths();
    sync.writeNoteToVault('a');
    sync.writeNoteToVault('b');
    expect(fs.existsSync(path.join(vaultRoot, 'Meeting.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Meeting (2).md'))).toBe(true);

    updateDocument('a', { title: 'Standup' });
    sync.writeNoteToVault('a');
    sync.sweepPaths();

    expect(fs.existsSync(path.join(vaultRoot, 'Standup.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Meeting.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Meeting (2).md'))).toBe(false);
  });
});
