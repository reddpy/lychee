import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import {
  setupDb,
  getDb,
  createDocument,
  updateDocument,
  getDocumentById,
  listDocuments,
  trashDocument,
  restoreDocument,
  moveDocument,
  getSortOrders,
} from './setup';

function assertContiguous(orders: number[]) {
  expect(orders).toEqual(Array.from({ length: orders.length }, (_, i) => i));
}

describe('Document Repository — Race & Consistency Contracts', () => {
  setupDb();

  it('rapid interleaved update/list cycles never return malformed or duplicate rows', () => {
    const docs = Array.from({ length: 25 }, (_, i) =>
      createDocument({ title: `Interleave ${i}`, content: `v0-${i}` }),
    );

    for (let i = 0; i < 150; i += 1) {
      const target = docs[i % docs.length];
      updateDocument(target.id, {
        title: `Interleave ${target.id.slice(0, 6)}-${i}`,
        content: `payload-${i}`,
      });

      const listed = listDocuments({ limit: 500, offset: 0 });
      const ids = listed.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const row of listed) {
        expect(typeof row.id).toBe('string');
        expect(typeof row.title).toBe('string');
        expect(typeof row.content).toBe('string');
        expect(Number.isInteger(row.sortOrder)).toBe(true);
        expect(row.deletedAt).toBeNull();
      }
    }
  });

  it('read-after-write: immediate get/list reflects latest update in tight loop', () => {
    const doc = createDocument({ title: 'Read-after-write target', content: 'v0' });

    let lastUpdatedAt = '';
    for (let i = 1; i <= 80; i += 1) {
      const content = `version-${i}`;
      const updated = updateDocument(doc.id, { content });
      expect(updated.content).toBe(content);
      if (lastUpdatedAt) {
        expect(updated.updatedAt >= lastUpdatedAt).toBe(true);
      }
      lastUpdatedAt = updated.updatedAt;

      const fetched = getDocumentById(doc.id)!;
      expect(fetched.content).toBe(content);
      const fromList = listDocuments({ limit: 500, offset: 0 }).find((d) => d.id === doc.id)!;
      expect(fromList.content).toBe(content);
    }
  });

  it('trash/restore/update churn keeps document state coherent', () => {
    const doc = createDocument({ title: 'Churn target', content: 'start' });

    for (let i = 0; i < 20; i += 1) {
      updateDocument(doc.id, { content: `pre-trash-${i}` });
      const trashed = trashDocument(doc.id);
      expect(trashed.trashedIds).toContain(doc.id);
      expect(getDocumentById(doc.id)!.deletedAt).not.toBeNull();

      const restored = restoreDocument(doc.id);
      expect(restored.restoredIds).toContain(doc.id);
      expect(getDocumentById(doc.id)!.deletedAt).toBeNull();

      updateDocument(doc.id, { content: `post-restore-${i}` });
      const fetched = getDocumentById(doc.id)!;
      expect(fetched.deletedAt).toBeNull();
      expect(fetched.content).toBe(`post-restore-${i}`);
    }
  });

  it('rapid moves of same document across parents preserve valid tree and sort-order contiguity', () => {
    const parentA = createDocument({ title: 'Parent A' });
    const parentB = createDocument({ title: 'Parent B' });
    const parentC = createDocument({ title: 'Parent C' });

    const moving = createDocument({ title: 'Moving child', parentId: parentA.id });
    for (let i = 0; i < 12; i += 1) {
      moveDocument(moving.id, parentB.id, 0);
      moveDocument(moving.id, parentC.id, 0);
      moveDocument(moving.id, parentA.id, 0);
    }

    const finalDoc = getDocumentById(moving.id)!;
    expect([parentA.id, parentB.id, parentC.id]).toContain(finalDoc.parentId);

    assertContiguous(getSortOrders(getDb(), parentA.id));
    assertContiguous(getSortOrders(getDb(), parentB.id));
    assertContiguous(getSortOrders(getDb(), parentC.id));
  });

  it('burst creates under same parent keep contiguous sort orders with no gaps', async () => {
    const parent = createDocument({ title: 'Burst parent' });
    await Promise.all(
      Array.from({ length: 180 }, (_, i) =>
        Promise.resolve().then(() =>
          createDocument({ title: `Burst child ${i}`, parentId: parent.id }),
        ),
      ),
    );

    const orders = getSortOrders(getDb(), parent.id);
    expect(orders).toHaveLength(180);
    assertContiguous(orders);
  });

  it('large payload update bursts remain readable and intact via list/get', () => {
    const doc = createDocument({ title: 'Large payload target', content: '' });
    const chunk = 'alpha-beta-gamma-0123456789 '.repeat(2000);

    for (let i = 0; i < 12; i += 1) {
      const payload = `${chunk}::v${i}`;
      updateDocument(doc.id, { content: payload });
      expect(getDocumentById(doc.id)!.content.endsWith(`::v${i}`)).toBe(true);
      const listed = listDocuments({ limit: 500, offset: 0 }).find((d) => d.id === doc.id)!;
      expect(listed.content.endsWith(`::v${i}`)).toBe(true);
      expect(listed.content.length).toBe(payload.length);
    }
  });

  it('update/trash interleaving on different docs keeps final list membership coherent', () => {
    const docs = Array.from({ length: 12 }, (_, i) =>
      createDocument({ title: `Membership ${i}`, content: `v0-${i}` }),
    );
    const trashedIds = new Set<string>();

    for (let i = 0; i < docs.length; i += 1) {
      if (i % 3 === 0) {
        trashDocument(docs[i].id);
        trashedIds.add(docs[i].id);
      } else {
        updateDocument(docs[i].id, { content: `updated-${i}` });
      }
    }

    const active = listDocuments({ limit: 500, offset: 0 });
    const activeIds = new Set(active.map((d) => d.id));
    for (const id of trashedIds) {
      expect(activeIds.has(id)).toBe(false);
      expect(getDocumentById(id)!.deletedAt).not.toBeNull();
    }
    for (const doc of docs) {
      if (!trashedIds.has(doc.id)) {
        expect(activeIds.has(doc.id)).toBe(true);
      }
    }
  });
});
