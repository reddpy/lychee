import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getSortOrders, getAllDocs, createDocument, moveDocument, trashDocument } from './setup';

describe('Document Repository — Sort Order Integrity', () => {
  setupDb();

    // If the shift-siblings-down logic is off by one, the 5th doc might
    // collide with the 4th, or there'd be a gap at position 3.
    it('creating 5 docs at root produces contiguous sortOrders [0,1,2,3,4]', () => {
      for (let i = 0; i < 5; i++) {
        createDocument({ title: `Doc ${i}` });
      }
      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([0, 1, 2, 3, 4]);
    });

    // After trashing the middle doc (sortOrder 2), the remaining siblings should
    // have no gap. Without gap-closing, UI would show an empty space.
    it('trashing a doc closes the sortOrder gap in siblings', () => {
      // Create 5 docs: newest first, so doc0(0) doc1(1) doc2(2) doc3(3) doc4(4)
      // Actually, createDocument always puts new doc at sortOrder 0 and shifts others.
      // So after creating 5 docs, the LAST created is at 0, FIRST created is at 4.
      for (let i = 0; i < 5; i++) {
        createDocument({ title: `Doc ${i}` });
      }
      // docs[4] is at sortOrder 0, docs[0] is at sortOrder 4
      // Find the one at sortOrder 2 and trash it
      const allDocs = getAllDocs(getDb());
      const middleDoc = allDocs.find((d) => d.sortOrder === 2)!;
      trashDocument(middleDoc.id);

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([0, 1, 2, 3]); // contiguous, no gap
    });

    // Interleaving creates and trashes is a common user pattern (create some notes,
    // delete one, create more). If the shift logic doesn't account for the gap
    // being closed, new docs could get wrong positions.
    it('interleaving create and trash maintains contiguous sortOrders', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });
      const c = createDocument({ title: 'C' });
      // Order: C(0), B(1), A(2)

      trashDocument(b.id); // closes gap: C(0), A(1)

      const d = createDocument({ title: 'D' });
      // D goes to 0, shifts others: D(0), C(1), A(2)

      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual([0, 1, 2]);
    });

    // Stress test: 20 docs should have exactly 0..19 with no duplicates.
    // This catches accumulation errors in the shift logic.
    it('bulk creation of 20 docs produces sortOrders 0..19 with no duplicates', () => {
      for (let i = 0; i < 20; i++) {
        createDocument({ title: `Doc ${i}` });
      }
      const orders = getSortOrders(getDb(), null);
      expect(orders).toEqual(Array.from({ length: 20 }, (_, i) => i));
    });

    // After a cross-parent move, BOTH the source and destination parents
    // need contiguous sortOrders. A bug in either gap-close or gap-open
    // would leave one parent with a hole.
    it('cross-parent move maintains sort integrity in both parents', () => {
      const parent1 = createDocument({ title: 'Parent 1' });
      const parent2 = createDocument({ title: 'Parent 2' });

      // Create 3 children under parent1
      createDocument({ title: 'Child A', parentId: parent1.id });
      const childB = createDocument({ title: 'Child B', parentId: parent1.id });
      createDocument({ title: 'Child C', parentId: parent1.id });
      // Under parent1: C(0), B(1), A(2)

      // Create 2 children under parent2
      createDocument({ title: 'Child X', parentId: parent2.id });
      createDocument({ title: 'Child Y', parentId: parent2.id });
      // Under parent2: Y(0), X(1)

      // Move B from parent1 to parent2 at position 1
      moveDocument(childB.id, parent2.id, 1);

      const ordersP1 = getSortOrders(getDb(), parent1.id);
      const ordersP2 = getSortOrders(getDb(), parent2.id);

      expect(ordersP1).toEqual([0, 1]); // gap closed
      expect(ordersP2).toEqual([0, 1, 2]); // room made for B
    });
});
