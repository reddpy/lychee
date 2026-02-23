import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, insertDoc, getAllDocs, getSortOrders, getAllDocsForParent, getDocumentById, createDocument, updateDocument, trashDocument, restoreDocument, permanentDeleteDocument, moveDocument } from './setup';

describe('Document Repository — Nesting & Unnesting', () => {
  setupDb();

    // ── Basic Nesting (root → child) ─────────────────────

    // The simplest nest: take a root doc and make it a child of another root doc.
    // parentId goes from null → someId, root loses a sibling, parent gains one.
    it('nest a root doc under another root doc', () => {
      const folder = createDocument({ title: 'Folder' });
      const note = createDocument({ title: 'Note' });
      // Root: Note(0) Folder(1)

      moveDocument(note.id, folder.id, 0);

      const moved = getDocumentById(note.id)!;
      expect(moved.parentId).toBe(folder.id);
      expect(moved.sortOrder).toBe(0);
      // Root should only have Folder left
      expect(getSortOrders(getDb(), null)).toEqual([0]);
      // Folder should have Note as child
      expect(getSortOrders(getDb(), folder.id)).toEqual([0]);
    });

    // Nest multiple root docs under one folder, one at a time.
    // Each nest should close the root gap and open a gap in the folder.
    it('nest 3 root docs into a folder one by one', () => {
      const folder = createDocument({ title: 'Folder' });
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });
      const c = createDocument({ title: 'C' });
      // Root: C(0) B(1) A(2) Folder(3)

      moveDocument(a.id, folder.id, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2]); // 3 root items left
      expect(getSortOrders(getDb(), folder.id)).toEqual([0]);

      moveDocument(b.id, folder.id, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1]); // 2 root items left
      expect(getSortOrders(getDb(), folder.id)).toEqual([0, 1]);

      moveDocument(c.id, folder.id, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0]); // only Folder remains at root
      expect(getSortOrders(getDb(), folder.id)).toEqual([0, 1, 2]);
    });

    // ── Basic Unnesting (child → root) ───────────────────

    // Take a nested doc and move it back to root.
    // parentId goes from someId → null.
    it('unnest a child doc back to root', () => {
      const folder = createDocument({ title: 'Folder' });
      const note = createDocument({ title: 'Note', parentId: folder.id });

      moveDocument(note.id, null, 0);

      const moved = getDocumentById(note.id)!;
      expect(moved.parentId).toBeNull();
      expect(getSortOrders(getDb(), folder.id)).toEqual([]); // folder is empty
      expect(getSortOrders(getDb(), null)).toEqual([0, 1]); // root has note + folder
    });

    // Unnest all children from a folder back to root.
    it('unnest all 3 children from a folder to root', () => {
      const folder = createDocument({ title: 'Folder' });
      const a = createDocument({ title: 'A', parentId: folder.id });
      const b = createDocument({ title: 'B', parentId: folder.id });
      const c = createDocument({ title: 'C', parentId: folder.id });
      // Folder children: C(0) B(1) A(2)

      // Unnest each to root at position 0
      moveDocument(c.id, null, 0);
      expect(getSortOrders(getDb(), folder.id)).toEqual([0, 1]);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1]);

      moveDocument(b.id, null, 0);
      expect(getSortOrders(getDb(), folder.id)).toEqual([0]);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2]);

      moveDocument(a.id, null, 0);
      expect(getSortOrders(getDb(), folder.id)).toEqual([]);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3]);
    });

    // ── Nest then Unnest (round-trip) ────────────────────

    // Nest a doc then immediately unnest it. Should end up back where it started.
    // Tests that the gap-close and gap-open are truly inverse operations.
    it('nest then unnest returns doc to root with correct sortOrders', () => {
      const folder = createDocument({ title: 'Folder' });
      createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });
      // Root: B(0) A(1) Folder(2)

      // Nest B
      moveDocument(b.id, folder.id, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1]);

      // Unnest B back to root at position 0
      moveDocument(b.id, null, 0);
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2]);
      expect(getSortOrders(getDb(), folder.id)).toEqual([]);
      expect(getDocumentById(b.id)!.parentId).toBeNull();
    });

    // Repeatedly nest and unnest the same doc — tests for stale state accumulation.
    it('nest and unnest same doc 5 times without corruption', () => {
      const folder = createDocument({ title: 'Folder' });
      const note = createDocument({ title: 'Note' });
      createDocument({ title: 'Other' });
      // Root: Other(0) Note(1) Folder(2)

      for (let i = 0; i < 5; i++) {
        // Nest
        moveDocument(note.id, folder.id, 0);
        expect(getDocumentById(note.id)!.parentId).toBe(folder.id);
        expect(getSortOrders(getDb(), folder.id)).toEqual([0]);

        // Root should be contiguous
        const rootAfterNest = getSortOrders(getDb(), null);
        expect(rootAfterNest).toEqual(
          Array.from({ length: rootAfterNest.length }, (_, j) => j),
        );

        // Unnest
        moveDocument(note.id, null, 0);
        expect(getDocumentById(note.id)!.parentId).toBeNull();
        expect(getSortOrders(getDb(), folder.id)).toEqual([]);

        const rootAfterUnnest = getSortOrders(getDb(), null);
        expect(rootAfterUnnest).toEqual(
          Array.from({ length: rootAfterUnnest.length }, (_, j) => j),
        );
      }
    });

    // ── Multi-level Nesting ──────────────────────────────

    // Nest a doc under a child that's already nested (building depth).
    // root → A → B → C. Build this by nesting one level at a time.
    it('build 3-level depth by successive nesting', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });
      const c = createDocument({ title: 'C' });
      // Root: C(0) B(1) A(2)

      // Nest B under A
      moveDocument(b.id, a.id, 0);
      expect(getDocumentById(b.id)!.parentId).toBe(a.id);

      // Nest C under B (now 3 levels: A → B → C)
      moveDocument(c.id, b.id, 0);
      expect(getDocumentById(c.id)!.parentId).toBe(b.id);

      // Root should only have A
      expect(getSortOrders(getDb(), null)).toEqual([0]);
      // A's children: just B
      expect(getSortOrders(getDb(), a.id)).toEqual([0]);
      // B's children: just C
      expect(getSortOrders(getDb(), b.id)).toEqual([0]);
    });

    // Unnest from deep: take the deepest node and bring it back to root.
    it('unnest deepest node from 3-level chain back to root', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });

      moveDocument(c.id, null, 0);

      expect(getDocumentById(c.id)!.parentId).toBeNull();
      expect(getSortOrders(getDb(), b.id)).toEqual([]); // B lost its child
      expect(getSortOrders(getDb(), null)).toEqual([0, 1]); // C and A at root
    });

    // Unnest a middle node: take B out of A → B → C chain.
    // C should stay under B (subtree moves with B), so the chain becomes:
    // root has A and B, B still has C.
    it('unnesting a middle node brings its subtree along', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });

      // Unnest B from A to root
      moveDocument(b.id, null, 0);

      expect(getDocumentById(b.id)!.parentId).toBeNull();
      // C is still under B — subtree followed
      expect(getDocumentById(c.id)!.parentId).toBe(b.id);
      // A has no children now
      expect(getSortOrders(getDb(), a.id)).toEqual([]);
      // B still has C
      expect(getSortOrders(getDb(), b.id)).toEqual([0]);
    });

    // ── Cross-folder Nesting ─────────────────────────────

    // Move a nested doc from one folder to another folder (re-nesting).
    it('re-nest: move child from one folder to another', () => {
      const folder1 = createDocument({ title: 'Folder 1' });
      const folder2 = createDocument({ title: 'Folder 2' });
      const note = createDocument({ title: 'Note', parentId: folder1.id });
      createDocument({ title: 'Sibling', parentId: folder1.id });
      // Folder1 children: Sibling(0) Note(1)

      moveDocument(note.id, folder2.id, 0);

      expect(getDocumentById(note.id)!.parentId).toBe(folder2.id);
      expect(getSortOrders(getDb(), folder1.id)).toEqual([0]); // Sibling only
      expect(getSortOrders(getDb(), folder2.id)).toEqual([0]); // Note
    });

    // Move a subtree from one folder to another.
    // Folder1 has Parent → Child. Move Parent under Folder2.
    // Child should still be under Parent.
    it('re-nest subtree: parent+child move from folder1 to folder2', () => {
      const f1 = createDocument({ title: 'F1' });
      const f2 = createDocument({ title: 'F2' });
      const parent = createDocument({ title: 'Parent', parentId: f1.id });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      moveDocument(parent.id, f2.id, 0);

      expect(getDocumentById(parent.id)!.parentId).toBe(f2.id);
      expect(getDocumentById(child.id)!.parentId).toBe(parent.id); // unchanged
      expect(getSortOrders(getDb(), f1.id)).toEqual([]); // f1 is empty
      expect(getSortOrders(getDb(), f2.id)).toEqual([0]); // parent
      expect(getSortOrders(getDb(), parent.id)).toEqual([0]); // child
    });

    // ── Nesting with Siblings ────────────────────────────

    // Nest a doc that's between siblings. The gap must close in root
    // and open in the folder, and the remaining siblings stay contiguous.
    it('nesting middle sibling closes gap and preserves order of remaining', () => {
      const folder = createDocument({ title: 'Folder' });
      createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      createDocument({ title: 'D' });
      // Root: D(0) C(1) B(2) A(3) Folder(4)

      moveDocument(b.id, folder.id, 0);

      // Root: D(0) C(1) A(2) Folder(3) — gap at B's old position closed
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3]);
      // Verify order of remaining root docs
      const rootDocs = getAllDocs(getDb())
        .filter((d) => d.parentId === null)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      expect(rootDocs.map((d) => d.title)).toEqual(['D', 'C', 'A', 'Folder']);
    });

    // Unnest a doc into a list of existing root siblings at a specific position.
    it('unnesting into middle of root siblings opens gap correctly', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      createDocument({ title: 'C' });
      // Root: C(0) B(1) A(2)

      const folder = createDocument({ title: 'Folder' });
      const nested = createDocument({ title: 'Nested', parentId: folder.id });
      // Root: Folder(0) C(1) B(2) A(3)

      // Unnest into root at position 2 (between B and A)
      moveDocument(nested.id, null, 2);

      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);
      const rootDocs = getAllDocs(getDb())
        .filter((d) => d.parentId === null)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      expect(rootDocs[2].title).toBe('Nested');
    });

    // ── Stress: Nest and Unnest Many ─────────────────────

    // Create 50 root docs, nest all into a single folder, then unnest all back.
    // Both root and folder should have contiguous sortOrders at every step.
    it('nest 50 docs into folder then unnest all back to root', () => {
      const folder = createDocument({ title: 'Folder' });
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const doc = createDocument({ title: `Note ${i}` });
        ids.push(doc.id);
      }
      // Root: 50 notes + folder = 51 items

      // Nest all 50 into folder (always move the current top root item)
      for (let i = 0; i < 50; i++) {
        const rootDocs = getAllDocs(getDb())
          .filter((d) => d.parentId === null && d.id !== folder.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        moveDocument(rootDocs[0].id, folder.id, i); // append at end
      }

      // Root should only have the folder
      expect(getSortOrders(getDb(), null)).toEqual([0]);
      // Folder should have all 50 with contiguous sortOrders
      expect(getSortOrders(getDb(), folder.id)).toEqual(
        Array.from({ length: 50 }, (_, i) => i),
      );

      // Unnest all 50 back to root (always move the first child)
      for (let i = 0; i < 50; i++) {
        const children = getAllDocsForParent(getDb(), folder.id)
          .filter((d) => !d.deletedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        moveDocument(children[0].id, null, 0);
      }

      // Folder should be empty
      expect(getSortOrders(getDb(), folder.id)).toEqual([]);
      // Root should have 51 items (50 notes + folder) with contiguous sortOrders
      expect(getSortOrders(getDb(), null)).toEqual(
        Array.from({ length: 51 }, (_, i) => i),
      );
    });

    // Build a 20-level deep chain by nesting one at a time from a flat list.
    // Start with 20 root docs, nest #2 under #1, #3 under #2, etc.
    it('build 20-level chain from flat list by successive nesting', () => {
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const doc = createDocument({ title: `Level ${i}` });
        ids.push(doc.id);
      }
      // All 20 at root

      // Nest each under the previous one
      for (let i = 1; i < 20; i++) {
        moveDocument(ids[i], ids[i - 1], 0);
      }

      // Only ids[0] should be at root
      expect(getSortOrders(getDb(), null)).toEqual([0]);

      // Verify chain: each doc's parent is the one before it
      for (let i = 1; i < 20; i++) {
        expect(getDocumentById(ids[i])!.parentId).toBe(ids[i - 1]);
      }
    });

    // Flatten a 20-level deep chain back to root by unnesting from the bottom up.
    it('flatten 20-level chain back to root by unnesting bottom-up', () => {
      // Build the chain
      const ids: string[] = [];
      let parentId: string | null = null;
      for (let i = 0; i < 20; i++) {
        const doc = createDocument({
          title: `Level ${i}`,
          parentId: parentId ?? undefined,
        });
        ids.push(doc.id);
        parentId = doc.id;
      }

      // Unnest from deepest to shallowest (skip root, it's already at root)
      for (let i = 19; i >= 1; i--) {
        moveDocument(ids[i], null, 0);
      }

      // All 20 should be at root with contiguous sortOrders
      expect(getSortOrders(getDb(), null)).toEqual(
        Array.from({ length: 20 }, (_, i) => i),
      );
      for (const id of ids) {
        expect(getDocumentById(id)!.parentId).toBeNull();
      }
    });

    // Scatter: take 10 root docs and distribute them across 5 folders,
    // then gather them all back to root. Tests many cross-parent transitions.
    it('scatter 10 docs across 5 folders then gather back to root', () => {
      const folders: string[] = [];
      for (let i = 0; i < 5; i++) {
        folders.push(createDocument({ title: `Folder ${i}` }).id);
      }
      const notes: string[] = [];
      for (let i = 0; i < 10; i++) {
        notes.push(createDocument({ title: `Note ${i}` }).id);
      }
      // Root: 10 notes + 5 folders = 15 items

      // Distribute: note[i] goes into folder[i % 5]
      for (let i = 0; i < 10; i++) {
        moveDocument(notes[i], folders[i % 5], 0);
      }

      // Root should have 5 folders only
      expect(getSortOrders(getDb(), null)).toEqual([0, 1, 2, 3, 4]);
      // Each folder should have 2 notes
      for (const fid of folders) {
        expect(getSortOrders(getDb(), fid)).toEqual([0, 1]);
      }

      // Gather all back to root
      for (const nid of notes) {
        const rootCount = getSortOrders(getDb(), null).length;
        moveDocument(nid, null, rootCount); // append at end
      }

      // Root should have 15 items with contiguous sortOrders
      expect(getSortOrders(getDb(), null)).toEqual(
        Array.from({ length: 15 }, (_, i) => i),
      );
      // All folders should be empty
      for (const fid of folders) {
        expect(getSortOrders(getDb(), fid)).toEqual([]);
      }
    });

    // Stress: 100 docs, repeatedly nest and unnest in a cycle.
    // Nest all into one folder, unnest all, nest into a different folder, repeat.
    it('cycle: nest 30 docs into folder A, unnest all, nest into folder B, unnest all', () => {
      const folderA = createDocument({ title: 'Folder A' });
      const folderB = createDocument({ title: 'Folder B' });
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) {
        ids.push(createDocument({ title: `Doc ${i}` }).id);
      }

      // Nest all into folder A
      for (let i = 0; i < 30; i++) {
        moveDocument(ids[i], folderA.id, i);
      }
      expect(getSortOrders(getDb(), folderA.id)).toEqual(
        Array.from({ length: 30 }, (_, i) => i),
      );

      // Unnest all from folder A
      for (let i = 0; i < 30; i++) {
        const first = getAllDocsForParent(getDb(), folderA.id)
          .filter((d) => !d.deletedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder)[0];
        moveDocument(first.id, null, 0);
      }
      expect(getSortOrders(getDb(), folderA.id)).toEqual([]);

      // Nest all into folder B
      for (let i = 0; i < 30; i++) {
        moveDocument(ids[i], folderB.id, i);
      }
      expect(getSortOrders(getDb(), folderB.id)).toEqual(
        Array.from({ length: 30 }, (_, i) => i),
      );

      // Unnest all from folder B
      for (let i = 0; i < 30; i++) {
        const first = getAllDocsForParent(getDb(), folderB.id)
          .filter((d) => !d.deletedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder)[0];
        moveDocument(first.id, null, 0);
      }
      expect(getSortOrders(getDb(), folderB.id)).toEqual([]);

      // All 32 items (30 docs + 2 folders) at root, contiguous
      expect(getSortOrders(getDb(), null)).toEqual(
        Array.from({ length: 32 }, (_, i) => i),
      );
    });

    // ── Edge Cases ───────────────────────────────────────

    // BUG: Nesting under a trashed parent leaves the doc in limbo — it has
    // deletedAt=NULL but its parent is trashed, so it won't appear in
    // listDocuments (parent is hidden) or listTrashedDocuments (doc isn't trashed).
    // moveDocument should reject nesting under a trashed parent.
    // TODO: validate target parent is not trashed in moveDocument
    it.todo('nesting under a trashed parent should be rejected');

    // BUG: Nesting a trashed doc silently moves it without restoring it.
    // A trashed doc shouldn't be movable — the user should restore it first.
    // TODO: validate source doc is not trashed in moveDocument
    it.todo('nesting a trashed doc should be rejected');

    // BUG: Nesting under a nonexistent parentId creates an orphan with a
    // dangling reference. moveDocument should validate the target exists.
    // TODO: validate target parent exists in moveDocument
    it.todo('nesting under nonexistent parent should be rejected');

    // BUG: sortOrder beyond sibling count creates a gap (e.g., sortOrder=100
    // when there are 0 siblings). Should be clamped to the sibling count.
    // TODO: clamp sortOrder to sibling count in moveDocument
    it.todo('nesting with sortOrder beyond sibling count should be clamped');

    // BUG: Negative sortOrder creates invalid state. Should be clamped to 0.
    // TODO: clamp negative sortOrder to 0 in moveDocument
    it.todo('nesting with negative sortOrder should be clamped to 0');

    // Nesting must preserve content, title, emoji, createdAt.
    // Only parentId, sortOrder, and updatedAt should change.
    // We use insertDoc with a past timestamp so moveDocument's nowIso() will differ.
    it('nesting preserves content, title, emoji, createdAt', () => {
      const folder = createDocument({ title: 'Folder' });
      const past = '2024-01-01T00:00:00.000Z';
      const noteData = insertDoc(getDb(), {
        title: 'Important Note',
        content: '{"type":"doc","content":[]}',
        emoji: '📌',
        createdAt: past,
        updatedAt: past,
      });
      const before = getDocumentById(noteData.id)!;

      moveDocument(noteData.id, folder.id, 0);

      const after = getDocumentById(noteData.id)!;
      expect(after.title).toBe(before.title);
      expect(after.content).toBe(before.content);
      expect(after.emoji).toBe(before.emoji);
      expect(after.createdAt).toBe(before.createdAt);
      // These should change:
      expect(after.parentId).toBe(folder.id);
      expect(after.sortOrder).toBe(0);
      expect(after.updatedAt).not.toBe(past);
    });

    // Trash a parent, verify the nested structure is preserved.
    // Then unnest a child WHILE the parent is trashed — the child
    // should move to root and become active again.
    it('unnesting a child while parent is trashed makes child active at root', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });

      trashDocument(parent.id);

      // Both are trashed now
      expect(getDocumentById(child.id)!.deletedAt).not.toBeNull();

      // Manually un-trash the child (simulating a selective restore),
      // then move it to root
      getDb().prepare(`UPDATE documents SET deletedAt = NULL WHERE id = ?`).run(
        child.id,
      );
      moveDocument(child.id, null, 0);

      const moved = getDocumentById(child.id)!;
      expect(moved.parentId).toBeNull();
      expect(moved.deletedAt).toBeNull();
      // Parent is still trashed
      expect(getDocumentById(parent.id)!.deletedAt).not.toBeNull();
    });

    // Nest two docs that are siblings into each other in sequence:
    // A and B are siblings. Nest A under B. Then try to nest B under A
    // — this should be blocked (A is now B's child, so B can't go under A
    // without creating a cycle).
    it('sibling-to-parent then reverse is blocked as circular', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });

      // Nest A under B
      moveDocument(a.id, b.id, 0);
      expect(getDocumentById(a.id)!.parentId).toBe(b.id);

      // Try reverse: nest B under A — circular! (B → A, can't also have A → B)
      expect(() => moveDocument(b.id, a.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });

    // Nest a doc, then permanently delete the parent.
    // The child is also deleted (cascade). Verify it's truly gone.
    it('permanently deleting a parent removes nested children', () => {
      const parent = createDocument({ title: 'Parent' });
      const child = createDocument({ title: 'Child', parentId: parent.id });
      const grandchild = createDocument({
        title: 'Grandchild',
        parentId: child.id,
      });

      const result = permanentDeleteDocument(parent.id);

      expect(result.deletedIds).toHaveLength(3);
      expect(getDocumentById(parent.id)).toBeNull();
      expect(getDocumentById(child.id)).toBeNull();
      expect(getDocumentById(grandchild.id)).toBeNull();
    });

    // Nest, then use updateDocument to change parentId (not moveDocument).
    // updateDocument does NOT adjust sortOrders — this is a subtle foot-gun.
    // After updateDocument, the old parent may have a gap and the new parent
    // may have a collision. Document this behavior.
    it('updateDocument parentId change does not fix sortOrders (foot-gun)', () => {
      const f1 = createDocument({ title: 'F1' });
      const f2 = createDocument({ title: 'F2' });
      const a = createDocument({ title: 'A', parentId: f1.id });
      createDocument({ title: 'B', parentId: f1.id });
      // F1 children: B(0) A(1)

      createDocument({ title: 'X', parentId: f2.id });
      // F2 children: X(0)

      // Use updateDocument instead of moveDocument to reparent A
      updateDocument(a.id, { parentId: f2.id });

      // F1 still has B at sortOrder 0 — that's fine (A was at 1, gap isn't visible)
      // But A still has sortOrder 1 from F1, which may collide or leave a gap in F2.
      const aDoc = getDocumentById(a.id)!;
      expect(aDoc.parentId).toBe(f2.id);
      expect(aDoc.sortOrder).toBe(1); // stale sortOrder from F1, not adjusted for F2

      // F2 children: X(0), A(1) — happens to be contiguous by luck here,
      // but the sortOrder wasn't explicitly set for F2's context
      const f2Orders = getSortOrders(getDb(), f2.id);
      expect(f2Orders).toEqual([0, 1]); // contiguous by coincidence
    });

    // The only doc at root is nested into itself — self-reference check.
    it('cannot nest the sole root doc into itself', () => {
      const solo = createDocument({ title: 'Solo' });

      expect(() => moveDocument(solo.id, solo.id, 0)).toThrow(
        'Cannot move document into itself',
      );
      expect(getDocumentById(solo.id)!.parentId).toBeNull();
    });

    // Create doc directly as nested (via createDocument with parentId),
    // verify it gets sortOrder 0 and shifts existing children.
    it('createDocument with parentId nests directly and shifts siblings', () => {
      const folder = createDocument({ title: 'Folder' });
      const first = createDocument({ title: 'First', parentId: folder.id });
      expect(first.sortOrder).toBe(0);

      const second = createDocument({ title: 'Second', parentId: folder.id });
      expect(second.sortOrder).toBe(0);

      // First should have been shifted to 1
      expect(getDocumentById(first.id)!.sortOrder).toBe(1);
      expect(getSortOrders(getDb(), folder.id)).toEqual([0, 1]);
    });

    // ── Deep nesting + children edge cases ──

    // Unnesting a node from deep in a chain should bring its entire subtree.
    // A → B → C → D → E. Unnest C to root. D and E should follow C.
    it('unnesting mid-chain node from depth 3 brings deep subtree to root', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });
      const d = createDocument({ title: 'D', parentId: c.id });
      const e = createDocument({ title: 'E', parentId: d.id });

      moveDocument(c.id, null, 0);

      // C is now at root, D is still under C, E is still under D
      expect(getDocumentById(c.id)!.parentId).toBeNull();
      expect(getDocumentById(d.id)!.parentId).toBe(c.id);
      expect(getDocumentById(e.id)!.parentId).toBe(d.id);
      // B lost its child
      expect(getSortOrders(getDb(), b.id)).toEqual([]);
    });

    // Cross-subtree deep move: move a deep node from one subtree into a deep
    // node of another subtree. Both subtrees should remain intact.
    it('cross-subtree move between two deep chains', () => {
      // Chain 1: A → B → C
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });

      // Chain 2: X → Y → Z
      const x = createDocument({ title: 'X' });
      const y = createDocument({ title: 'Y', parentId: x.id });
      const z = createDocument({ title: 'Z', parentId: y.id });

      // Move C (leaf of chain 1) under Z (leaf of chain 2)
      moveDocument(c.id, z.id, 0);

      expect(getDocumentById(c.id)!.parentId).toBe(z.id);
      // B lost its child
      expect(getSortOrders(getDb(), b.id)).toEqual([]);
      // Z gained a child
      expect(getSortOrders(getDb(), z.id)).toEqual([0]);
      // Chain 2's structure above Z is untouched
      expect(getDocumentById(z.id)!.parentId).toBe(y.id);
      expect(getDocumentById(y.id)!.parentId).toBe(x.id);
    });

    // Move a mid-chain node with subtree into a sibling subtree.
    // A has children B and C. B has child D. Move B (with D) under C.
    // Result: A → C → B → D. Circular check must NOT block this (C is not a descendant of B).
    it('move subtree into sibling (not circular)', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: a.id });
      const d = createDocument({ title: 'D', parentId: b.id });

      moveDocument(b.id, c.id, 0);

      expect(getDocumentById(b.id)!.parentId).toBe(c.id);
      expect(getDocumentById(d.id)!.parentId).toBe(b.id); // D follows B
      expect(getSortOrders(getDb(), a.id)).toEqual([0]); // only C remains under A
      expect(getSortOrders(getDb(), c.id)).toEqual([0]); // B is under C
    });

    // Reverse: now try to move C under B. This IS circular because C → B → D,
    // and B is C's child now.
    it('after nesting B under C, moving C under B is circular', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: a.id });
      createDocument({ title: 'D', parentId: b.id });

      moveDocument(b.id, c.id, 0);
      // Now: A → C → B → D

      expect(() => moveDocument(c.id, b.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );
      // Also can't move C under D (deeper descendant of B, which is under C)
      const d = getAllDocs(getDb()).find((doc) => doc.title === 'D')!;
      expect(() => moveDocument(c.id, d.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });

    // Nesting under a partially-restored subtree. Trash grandparent (cascades),
    // manually un-trash the middle node, then try to nest something under it.
    // The middle node's parent is still trashed, making the middle node a "zombie"
    // (active but under a trashed parent). BUG: moveDocument should reject this.
    // TODO: validate entire ancestor chain is not trashed in moveDocument
    it.todo('nesting under a zombie node (active but under trashed parent) should be rejected');

    // getDescendantIds includes trashed descendants in the circular check.
    // This means you can't move a node under its own trashed child.
    // Verify this behavior: A → B, trash B, try A → B should still be blocked.
    it('circular check includes trashed descendants', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });

      trashDocument(b.id);

      // B is trashed but still structurally a child of A.
      // getDescendantIds traverses all children regardless of deletedAt.
      // So moving A under B should detect the cycle.
      expect(() => moveDocument(a.id, b.id, 0)).toThrow(
        'Cannot move document into its descendant',
      );
    });

    // Build a deep chain, then reverse the entire hierarchy:
    // Start: A → B → C → D → E
    // Goal: E → D → C → B → A
    // Each step must pass the circular check because we're unnesting first.
    it('fully reverse a 5-level hierarchy', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });
      const d = createDocument({ title: 'D', parentId: c.id });
      const e = createDocument({ title: 'E', parentId: d.id });

      // Step 1: Unnest E to root
      moveDocument(e.id, null, 0);
      // Step 2: Unnest D to root, then nest under E
      moveDocument(d.id, null, 0);
      moveDocument(d.id, e.id, 0);
      // Step 3: Unnest C to root, then nest under D
      moveDocument(c.id, null, 0);
      moveDocument(c.id, d.id, 0);
      // Step 4: Unnest B to root, then nest under C
      moveDocument(b.id, null, 0);
      moveDocument(b.id, c.id, 0);
      // Step 5: Nest A under B
      moveDocument(a.id, b.id, 0);

      // Verify reversed chain: E → D → C → B → A
      expect(getDocumentById(e.id)!.parentId).toBeNull();
      expect(getDocumentById(d.id)!.parentId).toBe(e.id);
      expect(getDocumentById(c.id)!.parentId).toBe(d.id);
      expect(getDocumentById(b.id)!.parentId).toBe(c.id);
      expect(getDocumentById(a.id)!.parentId).toBe(b.id);
    });

    // After reversing, the circular check must use the NEW hierarchy.
    // E is now the root. Moving E under A should be circular.
    it('circular check uses reversed hierarchy after full reversal', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });
      const d = createDocument({ title: 'D', parentId: c.id });
      const e = createDocument({ title: 'E', parentId: d.id });

      // Reverse: E → D → C → B → A
      moveDocument(e.id, null, 0);
      moveDocument(d.id, null, 0);
      moveDocument(d.id, e.id, 0);
      moveDocument(c.id, null, 0);
      moveDocument(c.id, d.id, 0);
      moveDocument(b.id, null, 0);
      moveDocument(b.id, c.id, 0);
      moveDocument(a.id, b.id, 0);

      // Now E → D → C → B → A. Moving E under ANY of its descendants should fail.
      expect(() => moveDocument(e.id, d.id, 0)).toThrow('Cannot move document into its descendant');
      expect(() => moveDocument(e.id, c.id, 0)).toThrow('Cannot move document into its descendant');
      expect(() => moveDocument(e.id, b.id, 0)).toThrow('Cannot move document into its descendant');
      expect(() => moveDocument(e.id, a.id, 0)).toThrow('Cannot move document into its descendant');
    });

    // Multiple children at each level. Parent has 3 children, each child has 2 children.
    // Trash parent — all 9 nodes (1 + 3 + 6 = but we only build 2 levels below root = 1 + 3 + 6 = 10
    // nodes minus 1 root... let's be precise) should be trashed.
    // Then unnest one of the children (with its own children) to root.
    it('trash wide tree then selectively restore one branch to root', () => {
      const root = createDocument({ title: 'Root' });
      const c1 = createDocument({ title: 'C1', parentId: root.id });
      const c2 = createDocument({ title: 'C2', parentId: root.id });
      const c3 = createDocument({ title: 'C3', parentId: root.id });
      createDocument({ title: 'C1a', parentId: c1.id });
      createDocument({ title: 'C1b', parentId: c1.id });
      createDocument({ title: 'C2a', parentId: c2.id });
      createDocument({ title: 'C2b', parentId: c2.id });
      createDocument({ title: 'C3a', parentId: c3.id });
      createDocument({ title: 'C3b', parentId: c3.id });

      const { trashedIds } = trashDocument(root.id);
      expect(trashedIds).toHaveLength(10); // root + 3 children + 6 grandchildren

      // Selectively restore just C2 (and its children C2a, C2b)
      const result = restoreDocument(c2.id);
      expect(result.restoredIds).toContain(c2.id);

      // C2 is restored but still has parentId = root.id. Root is still trashed.
      // Move C2 to root to make it truly accessible.
      moveDocument(c2.id, null, 0);
      expect(getDocumentById(c2.id)!.parentId).toBeNull();
      expect(getDocumentById(c2.id)!.deletedAt).toBeNull();
    });

    // Nesting a doc that already has deeply nested children.
    // Verify the entire deep subtree follows the parent through multiple nesting operations.
    it('deep subtree follows parent through multiple re-nesting operations', () => {
      const folder1 = createDocument({ title: 'F1' });
      const folder2 = createDocument({ title: 'F2' });

      // Build chain: P → A → B → C → D
      const p = createDocument({ title: 'P' });
      const a = createDocument({ title: 'A', parentId: p.id });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });
      const d = createDocument({ title: 'D', parentId: c.id });

      // Nest P under folder1
      moveDocument(p.id, folder1.id, 0);
      // Nest P under folder2
      moveDocument(p.id, folder2.id, 0);
      // Unnest P back to root
      moveDocument(p.id, null, 0);

      // The entire chain should be intact regardless of P's parent changes
      expect(getDocumentById(a.id)!.parentId).toBe(p.id);
      expect(getDocumentById(b.id)!.parentId).toBe(a.id);
      expect(getDocumentById(c.id)!.parentId).toBe(b.id);
      expect(getDocumentById(d.id)!.parentId).toBe(c.id);
    });

    // Attempt a "rotation": In a chain A → B → C, move A under C (circular),
    // then move B under C (valid since B is C's parent, not ancestor of C... wait,
    // B IS C's parent, so C is B's descendant). Actually B → C, so moving B under C
    // is circular. Let's instead: move C to root, then B under C, then A under B.
    // This "rotates" the chain. Then try the original circular move.
    it('rotation: rebuild chain in new order, then verify circular checks', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });

      // Can't do A under C directly (circular)
      expect(() => moveDocument(a.id, c.id, 0)).toThrow();

      // Rotate: C → B → A
      moveDocument(c.id, null, 0); // C to root
      moveDocument(b.id, c.id, 0); // B under C
      moveDocument(a.id, b.id, 0); // A under B

      // Now C → B → A. Original direction checks should be reversed.
      expect(() => moveDocument(c.id, b.id, 0)).toThrow('Cannot move document into its descendant');
      expect(() => moveDocument(c.id, a.id, 0)).toThrow('Cannot move document into its descendant');

      // But A can now go to root (always valid)
      moveDocument(a.id, null, 0);
      expect(getDocumentById(a.id)!.parentId).toBeNull();
    });

    // Two separate chains that get connected, then attempt circular moves across
    // the join point. Chain 1: A → B. Chain 2: C → D. Connect: B → C (move C under B).
    // Now A → B → C → D. Moving D under A should be circular.
    it('connecting two chains creates circular constraints across the join', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C' });
      const d = createDocument({ title: 'D', parentId: c.id });

      // Connect: move C under B → A → B → C → D
      moveDocument(c.id, b.id, 0);

      // D is a descendant of A through the connected chain
      expect(() => moveDocument(a.id, d.id, 0)).toThrow('Cannot move document into its descendant');
      // B is a descendant of A
      expect(() => moveDocument(a.id, b.id, 0)).toThrow('Cannot move document into its descendant');
      // C is a descendant of A (through B)
      expect(() => moveDocument(a.id, c.id, 0)).toThrow('Cannot move document into its descendant');

      // But D can be moved to root (breaking the chain at the tail)
      moveDocument(d.id, null, 0);
      // Now A → B → C, D at root. Moving A under D should work now.
      moveDocument(a.id, d.id, 0);
      expect(getDocumentById(a.id)!.parentId).toBe(d.id);
    });

    // Nesting with multiple children: parent has 5 children, nest one child
    // under a sibling. The sibling's children should be unaffected.
    it('nest child under sibling preserves sibling existing children', () => {
      const parent = createDocument({ title: 'Parent' });
      const c1 = createDocument({ title: 'C1', parentId: parent.id });
      const c2 = createDocument({ title: 'C2', parentId: parent.id });
      createDocument({ title: 'C3', parentId: parent.id });
      // C2 already has a child
      const c2child = createDocument({ title: 'C2-child', parentId: c2.id });

      // Nest C1 under C2 (C2 already has C2-child)
      moveDocument(c1.id, c2.id, 0);

      // C2 now has 2 children: C1(0), C2-child(1)
      expect(getSortOrders(getDb(), c2.id)).toEqual([0, 1]);
      expect(getDocumentById(c1.id)!.parentId).toBe(c2.id);
      expect(getDocumentById(c2child.id)!.parentId).toBe(c2.id);
      // Parent lost C1, down to C3 and C2
      expect(getSortOrders(getDb(), parent.id)).toEqual([0, 1]);
    });

    // Deeply nested circular attempt via multiple levels.
    // Build: A → B → C → D → E → F. Try to nest A under F. Should fail.
    // Then break the chain at C (move C to root). Now A → B, C → D → E → F.
    // Moving A under F should now succeed.
    it('breaking a deep chain removes circular constraint', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });
      const d = createDocument({ title: 'D', parentId: c.id });
      const e = createDocument({ title: 'E', parentId: d.id });
      const f = createDocument({ title: 'F', parentId: e.id });

      // Can't nest A under F (F is a descendant)
      expect(() => moveDocument(a.id, f.id, 0)).toThrow('Cannot move document into its descendant');

      // Break chain: move C to root
      moveDocument(c.id, null, 0);
      // Now: A → B (at root), C → D → E → F (at root)

      // A under F should now work (F is no longer A's descendant)
      moveDocument(a.id, f.id, 0);
      expect(getDocumentById(a.id)!.parentId).toBe(f.id);
      // B followed A
      expect(getDocumentById(b.id)!.parentId).toBe(a.id);
    });

    // Nest same doc at every level of a deep chain (top, middle, bottom, back to top).
    // Verifies sortOrder consistency at every level after each move.
    it('wandering node through a 10-level chain maintains sortOrder integrity', () => {
      // Build chain: L0 → L1 → L2 → ... → L9
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const doc = createDocument({
          title: `L${i}`,
          parentId: i > 0 ? ids[i - 1] : undefined,
        });
        ids.push(doc.id);
      }

      // Create a wandering node at root
      const wanderer = createDocument({ title: 'Wanderer' });

      // Move wanderer into level 0 (under L0's parent = root peer → under L0)
      moveDocument(wanderer.id, ids[0], 0);
      expect(getDocumentById(wanderer.id)!.parentId).toBe(ids[0]);

      // Move to level 5
      moveDocument(wanderer.id, ids[5], 0);
      expect(getDocumentById(wanderer.id)!.parentId).toBe(ids[5]);
      // L0 lost the wanderer
      expect(getSortOrders(getDb(), ids[0]).length).toBe(1); // only L1

      // Move to level 9 (deepest)
      moveDocument(wanderer.id, ids[9], 0);
      expect(getDocumentById(wanderer.id)!.parentId).toBe(ids[9]);

      // Move back to root
      moveDocument(wanderer.id, null, 0);
      expect(getDocumentById(wanderer.id)!.parentId).toBeNull();
      expect(getSortOrders(getDb(), ids[9])).toEqual([]); // L9 lost wanderer
    });

    // Two siblings swap parent-child relationship.
    // A and B are siblings at root. Nest A under B, then try B under A (circular).
    // Unnest A, nest B under A, then try A under B (circular).
    it('sibling swap: alternating parent-child role between two docs', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B' });

      // A under B
      moveDocument(a.id, b.id, 0);
      expect(() => moveDocument(b.id, a.id, 0)).toThrow('Cannot move document into its descendant');

      // Undo: A back to root
      moveDocument(a.id, null, 0);

      // B under A
      moveDocument(b.id, a.id, 0);
      expect(() => moveDocument(a.id, b.id, 0)).toThrow('Cannot move document into its descendant');

      // Undo again
      moveDocument(b.id, null, 0);

      // Both back at root, both moves should work again
      moveDocument(a.id, b.id, 0);
      expect(getDocumentById(a.id)!.parentId).toBe(b.id);
    });

    // Trash a deep subtree, unnest a mid-level node out, then verify the
    // trashed descendants below it are still trashed (subtree doesn't auto-restore on move).
    it('moving a node out of a trashed subtree does not restore its trashed children', () => {
      const a = createDocument({ title: 'A' });
      const b = createDocument({ title: 'B', parentId: a.id });
      const c = createDocument({ title: 'C', parentId: b.id });
      const d = createDocument({ title: 'D', parentId: c.id });

      trashDocument(a.id);

      // Manually un-trash B (simulating selective restore)
      getDb().prepare(`UPDATE documents SET deletedAt = NULL WHERE id = ?`).run(b.id);

      // Move B to root
      moveDocument(b.id, null, 0);

      // B is at root, but C and D should still be trashed
      expect(getDocumentById(b.id)!.parentId).toBeNull();
      expect(getDocumentById(b.id)!.deletedAt).toBeNull();
      expect(getDocumentById(c.id)!.deletedAt).not.toBeNull();
      expect(getDocumentById(d.id)!.deletedAt).not.toBeNull();
    });

    // Nest doc under a leaf that has no children yet, then nest another doc
    // under the same leaf. Both should have contiguous sortOrders.
    it('nesting two docs under a previously childless node produces [0,1]', () => {
      const leaf = createDocument({ title: 'Leaf' });
      const x = createDocument({ title: 'X' });
      const y = createDocument({ title: 'Y' });

      moveDocument(x.id, leaf.id, 0);
      moveDocument(y.id, leaf.id, 0);

      expect(getSortOrders(getDb(), leaf.id)).toEqual([0, 1]);
      expect(getDocumentById(y.id)!.sortOrder).toBe(0); // y was moved to position 0
      expect(getDocumentById(x.id)!.sortOrder).toBe(1); // x shifted to 1
    });
});
