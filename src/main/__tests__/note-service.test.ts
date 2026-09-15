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

import { setupDb, getDocumentById, listDocuments, setDocumentMetadata } from './documents/setup';
import { setSetting } from '../repos/settings';
import { VAULT_LOCATION_KEY, getVaultSync } from '../vault-sync';
import { resolveVaultRoot } from '../mcp-config';
import { CONTENT_SCHEMA_VERSION } from '../../shared/documents';
import {
  createNote as serviceCreateNote,
  getActiveVault,
  setActiveVault,
  updateNote as serviceUpdateNote,
} from '../note-service';
import { parseFrontmatter } from '../../shared/frontmatter';

let vault: string;
let vaultRoot: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-note-service-'));
  vaultRoot = resolveVaultRoot(vault);
  fs.mkdirSync(vaultRoot, { recursive: true });
});

afterEach(() => {
  setActiveVault(null);
  fs.rmSync(vault, { recursive: true, force: true });
});

function listMarkdownNames(): string[] {
  return fs.readdirSync(vaultRoot).filter((name) => name.endsWith('.md')).sort();
}

describe('note service — active vault (file-first)', () => {
  setupDb();

  // Registered after setupDb so the test DB exists before settings are written.
  beforeEach(() => {
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    setActiveVault(vaultRoot);
  });

  it('writes the file first and projects it into the index', () => {
    expect(getActiveVault()).toBe(vaultRoot);

    const document = serviceCreateNote({ title: 'Fresh' });

    expect(fs.existsSync(path.join(vaultRoot, 'Fresh.md'))).toBe(true);
    const row = getDocumentById(document.id)!;
    expect(row.metadata.vaultRelativePath).toBe('Fresh.md');
    expect(row.metadata.vaultFileRevision).toBeTruthy();
    expect(row.content).toBe('');
    expect(row.title).toBe('Fresh');

    // The index row's identity is the file's identity.
    const { data } = parseFrontmatter(fs.readFileSync(path.join(vaultRoot, 'Fresh.md'), 'utf8'));
    expect(data.id).toBe(row.id);
  });

  it('stores initial markdown content in both the file and the index', () => {
    const document = serviceCreateNote({ title: 'With Body', content: 'hello **world**' });

    const file = fs.readFileSync(path.join(vaultRoot, 'With Body.md'), 'utf8');
    expect(file).toContain('hello **world**');
    expect(getDocumentById(document.id)!.content).toBe('hello **world**');
  });

  it('nests under a parent and records the hierarchy', () => {
    const parent = serviceCreateNote({ title: 'Parent' });
    const child = serviceCreateNote({ title: 'Child', parentId: parent.id });

    expect(fs.existsSync(path.join(vaultRoot, 'Parent', 'Child.md'))).toBe(true);
    const childRow = getDocumentById(child.id)!;
    expect(childRow.parentId).toBe(parent.id);
    expect(childRow.metadata.vaultRelativePath).toBe('Parent/Child.md');
  });

  it('puts each new note on top (dense sibling order)', () => {
    const a = serviceCreateNote({ title: 'A' });
    const b = serviceCreateNote({ title: 'B' });
    const c = serviceCreateNote({ title: 'C' });

    const rows = new Map(listDocuments({ limit: 50 }).map((row) => [row.id, row.sortOrder]));
    expect(rows.get(c.id)).toBe(0);
    expect(rows.get(b.id)).toBe(1);
    expect(rows.get(a.id)).toBe(2);
  });

  it('refuses a duplicate title without leaving a file behind', () => {
    serviceCreateNote({ title: 'Dup' });
    expect(() => serviceCreateNote({ title: 'dup' })).toThrow('Duplicate title');
    expect(fs.readdirSync(vaultRoot).filter((name) => name.endsWith('.md'))).toHaveLength(1);
  });

  it('keeps sibling files\' frontmatter order dense after a burst of creates', () => {
    for (let i = 0; i < 10; i += 1) serviceCreateNote({ title: `Note ${i}` });

    const orders = fs
      .readdirSync(vaultRoot)
      .filter((name) => name.endsWith('.md'))
      .map((name) => parseFrontmatter(fs.readFileSync(path.join(vaultRoot, name), 'utf8')).data.order);
    expect([...orders].sort((x, y) => Number(x) - Number(y))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
});

describe('note service — inactive vault (DB-first pass-through)', () => {
  setupDb();

  beforeEach(() => {
    // A location is configured, but the service has not been told the vault is
    // active — the pre-bootstrap state. It must fall back to DB-first and still
    // write through, never crash.
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    setActiveVault(null);
  });

  it('creates through the repo then writes through to the vault', () => {
    const document = serviceCreateNote({ title: 'DB Only' });

    expect(getDocumentById(document.id)).not.toBeNull();
    expect(fs.existsSync(path.join(vaultRoot, 'DB Only.md'))).toBe(true);
  });

  it('updates through the repo then writes through to the vault', () => {
    const document = serviceCreateNote({ title: 'Existing' });
    const updated = serviceUpdateNote(document.id, { content: 'db-first edit' })!;

    expect(updated.content).toBe('db-first edit');
    expect(fs.readFileSync(path.join(vaultRoot, 'Existing.md'), 'utf8')).toContain(
      'db-first edit',
    );
  });
});

describe('note service — update (file-first)', () => {
  setupDb();

  beforeEach(() => {
    setSetting(VAULT_LOCATION_KEY, vaultRoot);
    setActiveVault(vaultRoot);
  });

  it('writes content to the file first and projects it into the index', () => {
    const created = serviceCreateNote({ title: 'Doc' });
    const document = serviceUpdateNote(created.id, { content: 'edited body' })!;

    expect(fs.readFileSync(path.join(vaultRoot, 'Doc.md'), 'utf8')).toContain('edited body');
    expect(document.content).toBe('edited body');
    expect(document.metadata.vaultFileRevision).toBeTruthy();
  });

  it('renames the file and updates the path on a title commit', () => {
    const created = serviceCreateNote({ title: 'Old Name' });
    const document = serviceUpdateNote(created.id, { title: 'New Name', rename: true })!;

    expect(fs.existsSync(path.join(vaultRoot, 'New Name.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Old Name.md'))).toBe(false);
    expect(document.title).toBe('New Name');
    expect(document.metadata.vaultRelativePath).toBe('New Name.md');
  });

  it('defers the rename when rename is false, then commits on demand', () => {
    const created = serviceCreateNote({ title: 'Draft' });
    serviceUpdateNote(created.id, { title: 'Final', rename: false });

    // Still at the old path, but the title is persisted in the index.
    expect(fs.existsSync(path.join(vaultRoot, 'Draft.md'))).toBe(true);
    expect(getDocumentById(created.id)!.title).toBe('Final');

    getVaultSync().commitNote(created.id);
    expect(fs.existsSync(path.join(vaultRoot, 'Final.md'))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, 'Draft.md'))).toBe(false);
  });

  it('persists emoji and bookmark frontmatter changes', () => {
    const created = serviceCreateNote({ title: 'Styled' });
    serviceUpdateNote(created.id, { emoji: '📌' });
    let file = fs.readFileSync(path.join(vaultRoot, 'Styled.md'), 'utf8');
    expect(file).toContain('emoji: "📌"');
    expect(getDocumentById(created.id)!.emoji).toBe('📌');

    serviceUpdateNote(created.id, { metadata: { bookmarkedAt: '2026-09-12T00:00:00.000Z' } });
    file = fs.readFileSync(path.join(vaultRoot, 'Styled.md'), 'utf8');
    expect(file).toContain('bookmarked: "2026-09-12T00:00:00.000Z"');
    expect(getDocumentById(created.id)!.metadata.bookmarkedAt).toBe('2026-09-12T00:00:00.000Z');

    serviceUpdateNote(created.id, { emoji: null, metadata: { bookmarkedAt: null } });
    file = fs.readFileSync(path.join(vaultRoot, 'Styled.md'), 'utf8');
    expect(file).not.toContain('emoji:');
    expect(file).not.toContain('bookmarked:');
  });

  it('refuses to overwrite content from a newer schema, leaving the file intact', () => {
    const created = serviceCreateNote({ title: 'Future', content: 'v2 body' });
    setDocumentMetadata(created.id, { contentSchemaVersion: CONTENT_SCHEMA_VERSION + 1 });

    expect(() => serviceUpdateNote(created.id, { content: 'stale write' })).toThrow(
      /newer content schema/,
    );
    expect(fs.readFileSync(path.join(vaultRoot, 'Future.md'), 'utf8')).toContain('v2 body');
  });

  it('preserves an external edit when the file diverged (falls back to conflict path)', () => {
    const created = serviceCreateNote({ title: 'Contested', content: 'original' });

    // Simulate MCP/sync writing the file after our baseline.
    fs.writeFileSync(
      path.join(vaultRoot, 'Contested.md'),
      '---\nid: "' + created.id + '"\ntitle: "Contested"\n---\nexternal edit',
    );

    const document = serviceUpdateNote(created.id, { content: 'my edit' })!;

    // The external bytes survive on disk; the index holds our edit (the watcher
    // then preserves the external change as a conflict copy).
    expect(fs.readFileSync(path.join(vaultRoot, 'Contested.md'), 'utf8')).toContain('external edit');
    expect(document.content).toBe('my edit');
  });

  it('propagates a duplicate-title error and leaves the file alone', () => {
    serviceCreateNote({ title: 'Taken' });
    const other = serviceCreateNote({ title: 'Other' });

    // Bypass the IPC pre-check to exercise the store's own guard.
    expect(() => serviceUpdateNote(other.id, { title: 'taken', rename: true })).toThrow(
      'Duplicate title',
    );
    expect(fs.existsSync(path.join(vaultRoot, 'Other.md'))).toBe(true);
  });

  it('does not rename when the committed title is unchanged', () => {
    const created = serviceCreateNote({ title: 'Same' });
    serviceUpdateNote(created.id, { title: 'Same', rename: true });

    expect(listMarkdownNames()).toEqual(['Same.md']);
  });

  it('leaves the body untouched for a bookmark-only update', () => {
    const created = serviceCreateNote({ title: 'Bmark', content: 'keep this body' });
    serviceUpdateNote(created.id, { metadata: { bookmarkedAt: '2026-06-06T00:00:00.000Z' } });

    expect(fs.readFileSync(path.join(vaultRoot, 'Bmark.md'), 'utf8')).toContain('keep this body');
    expect(getDocumentById(created.id)!.content).toBe('keep this body');
  });
});
