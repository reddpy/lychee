import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getSortOrders, getAllDocs, getDocumentById, createDocument, deleteDocument, trashDocument, moveDocument, listDocuments } from './setup';

describe('Document Repository — Hard Delete, getDocumentById, Move Error Cases', () => {
  setupDb();

  describe('Hard Delete', () => {
    // deleteDocument is a low-level operation that does NOT cascade.
    // This is intentional — it's only used internally, not exposed directly
    // to the user. But it means children become orphaned.
    it('hard delete does NOT cascade to children', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      deleteDocument(parent.id);

      expect(getDocumentById(parent.id)).toBeNull();
      // Child still exists but has a dangling parentId
      const orphan = getDocumentById(child.id)!;
      expect(orphan).not.toBeNull();
      expect(orphan.parentId).toBe(parent.id); // dangling reference
    });

    // Deleting a non-existent doc should be a silent no-op.
    // The SQL DELETE just affects 0 rows.
    it('deleting non-existent document is a silent no-op', () => {
      expect(() => deleteDocument('nonexistent')).not.toThrow();
    });
  });

  describe('getDocumentById', () => {
    it('returns document when found', () => {
      const doc = createDocument({ title: 'Test' });
      const result = getDocumentById(doc.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(doc.id);
      expect(result!.title).toBe('Test');
    });

    it('returns null when not found', () => {
      const result = getDocumentById('nonexistent');
      expect(result).toBeNull();
    });

    // Trashed docs should still be retrievable by ID — they're needed
    // for the trash UI and restore operations.
    it('returns trashed documents (no deletedAt filter)', () => {
      const doc = createDocument({ title: 'Test' });
      trashDocument(doc.id);

      const result = getDocumentById(doc.id);
      expect(result).not.toBeNull();
      expect(result!.deletedAt).not.toBeNull();
    });
  });

  describe('Move Error Cases', () => {
    it('throws on moving non-existent document', () => {
      expect(() => moveDocument('nonexistent', null, 0)).toThrow(
        'Document not found',
      );
    });
  });

  // ── Bug #3: deleteDocument doesn't close sort order gaps ────────────
  describe('Bug #3: Hard Delete Sort Order Gaps', () => {
    it('BUG: hard deleting middle doc leaves sort order gap', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      const b = getAllDocs(getDb()).find((d) => d.title === 'B')!;
      deleteDocument(b.id);

      // Should be [0, 1] if gap was closed, but it's [0, 2]
      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([0, 2]); // BUG: gap at position 1
    });

    it('BUG: hard deleting first doc leaves all siblings shifted up', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      deleteDocument(c.id);

      // Should be [0, 1] but will be [1, 2] — no gap closing
      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([1, 2]); // BUG: starts at 1, not 0
    });

    it('BUG: multiple hard deletes accumulate gaps', () => {
      for (let i = 0; i < 5; i++) {
        createDocument({ title: `Doc ${i}` });
      }
      // Doc4(0) Doc3(1) Doc2(2) Doc1(3) Doc0(4)

      // Delete positions 1 and 3
      const docs = getAllDocs(getDb()).sort((a, b) => a.sortOrder - b.sortOrder);
      deleteDocument(docs[1].id); // delete sortOrder 1
      deleteDocument(docs[3].id); // delete sortOrder 3

      const orders = getSortOrders(getDb(), null);
      // Should be [0, 1, 2] if gaps were closed
      expect(orders).toEqual([0, 2, 4]); // BUG: two gaps
    });
  });

  // ── Bug #4: deleteDocument doesn't cascade to children ──────────────
  describe('Bug #4: Hard Delete Orphans Children', () => {
    it('BUG: children become invisible orphans after parent hard delete', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });
      const grandchild = createDocument({ title: 'Grandchild', parentId: child.id });

      deleteDocument(parent.id);

      // Child and grandchild still exist with dangling parentIds
      const orphanChild = getDocumentById(child.id)!;
      expect(orphanChild).not.toBeNull();
      expect(orphanChild.parentId).toBe(parent.id); // points to deleted doc

      const orphanGrandchild = getDocumentById(grandchild.id)!;
      expect(orphanGrandchild).not.toBeNull();

      // These orphans are invisible in listDocuments because the sidebar
      // groups by parentId — they'll end up under a parent that doesn't exist.
      // The frontend's safety net promotes them to root level, but the data is corrupt.
      const listed = listDocuments({ limit: 100 });
      const orphanInList = listed.find((d) => d.id === child.id);
      expect(orphanInList).toBeDefined();
      expect(orphanInList!.parentId).toBe(parent.id); // dangling reference in the list
    });

    it('BUG: deep tree hard delete only removes root, leaves entire subtree orphaned', () => {
      const root = createDocument({ title: 'Root' });
      const level1 = createDocument({ title: 'L1', parentId: root.id });
      const level2 = createDocument({ title: 'L2', parentId: level1.id });
      const level3 = createDocument({ title: 'L3', parentId: level2.id });

      deleteDocument(root.id);

      // All descendants still exist
      expect(getDocumentById(level1.id)).not.toBeNull();
      expect(getDocumentById(level2.id)).not.toBeNull();
      expect(getDocumentById(level3.id)).not.toBeNull();

      // L1 is an orphan (parentId points to deleted root)
      expect(getDocumentById(level1.id)!.parentId).toBe(root.id);
      // L2 and L3 still have valid parent chains to each other
      // but the chain is broken at L1 → deleted root
    });
  });

});
