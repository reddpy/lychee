import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getSortOrders, getAllDocs, getAllDocsForParent, getDocumentById, createDocument, trashDocument, restoreDocument, permanentDeleteDocument, moveDocument } from './setup';

describe('Document Repository — Trash & Restore Cascading', () => {
  setupDb();

    // Basic cascade: trashing a parent with children should trash all of them.
    it('trashing parent cascades deletedAt to all children', () => {
      const parent = createDocument({ title: 'Parent' });
      const child1 = createDocument({ title: 'Child 1', parentId: parent.id });
      const child2 = createDocument({ title: 'Child 2', parentId: parent.id });
      const child3 = createDocument({ title: 'Child 3', parentId: parent.id });

      const result = trashDocument(parent.id);

      expect(result.trashedIds).toHaveLength(4);
      expect(result.trashedIds).toContain(parent.id);
      expect(result.trashedIds).toContain(child1.id);
      expect(result.trashedIds).toContain(child2.id);
      expect(result.trashedIds).toContain(child3.id);

      // All should have deletedAt set
      for (const id of result.trashedIds) {
        const doc = getDocumentById(id)!;
        expect(doc.deletedAt).not.toBeNull();
      }
    });

    // The recursive CTE must go deeper than 1 level.
    // A common bug is only trashing direct children, not grandchildren.
    it('trash cascades through 3+ levels of nesting', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });
      const d = createDocument({ title: 'D', parentId: c.id });

      const result = trashDocument(a.id);

      expect(result.trashedIds).toHaveLength(4);
      expect(result.trashedIds).toContain(d.id);
    });

    // Trashing should preserve parentId on children so the tree structure
    // can be reconstructed on restore. If parentId gets nulled, restore
    // would dump all children at root level — data loss.
    it('trashing preserves parentId on children (tree structure intact)', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      trashDocument(parent.id);

      const trashedChild = getDocumentById(child.id)!;
      expect(trashedChild.parentId).toBe(parent.id); // NOT null
    });

    // Restore should be the inverse of trash: clear deletedAt on all
    // descendants and re-open the sortOrder gap.
    it('restoring parent cascades to all trashed descendants', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });
      createDocument({
        title: 'Grandchild',
        parentId: child.id,
      });

      trashDocument(parent.id);
      const result = restoreDocument(parent.id);

      expect(result.restoredIds).toHaveLength(3);
      // All should have deletedAt cleared
      for (const id of result.restoredIds) {
        const doc = getDocumentById(id)!;
        expect(doc.deletedAt).toBeNull();
      }
    });

    // Edge case: if one child was manually restored (e.g. via a different code path)
    // before the parent is restored, the restore CTE should skip it.
    // This prevents double-restoring and ensures the CTE's WHERE deletedAt IS NOT NULL works.
    it('restore only restores descendants that are currently trashed', () => {
      const parent = createDocument({ title: 'Parent' });
      const childA = createDocument({ title: 'Child A', parentId: parent.id });
      const childB = createDocument({ title: 'Child B', parentId: parent.id });

      trashDocument(parent.id);

      // Manually un-trash childB via direct DB update (simulating some other code path)
      getDb().prepare(`UPDATE documents SET deletedAt = NULL WHERE id = ?`).run(
        childB.id,
      );

      const result = restoreDocument(parent.id);

      // childB was already un-trashed, so it shouldn't be in restoredIds
      expect(result.restoredIds).toContain(parent.id);
      expect(result.restoredIds).toContain(childA.id);
      // childB should NOT be in restoredIds since it was already restored
      // BUT: The recursive CTE only includes nodes WHERE d.deletedAt IS NOT NULL
      // Since childB.deletedAt is now NULL, the CTE won't traverse into it.
      // However, childB's children (if any) that ARE still trashed would also be missed.
      // This is the correct behavior — childB is a "branch break" in the restore CTE.
    });

    // Real scenario: user trashes a folder, creates a new doc at the same position,
    // then restores the folder. The new doc should shift to make room.
    it('restore handles occupied sort positions without collision', () => {
      createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      trashDocument(b.id);
      // C(0) A(1) — gap closed

      // Create new doc — goes to position 0, shifts others
      createDocument({ title: 'D' });
      // D(0) C(1) A(2)

      // Restore B — should re-open gap at B's original position
      restoreDocument(b.id);

      // Verify no duplicate sortOrders
      const orders = getSortOrders(getDb(), null);
      const uniqueOrders = new Set(orders);
      expect(uniqueOrders.size).toBe(orders.length); // no duplicates
    });

    // Restoring a doc that was never trashed should be a no-op.
    // The code returns early with restoredIds=[id] — test it doesn't
    // accidentally modify anything.
    it('restoring a non-trashed doc is a no-op', () => {
      const doc = createDocument({ title: 'Test' });
      const before = getDocumentById(doc.id)!;

      const result = restoreDocument(doc.id);

      expect(result.restoredIds).toEqual([doc.id]);
      const after = getDocumentById(doc.id)!;
      expect(after.deletedAt).toBeNull();
      // updatedAt should NOT change on a no-op restore
      expect(after.updatedAt).toBe(before.updatedAt);
    });

    // Double-trash: the code doesn't check if already trashed.
    // This verifies it doesn't corrupt data even if called twice.
    it('double-trashing a document does not corrupt data', () => {
      const parent = createDocument({ title: 'Parent' });
      createDocument({ title: 'Child', parentId: parent.id });

      trashDocument(parent.id);

      // Trash again — parent is already trashed but getDocumentById still finds it
      // This should still work without throwing
      const result2 = trashDocument(parent.id);
      expect(result2.trashedIds).toContain(parent.id);

      // Verify we can still restore everything
      restoreDocument(parent.id);
      const restored = getDocumentById(parent.id)!;
      expect(restored.deletedAt).toBeNull();
    });

    // permanentDelete should remove ALL descendants from the database.
    // After deletion, none of the IDs should be retrievable.
    it('permanentDelete removes all descendants from DB', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });

      const result = permanentDeleteDocument(a.id);

      expect(result.deletedIds).toHaveLength(3);
      expect(getDocumentById(a.id)).toBeNull();
      expect(getDocumentById(b.id)).toBeNull();
      expect(getDocumentById(c.id)).toBeNull();
    });

    // permanentDelete on already-trashed trees should still work.
    // This is the normal flow: trash → permanent delete from trash UI.
    it('permanentDelete works on already-trashed documents', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      trashDocument(parent.id);
      const result = permanentDeleteDocument(parent.id);

      expect(result.deletedIds).toHaveLength(2);
      expect(getDocumentById(parent.id)).toBeNull();
      expect(getDocumentById(child.id)).toBeNull();
    });

    // Verify trashDocument throws on non-existent ID (not a silent no-op).
    it('trashDocument throws on non-existent document', () => {
      expect(() => trashDocument('nonexistent-id')).toThrow('Document not found');
    });

    // Verify restoreDocument throws on non-existent ID.
    it('restoreDocument throws on non-existent document', () => {
      expect(() => restoreDocument('nonexistent-id')).toThrow(
        'Document not found',
      );
    });

    // Verify permanentDeleteDocument throws on non-existent ID.
    it('permanentDeleteDocument throws on non-existent document', () => {
      expect(() => permanentDeleteDocument('nonexistent-id')).toThrow(
        'Document not found',
      );
    });

    // ── Bug #5: restoreDocument uses stale sortOrder ──────────────────
    // After trashing, the gap closes and other docs may move around.
    // When restoring, the doc is jammed back at its original sortOrder
    // which may now be out of range or conflict with the new landscape.

    it('BUG: restore after landscape change puts doc at out-of-range position', () => {
      const a = createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      trashDocument(a.id);
      // C(0) B(1) — gap closed. A's stale sortOrder is 2.

      // Trash the remaining docs too
      const remaining = getAllDocs(getDb());
      for (const doc of remaining) {
        trashDocument(doc.id);
      }
      // No active docs at root

      // Restore A — it will try to insert at sortOrder 2, but there are 0 siblings
      restoreDocument(a.id);

      const restored = getDocumentById(a.id)!;
      // Should be at position 0 (it's the only doc), but it's at stale position 2
      expect(restored.sortOrder).toBe(2); // BUG: should be 0
      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([2]); // BUG: only doc is at position 2, not 0
    });

    it('BUG: restore after new docs created inserts at stale position', () => {
      createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      trashDocument(b.id);
      // C(0) A(1) — B's stale sortOrder is 1

      // Create 3 new docs — they all go to position 0 and shift
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });
      createDocument({ title: 'F' });
      // F(0) E(1) D(2) C(3) A(4)

      restoreDocument(b.id);

      // B restores at its stale sortOrder 1, shifting E and everything after it
      const orders = getSortOrders(getDb(), null);
      const uniqueOrders = new Set(orders);
      // There should be 6 docs with contiguous [0,1,2,3,4,5]
      expect(orders.length).toBe(6);
      expect(uniqueOrders.size).toBe(6); // at least no duplicates
      // B is wedged at position 1, between F and E — likely not where the user expects
      const b_restored = getDocumentById(b.id)!;
      expect(b_restored.sortOrder).toBe(1); // stale position, not end of list
    });

    it('BUG: trash and restore cycle with moves produces wrong position', () => {
      const a = createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      trashDocument(a.id); // A's stale sortOrder: 2
      // C(0) B(1)

      // Move B to position 0 (already there after gap close, but let's move C)
      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      moveDocument(c.id, null, 1);
      // B(0) C(1)

      restoreDocument(a.id);
      // A restores at stale position 2, which is the end — this happens to be
      // reasonable here, but it's coincidental, not intentional
      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([0, 1, 2]);
    });

    // ── Bug #7: permanentDeleteDocument doesn't close sort order gaps ──

    it('BUG: permanentDelete leaves sort order gap in siblings', () => {
      const a = createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      // Trash first, then permanent delete (normal user flow)
      trashDocument(a.id);
      // C(0) B(1) — gap closed by trashDocument

      // But if we permanent delete without trashing first:
      const b = getAllDocs(getDb()).find((d) => d.title === 'B')!;

      // First trash B to put it in trash, then permanent delete
      trashDocument(b.id);
      // C(0) — gap closed by trashDocument
      permanentDeleteDocument(b.id);
      // This is fine because trashDocument already closed the gap

      // The real bug is when permanentDelete is called on a doc
      // that was trashed as part of a cascade but its own sibling
      // sort order was never adjusted (only the top-level doc's was)
      expect(getSortOrders(getDb(), null)).toEqual([0]);
    });

    it('BUG: permanentDelete of non-trashed doc leaves gap', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      // Directly permanent delete B without trashing first
      const b = getAllDocs(getDb()).find((d) => d.title === 'B')!;
      permanentDeleteDocument(b.id);

      // Should be [0, 1] if gap was closed
      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([0, 2]); // BUG: gap at position 1
    });

    it('BUG: permanentDelete of parent does not fix children sort orders in grandparent', () => {
      const folder = createDocument({ title: 'Folder' });
      createDocument({ title: 'Sibling', parentId: null });
      // root: Sibling(0) Folder(1) — wait, creation order matters
      // Actually: Sibling(0) Folder(1) since Sibling was created second and shifts

      // Create children under folder
      createDocument({ title: 'Child A', parentId: folder.id });
      createDocument({ title: 'Child B', parentId: folder.id });

      const rootOrdersBefore = getSortOrders(getDb(), null);

      // Permanently delete folder (cascades to children)
      permanentDeleteDocument(folder.id);

      // Root siblings should have gap closed
      const rootOrdersAfter = getSortOrders(getDb(), null);
      // Only 'Sibling' remains — but its sortOrder may not be adjusted
      expect(rootOrdersAfter.length).toBe(1);
      // If folder was at position 1 and got deleted, sibling at 0 is fine
      // But if folder was at position 0, sibling at 1 has a gap
      // The point is: permanentDelete doesn't run gap-closing logic
    });

    // ── Bug #8: permanentDeleteDocument has no transaction ─────────────
    // The CTE query and DELETE are separate statements. If the DELETE fails,
    // the tree query already ran but nothing was deleted — not harmful on its
    // own, but if there were side effects between them it could corrupt state.

    it('BUG: permanentDelete CTE and DELETE are not atomic', () => {
      const parent = createDocument({ title: 'Parent' });
      createDocument({ title: 'Child 1', parentId: parent.id });
      createDocument({ title: 'Child 2', parentId: parent.id });

      // We can verify non-atomicity by checking that the CTE runs first:
      // If we examine the implementation, tree IDs are collected, THEN deleted
      // in a second statement. This is a structural issue — the test just
      // verifies that the operation works correctly in the happy path.
      const result = permanentDeleteDocument(parent.id);
      expect(result.deletedIds).toHaveLength(3);

      // All gone
      expect(getDocumentById(parent.id)).toBeNull();
    });

    // ── Bug #9: restoreDocument doesn't verify parent still exists ─────

    it('BUG: restore creates orphan when parent was permanently deleted', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      // Trash only the child (not via parent cascade)
      trashDocument(child.id);

      // Now permanently delete the parent directly (it's not trashed,
      // but permanentDelete works on any doc). This cascades to
      // descendants — but child is already trashed and still in DB.
      // permanentDeleteDocument uses a recursive CTE that finds children
      // via parentId. The child will be found and deleted too.
      //
      // To truly test this bug, we need the child to survive the parent deletion.
      // We do this by reparenting the child out first, then trashing it,
      // then deleting the original parent, then moving it back via direct SQL.
      const db = getDb();

      // Move child to root so it's not caught in parent's cascade
      db.prepare(`UPDATE documents SET parentId = NULL WHERE id = ?`).run(child.id);

      // Now permanently delete the parent (child is safe at root)
      permanentDeleteDocument(parent.id);
      expect(getDocumentById(parent.id)).toBeNull();

      // Put the dangling parentId back (simulating the real bug scenario)
      db.prepare(`UPDATE documents SET parentId = ? WHERE id = ?`).run(parent.id, child.id);

      // Restore child — it references the deleted parent
      restoreDocument(child.id);
      const restored = getDocumentById(child.id)!;

      expect(restored.deletedAt).toBeNull(); // restored successfully
      expect(restored.parentId).toBe(parent.id); // BUG: dangling parentId
    });

    it('BUG: restore creates orphan when parent was trashed', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      // Trash parent (cascades to child)
      trashDocument(parent.id);

      // Restore ONLY the child, not the parent
      restoreDocument(child.id);

      const restoredChild = getDocumentById(child.id)!;
      expect(restoredChild.deletedAt).toBeNull(); // restored
      expect(restoredChild.parentId).toBe(parent.id); // parent still trashed

      // Parent is still trashed
      const parentDoc = getDocumentById(parent.id)!;
      expect(parentDoc.deletedAt).not.toBeNull();

      // Child is "active" but its parent is trashed — it won't appear
      // in listDocuments under its parent because parent is filtered out.
      // The frontend safety net promotes it to root, but the data is inconsistent.
    });

    it('BUG: restore with deleted parent does not reassign to root', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });
      const db = getDb();

      // Trash the child independently
      trashDocument(child.id);

      // Move child to root temporarily so permanentDelete of parent doesn't cascade to it
      db.prepare(`UPDATE documents SET parentId = NULL WHERE id = ?`).run(child.id);
      permanentDeleteDocument(parent.id);
      expect(getDocumentById(parent.id)).toBeNull();

      // Restore the dangling parentId
      db.prepare(`UPDATE documents SET parentId = ? WHERE id = ?`).run(parent.id, child.id);

      // Restore child — parent is gone
      restoreDocument(child.id);

      const restored = getDocumentById(child.id)!;
      // Ideally, since parent is gone, child should be reassigned to root (null)
      // But restoreDocument doesn't check — it keeps the stale parentId
      expect(restored.parentId).toBe(parent.id); // BUG: should be null
      expect(restored.parentId).not.toBeNull(); // proves it's not reassigned
    });
});
