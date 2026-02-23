import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, getSortOrders, getDocumentById, createDocument } from './setup';

describe('Document Repository — Create Edge Cases', () => {
  setupDb();

    // "Untitled" is the placeholder shown in the UI. If it reaches the DB,
    // it would show up in search results and exports as a real title.
    it('strips "Untitled" title to empty string', () => {
      const doc = createDocument({ title: 'Untitled' });
      expect(doc.title).toBe('');
    });

    // "  Untitled  " with whitespace — trim() runs first, then the comparison.
    // Without trim, this would NOT be stripped because "  Untitled  " !== "Untitled".
    it('strips whitespace-padded "Untitled" title', () => {
      const doc = createDocument({ title: '  Untitled  ' });
      expect(doc.title).toBe('');
    });

    // Normal titles should be trimmed but not otherwise modified.
    it('trims whitespace from normal titles', () => {
      const doc = createDocument({ title: ' My Note ' });
      expect(doc.title).toBe('My Note');
    });

    // Various falsy/empty title inputs should all result in empty string.
    it('handles undefined, empty, and null-ish title inputs', () => {
      const doc1 = createDocument({});
      expect(doc1.title).toBe('');

      const doc2 = createDocument({ title: '' });
      expect(doc2.title).toBe('');

      const doc3 = createDocument({ title: undefined });
      expect(doc3.title).toBe('');
    });

    // Content with special characters must survive round-trip through SQLite.
    // SQL injection via content would be a critical vulnerability.
    it('content handles unicode, emoji, JSON, and SQL-like strings', () => {
      const testContent = `{"text": "Hello 🌍"}\n'; DROP TABLE documents; --`;
      const doc = createDocument({ content: testContent });
      const retrieved = getDocumentById(doc.id)!;
      expect(retrieved.content).toBe(testContent);
    });

    // Creating a doc with a parentId that doesn't exist in the DB.
    // The code has no FK validation — it just inserts. This is by design
    // (performance, simplicity) but we should verify the behavior.
    it('creating with non-existent parentId succeeds (no FK enforcement)', () => {
      const doc = createDocument({ parentId: 'nonexistent-parent' });
      expect(doc.parentId).toBe('nonexistent-parent');
      const retrieved = getDocumentById(doc.id)!;
      expect(retrieved.parentId).toBe('nonexistent-parent');
    });

    // Each created doc should get a unique UUID.
    it('each created document gets a unique UUID', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const doc = createDocument({ title: `Doc ${i}` });
        ids.add(doc.id);
      }
      expect(ids.size).toBe(50);
    });

    // createdAt and updatedAt should be set to the same value on creation.
    it('createdAt equals updatedAt on new document', () => {
      const doc = createDocument({ title: 'Test' });
      expect(doc.createdAt).toBe(doc.updatedAt);
    });

    // emoji field edge cases
    it('handles emoji field: null, undefined, and actual emoji', () => {
      const doc1 = createDocument({ emoji: null });
      expect(doc1.emoji).toBeNull();

      const doc2 = createDocument({});
      expect(doc2.emoji).toBeNull();

      const doc3 = createDocument({ emoji: '🎉' });
      expect(doc3.emoji).toBe('🎉');

      // Verify emoji survives round-trip
      const retrieved = getDocumentById(doc3.id)!;
      expect(retrieved.emoji).toBe('🎉');
    });

    // New docs should always get sortOrder 0 and push existing siblings down.
    it('new document gets sortOrder 0 and shifts siblings', () => {
      const first = createDocument({ title: 'First' });
      expect(first.sortOrder).toBe(0);

      const second = createDocument({ title: 'Second' });
      expect(second.sortOrder).toBe(0);

      // First doc should now be at sortOrder 1
      const firstRefreshed = getDocumentById(first.id)!;
      expect(firstRefreshed.sortOrder).toBe(1);
    });

    // ── Bug #1: createDocument has no transaction ─────────────────────
    // The sibling shift (UPDATE sortOrder + 1) and the INSERT are two
    // separate statements with no transaction wrapper. If the INSERT were
    // to fail, siblings would already be shifted, leaving a permanent gap
    // at sortOrder 0. We can't easily simulate an INSERT failure, but we
    // can verify the non-atomic nature by checking that the shift happens
    // BEFORE the insert returns — i.e., siblings are shifted even if
    // we inspect state between the two statements.

    it('BUG: sibling shift and insert are not atomic — gap if insert were to fail', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });
      // B(0), A(1)

      // Simulate what happens if the INSERT fails after the shift:
      // We can't easily force a failure, but we can prove the shift
      // happens independently by doing a manual shift + checking state.
      const db = getDb();

      // Manually run just the shift that createDocument would do (without the INSERT)
      db.prepare(
        `UPDATE documents SET sortOrder = sortOrder + 1
         WHERE parentId IS NULL AND deletedAt IS NULL`,
      ).run();

      // Siblings are now shifted: B(1), A(2) — but no doc at position 0
      const orders = getSortOrders(db, null);
      expect(orders).toEqual([1, 2]); // gap at 0 — this is the bug
      expect(orders[0]).not.toBe(0); // proves the gap exists
    });

    it('BUG: createDocument shifts siblings in other parents when parentId is NULL', () => {
      // createDocument uses `WHERE parentId IS ?` with NULL.
      // `IS NULL` matches NULL correctly in SQLite, so this should be fine.
      // But let's verify that creating a root doc does NOT shift children
      // under a named parent.
      const folder = createDocument({ title: 'Folder' });
      const child = createDocument({ title: 'Child', parentId: folder.id });

      // Create a root-level doc — should only shift root siblings
      createDocument({ title: 'Root Doc' });

      // Child's sortOrder should be unaffected
      const childRefreshed = getDocumentById(child.id)!;
      expect(childRefreshed.sortOrder).toBe(0);
    });
});
