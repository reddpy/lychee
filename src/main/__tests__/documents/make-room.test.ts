import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb, importDocument, listDocuments, trashDocument } from './setup';
import { makeRoomForNewDocument } from '../../repos/documents';

function orders(): Record<string, number> {
  return Object.fromEntries(listDocuments({ limit: 50 }).map((row) => [row.id, row.sortOrder]));
}

describe('makeRoomForNewDocument', () => {
  setupDb();

  it('shifts every live sibling at or below the position down by one', () => {
    importDocument({ id: 'a', title: 'A', content: '', sortOrder: 0 });
    importDocument({ id: 'b', title: 'B', content: '', sortOrder: 1 });
    importDocument({ id: 'c', title: 'C', content: '', sortOrder: 2 });

    makeRoomForNewDocument(null, 0);
    expect(orders()).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('only shifts siblings at or below the requested position', () => {
    importDocument({ id: 'a', title: 'A', content: '', sortOrder: 0 });
    importDocument({ id: 'b', title: 'B', content: '', sortOrder: 1 });
    importDocument({ id: 'c', title: 'C', content: '', sortOrder: 2 });

    makeRoomForNewDocument(null, 2);
    expect(orders()).toEqual({ a: 0, b: 1, c: 3 });
  });

  it('scopes the shift to the given parent', () => {
    importDocument({ id: 'root', title: 'Root', content: '', sortOrder: 0 });
    importDocument({ id: 'child', title: 'Child', content: '', parentId: 'root', sortOrder: 0 });

    makeRoomForNewDocument('root', 0);
    expect(orders()).toEqual({ root: 0, child: 1 });
  });

  it('ignores trashed siblings', () => {
    importDocument({ id: 'live', title: 'Live', content: '', sortOrder: 0 });
    importDocument({ id: 'gone', title: 'Gone', content: '', sortOrder: 1 });
    trashDocument('gone');

    makeRoomForNewDocument(null, 0);
    // `listDocuments` excludes trashed rows; the live sibling still shifted.
    expect(orders()).toEqual({ live: 1 });
  });

  it('is a no-op on an empty parent', () => {
    expect(() => makeRoomForNewDocument(null, 0)).not.toThrow();
    expect(orders()).toEqual({});
  });
});
