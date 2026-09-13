import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, createDocument, getDocumentById, importDocument, setDocumentMetadata } from './setup';

describe('Document Repository — importDocument', () => {
  setupDb();

  it('inserts a document under an explicit id', () => {
    const result = importDocument({
      id: 'imported-1',
      title: 'Imported',
      content: '{"root":{"type":"root","version":1,"children":[]}}',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });

    expect(result).toEqual({ created: true });
    const stored = getDocumentById('imported-1')!;
    expect(stored.title).toBe('Imported');
    expect(stored.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(stored.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('never overwrites an existing note', () => {
    importDocument({ id: 'dupe', title: 'Original', content: 'original' });
    const result = importDocument({ id: 'dupe', title: 'Replacement', content: 'replacement' });

    expect(result).toEqual({ created: false });
    expect(getDocumentById('dupe')!.content).toBe('original');
  });

  it('falls back to root when the parent does not exist', () => {
    importDocument({ id: 'child', title: 'Child', content: 'x', parentId: 'missing' });
    expect(getDocumentById('child')!.parentId).toBeNull();
  });

  it('links to an existing parent', () => {
    const parent = createDocument({ title: 'Parent' });
    importDocument({ id: 'child', title: 'Child', content: 'x', parentId: parent.id });
    expect(getDocumentById('child')!.parentId).toBe(parent.id);
  });

  it('clamps a negative sortOrder to zero', () => {
    importDocument({ id: 'n', title: 'N', content: 'x', sortOrder: -5 });
    expect(getDocumentById('n')!.sortOrder).toBe(0);
  });

  it('stores the content schema version in metadata', () => {
    importDocument({
      id: 'v',
      title: 'V',
      content: 'x',
      metadata: { contentSchemaVersion: 1 },
    });
    expect(getDocumentById('v')!.metadata.contentSchemaVersion).toBe(1);
  });
});

describe('setDocumentMetadata', () => {
  setupDb();

  it('updates metadata without touching content or updatedAt', () => {
    const doc = createDocument({ title: 'X' });
    const before = getDocumentById(doc.id)!;
    setDocumentMetadata(doc.id, { vaultFileRevision: 'abc', vaultContentRevision: 'def' });
    const after = getDocumentById(doc.id)!;
    expect(after.metadata.vaultFileRevision).toBe('abc');
    expect(after.metadata.vaultContentRevision).toBe('def');
    expect(after.content).toBe(before.content);
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});
