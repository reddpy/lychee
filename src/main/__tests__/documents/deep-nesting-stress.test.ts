import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getSortOrders, getDocumentById, createDocument, trashDocument, restoreDocument, permanentDeleteDocument, moveDocument } from './setup';

describe('Document Repository — Deep Nesting Stress Tests', () => {
  setupDb();

    // Build a chain of 50 nested documents: root → child1 → child2 → ... → child50.
    // This tests that recursive CTEs traverse all levels without truncation.
    // SQLite's default recursion limit is 1000, but bugs in CTE termination
    // conditions could cause early exit at much shallower depths.
    it('trash cascades through a 50-level deep chain', () => {
      let parentId: string | null = null;
      const ids: string[] = [];

      for (let i = 0; i < 50; i++) {
        const doc = createDocument({
          title: `Level ${i}`,
          parentId: parentId ?? undefined,
        });
        ids.push(doc.id);
        parentId = doc.id;
      }

      // Trash the root — all 50 descendants should be trashed
      const result = trashDocument(ids[0]);
      expect(result.trashedIds).toHaveLength(50);

      // Verify every single level was trashed
      for (const id of ids) {
        const doc = getDocumentById(id)!;
        expect(doc.deletedAt).not.toBeNull();
      }
    });

    // Restore after trashing a deep chain — all 50 levels should come back.
    // A bug in the restore CTE's WHERE clause could skip deeply nested nodes.
    it('restore cascades through a 50-level deep chain', () => {
      let parentId: string | null = null;
      const ids: string[] = [];

      for (let i = 0; i < 50; i++) {
        const doc = createDocument({
          title: `Level ${i}`,
          parentId: parentId ?? undefined,
        });
        ids.push(doc.id);
        parentId = doc.id;
      }

      trashDocument(ids[0]);
      const result = restoreDocument(ids[0]);

      expect(result.restoredIds).toHaveLength(50);

      // Verify every level is restored and tree structure is intact
      for (let i = 0; i < ids.length; i++) {
        const doc = getDocumentById(ids[i])!;
        expect(doc.deletedAt).toBeNull();
        if (i > 0) {
          expect(doc.parentId).toBe(ids[i - 1]); // parent chain preserved
        }
      }
    });

    // permanentDelete on a 50-level chain — every row should be removed from the DB.
    // If the CTE misses deeper nodes, orphaned rows would accumulate and waste storage.
    it('permanentDelete removes all 50 levels of a deep chain', () => {
      let parentId: string | null = null;
      const ids: string[] = [];

      for (let i = 0; i < 50; i++) {
        const doc = createDocument({
          title: `Level ${i}`,
          parentId: parentId ?? undefined,
        });
        ids.push(doc.id);
        parentId = doc.id;
      }

      const result = permanentDeleteDocument(ids[0]);
      expect(result.deletedIds).toHaveLength(50);

      // Verify every row is actually gone
      for (const id of ids) {
        expect(getDocumentById(id)).toBeNull();
      }
    });

    // Move the root of a 50-level deep tree to a new parent.
    // The entire subtree should follow (children's parentIds don't change).
    // This tests that moveDocument works correctly when the moved doc has
    // a deep descendant chain — the circular reference check must traverse
    // all 50 levels to verify the target isn't a descendant.
    it('moving root of a 50-level tree carries entire subtree', () => {
      const newParent = createDocument({ title: 'New Home' });

      let parentId: string | null = null;
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const doc = createDocument({
          title: `Level ${i}`,
          parentId: parentId ?? undefined,
        });
        ids.push(doc.id);
        parentId = doc.id;
      }

      // Move root to under newParent
      moveDocument(ids[0], newParent.id, 0);

      // Root's parent should be newParent
      expect(getDocumentById(ids[0])!.parentId).toBe(newParent.id);

      // Interior parentIds should be unchanged (tree structure preserved)
      for (let i = 1; i < ids.length; i++) {
        expect(getDocumentById(ids[i])!.parentId).toBe(ids[i - 1]);
      }
    });

    // Circular reference check on a deep tree: try to move the root
    // into its deepest descendant (level 49). The CTE must traverse all
    // 50 levels to detect this. If the CTE stops early, this would create
    // an infinite loop in the tree.
    it('circular reference detected through 50 levels of nesting', () => {
      let parentId: string | null = null;
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const doc = createDocument({
          title: `Level ${i}`,
          parentId: parentId ?? undefined,
        });
        ids.push(doc.id);
        parentId = doc.id;
      }

      // Try to move root into its deepest descendant
      expect(() => moveDocument(ids[0], ids[49], 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });

    // Trash a node in the middle of a deep chain (level 25 out of 50).
    // Only descendants (levels 25-49) should be trashed, not ancestors (0-24).
    // A buggy CTE that traverses upward instead of downward would trash everything.
    it('trashing mid-chain node only cascades downward, not upward', () => {
      let parentId: string | null = null;
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const doc = createDocument({
          title: `Level ${i}`,
          parentId: parentId ?? undefined,
        });
        ids.push(doc.id);
        parentId = doc.id;
      }

      // Trash level 25 — should cascade to levels 25-49 (25 nodes)
      const result = trashDocument(ids[25]);
      expect(result.trashedIds).toHaveLength(25);

      // Levels 0-24 should still be active
      for (let i = 0; i < 25; i++) {
        expect(getDocumentById(ids[i])!.deletedAt).toBeNull();
      }

      // Levels 25-49 should be trashed
      for (let i = 25; i < 50; i++) {
        expect(getDocumentById(ids[i])!.deletedAt).not.toBeNull();
      }
    });

    // Deep tree with branching: each node has 2 children, creating a binary tree.
    // 6 levels deep = 63 total nodes. Tests that the CTE handles width as well as depth.
    it('trash cascades through a wide binary tree (6 levels, 63 nodes)', () => {
      const root = createDocument({ title: 'Root' });
      const allIds = [root.id];

      // Build a binary tree using BFS
      const queue = [root.id];
      let level = 0;
      while (level < 5 && queue.length > 0) {
        const nextQueue: string[] = [];
        for (const pid of queue) {
          const left = createDocument({ title: `L${level}-L`, parentId: pid });
          const right = createDocument({ title: `L${level}-R`, parentId: pid });
          allIds.push(left.id, right.id);
          nextQueue.push(left.id, right.id);
        }
        queue.length = 0;
        queue.push(...nextQueue);
        level++;
      }

      // 1 + 2 + 4 + 8 + 16 + 32 = 63 nodes
      expect(allIds.length).toBe(63);

      const result = trashDocument(root.id);
      expect(result.trashedIds).toHaveLength(63);
    });

    // 100-level deep chain: pushes toward SQLite's default recursion limit.
    // If someone has a deeply nested folder structure (e.g., organizational hierarchy),
    // the CTE must not silently truncate.
    it('permanentDelete handles a 100-level deep chain', () => {
      let parentId: string | null = null;
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        const doc = createDocument({
          title: `Level ${i}`,
          parentId: parentId ?? undefined,
        });
        ids.push(doc.id);
        parentId = doc.id;
      }

      const result = permanentDeleteDocument(ids[0]);
      expect(result.deletedIds).toHaveLength(100);

      for (const id of ids) {
        expect(getDocumentById(id)).toBeNull();
      }
    });

    // Build a 30-level chain, then try to move every ancestor into the deepest
    // node. All 29 attempts should be blocked by the circular check.
    // This tests that getDescendantIds is exhaustive at every level.
    it('circular check blocks all 29 ancestors from nesting into the deepest node of a 30-level chain', () => {
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) {
        const doc = createDocument({
          title: `L${i}`,
          parentId: i > 0 ? ids[i - 1] : undefined,
        });
        ids.push(doc.id);
      }

      const deepest = ids[29];
      // Every node from L0 to L28 is an ancestor of L29.
      // Moving any of them under L29 should be circular.
      for (let i = 0; i < 29; i++) {
        expect(() => moveDocument(ids[i], deepest, 0)).toThrow(
          'Cannot move document into its descendant',
        );
      }
    });

    // Build a 30-level chain, reverse it completely (deepest becomes root),
    // then verify the new hierarchy has correct circular constraints.
    it('fully reverse a 30-level chain and verify circular checks on new hierarchy', () => {
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) {
        const doc = createDocument({
          title: `L${i}`,
          parentId: i > 0 ? ids[i - 1] : undefined,
        });
        ids.push(doc.id);
      }

      // Reverse: unnest from bottom up, then nest in reverse order
      // First, unnest all to root (bottom up so we don't create circular issues)
      for (let i = 29; i >= 1; i--) {
        moveDocument(ids[i], null, 0);
      }

      // Now all are at root. Rebuild as reversed chain: L29 → L28 → ... → L0
      for (let i = 28; i >= 0; i--) {
        moveDocument(ids[i], ids[i + 1], 0);
      }

      // Verify chain: L29 is root, L0 is deepest
      expect(getDocumentById(ids[29])!.parentId).toBeNull();
      for (let i = 0; i < 29; i++) {
        expect(getDocumentById(ids[i])!.parentId).toBe(ids[i + 1]);
      }

      // L29 (new root) can't go under L0 (its deepest descendant now)
      expect(() => moveDocument(ids[29], ids[0], 0)).toThrow(
        'Cannot move document into its descendant',
      );
      // L28 (child of L29) can't go under L0 either
      expect(() => moveDocument(ids[28], ids[0], 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });

    // Build two 25-level chains, connect them into a single 50-level chain,
    // then verify circular constraints span the join point.
    it('joining two 25-level chains creates 50-level circular constraints', () => {
      // Chain A: A0 → A1 → ... → A24
      const chainA: string[] = [];
      for (let i = 0; i < 25; i++) {
        const doc = createDocument({
          title: `A${i}`,
          parentId: i > 0 ? chainA[i - 1] : undefined,
        });
        chainA.push(doc.id);
      }

      // Chain B: B0 → B1 → ... → B24
      const chainB: string[] = [];
      for (let i = 0; i < 25; i++) {
        const doc = createDocument({
          title: `B${i}`,
          parentId: i > 0 ? chainB[i - 1] : undefined,
        });
        chainB.push(doc.id);
      }

      // Connect: move B0 under A24 (tail of chain A)
      moveDocument(chainB[0], chainA[24], 0);

      // Now A0 → ... → A24 → B0 → ... → B24 (50 levels)
      // A0 can't go under B24 (its descendant through the join)
      expect(() => moveDocument(chainA[0], chainB[24], 0)).toThrow(
        'Cannot move document into its descendant',
      );
      // A24 (the join point's parent) can't go under B0 (its child)
      expect(() => moveDocument(chainA[24], chainB[0], 0)).toThrow(
        'Cannot move document into its descendant',
      );

      // But B24 CAN go under A0 (B24 is a descendant, not an ancestor of A0)
      // Wait — that's wrong. B24 is a descendant of A0. Moving B24 under A0
      // doesn't create a cycle (B24 has no children). Actually, B24 IS a
      // descendant of A0 already. Moving B24 under A0 just shortens the chain.
      moveDocument(chainB[24], chainA[0], 0);
      expect(getDocumentById(chainB[24])!.parentId).toBe(chainA[0]);
    });

    // Deep unnesting stress: build 50-level chain, then unnest every other node
    // to root (even-indexed levels). This creates many short chains.
    it('unnesting every other node from a 50-level chain fragments into short chains', () => {
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const doc = createDocument({
          title: `L${i}`,
          parentId: i > 0 ? ids[i - 1] : undefined,
        });
        ids.push(doc.id);
      }

      // Unnest even-indexed nodes (except L0 which is already root) to root.
      // Go from the bottom up so we don't break parent references mid-iteration.
      for (let i = 48; i >= 2; i -= 2) {
        moveDocument(ids[i], null, 0);
      }

      // L0 should still be at root
      expect(getDocumentById(ids[0])!.parentId).toBeNull();
      // Every even node (>=2) should be at root
      for (let i = 2; i < 50; i += 2) {
        expect(getDocumentById(ids[i])!.parentId).toBeNull();
      }
      // Odd nodes should still chain: L1 under L0, L3 under L2, etc.
      // Actually, after unnesting L2, L3 was under L2. L2 moved to root,
      // so L3 is still under L2 (subtree follows). Let me verify the actual
      // structure: L0 → L1, L2 → L3, L4 → L5, etc. (pairs)
      for (let i = 1; i < 50; i += 2) {
        expect(getDocumentById(ids[i])!.parentId).toBe(ids[i - 1]);
      }
    });

    // Wide + deep combo: build a tree where root has 5 children, each child has
    // 5 children (25 grandchildren). Then try to nest root under one of its
    // grandchildren (circular across 2 levels + width).
    it('circular check on wide tree: root cannot nest under any of its 25 grandchildren', () => {
      const root = createDocument({ title: 'Root' });
      const children: string[] = [];
      const grandchildren: string[] = [];

      for (let i = 0; i < 5; i++) {
        const child = createDocument({ title: `C${i}`, parentId: root.id });
        children.push(child.id);
        for (let j = 0; j < 5; j++) {
          const gc = createDocument({ title: `C${i}-G${j}`, parentId: child.id });
          grandchildren.push(gc.id);
        }
      }

      // Root has 25 grandchildren. Can't nest under any of them.
      for (const gcId of grandchildren) {
        expect(() => moveDocument(root.id, gcId, 0)).toThrow(
          'Cannot move document into its descendant',
        );
      }

      // But a grandchild CAN be moved under root (it's already a descendant,
      // this just shortens the chain)
      moveDocument(grandchildren[0], root.id, 0);
      expect(getDocumentById(grandchildren[0])!.parentId).toBe(root.id);
    });

    // Stress: build 20-level chain, trash at level 10, restore at level 10,
    // then verify circular checks still work across the full chain.
    it('trash and restore mid-chain preserves circular constraints', () => {
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const doc = createDocument({
          title: `L${i}`,
          parentId: i > 0 ? ids[i - 1] : undefined,
        });
        ids.push(doc.id);
      }

      // Trash at level 10 — levels 10-19 are trashed
      trashDocument(ids[10]);
      // Restore at level 10 — levels 10-19 are restored
      restoreDocument(ids[10]);

      // Full chain should be intact. Circular checks should work.
      expect(() => moveDocument(ids[0], ids[19], 0)).toThrow(
        'Cannot move document into its descendant',
      );
      expect(() => moveDocument(ids[5], ids[15], 0)).toThrow(
        'Cannot move document into its descendant',
      );

      // L19 (leaf) can move to root — not circular
      moveDocument(ids[19], null, 0);
      expect(getDocumentById(ids[19])!.parentId).toBeNull();
    });

    // Build a 30-level chain, split it into 3 chains of 10, reconnect in
    // reversed order, and verify the new hierarchy.
    it('split and reconnect deep chains in reversed order', () => {
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) {
        const doc = createDocument({
          title: `L${i}`,
          parentId: i > 0 ? ids[i - 1] : undefined,
        });
        ids.push(doc.id);
      }

      // Split: move L10 and L20 to root (creates 3 chains: L0-L9, L10-L19, L20-L29)
      moveDocument(ids[20], null, 0);
      moveDocument(ids[10], null, 0);

      // Verify 3 root-level chains
      expect(getDocumentById(ids[0])!.parentId).toBeNull();
      expect(getDocumentById(ids[10])!.parentId).toBeNull();
      expect(getDocumentById(ids[20])!.parentId).toBeNull();

      // Reconnect in reverse: L20's tail → L10, L10's tail → L0
      // L20-L29, then L29 gets L10 as child, L19 gets L0 as child
      moveDocument(ids[10], ids[29], 0); // L10 chain under L29
      moveDocument(ids[0], ids[19], 0);  // L0 chain under L19

      // Verify: L20 is root. L20 → ... → L29 → L10 → ... → L19 → L0 → ... → L9
      expect(getDocumentById(ids[20])!.parentId).toBeNull();
      expect(getDocumentById(ids[10])!.parentId).toBe(ids[29]);
      expect(getDocumentById(ids[0])!.parentId).toBe(ids[19]);

      // Circular: L20 can't go under L9 (deepest descendant now)
      expect(() => moveDocument(ids[20], ids[9], 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });
});
