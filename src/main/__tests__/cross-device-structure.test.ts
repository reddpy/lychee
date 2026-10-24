import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../db', async () => {
  const { getTestDb } = await import('./helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, importDocument, getDocumentById, setDocumentMetadata } from './documents/setup';
import { reconcileIndexFromVault } from '../vault-index';

/**
 * Cross-device STRUCTURE propagation at reconcile time.
 *
 * A shared vault can receive a note's file at a new path — from a rename or move
 * on another device — or two paths claiming the same id when both devices
 * retitled concurrently. Reconcile must adopt the new layout, keep identity and
 * content, and collapse duplicates deterministically.
 */

let vault: string;

const fm = (id: string, title: string, updated: string): string =>
  [
    '---',
    `id: "${id}"`,
    `title: ${JSON.stringify(title)}`,
    'created: "2024-01-01T00:00:00.000Z"',
    `updated: "${updated}"`,
    'content_schema_version: 1',
    '---',
    '',
  ].join('\n');

function write(relativePath: string, id: string, title: string, updated: string, body = ''): void {
  const absolute = path.join(vault, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${fm(id, title, updated)}${body}`);
}

function files(root = vault): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.toLowerCase().endsWith('.md')) {
        out.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

function trashFiles(): string[] {
  const root = path.join(vault, '.trash');
  return fs.existsSync(root) ? files(root) : [];
}

function row(id: string) {
  const document = getDocumentById(id);
  if (!document) throw new Error(`missing document ${id}`);
  return document;
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-cross-device-structure-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('cross-device structure — a file arrives at a new path', () => {
  setupDb();

  it('adopts a rename made on another device', () => {
    importDocument({ id: 'note', title: 'Old Name', content: 'body' });
    setDocumentMetadata('note', { vaultRelativePath: 'Old Name.md' });

    write('New Name.md', 'note', 'New Name', '2026-02-01T00:00:00.000Z', 'renamed body');

    reconcileIndexFromVault(vault);

    expect(row('note').title).toBe('New Name');
    expect(row('note').content).toContain('renamed body');
    expect(row('note').metadata.vaultRelativePath).toBe('New Name.md');
    expect(files()).toEqual(['New Name.md']);
  });

  it('adopts a move that reparents the note', () => {
    importDocument({ id: 'child', title: 'Child', content: 'child body' });
    setDocumentMetadata('child', { vaultRelativePath: 'Child.md' });
    importDocument({ id: 'home', title: 'Home', content: 'home body' });

    write('Home.md', 'home', 'Home', '2026-02-01T00:00:00.000Z', 'home body');
    write('Home/Child.md', 'child', 'Child', '2026-02-01T00:00:00.000Z', 'moved body');

    reconcileIndexFromVault(vault);

    expect(row('child').parentId).toBe('home');
    expect(row('child').title).toBe('Child');
    expect(row('child').metadata.vaultRelativePath).toBe('Home/Child.md');
    expect(files()).toEqual(['Home.md', 'Home/Child.md']);
  });

  it('clears the title when the renamed file uses the blank sentinel', () => {
    importDocument({ id: 'blank', title: 'Something', content: 'body' });
    setDocumentMetadata('blank', { vaultRelativePath: 'Something.md' });

    write('Untitled.md', 'blank', 'Untitled', '2026-02-01T00:00:00.000Z', 'body');

    reconcileIndexFromVault(vault);
    expect(row('blank').title).toBe('');
    expect(row('blank').metadata.vaultRelativePath).toBe('Untitled.md');
  });

  it('adopts unicode and punctuation in a remote filename', () => {
    importDocument({ id: 'unicode', title: 'Old', content: 'body' });
    setDocumentMetadata('unicode', { vaultRelativePath: 'Old.md' });

    write('Café 日本 (draft).md', 'unicode', 'Café 日本 (draft)', '2026-02-01T00:00:00.000Z', 'body');

    reconcileIndexFromVault(vault);
    expect(row('unicode').title).toBe('Café 日本 (draft)');
    expect(files()).toEqual(['Café 日本 (draft).md']);
  });

  it('adopts a rename and an edited body arriving together', () => {
    importDocument({ id: 'edit-rename', title: 'Before', content: 'old body' });
    setDocumentMetadata('edit-rename', { vaultRelativePath: 'Before.md' });

    write('After.md', 'edit-rename', 'After', '2026-02-01T00:00:00.000Z', 'new body from device B');

    reconcileIndexFromVault(vault);
    expect(row('edit-rename').title).toBe('After');
    expect(row('edit-rename').content).toContain('new body from device B');
    expect(files()).toEqual(['After.md']);
  });

  it('adopts a move back to the vault root', () => {
    importDocument({ id: 'home', title: 'Home', content: 'home' });
    importDocument({ id: 'child', title: 'Child', content: 'child', parentId: 'home' });
    setDocumentMetadata('child', { vaultRelativePath: 'Home/Child.md' });

    write('Home.md', 'home', 'Home', '2026-02-01T00:00:00.000Z', 'home');
    write('Child.md', 'child', 'Child', '2026-02-01T00:00:00.000Z', 'moved to root');

    reconcileIndexFromVault(vault);
    expect(row('child').parentId).toBeNull();
    expect(row('child').metadata.vaultRelativePath).toBe('Child.md');
  });

  it('derives a deep parent chain from the folder layout', () => {
    write('A.md', 'a', 'A', '2026-02-01T00:00:00.000Z');
    write('A/B.md', 'b', 'B', '2026-02-01T00:00:00.000Z');
    write('A/B/C.md', 'c', 'C', '2026-02-01T00:00:00.000Z');

    reconcileIndexFromVault(vault);
    expect(row('a').parentId).toBeNull();
    expect(row('b').parentId).toBe('a');
    expect(row('c').parentId).toBe('b');
    expect(row('c').metadata.vaultRelativePath).toBe('A/B/C.md');
  });

  it('a folder with no parent file leaves the note at the root', () => {
    importDocument({ id: 'loose', title: 'Loose', content: 'body' });
    setDocumentMetadata('loose', { vaultRelativePath: 'Loose.md' });

    write('Loose/Child.md', 'loose', 'Loose', '2026-02-01T00:00:00.000Z', 'body');

    reconcileIndexFromVault(vault);
    expect(row('loose').parentId).toBeNull();
  });

  it('moving a parent carries its subtree without changing child parents', () => {
    importDocument({ id: 'home', title: 'Home', content: 'home' });
    importDocument({ id: 'parent', title: 'Parent', content: 'parent' });
    importDocument({ id: 'child', title: 'Child', content: 'child', parentId: 'parent' });
    setDocumentMetadata('parent', { vaultRelativePath: 'Parent.md' });
    setDocumentMetadata('child', { vaultRelativePath: 'Parent/Child.md' });

    write('Home.md', 'home', 'Home', '2026-02-01T00:00:00.000Z', 'home');
    write('Home/Parent.md', 'parent', 'Parent', '2026-02-01T00:00:00.000Z', 'parent');
    write('Home/Parent/Child.md', 'child', 'Child', '2026-02-01T00:00:00.000Z', 'child');

    reconcileIndexFromVault(vault);
    expect(row('parent').parentId).toBe('home');
    expect(row('child').parentId).toBe('parent');
    expect(row('parent').metadata.vaultRelativePath).toBe('Home/Parent.md');
    expect(row('child').metadata.vaultRelativePath).toBe('Home/Parent/Child.md');
  });

  it('adopts a rename and a move in the same update', () => {
    importDocument({ id: 'old-child', title: 'Old Child', content: 'old' });
    setDocumentMetadata('old-child', { vaultRelativePath: 'Old/Child.md' });
    importDocument({ id: 'old-parent', title: 'Old Parent', content: 'old parent' });
    importDocument({ id: 'new-parent', title: 'New Parent', content: 'new parent' });

    write('New Parent.md', 'new-parent', 'New Parent', '2026-02-01T00:00:00.000Z', 'new parent');
    write(
      'New Parent/Renamed Child.md',
      'old-child',
      'Renamed Child',
      '2026-02-01T00:00:00.000Z',
      'moved + renamed',
    );

    reconcileIndexFromVault(vault);

    expect(row('old-child').title).toBe('Renamed Child');
    expect(row('old-child').parentId).toBe('new-parent');
    expect(row('old-child').content).toContain('moved + renamed');
    expect(row('old-child').metadata.vaultRelativePath).toBe('New Parent/Renamed Child.md');
  });
});

describe('cross-device structure — concurrent renames', () => {
  setupDb();

  it('keeps the newest retitle and trashes the losing file', () => {
    importDocument({ id: 'shared', title: 'App Title', content: 'shared body' });
    setDocumentMetadata('shared', { vaultRelativePath: 'App Title.md' });

    // Both devices renamed the same note; the folder now has both files.
    write('App Title.md', 'shared', 'App Title', '2026-02-01T00:00:00.000Z', 'from app');
    write('Device Title.md', 'shared', 'Device Title', '2026-03-01T00:00:00.000Z', 'from device');

    reconcileIndexFromVault(vault);

    expect(row('shared').title).toBe('Device Title');
    expect(row('shared').metadata.vaultRelativePath).toBe('Device Title.md');
    expect(files()).toEqual(['Device Title.md']);
    expect(trashFiles()).toContain('App Title.md');
  });

  it('an older retitle loses to the newer app-side rename', () => {
    importDocument({ id: 'shared', title: 'App Title', content: 'shared body' });
    setDocumentMetadata('shared', { vaultRelativePath: 'App Title.md' });

    write('App Title.md', 'shared', 'App Title', '2026-03-01T00:00:00.000Z', 'from app');
    write('Device Title.md', 'shared', 'Device Title', '2026-01-01T00:00:00.000Z', 'from device');

    reconcileIndexFromVault(vault);

    expect(row('shared').title).toBe('App Title');
    expect(row('shared').metadata.vaultRelativePath).toBe('App Title.md');
    expect(files()).toEqual(['App Title.md']);
    expect(trashFiles()).toContain('Device Title.md');
  });

  it('collapses three duplicate-id files to the newest retitle', () => {
    importDocument({ id: 'shared', title: 'Base', content: 'body' });
    setDocumentMetadata('shared', { vaultRelativePath: 'Base.md' });

    write('Oldest.md', 'shared', 'Oldest', '2026-01-01T00:00:00.000Z', 'oldest');
    write('Newest.md', 'shared', 'Newest', '2026-03-01T00:00:00.000Z', 'newest');
    write('Middle.md', 'shared', 'Middle', '2026-02-01T00:00:00.000Z', 'middle');

    reconcileIndexFromVault(vault);
    expect(row('shared').title).toBe('Newest');
    expect(files()).toEqual(['Newest.md']);
    expect(trashFiles().sort()).toEqual(['Middle.md', 'Oldest.md']);
  });

  it('ignores a conflict copy even when it carries the same id and a newer date', () => {
    importDocument({ id: 'note', title: 'Note', content: 'canonical' });
    setDocumentMetadata('note', { vaultRelativePath: 'Note.md' });

    write('Note.md', 'note', 'Note', '2026-01-01T00:00:00.000Z', 'canonical');
    write(
      'Note (conflict 2024-01-01 00-00-00).md',
      'note',
      'Note',
      '2030-01-01T00:00:00.000Z',
      'conflict copy',
    );

    reconcileIndexFromVault(vault);
    expect(row('note').metadata.vaultRelativePath).toBe('Note.md');
    expect(files()).toContain('Note (conflict 2024-01-01 00-00-00).md');
    expect(trashFiles()).toEqual([]);
  });

  it('does not wipe content when the newest duplicate has an empty body', () => {
    importDocument({ id: 'note', title: 'Note', content: 'original content' });
    setDocumentMetadata('note', { vaultRelativePath: 'Note.md' });

    write('Newest.md', 'note', 'Newest', '2026-03-01T00:00:00.000Z', '');
    write('Older.md', 'note', 'Older', '2026-01-01T00:00:00.000Z', 'older content');

    reconcileIndexFromVault(vault);
    expect(row('note').title).toBe('Newest');
    expect(row('note').content).toContain('original content');
    expect(files()).toEqual(['Newest.md']);
  });

  it('takes the parent from the winning file when concurrent copies disagree', () => {
    importDocument({ id: 'a', title: 'A', content: 'a' });
    importDocument({ id: 'b', title: 'B', content: 'b' });
    importDocument({ id: 'shared', title: 'Shared', content: 'shared', parentId: 'a' });
    setDocumentMetadata('shared', { vaultRelativePath: 'A/Shared.md' });

    write('A.md', 'a', 'A', '2026-02-01T00:00:00.000Z', 'a');
    write('B.md', 'b', 'B', '2026-02-01T00:00:00.000Z', 'b');
    write('A/Shared.md', 'shared', 'Shared', '2026-01-01T00:00:00.000Z', 'older');
    write('B/Shared.md', 'shared', 'Shared', '2026-03-01T00:00:00.000Z', 'newer');

    reconcileIndexFromVault(vault);
    expect(row('shared').parentId).toBe('b');
    expect(row('shared').metadata.vaultRelativePath).toBe('B/Shared.md');
    expect(files()).toEqual(['A.md', 'B.md', 'B/Shared.md']);
  });

  it('a stale duplicate never resurrects the note after a purge tombstone', () => {
    importDocument({ id: 'gone', title: 'Gone', content: 'gone body' });
    setDocumentMetadata('gone', { vaultRelativePath: 'Gone.md' });
    write('Gone.md', 'gone', 'Gone', '2026-01-01T00:00:00.000Z', 'gone body');

    const dir = path.join(vault, '.lychee', 'tombstones');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'device-b.jsonl'),
      `${JSON.stringify({
        id: 'gone',
        action: 'purge',
        at: '2026-02-01T00:00:00.000Z',
        device: 'device-b',
      })}\n`,
    );

    const result = reconcileIndexFromVault(vault);
    expect(result.updated).toBe(0);
    expect(getDocumentById('gone')?.metadata.vaultRelativePath).toBe('Gone.md');
  });
});
