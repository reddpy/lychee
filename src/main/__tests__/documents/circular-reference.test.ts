import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getDocumentById, createDocument, moveDocument } from './setup';

describe('Document Repository — Circular Reference Prevention', () => {
  setupDb();

    // Direct cycle: A → B, try to make A a child of B.
    it('prevents moving parent into its direct child', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });

      expect(() => moveDocument(a.id, b.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });

    // Deep cycle: A → B → C, try to make A a child of C.
    // The recursive CTE must traverse multiple levels to catch this.
    it('prevents moving grandparent into grandchild', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });

      expect(() => moveDocument(a.id, c.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });

    // Self-reference: trying to make a doc its own parent.
    it('prevents moving document into itself', () => {
      const doc = createDocument({ title: 'Test' });

      expect(() => moveDocument(doc.id, doc.id, 0)).toThrow(
        'Cannot move document into itself',
      );
    });

    // Moving to an unrelated node should NOT be blocked.
    // A too-aggressive check could prevent valid moves.
    it('allows valid move to unrelated node', () => {
      const a = createDocument({ title: 'A' });
      createDocument({ title: 'B', parentId: a.id });
      const d = createDocument({ title: 'D' });

      // Moving A under D — D is unrelated, should be fine
      expect(() => moveDocument(a.id, d.id, 0)).not.toThrow();
    });

    // Root doc with children tries to nest under one of its children.
    // Real scenario: user drags "Project Notes" folder into one of
    // its own sub-notes in the sidebar. This should be blocked.
    it('root doc cannot nest into its own child', () => {
      const root = createDocument({ title: 'Project Notes' });
      const sub1 = createDocument({ title: 'Meeting Notes', parentId: root.id });
      createDocument({ title: 'Ideas', parentId: root.id });

      expect(() => moveDocument(root.id, sub1.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );

      // Verify nothing changed — root is still at root, sub1 still under root
      expect(getDocumentById(root.id)!.parentId).toBeNull();
      expect(getDocumentById(sub1.id)!.parentId).toBe(root.id);
    });

    // Wide tree: parent with 5 children. Try to nest parent under each child.
    // All 5 attempts should fail. This ensures the descendant CTE checks
    // all children, not just the first one.
    it('parent cannot nest under any of its children (wide tree)', () => {
      const parent = createDocument({ title: 'Parent' });
      const children: string[] = [];
      for (let i = 0; i < 5; i++) {
        children.push(
          createDocument({ title: `Child ${i}`, parentId: parent.id }).id,
        );
      }

      for (const childId of children) {
        expect(() => moveDocument(parent.id, childId, 0)).toThrow(
          'Cannot move document into its descendant',
        );
      }

      // Tree structure should be completely unchanged
      expect(getDocumentById(parent.id)!.parentId).toBeNull();
      for (const childId of children) {
        expect(getDocumentById(childId)!.parentId).toBe(parent.id);
      }
    });

    // After a valid move, the descendant set changes. A previously invalid
    // circular move may become valid. E.g.: A → B → C. Move B to root.
    // Now A has no descendants, so moving A under C should be allowed.
    it('circular check uses current tree, not stale state after moves', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });

      // A → B → C. Moving A under C is circular.
      expect(() => moveDocument(a.id, c.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );

      // Unnest B to root. Now A has no children, C is under B (not under A).
      moveDocument(b.id, null, 0);

      // A → (no children). B → C. Moving A under C should now be valid.
      expect(() => moveDocument(a.id, c.id, 0)).not.toThrow();
      expect(getDocumentById(a.id)!.parentId).toBe(c.id);
    });

    // Deep nesting then trying to create a cycle from a middle node.
    // A → B → C → D → E. Try to nest B under E. B's descendants are C,D,E
    // so E IS a descendant of B — should be blocked.
    it('mid-chain node cannot nest under its deep descendant', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });
      const d = createDocument({ title: 'D', parentId: c.id });
      const e = createDocument({ title: 'E', parentId: d.id });

      expect(() => moveDocument(b.id, e.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );

      // Also try B → D (skip one level) — still circular
      expect(() => moveDocument(b.id, d.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );

      // But A → E should also fail (E is A's descendant through B→C→D→E)
      expect(() => moveDocument(a.id, e.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );

      // Tree should be completely unchanged after all failed attempts
      expect(getDocumentById(a.id)!.parentId).toBeNull();
      expect(getDocumentById(b.id)!.parentId).toBe(a.id);
      expect(getDocumentById(c.id)!.parentId).toBe(b.id);
      expect(getDocumentById(d.id)!.parentId).toBe(c.id);
      expect(getDocumentById(e.id)!.parentId).toBe(d.id);
    });

    // Two separate trees: A → B and C → D. Moving A under D is fine (no cycle).
    // But after nesting A under D (D → A → B), moving C under B would be
    // circular (C → D → A → B, and B is C's descendant now? No — B is A's child,
    // not C's. C → D is the original chain. So C's descendants are D, A, B.
    // Moving C under B would be circular.)
    it('cycle detection works after merging two trees', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C' });
      const d = createDocument({ title: 'D', parentId: c.id });

      // Nest A under D: now C → D → A → B
      moveDocument(a.id, d.id, 0);

      // C's descendant chain is now D → A → B. Moving C under B is circular.
      expect(() => moveDocument(c.id, b.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );

      // Moving C under A is also circular (A is a descendant of C via D)
      expect(() => moveDocument(c.id, a.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });

    // Moving to root (null parent) should always succeed,
    // even if the doc has descendants. Root can never be a descendant.
    it('moving to root always succeeds regardless of descendants', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      createDocument({ title: 'C', parentId: b.id });

      // Move A (which has descendants B and C) to root — should work
      // A is already at root, so let's first nest it then move back
      const d = createDocument({ title: 'D' });
      moveDocument(a.id, d.id, 0);

      // Now move A back to root
      expect(() => moveDocument(a.id, null, 0)).not.toThrow();
    });
});
