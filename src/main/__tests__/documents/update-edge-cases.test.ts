import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, insertDoc, getAllDocsForParent, getSortOrders, getDocumentById, createDocument, updateDocument, trashDocument } from './setup';

describe('Document Repository — Update Edge Cases', () => {
  setupDb();

    // Empty patch — only updatedAt should change.
    // This is a valid operation (e.g., "touch" the document).
    // We use insertDoc with a past timestamp so the update's nowIso() will differ.
    it('empty patch only bumps updatedAt', () => {
      const past = '2024-01-01T00:00:00.000Z';
      const docData = insertDoc(getDb(), {
        title: 'Test',
        content: 'hello',
        createdAt: past,
        updatedAt: past,
      });

      const updated = updateDocument(docData.id, {});

      expect(updated.title).toBe('Test');
      expect(updated.content).toBe('hello');
      expect(updated.updatedAt).not.toBe(past);
    });

    // Setting title to empty string is valid (user clears the title field).
    it('update title to empty string is allowed', () => {
      const doc = createDocument({ title: 'Original' });
      const updated = updateDocument(doc.id, { title: '' });
      expect(updated.title).toBe('');
    });

    // CRITICAL DIFFERENCE: updateDocument(parentId) does NOT adjust sortOrders.
    // Only moveDocument does that. This is subtle — if a developer accidentally
    // uses updateDocument to reparent, sortOrders in both parents will be wrong.
    it('update parentId does NOT adjust sortOrders (unlike moveDocument)', () => {
      const parent1 = createDocument({ title: 'Parent 1' });
      const parent2 = createDocument({ title: 'Parent 2' });
      const child = createDocument({ title: 'Child', parentId: parent1.id });
      createDocument({ title: 'Sibling', parentId: parent1.id });
      // Under parent1: Sibling(0), Child(1)

      // Use updateDocument instead of moveDocument
      updateDocument(child.id, { parentId: parent2.id });

      // parent1 should still have sortOrders with gap (no gap-closing happened)
      const p1Children = getAllDocsForParent(getDb(), parent1.id);
      // Only Sibling remains, but its sortOrder is still 0 (it was already 0)
      // The key point: if Child was at sortOrder 1, there's no gap-closing
      // because updateDocument doesn't do that.
      const p1Orders = p1Children
        .filter((d) => !d.deletedAt)
        .map((d) => d.sortOrder);
      // Sibling is at 0, which is fine. But if child was in the middle,
      // there'd be a gap. Let's test that more explicitly:
      expect(p1Orders).toEqual([0]); // only sibling remains
    });

    // Updating a trashed document should succeed — the code doesn't check deletedAt.
    it('can update a trashed document', () => {
      const doc = createDocument({ title: 'Test' });
      trashDocument(doc.id);

      const updated = updateDocument(doc.id, { title: 'Updated While Trashed' });
      expect(updated.title).toBe('Updated While Trashed');
      expect(updated.deletedAt).not.toBeNull(); // still trashed
    });

    // Updating non-existent doc should throw.
    it('throws on updating non-existent document', () => {
      expect(() => updateDocument('nonexistent', { title: 'X' })).toThrow(
        'Document not found',
      );
    });

    // Verify partial patches work — only the provided fields change.
    it('partial patch only updates provided fields', () => {
      const doc = createDocument({
        title: 'Original Title',
        content: 'Original Content',
        emoji: '📝',
      });

      const updated = updateDocument(doc.id, { title: 'New Title' });
      expect(updated.title).toBe('New Title');
      expect(updated.content).toBe('Original Content');
      expect(updated.emoji).toBe('📝');
    });

    // Setting emoji to null (removing the emoji) should work.
    it('can set emoji to null (remove emoji)', () => {
      const doc = createDocument({ emoji: '📝' });
      const updated = updateDocument(doc.id, { emoji: null });
      expect(updated.emoji).toBeNull();
    });

    // ── Bug #2: updateDocument allows parentId change without sort order maintenance ──
    // The IPC contract exposes parentId in the update patch. If called with a new
    // parentId, it silently moves the doc without closing the gap in the old parent,
    // making room in the new parent, or checking for circular references.

    it('BUG: updateDocument with parentId leaves sort order gap in old parent', () => {
      const parent1 = createDocument({ title: 'Parent 1' });
      createDocument({ title: 'A', parentId: parent1.id });
      const b = createDocument({ title: 'B', parentId: parent1.id });
      createDocument({ title: 'C', parentId: parent1.id });
      // parent1 children: C(0), B(1), A(2)

      const parent2 = createDocument({ title: 'Parent 2' });

      // Use updateDocument to reparent B — this is the bug
      updateDocument(b.id, { parentId: parent2.id });

      // Old parent should have [0, 1] if gap was closed, but gap remains
      const oldOrders = getSortOrders(getDb(), parent1.id);
      expect(oldOrders).toEqual([0, 2]); // BUG: gap at position 1
    });

    it('BUG: updateDocument with parentId does not make room in new parent', () => {
      const parent1 = createDocument({ title: 'Parent 1' });
      const doc = createDocument({ title: 'Doc', parentId: parent1.id });

      const parent2 = createDocument({ title: 'Parent 2' });
      createDocument({ title: 'X', parentId: parent2.id });
      createDocument({ title: 'Y', parentId: parent2.id });
      // parent2 children: Y(0), X(1)

      updateDocument(doc.id, { parentId: parent2.id });

      // Doc keeps its old sortOrder (0) which collides with Y
      const newOrders = getSortOrders(getDb(), parent2.id);
      const uniqueOrders = new Set(newOrders);
      expect(uniqueOrders.size).not.toBe(newOrders.length); // BUG: duplicate sortOrders
    });

    it('BUG: updateDocument with parentId allows circular reference', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      // moveDocument would throw 'Cannot move document into its descendant'
      // but updateDocument has no such check
      expect(() => {
        updateDocument(parent.id, { parentId: child.id });
      }).not.toThrow(); // BUG: this should throw but doesn't

      // Verify the circular reference was created
      const parentDoc = getDocumentById(parent.id)!;
      const childDoc = getDocumentById(child.id)!;
      expect(parentDoc.parentId).toBe(child.id);
      expect(childDoc.parentId).toBe(parent.id); // circular!
    });

    it('BUG: updateDocument allows self-referencing parentId', () => {
      const doc = createDocument({ title: 'Doc' });

      // moveDocument would throw 'Cannot move document into itself'
      // but updateDocument has no such check
      expect(() => {
        updateDocument(doc.id, { parentId: doc.id });
      }).not.toThrow(); // BUG: this should throw but doesn't

      const updated = getDocumentById(doc.id)!;
      expect(updated.parentId).toBe(doc.id); // self-reference!
    });
});
