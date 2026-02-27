import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getSortOrders, getAllDocs, getAllDocsForParent, getDocumentById, createDocument, deleteDocument, trashDocument, moveDocument } from './setup';

describe('Document Repository — Move Operations', () => {
  setupDb();

    // ── Same-Parent Reordering ──────────────────────────────
    // These tests simulate a user dragging notes up and down
    // within the same folder in the sidebar.

    // Moving last item to first position within the same parent.
    // The shift logic for "moving up" must increment sortOrders in [new, old).
    it('same-parent reorder: move last to first shifts intermediates correctly', () => {
      // Create A, B, C, D — order is D(0) C(1) B(2) A(3)
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      const d = createDocument({ title: 'D' });
      // D is at sortOrder 0 (most recently created)

      // Move A (sortOrder 3) to position 1
      const a = getDocumentById(
        getAllDocs(getDb()).find((doc) => doc.title === 'A')!.id,
      )!;
      moveDocument(a.id, null, 1);

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['D', 'A', 'C', 'B']);
    });

    // Moving first item to last position within the same parent.
    // The shift logic for "moving down" must decrement sortOrders in (old, new].
    it('same-parent reorder: move first to last shifts intermediates correctly', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      const d = createDocument({ title: 'D' });
      // D(0) C(1) B(2) A(3)

      // Move D (sortOrder 0) to position 3
      moveDocument(d.id, null, 3);

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['C', 'B', 'A', 'D']);
    });

    // Move an item one position up (adjacent swap).
    // This is the most common drag: user drags a note just one slot up.
    it('same-parent: move one position up (adjacent swap)', () => {
      // Setup: E(0) D(1) C(2) B(3) A(4)
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });

      // Move C (sortOrder 2) to position 1
      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      moveDocument(c.id, null, 1);

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['E', 'C', 'D', 'B', 'A']);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);
    });

    // Move an item one position down (adjacent swap the other direction).
    it('same-parent: move one position down (adjacent swap)', () => {
      // Setup: E(0) D(1) C(2) B(3) A(4)
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });

      // Move C (sortOrder 2) to position 3
      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      moveDocument(c.id, null, 3);

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['E', 'D', 'B', 'C', 'A']);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);
    });

    // Move middle item to position 0 (drag to top of sidebar).
    it('same-parent: move middle item to top', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });
      // E(0) D(1) C(2) B(3) A(4)

      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      moveDocument(c.id, null, 0);

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['C', 'E', 'D', 'B', 'A']);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);
    });

    // Move middle item to last position (drag to bottom of sidebar).
    it('same-parent: move middle item to bottom', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });
      // E(0) D(1) C(2) B(3) A(4)

      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      moveDocument(c.id, null, 4);

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['E', 'D', 'B', 'A', 'C']);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);
    });

    // No-op moves should not bump updatedAt — otherwise every drag-and-drop
    // that ends at the same position would mark the doc as "recently modified".
    it('same-parent no-op move does not bump updatedAt', () => {
      const doc = createDocument({ title: 'Test' });
      const before = getDocumentById(doc.id)!;

      moveDocument(doc.id, null, 0); // same position

      const after = getDocumentById(doc.id)!;
      expect(after.updatedAt).toBe(before.updatedAt);
    });

    // Multiple sequential reorders on the same list — simulates a user
    // rearranging several items one after another without refreshing.
    it('multiple sequential reorders maintain consistency', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });
      // E(0) D(1) C(2) B(3) A(4)

      // Move A to top
      const a = getAllDocs(getDb()).find((d) => d.title === 'A')!;
      moveDocument(a.id, null, 0);
      // A(0) E(1) D(2) C(3) B(4)
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);

      // Now move B to position 1
      const b = getDocumentById(
        getAllDocs(getDb()).find((d) => d.title === 'B')!.id,
      )!;
      moveDocument(b.id, null, 1);
      // A(0) B(1) E(2) D(3) C(4)
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);

      // Now move E to the end
      const e = getDocumentById(
        getAllDocs(getDb()).find((d) => d.title === 'E')!.id,
      )!;
      moveDocument(e.id, null, 4);
      // A(0) B(1) D(2) C(3) E(4)

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['A', 'B', 'D', 'C', 'E']);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);
    });

    // Reorder with only 2 items — the minimum case. Swap them.
    it('reorder with only 2 items (swap)', () => {
      const a = createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      // B(0) A(1)

      // Move A to position 0
      moveDocument(a.id, null, 0);

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['A', 'B']);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1]);
    });

    // Reorder with only 1 item — should be a no-op, not crash.
    it('reorder with only 1 item is a no-op', () => {
      const solo = createDocument({ title: 'Solo' });

      moveDocument(solo.id, null, 0);

      const doc = getDocumentById(solo.id)!;
      expect(doc.sortOrder).toBe(0);
      expect(getSortOrders(getDb(), null)).toEqual([0]);
    });

    // ── Cross-Parent Moves ──────────────────────────────────
    // These tests simulate dragging a note from one folder to another.

    // Moving the last child out of a parent should leave the parent
    // with zero children and not crash on the gap-closing logic.
    it('moving last child out of parent leaves parent with zero children', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      moveDocument(child.id, null, 0); // move to root

      const children = getSortOrders(getDb(), parent.id);
      expect(children).toEqual([]);

      const moved = getDocumentById(child.id)!;
      expect(moved.parentId).toBeNull();
    });

    // The IS NULL vs = NULL distinction in SQL is critical.
    // `WHERE parentId IS ?` with null works correctly, but = NULL doesn't.
    // This test ensures nested-to-root moves work (null parentId).
    it('move from nested to root works (null parentId SQL handling)', () => {
      const parent = createDocument({ title: 'Parent' });
      createDocument({ title: 'Root Doc 1' });
      const nested = createDocument({ title: 'Nested', parentId: parent.id });

      moveDocument(nested.id, null, 0);

      const doc = getDocumentById(nested.id)!;
      expect(doc.parentId).toBeNull();
      const rootOrders = getSortOrders(getDb(), null);
      expect(rootOrders.length).toBeGreaterThanOrEqual(3);
    });

    // Moving to position 0 in a new parent — boundary case for the
    // "make room" shift (sortOrder >= 0 means ALL siblings shift down).
    it('move to position 0 (top) of new parent', () => {
      const parent = createDocument({ title: 'Parent' });
      createDocument({ title: 'Existing Child', parentId: parent.id });
      const mover = createDocument({ title: 'Mover' });

      moveDocument(mover.id, parent.id, 0);

      const doc = getDocumentById(mover.id)!;
      expect(doc.sortOrder).toBe(0);
      expect(doc.parentId).toBe(parent.id);
    });

    // Move to end of destination parent's list (sortOrder = existing count).
    it('move to end (bottom) of new parent', () => {
      const parent = createDocument({ title: 'Parent' });
      createDocument({ title: 'Child 1', parentId: parent.id });
      createDocument({ title: 'Child 2', parentId: parent.id });
      createDocument({ title: 'Child 3', parentId: parent.id });
      // Under parent: Child3(0) Child2(1) Child1(2)

      const mover = createDocument({ title: 'Mover' });
      moveDocument(mover.id, parent.id, 3); // append at end

      const doc = getDocumentById(mover.id)!;
      expect(doc.sortOrder).toBe(3);
      expect(doc.parentId).toBe(parent.id);
      expect(getSortOrders(getDb(), parent.id)).toEqual([0, 1, 2, 3]);
    });

    // Move to middle of destination parent's list.
    it('move to middle of new parent', () => {
      const parent = createDocument({ title: 'Parent' });
      createDocument({ title: 'Child A', parentId: parent.id });
      createDocument({ title: 'Child B', parentId: parent.id });
      createDocument({ title: 'Child C', parentId: parent.id });
      // Under parent: C(0) B(1) A(2)

      const mover = createDocument({ title: 'Mover' });
      moveDocument(mover.id, parent.id, 1); // insert at position 1

      const sorted = getAllDocsForParent(getDb(), parent.id)
        .filter((d) => !d.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual([
        'Child C',
        'Mover',
        'Child B',
        'Child A',
      ]);
      expect(getSortOrders(getDb(), parent.id)).toEqual([0, 1, 2, 3]);
    });

    // Move into an empty parent (no existing children).
    it('move to empty parent', () => {
      const parent = createDocument({ title: 'Empty Parent' });
      const doc = createDocument({ title: 'Doc' });

      moveDocument(doc.id, parent.id, 0);

      expect(getDocumentById(doc.id)!.parentId).toBe(parent.id);
      expect(getSortOrders(getDb(), parent.id)).toEqual([0]);
    });

    // Cross-parent move: verify both source and destination have contiguous sortOrders.
    // This is the definitive test for the gap-close + gap-open transaction.
    it('cross-parent move fixes sortOrders in both source and destination', () => {
      const src = createDocument({ title: 'Source Folder' });
      const dst = createDocument({ title: 'Dest Folder' });

      // 5 children in source
      createDocument({ title: 'S1', parentId: src.id });
      createDocument({ title: 'S2', parentId: src.id });
      const s3 = createDocument({ title: 'S3', parentId: src.id });
      createDocument({ title: 'S4', parentId: src.id });
      createDocument({ title: 'S5', parentId: src.id });
      // Source: S5(0) S4(1) S3(2) S2(3) S1(4)

      // 3 children in dest
      createDocument({ title: 'D1', parentId: dst.id });
      createDocument({ title: 'D2', parentId: dst.id });
      createDocument({ title: 'D3', parentId: dst.id });
      // Dest: D3(0) D2(1) D1(2)

      // Move S3 from source (position 2) to dest (position 1)
      moveDocument(s3.id, dst.id, 1);

      // Source should have 4 children with contiguous sortOrders
      expect(getSortOrders(getDb(), src.id)).toEqual([0, 1, 2, 3]);
      // Dest should have 4 children with contiguous sortOrders
      expect(getSortOrders(getDb(), dst.id)).toEqual([0, 1, 2, 3]);

      // S3 should be at position 1 in dest
      const moved = getDocumentById(s3.id)!;
      expect(moved.parentId).toBe(dst.id);
      expect(moved.sortOrder).toBe(1);
    });

    // Move from root to nested — tests the case where oldParentId is null.
    it('move from root (null parent) to nested folder', () => {
      const folder = createDocument({ title: 'Folder' });
      createDocument({ title: 'Existing', parentId: folder.id });
      const rootDoc = createDocument({ title: 'Root Doc' });

      // 3 root docs: rootDoc(0), folder(1), ... depends on creation order
      const rootBefore = getSortOrders(getDb(), null);

      moveDocument(rootDoc.id, folder.id, 0);

      const doc = getDocumentById(rootDoc.id)!;
      expect(doc.parentId).toBe(folder.id);

      // Root should have one fewer item, still contiguous
      const rootAfter = getSortOrders(getDb(), null);
      expect(rootAfter.length).toBe(rootBefore.length - 1);
      expect(rootAfter).toEqual(
        Array.from({ length: rootAfter.length }, (_, i) => i),
      );
    });

    // ── Complex Multi-Move Sequences ────────────────────────
    // These simulate real user sessions where they reorganize
    // their entire sidebar.

    // User reorganizes: moves items between 3 different folders
    // in a sequence. All folders should stay consistent.
    it('multi-folder reorganization: 3 folders, multiple moves', () => {
      const f1 = createDocument({ title: 'Folder 1' });
      const f2 = createDocument({ title: 'Folder 2' });
      const f3 = createDocument({ title: 'Folder 3' });

      // 3 docs in each folder
      createDocument({ title: 'F1-A', parentId: f1.id });
      const f1b = createDocument({ title: 'F1-B', parentId: f1.id });
      createDocument({ title: 'F1-C', parentId: f1.id });

      createDocument({ title: 'F2-A', parentId: f2.id });
      const f2b = createDocument({ title: 'F2-B', parentId: f2.id });
      createDocument({ title: 'F2-C', parentId: f2.id });

      createDocument({ title: 'F3-A', parentId: f3.id });
      createDocument({ title: 'F3-B', parentId: f3.id });
      createDocument({ title: 'F3-C', parentId: f3.id });

      // Move F1-B to folder 2
      moveDocument(f1b.id, f2.id, 0);
      expect(getSortOrders(getDb(), f1.id)).toEqual([0, 1]); // 2 left
      expect(getSortOrders(getDb(), f2.id)).toEqual([0, 1, 2, 3]); // 4 now

      // Move F2-B to folder 3
      moveDocument(f2b.id, f3.id, 2);
      expect(getSortOrders(getDb(), f2.id)).toEqual([0, 1, 2]); // 3 now
      expect(getSortOrders(getDb(), f3.id)).toEqual([0, 1, 2, 3]); // 4 now

      // All folders have contiguous sortOrders
      expect(getSortOrders(getDb(), f1.id)).toEqual([0, 1]);
      expect(getSortOrders(getDb(), f2.id)).toEqual([0, 1, 2]);
      expect(getSortOrders(getDb(), f3.id)).toEqual([0, 1, 2, 3]);
    });

    // Drag item within a large list — the real-world scenario
    // where sort order bugs are most visible to users.
    it('reorder within a 10-item list: move item 7 to position 2', () => {
      const items: string[] = [];
      for (let i = 0; i < 10; i++) {
        const doc = createDocument({ title: `Item ${i}` });
        items.push(doc.id);
      }
      // items[9] is at sortOrder 0, items[0] is at sortOrder 9

      // Find the item at sortOrder 7
      const target = getAllDocs(getDb()).find((d) => d.sortOrder === 7)!;
      moveDocument(target.id, null, 2);

      // All sortOrders should still be contiguous 0..9
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // Target should be at position 2
      expect(getDocumentById(target.id)!.sortOrder).toBe(2);
    });

    // Reverse an entire list by moving each item to position 0 in sequence.
    // This is an extreme test of the shift-up logic being called repeatedly.
    it('reverse a list by sequentially moving each item to top', () => {
      // Create 5 items: E(0) D(1) C(2) B(3) A(4)
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });

      // Move each from bottom to top in sequence: A→0, B→0, C→0, D→0
      const a = getAllDocs(getDb()).find((d) => d.title === 'A')!;
      moveDocument(a.id, null, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);

      const b = getAllDocs(getDb()).find((d) => d.title === 'B')!;
      moveDocument(b.id, null, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);

      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      moveDocument(c.id, null, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);

      const dd = getAllDocs(getDb()).find((d) => d.title === 'D')!;
      moveDocument(dd.id, null, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);

      // The order should now be reversed: D C B A E
      // (E was originally at 0, never moved, gets pushed to 4)
      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['D', 'C', 'B', 'A', 'E']);
    });

    // Bubble sort pattern: repeatedly swap adjacent items.
    // This simulates a user meticulously reordering items one step at a time.
    it('bubble sort pattern: repeatedly swap adjacents', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      // Swap A and B: move A from 2 to 1
      const a = getAllDocs(getDb()).find((d) => d.title === 'A')!;
      moveDocument(a.id, null, 1);
      // C(0) A(1) B(2)
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2]);

      // Swap A and C: move A from 1 to 0
      moveDocument(a.id, null, 0);
      // A(0) C(1) B(2)
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2]);

      const sorted = getAllDocs(getDb()).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['A', 'C', 'B']);
    });

    // Move the same item back and forth multiple times.
    // This catches bugs where sortOrder state gets stale between moves.
    it('move same item back and forth repeatedly', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      // D(0) C(1) B(2) A(3)

      const b = getAllDocs(getDb()).find((d) => d.title === 'B')!;

      // Move B to top
      moveDocument(b.id, null, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3]);

      // Move B to bottom
      moveDocument(b.id, null, 3);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3]);

      // Move B to position 2
      moveDocument(b.id, null, 2);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3]);

      // Move B back to position 0
      moveDocument(b.id, null, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3]);
    });

    // Move between the same two parents repeatedly.
    // Tests that gap-close/gap-open works correctly on repeated operations.
    it('shuttle item between two parents repeatedly', () => {
      const p1 = createDocument({ title: 'P1' });
      const p2 = createDocument({ title: 'P2' });

      const item = createDocument({ title: 'Item', parentId: p1.id });
      createDocument({ title: 'P1-Other', parentId: p1.id });
      createDocument({ title: 'P2-Other', parentId: p2.id });

      // Move to p2
      moveDocument(item.id, p2.id, 0);
      expect(getSortOrders(getDb(), p1.id)).toEqual([0]);
      expect(getSortOrders(getDb(), p2.id)).toEqual([0, 1]);

      // Move back to p1
      moveDocument(item.id, p1.id, 0);
      expect(getSortOrders(getDb(), p1.id)).toEqual([0, 1]);
      expect(getSortOrders(getDb(), p2.id)).toEqual([0]);

      // Move to p2 again
      moveDocument(item.id, p2.id, 1);
      expect(getSortOrders(getDb(), p1.id)).toEqual([0]);
      expect(getSortOrders(getDb(), p2.id)).toEqual([0, 1]);
    });

    // ── Edge Cases & Boundary Conditions ────────────────────

    // Move with trashed siblings — trashed docs should not interfere
    // with sortOrder calculations for non-trashed docs.
    it('reorder ignores trashed siblings', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });
      // E(0) D(1) C(2) B(3) A(4)

      // Trash C and D
      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      const d = getAllDocs(getDb()).find((d) => d.title === 'D')!;
      trashDocument(c.id);
      trashDocument(d.id);
      // Active: E(0) B(1) A(2)

      // Move A to top
      const a = getAllDocs(getDb()).find((doc) => doc.title === 'A')!;
      moveDocument(a.id, null, 0);

      // Active docs should be contiguous
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2]);
    });

    // After move, the returned document should have the new parentId and sortOrder.
    // This is what the UI uses to update immediately.
    it('moveDocument return value reflects new state', () => {
      const folder = createDocument({ title: 'Folder' });
      const doc = createDocument({ title: 'Doc' });

      const result = moveDocument(doc.id, folder.id, 0);

      expect(result.parentId).toBe(folder.id);
      expect(result.sortOrder).toBe(0);
      expect(result.id).toBe(doc.id);
    });

    // Move a document that has children — the children should follow
    // (their parentId still points to the moved doc, so the subtree moves).
    it('moving a parent preserves its children (subtree moves with it)', () => {
      const folder = createDocument({ title: 'Folder' });
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      moveDocument(parent.id, folder.id, 0);

      // Child still has parent as its parentId
      const childDoc = getDocumentById(child.id)!;
      expect(childDoc.parentId).toBe(parent.id);
      // Parent is now under folder
      expect(getDocumentById(parent.id)!.parentId).toBe(folder.id);
    });

    // Cross-parent move where the source doc was at sortOrder 0 —
    // tests gap-closing when the first item is removed.
    it('cross-parent: move first item out of source', () => {
      const src = createDocument({ title: 'Source' });
      createDocument({ title: 'C1', parentId: src.id });
      createDocument({ title: 'C2', parentId: src.id });
      const first = createDocument({ title: 'C3', parentId: src.id });
      // Source: C3(0) C2(1) C1(2)

      moveDocument(first.id, null, 0);

      // Remaining source children should be 0, 1
      expect(getSortOrders(getDb(), src.id)).toEqual([0, 1]);
    });

    // Cross-parent move where the source doc was the last item (highest sortOrder) —
    // tests gap-closing when the last item is removed (no gap to close).
    it('cross-parent: move last item out of source', () => {
      const src = createDocument({ title: 'Source' });
      const first = createDocument({ title: 'C1', parentId: src.id });
      createDocument({ title: 'C2', parentId: src.id });
      createDocument({ title: 'C3', parentId: src.id });
      // Source: C3(0) C2(1) C1(2) — C1 is last

      moveDocument(first.id, null, 0);

      // Remaining source children should be 0, 1
      expect(getSortOrders(getDb(), src.id)).toEqual([0, 1]);
    });

    // ── moveDocument Edge Cases ──────────────────────────

    // ── Bug #6: moveDocument doesn't validate sort order range ──────

    it('same-parent move beyond sibling count is clamped', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      moveDocument(c.id, null, 100); // way beyond valid range

      // C is clamped to position 2 (sibling count)
      const cDoc = getDocumentById(c.id)!;
      expect(cDoc.sortOrder).toBe(2);

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([0, 1, 2]); // contiguous
    });

    it('same-parent move with negative sortOrder is clamped to 0', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      const a = getAllDocs(getDb()).find((d) => d.title === 'A')!;
      moveDocument(a.id, null, -5); // negative

      const aDoc = getDocumentById(a.id)!;
      expect(aDoc.sortOrder).toBe(0); // clamped to 0

      const orders = getSortOrders(getDb(), null);
      expect(orders[0]).toBeGreaterThanOrEqual(0);
    });

    it('cross-parent move with out-of-range sortOrder is clamped', () => {
      const folder = createDocument({ title: 'Folder' });
      createDocument({ title: 'X', parentId: folder.id });
      // Folder children: X(0)

      const doc = createDocument({ title: 'Doc' });
      moveDocument(doc.id, folder.id, 50); // only 1 sibling, valid range is 0-1

      const docRefreshed = getDocumentById(doc.id)!;
      expect(docRefreshed.sortOrder).toBe(1); // clamped to 1

      const orders = getSortOrders(getDb(), folder.id);
      expect(orders).toEqual([0, 1]); // contiguous
    });

    // Explicitly pass the same parentId (not relying on same-parent detection).
    // If doc is at root (parentId=null) and we pass newParentId=null, the code
    // compares null !== null → false, so it takes the same-parent path. Good.
    // But if doc is nested and we pass the same parentId string, it should also
    // take the same-parent reorder path, NOT the cross-parent path.
    it('move with explicit same parentId uses reorder path, not cross-parent', () => {
      const folder = createDocument({ title: 'Folder' });
      createDocument({ title: 'A', parentId: folder.id });
      createDocument({ title: 'B', parentId: folder.id });
      const c = createDocument({ title: 'C', parentId: folder.id });
      // Folder children: C(0) B(1) A(2)

      // Explicitly pass folder.id as newParentId (same parent)
      moveDocument(c.id, folder.id, 2);

      const sorted = getAllDocsForParent(getDb(), folder.id)
        .filter((d) => !d.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['B', 'A', 'C']);
      expect(getSortOrders(getDb(), folder.id)).toEqual([0, 1, 2]);
    });

    // Move after a hard delete (deleteDocument). Hard delete does NOT close
    // the sortOrder gap. If we then move within that parent, the shift logic
    // operates on a list with a hole. Verify it doesn't corrupt further.
    it('move after hard delete operates on gapped sortOrders', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      // D(0) C(1) B(2) A(3)

      // Hard delete B (no gap close!) — leaves D(0) C(1) _gap_ A(3)
      const b = getAllDocs(getDb()).find((d) => d.title === 'B')!;
      deleteDocument(b.id);

      // Now move A to position 0
      const a = getAllDocs(getDb()).find((d) => d.title === 'A')!;
      moveDocument(a.id, null, 0);

      // A should be at 0. The others may have shifted but
      // the key check: no duplicate sortOrders and A is at 0.
      const orders = getSortOrders(getDb(), null);
      const uniqueOrders = new Set(orders);
      expect(uniqueOrders.size).toBe(orders.length);
      expect(getDocumentById(a.id)!.sortOrder).toBe(0);
    });

    // Two sequential moves to the same target position.
    // Move doc X to position 1, then move doc Y to position 1.
    // Y should be at 1, X should have shifted to 2.
    it('two docs moved to same position sequentially', () => {
      const folder = createDocument({ title: 'Folder' });
      createDocument({ title: 'Existing', parentId: folder.id });
      const x = createDocument({ title: 'X' });
      const y = createDocument({ title: 'Y' });

      moveDocument(x.id, folder.id, 0);
      moveDocument(y.id, folder.id, 0);

      // Y should be at 0 (most recent), X pushed to 1, Existing to 2
      const sorted = getAllDocsForParent(getDb(), folder.id)
        .filter((d) => !d.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      expect(sorted.map((d) => d.title)).toEqual(['Y', 'X', 'Existing']);
      expect(getSortOrders(getDb(), folder.id)).toEqual([0, 1, 2]);
    });

    // Interleave move and trash operations on the same sibling group.
    // This is a realistic scenario: user reorganizes while also deleting.
    it('interleaved move and trash on same sibling group', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      createDocument({ title: 'E' });
      // E(0) D(1) C(2) B(3) A(4)

      // Move E to position 3
      const e = getAllDocs(getDb()).find((d) => d.title === 'E')!;
      moveDocument(e.id, null, 3);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);

      // Trash B
      const b = getAllDocs(getDb()).find((d) => d.title === 'B')!;
      trashDocument(b.id);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3]);

      // Move A to position 0
      const a = getAllDocs(getDb()).find((d) => d.title === 'A')!;
      moveDocument(a.id, null, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3]);

      // Trash D
      const d = getAllDocs(getDb()).find((d) => d.title === 'D')!;
      trashDocument(d.id);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2]);

      // Move C to bottom
      const c = getAllDocs(getDb()).find((d) => d.title === 'C')!;
      moveDocument(c.id, null, 2);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2]);
    });

    // Move a doc that has been hard-deleted — should throw "Document not found".
    it('move a hard-deleted document throws', () => {
      const doc = createDocument({ title: 'Test' });
      deleteDocument(doc.id);

      expect(() => moveDocument(doc.id, null, 0)).toThrow('Document not found');
    });

    // Fractional sortOrder. JavaScript numbers allow 1.5, SQLite stores it as REAL.
    // The shift logic uses INTEGER arithmetic (sortOrder + 1, sortOrder - 1).
    // A fractional sortOrder could break comparisons like sortOrder >= ? AND sortOrder < ?.
    it('fractional sortOrder is floored to integer', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      // Move B to fractional position 0.5 — should be floored to 0
      const b = getAllDocs(getDb()).find((d) => d.title === 'B')!;
      moveDocument(b.id, null, 0.5);

      const bDoc = getDocumentById(b.id)!;
      expect(bDoc.sortOrder).toBe(0); // floored from 0.5 to 0
    });

    // Return value should always reflect the actual DB state after the move.
    // If there's any inconsistency between what's returned and what's in DB,
    // the UI would show stale data.
    it('return value matches DB state for cross-parent move', () => {
      const folder = createDocument({ title: 'Folder' });
      const doc = createDocument({ title: 'Doc' });

      const result = moveDocument(doc.id, folder.id, 0);
      const fromDb = getDocumentById(doc.id)!;

      expect(result.id).toBe(fromDb.id);
      expect(result.parentId).toBe(fromDb.parentId);
      expect(result.sortOrder).toBe(fromDb.sortOrder);
      expect(result.updatedAt).toBe(fromDb.updatedAt);
      expect(result.title).toBe(fromDb.title);
    });

    it('return value matches DB state for same-parent move', () => {
      createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // C(0) B(1) A(2)

      const result = moveDocument(b.id, null, 0);
      const fromDb = getDocumentById(b.id)!;

      expect(result.id).toBe(fromDb.id);
      expect(result.parentId).toBe(fromDb.parentId);
      expect(result.sortOrder).toBe(fromDb.sortOrder);
      expect(result.updatedAt).toBe(fromDb.updatedAt);
    });

    // Move the same doc rapidly to many different parents.
    // Tests that each move correctly closes the previous parent's gap
    // and opens the new one, even when done in rapid succession.
    it('move same doc through 10 different parents in sequence', () => {
      const parents: string[] = [];
      for (let i = 0; i < 10; i++) {
        parents.push(createDocument({ title: `Folder ${i}` }).id);
      }
      const doc = createDocument({ title: 'Nomad' });

      for (const parentId of parents) {
        moveDocument(doc.id, parentId, 0);
        expect(getDocumentById(doc.id)!.parentId).toBe(parentId);
        expect(getSortOrders(getDb(), parentId)).toEqual([0]);
      }

      // All parents except the last should be empty
      for (let i = 0; i < 9; i++) {
        expect(getSortOrders(getDb(), parents[i])).toEqual([]);
      }
      expect(getSortOrders(getDb(), parents[9])).toEqual([0]);
    });

    // Move creates a new sibling group where all docs came from different parents.
    // Gather 5 docs from 5 different folders into one target folder.
    it('gather docs from 5 different parents into one folder', () => {
      const target = createDocument({ title: 'Target' });
      const sources: string[] = [];
      const docs: string[] = [];
      for (let i = 0; i < 5; i++) {
        const src = createDocument({ title: `Src ${i}` });
        sources.push(src.id);
        docs.push(createDocument({ title: `Doc ${i}`, parentId: src.id }).id);
      }

      // Move each doc to target at incrementing positions
      for (let i = 0; i < 5; i++) {
        moveDocument(docs[i], target.id, i);
      }

      expect(getSortOrders(getDb(), target.id)).toEqual([0, 1, 2, 3, 4]);
      // All source folders should be empty
      for (const srcId of sources) {
        expect(getSortOrders(getDb(), srcId)).toEqual([]);
      }
    });

    // Move doc from a parent with trashed siblings. The gap-close should
    // only affect non-trashed siblings (WHERE deletedAt IS NULL).
    it('cross-parent move gap-close ignores trashed siblings in source', () => {
      const src = createDocument({ title: 'Source' });
      const dst = createDocument({ title: 'Dest' });
      createDocument({ title: 'A', parentId: src.id });
      const b = createDocument({ title: 'B', parentId: src.id });
      const c = createDocument({ title: 'C', parentId: src.id });
      createDocument({ title: 'D', parentId: src.id });
      // Source: D(0) C(1) B(2) A(3)

      // Trash C
      trashDocument(c.id);
      // Active source: D(0) B(1) A(2)

      // Move B to dest
      moveDocument(b.id, dst.id, 0);

      // Source active should be contiguous: D(0) A(1)
      expect(getSortOrders(getDb(), src.id)).toEqual([0, 1]);
      expect(getSortOrders(getDb(), dst.id)).toEqual([0]);
    });

    // Move the only non-trashed child out. Source has trashed docs
    // but no active children. This tests the edge where active count
    // goes to 0 while trashed docs still exist.
    it('move last active child out of parent that has trashed siblings', () => {
      const src = createDocument({ title: 'Source' });
      const a = createDocument({ title: 'A', parentId: src.id });
      const b = createDocument({ title: 'B', parentId: src.id });
      const c = createDocument({ title: 'C', parentId: src.id });

      trashDocument(a.id);
      trashDocument(b.id);
      // Only C is active in source

      moveDocument(c.id, null, 0);

      // Source has 0 active children
      expect(getSortOrders(getDb(), src.id)).toEqual([]);
      // But trashed docs still exist
      const allInSrc = getAllDocsForParent(getDb(), src.id);
      expect(allInSrc.filter((d) => d.deletedAt)).toHaveLength(2);
    });
});
