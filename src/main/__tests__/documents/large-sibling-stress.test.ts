import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getSortOrders, getAllDocs, getAllDocsForParent, getDocumentById, createDocument, trashDocument, restoreDocument, permanentDeleteDocument, moveDocument } from './setup';

describe('Document Repository — Large Sibling List Stress Tests', () => {
  setupDb();

    // 100 docs created sequentially at root — sortOrders should be exactly 0..99.
    // The shift-all-by-one happens 100 times, each time on a growing list.
    // Off-by-one accumulation over 100 iterations would be very visible here.
    it('creating 100 docs produces contiguous sortOrders 0..99', () => {
      for (let i = 0; i < 100; i++) {
        createDocument({ title: `Doc ${i}` });
      }
      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 100 }, (_, i) => i));
    });

    // Move from position 99 to position 0 in a 100-item list.
    // This shifts ALL 99 intermediate items — the maximum possible shift.
    // If the SQL UPDATE doesn't correctly bound the range, some items
    // could get double-shifted or missed.
    it('move last item to first in 100-item list', () => {
      const docIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        const doc = createDocument({ title: `Doc ${i}` });
        docIds.push(doc.id);
      }

      // Last created is at sortOrder 0; first created is at sortOrder 99.
      // Find the one at sortOrder 99 and move it to 0.
      const bottom = getAllDocs(getDb()).find((d) => d.sortOrder === 99)!;
      moveDocument(bottom.id, null, 0);

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(getDocumentById(bottom.id)!.sortOrder).toBe(0);
    });

    // Move from position 0 to position 99 in a 100-item list.
    // Opposite direction — shifts all 99 items down.
    it('move first item to last in 100-item list', () => {
      for (let i = 0; i < 100; i++) {
        createDocument({ title: `Doc ${i}` });
      }

      const top = getAllDocs(getDb()).find((d) => d.sortOrder === 0)!;
      moveDocument(top.id, null, 99);

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(getDocumentById(top.id)!.sortOrder).toBe(99);
    });

    // Move from position 50 to position 25 in a 100-item list.
    // Tests the shift-up path with a mid-list range.
    it('move middle item upward in 100-item list', () => {
      for (let i = 0; i < 100; i++) {
        createDocument({ title: `Doc ${i}` });
      }

      const mid = getAllDocs(getDb()).find((d) => d.sortOrder === 50)!;
      moveDocument(mid.id, null, 25);

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(getDocumentById(mid.id)!.sortOrder).toBe(25);
    });

    // Move from position 25 to position 75 in a 100-item list.
    // Tests the shift-down path with a mid-list range.
    it('move middle item downward in 100-item list', () => {
      for (let i = 0; i < 100; i++) {
        createDocument({ title: `Doc ${i}` });
      }

      const mid = getAllDocs(getDb()).find((d) => d.sortOrder === 25)!;
      moveDocument(mid.id, null, 75);

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(getDocumentById(mid.id)!.sortOrder).toBe(75);
    });

    // Trash 50 items out of 100, then verify the remaining 50 have
    // contiguous sortOrders 0..49. Each trash closes a gap, and after
    // 50 gap-closings on a shrinking list, the arithmetic must still be correct.
    it('trashing 50 out of 100 items maintains contiguous sortOrders', () => {
      for (let i = 0; i < 100; i++) {
        createDocument({ title: `Doc ${i}` });
      }

      // Trash every other item (by current sortOrder)
      for (let i = 0; i < 50; i++) {
        // Always trash the item currently at sortOrder 0 (the top)
        // This is the most aggressive gap-closing scenario since every
        // trash triggers a shift of the entire remaining list.
        const top = getAllDocs(getDb()).find((d) => d.sortOrder === 0)!;
        trashDocument(top.id);
      }

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 50 }, (_, i) => i));
    });

    // Create 100 items, perform 20 sequential reorders picking random positions.
    // After all moves, sortOrders should still be contiguous.
    // This simulates a user aggressively reorganizing a large folder.
    it('20 sequential reorders on a 100-item list maintain contiguity', () => {
      for (let i = 0; i < 100; i++) {
        createDocument({ title: `Doc ${i}` });
      }

      // Deterministic "random" positions based on index (not truly random — reproducible)
      const moves = [
        [95, 3], [7, 88], [42, 0], [99, 50], [0, 99],
        [33, 67], [67, 33], [1, 98], [50, 1], [80, 20],
        [15, 85], [90, 10], [5, 45], [60, 30], [25, 75],
        [70, 2], [48, 97], [11, 55], [88, 12], [3, 93],
      ];

      for (const [fromSort, toSort] of moves) {
        const item = getAllDocs(getDb()).find((d) => d.sortOrder === fromSort);
        if (item) {
          moveDocument(item.id, null, toSort);
        }
      }

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 100 }, (_, i) => i));
    });

    // Cross-parent stress: move 50 items from one parent to another, one at a time.
    // Both parents should maintain contiguous sortOrders throughout.
    it('moving 50 items between parents one by one', () => {
      const src = createDocument({ title: 'Source' });
      const dst = createDocument({ title: 'Dest' });

      // Create 50 children under source
      for (let i = 0; i < 50; i++) {
        createDocument({ title: `Item ${i}`, parentId: src.id });
      }

      // Move them all to dest, one at a time, always taking the first item
      for (let i = 0; i < 50; i++) {
        const first = getAllDocsForParent(getDb(), src.id)
          .filter((d) => !d.deletedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder)[0];
        if (first) {
          moveDocument(first.id, dst.id, i); // append at end
        }
      }

      // Source should be empty
      expect(getSortOrders(getDb(), src.id)).toEqual([]);

      // Dest should have all 50 with contiguous sortOrders
      const dstOrders = getSortOrders(getDb(), dst.id);
      expect(dstOrders).toEqual(Array.from({ length: 50 }, (_, i) => i));
    });

    // 200 docs under one parent: tests that SQLite handles the UPDATE ... SET sortOrder = sortOrder + 1
    // on a large rowset without timeout or corruption.
    it('200 siblings under one parent with reorder at end', () => {
      const parent = createDocument({ title: 'Big Folder' });
      for (let i = 0; i < 200; i++) {
        createDocument({ title: `Note ${i}`, parentId: parent.id });
      }

      const orders = getSortOrders(getDb(), parent.id);
      expect(orders).toEqual(Array.from({ length: 200 }, (_, i) => i));

      // Move the last item to the first position
      const last = getAllDocsForParent(getDb(), parent.id)
        .filter((d) => !d.deletedAt)
        .find((d) => d.sortOrder === 199)!;
      moveDocument(last.id, parent.id, 0);

      const afterOrders = getSortOrders(getDb(), parent.id);
      expect(afterOrders).toEqual(Array.from({ length: 200 }, (_, i) => i));
      expect(getDocumentById(last.id)!.sortOrder).toBe(0);
    });

    // restoreDocument clamps the restore position to min(existing.sortOrder, currentSiblingCount)
    // so that stale stored sortOrders don't create gaps when items are restored individually.
    it('trash and restore cycle on 100 individual items should produce contiguous sortOrders', () => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(createDocument({ title: `Doc ${i}` }).id);
      }

      // Trash all 100 items individually, from highest sortOrder downward.
      // This is the worst case: each doc retains its original sortOrder.
      const sorted = getAllDocs(getDb())
        .sort((a, b) => b.sortOrder - a.sortOrder);
      for (const doc of sorted) {
        trashDocument(doc.id);
      }

      // All should be trashed now
      expect(getAllDocs(getDb())).toHaveLength(0);

      // Restore all 100 individually, in order of stored sortOrder (lowest first).
      // Without the clamp fix, stale sortOrders would create gaps.
      const trashed = (getDb().prepare(
        `SELECT id, sortOrder FROM documents WHERE deletedAt IS NOT NULL ORDER BY sortOrder ASC`,
      ).all() as { id: string; sortOrder: number }[]);
      expect(trashed).toHaveLength(100);

      for (const doc of trashed) {
        restoreDocument(doc.id);
      }

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 100 }, (_, i) => i));
    });

    // Create 100 items under different parents (10 parents × 10 children each).
    // Then move children across parents randomly. All parents should maintain
    // contiguous sortOrders throughout.
    it('shuffle 100 items across 10 parents', () => {
      const parents: string[] = [];
      for (let i = 0; i < 10; i++) {
        const p = createDocument({ title: `Folder ${i}` });
        parents.push(p.id);
      }

      // Create 10 children per parent
      const children: string[] = [];
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          const c = createDocument({
            title: `F${i}-C${j}`,
            parentId: parents[i],
          });
          children.push(c.id);
        }
      }

      // Move 20 items to different parents using deterministic pattern
      const moves = [
        [0, 5], [15, 3], [27, 8], [42, 1], [53, 9],
        [61, 0], [74, 4], [88, 2], [99, 7], [33, 6],
        [11, 9], [22, 0], [44, 5], [55, 3], [66, 8],
        [77, 1], [8, 4], [19, 2], [30, 7], [41, 6],
      ];

      for (const [childIdx, parentIdx] of moves) {
        const childId = children[childIdx];
        const doc = getDocumentById(childId);
        if (doc && !doc.deletedAt) {
          moveDocument(childId, parents[parentIdx], 0);
        }
      }

      // Every parent should have contiguous sortOrders
      for (const pid of parents) {
        const orders = getSortOrders(getDb(), pid);
        if (orders.length > 0) {
          expect(orders).toEqual(
            Array.from({ length: orders.length }, (_, i) => i),
          );
        }
      }
    });

    // permanentDelete a parent with 100 children — all 101 rows should be removed.
    // This tests that the recursive CTE + DELETE handles large IN (...) clauses.
    it('permanentDelete parent with 100 children removes all 101 rows', () => {
      const parent = createDocument({ title: 'Big Parent' });
      const childIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        const c = createDocument({ title: `Child ${i}`, parentId: parent.id });
        childIds.push(c.id);
      }

      const result = permanentDeleteDocument(parent.id);
      expect(result.deletedIds).toHaveLength(101);

      expect(getDocumentById(parent.id)).toBeNull();
      for (const id of childIds) {
        expect(getDocumentById(id)).toBeNull();
      }
    });

    // Combination test: deep AND wide. A 10-level tree where each node has 3 children.
    // Total nodes = 1 + 3 + 9 + 27 + 81 = 121 (5 levels) — we'll do 5 levels with 3 children.
    // Tests that the recursive CTE handles both dimensions simultaneously.
    it('trash cascades through a wide+deep tree (5 levels, 3 children each, 121 nodes)', () => {
      const root = createDocument({ title: 'Root' });
      const allIds = [root.id];

      const queue = [root.id];
      for (let level = 0; level < 4; level++) {
        const nextQueue: string[] = [];
        for (const pid of queue) {
          for (let c = 0; c < 3; c++) {
            const child = createDocument({
              title: `L${level}C${c}`,
              parentId: pid,
            });
            allIds.push(child.id);
            nextQueue.push(child.id);
          }
        }
        queue.length = 0;
        queue.push(...nextQueue);
      }

      // 1 + 3 + 9 + 27 + 81 = 121
      expect(allIds.length).toBe(121);

      const result = trashDocument(root.id);
      expect(result.trashedIds).toHaveLength(121);

      // Restore and verify
      const restored = restoreDocument(root.id);
      expect(restored.restoredIds).toHaveLength(121);

      for (const id of allIds) {
        expect(getDocumentById(id)!.deletedAt).toBeNull();
      }
    });
});
