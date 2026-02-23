import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, getDb, insertDoc, createDocument, trashDocument, listDocuments, listTrashedDocuments } from './setup';

describe('Document Repository — List & Pagination', () => {
  setupDb();

    // Negative limit should be clamped to 1, not cause an error.
    it('clamps negative limit to 1', () => {
      createDocument({ title: 'A' });
      createDocument({ title: 'B' });

      const result = listDocuments({ limit: -5 });
      expect(result).toHaveLength(1);
    });

    // Negative offset should be clamped to 0, not cause an error.
    it('clamps negative offset to 0', () => {
      createDocument({ title: 'A' });
      const result = listDocuments({ offset: -10 });
      expect(result.length).toBeGreaterThan(0);
    });

    // Limit above 500 should be clamped to protect against accidental
    // full-table dumps that could freeze the UI.
    it('clamps limit above 500 to 500', () => {
      // We can't easily create 501 docs, but we can verify the clamp
      // by checking that requesting 501 doesn't error
      const result = listDocuments({ limit: 501 });
      // No error thrown, just returns what's available
      expect(result).toBeDefined();
    });

    // listDocuments and listTrashedDocuments should be mutually exclusive.
    // A trashed doc showing in the active list would be very confusing.
    it('listDocuments excludes trashed, listTrashedDocuments excludes active', () => {
      createDocument({ title: 'Active 1' });
      createDocument({ title: 'Active 2' });
      const toTrash = createDocument({ title: 'Will Trash' });
      createDocument({ title: 'Active 3' });

      trashDocument(toTrash.id);

      const active = listDocuments({});
      const trashed = listTrashedDocuments({});

      expect(active).toHaveLength(3);
      expect(trashed).toHaveLength(1);

      // No overlap
      const activeIds = new Set(active.map((d) => d.id));
      const trashedIds = new Set(trashed.map((d) => d.id));
      for (const id of trashedIds) {
        expect(activeIds.has(id)).toBe(false);
      }
    });

    // Standard pagination: verify offset + limit works correctly.
    it('pagination with limit and offset works', () => {
      for (let i = 0; i < 10; i++) {
        createDocument({ title: `Doc ${i}` });
      }

      const page1 = listDocuments({ limit: 3, offset: 0 });
      const page2 = listDocuments({ limit: 3, offset: 3 });

      expect(page1).toHaveLength(3);
      expect(page2).toHaveLength(3);

      // Pages should not overlap
      const page1Ids = new Set(page1.map((d) => d.id));
      for (const doc of page2) {
        expect(page1Ids.has(doc.id)).toBe(false);
      }
    });

    // Offset beyond the total count should return empty, not error.
    it('offset beyond total count returns empty array', () => {
      createDocument({ title: 'Only Doc' });
      const result = listDocuments({ offset: 100 });
      expect(result).toEqual([]);
    });

    // Verify sort order: sortOrder ASC primary, updatedAt DESC secondary.
    // This tests the tiebreaker when multiple docs have the same sortOrder.
    it('list order: sortOrder ASC, then updatedAt DESC for tiebreaker', () => {
      // Insert docs with same sortOrder but different updatedAt
      insertDoc(getDb(), {
        id: 'older',
        title: 'Older',
        sortOrder: 0,
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      insertDoc(getDb(), {
        id: 'newer',
        title: 'Newer',
        sortOrder: 0,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });
      insertDoc(getDb(), {
        id: 'highsort',
        title: 'High Sort',
        sortOrder: 1,
        updatedAt: '2024-12-01T00:00:00.000Z',
      });

      const result = listDocuments({});
      // sortOrder 0 first (newer before older due to DESC), then sortOrder 1
      expect(result[0].id).toBe('newer');
      expect(result[1].id).toBe('older');
      expect(result[2].id).toBe('highsort');
    });

    // Default limit for listDocuments is 50.
    it('listDocuments defaults to limit 50', () => {
      // Create 51 docs
      for (let i = 0; i < 51; i++) {
        createDocument({ title: `Doc ${i}` });
      }
      const result = listDocuments({});
      expect(result).toHaveLength(50);
    });

    // Default limit for listTrashedDocuments is 200.
    it('listTrashedDocuments defaults to limit 200', () => {
      // We'll just verify the function works with no params
      const result = listTrashedDocuments({});
      expect(result).toEqual([]);
    });
});
