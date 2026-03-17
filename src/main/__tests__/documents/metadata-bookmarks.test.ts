import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import {
  setupDb,
  getDb,
  insertDoc,
  createDocument,
  updateDocument,
  getDocumentById,
  listDocuments,
  listTrashedDocuments,
  trashDocument,
  restoreDocument,
  permanentDeleteDocument,
  deleteDocument,
} from './setup';

describe('Document Repository — Metadata & Bookmarks', () => {
  setupDb();

  // --- Defaults ---

  it('newly created document has empty metadata object', () => {
    const doc = createDocument({ title: 'Fresh' });
    expect(doc.metadata).toEqual({});
    expect(doc.metadata.bookmarkedAt).toBeUndefined();
  });

  it('insertDoc helper defaults metadata to empty JSON', () => {
    const raw = insertDoc(getDb(), { title: 'Raw' });
    const doc = getDocumentById(raw.id)!;
    expect(doc.metadata).toEqual({});
  });

  it('listDocuments hydrates metadata from JSON string', () => {
    createDocument({ title: 'Hydrate Test' });
    const docs = listDocuments({ limit: 50 });
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect(typeof doc.metadata).toBe('object');
      expect(doc.metadata).not.toBeNull();
    }
  });

  // --- Bookmark toggle ---

  it('sets bookmarkedAt via updateDocument metadata patch', () => {
    const doc = createDocument({ title: 'Bookmark Me' });
    const ts = '2025-03-15T12:00:00.000Z';

    const updated = updateDocument(doc.id, { metadata: { bookmarkedAt: ts } });

    expect(updated.metadata.bookmarkedAt).toBe(ts);
  });

  it('clears bookmarkedAt by setting it to null', () => {
    const doc = createDocument({ title: 'Unbookmark' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-01-01T00:00:00.000Z' } });

    const cleared = updateDocument(doc.id, { metadata: { bookmarkedAt: null } });

    expect(cleared.metadata.bookmarkedAt).toBeNull();
  });

  it('bookmarkedAt persists across getDocumentById round-trip', () => {
    const doc = createDocument({ title: 'Persist' });
    const ts = '2025-06-01T08:30:00.000Z';
    updateDocument(doc.id, { metadata: { bookmarkedAt: ts } });

    const fetched = getDocumentById(doc.id)!;
    expect(fetched.metadata.bookmarkedAt).toBe(ts);
  });

  it('bookmarkedAt persists across listDocuments round-trip', () => {
    const doc = createDocument({ title: 'List Persist' });
    const ts = '2025-06-01T09:00:00.000Z';
    updateDocument(doc.id, { metadata: { bookmarkedAt: ts } });

    const docs = listDocuments({ limit: 500 });
    const found = docs.find((d) => d.id === doc.id)!;
    expect(found.metadata.bookmarkedAt).toBe(ts);
  });

  // --- Metadata merge behavior ---

  it('metadata patch merges with existing metadata (does not replace)', () => {
    const doc = createDocument({ title: 'Merge' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-01-01T00:00:00.000Z' } });

    // Update with an empty metadata patch should not clear bookmarkedAt
    // (patch.metadata is undefined → existing preserved)
    const updated = updateDocument(doc.id, { title: 'Merge Renamed' });
    expect(updated.metadata.bookmarkedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('metadata partial patch only updates specified keys', () => {
    const doc = createDocument({ title: 'Partial' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-03-01T00:00:00.000Z' } });

    // Passing an empty metadata object should spread over existing, keeping bookmarkedAt
    const updated = updateDocument(doc.id, { metadata: {} });
    expect(updated.metadata.bookmarkedAt).toBe('2025-03-01T00:00:00.000Z');
  });

  it('updating non-metadata fields does not affect metadata', () => {
    const doc = createDocument({ title: 'Isolated' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-05-01T00:00:00.000Z' } });

    const updated = updateDocument(doc.id, { title: 'New Title', emoji: '🔖' });
    expect(updated.metadata.bookmarkedAt).toBe('2025-05-01T00:00:00.000Z');
    expect(updated.title).toBe('New Title');
    expect(updated.emoji).toBe('🔖');
  });

  // --- Trash & restore with metadata ---

  it('trashing a bookmarked document preserves metadata', () => {
    const doc = createDocument({ title: 'Trash Test' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-02-01T00:00:00.000Z' } });

    trashDocument(doc.id);

    const trashed = getDocumentById(doc.id)!;
    expect(trashed.deletedAt).not.toBeNull();
    expect(trashed.metadata.bookmarkedAt).toBe('2025-02-01T00:00:00.000Z');
  });

  it('restoring a bookmarked document preserves metadata', () => {
    const doc = createDocument({ title: 'Restore Test' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-02-01T00:00:00.000Z' } });
    trashDocument(doc.id);

    restoreDocument(doc.id);

    const restored = getDocumentById(doc.id)!;
    expect(restored.deletedAt).toBeNull();
    expect(restored.metadata.bookmarkedAt).toBe('2025-02-01T00:00:00.000Z');
  });

  // --- Edge cases ---

  it('handles malformed metadata JSON gracefully (falls back to empty object)', () => {
    const raw = insertDoc(getDb(), { title: 'Corrupt' });
    // Directly write invalid JSON to metadata column
    getDb().prepare(`UPDATE documents SET metadata = ? WHERE id = ?`).run('not-json', raw.id);

    const doc = getDocumentById(raw.id)!;
    expect(doc.metadata).toEqual({});
    expect(doc.metadata.bookmarkedAt).toBeUndefined();
  });

  it('handles metadata with unknown extra keys (forward-compatible)', () => {
    const raw = insertDoc(getDb(), { title: 'Extra Keys' });
    getDb().prepare(`UPDATE documents SET metadata = ? WHERE id = ?`).run(
      JSON.stringify({ bookmarkedAt: '2025-01-01T00:00:00.000Z', futureField: 42 }),
      raw.id,
    );

    const doc = getDocumentById(raw.id)!;
    expect(doc.metadata.bookmarkedAt).toBe('2025-01-01T00:00:00.000Z');
    // Extra keys pass through the hydration layer
    expect((doc.metadata as Record<string, unknown>).futureField).toBe(42);
  });

  it('toggle bookmark on/off/on produces correct state each time', () => {
    const doc = createDocument({ title: 'Toggle' });

    // Bookmark
    const v1 = updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-01-01T00:00:00.000Z' } });
    expect(v1.metadata.bookmarkedAt).toBe('2025-01-01T00:00:00.000Z');

    // Unbookmark
    const v2 = updateDocument(doc.id, { metadata: { bookmarkedAt: null } });
    expect(v2.metadata.bookmarkedAt).toBeNull();

    // Re-bookmark
    const v3 = updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-06-01T00:00:00.000Z' } });
    expect(v3.metadata.bookmarkedAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('multiple documents can be bookmarked independently', () => {
    const a = createDocument({ title: 'A' });
    const b = createDocument({ title: 'B' });
    const c = createDocument({ title: 'C' });

    updateDocument(a.id, { metadata: { bookmarkedAt: '2025-01-01T00:00:00.000Z' } });
    updateDocument(c.id, { metadata: { bookmarkedAt: '2025-03-01T00:00:00.000Z' } });

    const docs = listDocuments({ limit: 500 });
    const bookmarked = docs.filter((d) => d.metadata.bookmarkedAt);
    expect(bookmarked).toHaveLength(2);
    expect(bookmarked.map((d) => d.title).sort()).toEqual(['A', 'C']);

    // B is not bookmarked
    const bDoc = docs.find((d) => d.id === b.id)!;
    expect(bDoc.metadata.bookmarkedAt).toBeUndefined();
  });

  // --- Permanent delete ---

  it('permanently deleting a bookmarked doc removes it completely', () => {
    const doc = createDocument({ title: 'Perm Delete' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-01-01T00:00:00.000Z' } });
    trashDocument(doc.id);

    permanentDeleteDocument(doc.id);

    expect(getDocumentById(doc.id)).toBeNull();
    const docs = listDocuments({ limit: 500 });
    expect(docs.find((d) => d.id === doc.id)).toBeUndefined();
  });

  it('deleting a bookmarked doc via deleteDocument removes it', () => {
    const doc = createDocument({ title: 'Direct Delete' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-01-01T00:00:00.000Z' } });

    deleteDocument(doc.id);

    expect(getDocumentById(doc.id)).toBeNull();
  });

  // --- Trashed bookmarks excluded from active list ---

  it('trashed bookmarked docs do not appear in listDocuments', () => {
    const doc = createDocument({ title: 'Trashed BM' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-01-01T00:00:00.000Z' } });
    trashDocument(doc.id);

    const docs = listDocuments({ limit: 500 });
    expect(docs.find((d) => d.id === doc.id)).toBeUndefined();
  });

  it('trashed bookmarked docs appear in listTrashedDocuments with metadata', () => {
    const doc = createDocument({ title: 'Trashed BM List' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-04-01T00:00:00.000Z' } });
    trashDocument(doc.id);

    const trashed = listTrashedDocuments({ limit: 500 });
    const found = trashed.find((d) => d.id === doc.id)!;
    expect(found).toBeDefined();
    expect(found.metadata.bookmarkedAt).toBe('2025-04-01T00:00:00.000Z');
  });

  // --- Metadata with various JSON types ---

  it('handles metadata with empty string bookmarkedAt (truthy but invalid)', () => {
    const raw = insertDoc(getDb(), { title: 'Empty String' });
    getDb().prepare(`UPDATE documents SET metadata = ? WHERE id = ?`).run(
      JSON.stringify({ bookmarkedAt: '' }),
      raw.id,
    );

    const doc = getDocumentById(raw.id)!;
    // Empty string is stored as-is — app layer treats falsy as unbookmarked
    expect(doc.metadata.bookmarkedAt).toBe('');
  });

  it('metadata survives update that only changes content', () => {
    const doc = createDocument({ title: 'Content Update' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-07-01T00:00:00.000Z' } });

    const updated = updateDocument(doc.id, { content: '{"root":{}}' });
    expect(updated.metadata.bookmarkedAt).toBe('2025-07-01T00:00:00.000Z');
  });

  // --- Bookmark on child document ---

  it('bookmarking a child document works independently of parent', () => {
    const parent = createDocument({ title: 'Parent' });
    const child = createDocument({ title: 'Child', parentId: parent.id });

    updateDocument(child.id, { metadata: { bookmarkedAt: '2025-05-01T00:00:00.000Z' } });

    const fetchedChild = getDocumentById(child.id)!;
    expect(fetchedChild.metadata.bookmarkedAt).toBe('2025-05-01T00:00:00.000Z');

    const fetchedParent = getDocumentById(parent.id)!;
    expect(fetchedParent.metadata.bookmarkedAt).toBeUndefined();
  });

  it('permanently deleting parent cascades and removes bookmarked child', () => {
    const parent = createDocument({ title: 'Parent Del' });
    const child = createDocument({ title: 'Child BM', parentId: parent.id });
    updateDocument(child.id, { metadata: { bookmarkedAt: '2025-05-01T00:00:00.000Z' } });

    permanentDeleteDocument(parent.id);

    expect(getDocumentById(child.id)).toBeNull();
    expect(getDocumentById(parent.id)).toBeNull();
  });

  // --- Stress tests ---

  it('bookmarking every other doc: getDocumentById returns correct state for each', () => {
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const doc = createDocument({ title: `Stress ${i}` });
      ids.push(doc.id);
    }

    // Bookmark even-indexed documents
    const bookmarkedIds = new Set<string>();
    for (let i = 0; i < ids.length; i += 2) {
      updateDocument(ids[i], { metadata: { bookmarkedAt: `2025-01-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00.000Z` } });
      bookmarkedIds.add(ids[i]);
    }

    // Verify each doc individually via getDocumentById
    for (const id of ids) {
      const doc = getDocumentById(id)!;
      if (bookmarkedIds.has(id)) {
        expect(doc.metadata.bookmarkedAt).toBeTruthy();
      } else {
        expect(doc.metadata.bookmarkedAt).toBeUndefined();
      }
    }
  });

  it('50 sequential metadata writes all persist (no write swallowed)', () => {
    const doc = createDocument({ title: 'Rapid Writes' });

    for (let i = 0; i < 50; i++) {
      const ts = `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z`;
      updateDocument(doc.id, { metadata: { bookmarkedAt: ts } });
      // Read back immediately — every single write must be visible
      const readBack = getDocumentById(doc.id)!;
      expect(readBack.metadata.bookmarkedAt).toBe(ts);
    }
  });

  it('bookmarking all docs in a deep tree and permanently deleting root', () => {
    // Build 5-level chain: root → c1 → c2 → c3 → c4
    const root = createDocument({ title: 'Deep Root' });
    const c1 = createDocument({ title: 'Deep L1', parentId: root.id });
    const c2 = createDocument({ title: 'Deep L2', parentId: c1.id });
    const c3 = createDocument({ title: 'Deep L3', parentId: c2.id });
    const c4 = createDocument({ title: 'Deep L4', parentId: c3.id });

    const allIds = [root.id, c1.id, c2.id, c3.id, c4.id];
    for (const id of allIds) {
      updateDocument(id, { metadata: { bookmarkedAt: '2025-06-01T00:00:00.000Z' } });
    }

    // Verify all bookmarked
    for (const id of allIds) {
      expect(getDocumentById(id)!.metadata.bookmarkedAt).toBe('2025-06-01T00:00:00.000Z');
    }

    permanentDeleteDocument(root.id);

    for (const id of allIds) {
      expect(getDocumentById(id)).toBeNull();
    }
  });

  it('metadata merge is consistent across 100 interleaved updates', () => {
    const doc = createDocument({ title: 'Interleaved' });
    updateDocument(doc.id, { metadata: { bookmarkedAt: '2025-01-01T00:00:00.000Z' } });

    // 100 title-only updates should never clobber metadata
    for (let i = 0; i < 100; i++) {
      updateDocument(doc.id, { title: `Title v${i}` });
    }

    const final = getDocumentById(doc.id)!;
    expect(final.title).toBe('Title v99');
    expect(final.metadata.bookmarkedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('200 docs: each bookmarkedAt value round-trips exactly through listDocuments', () => {
    const expected = new Map<string, string>();
    for (let i = 0; i < 200; i++) {
      const doc = createDocument({ title: `RT ${i}` });
      const ts = `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z`;
      updateDocument(doc.id, { metadata: { bookmarkedAt: ts } });
      expected.set(doc.id, ts);
    }

    const docs = listDocuments({ limit: 500 });
    for (const [id, ts] of expected) {
      const found = docs.find((d) => d.id === id);
      expect(found).toBeDefined();
      expect(found!.metadata.bookmarkedAt).toBe(ts);
    }
  });
});
