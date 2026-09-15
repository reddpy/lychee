import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import { setupDb } from './setup';
import {
  appendDocumentUpdate,
  compactDocument,
  loadDocumentUpdates,
  pendingUpdateCount,
  removeDocumentCrdt,
} from '../../repos/crdt';

/** Bytes of each stored update, for easy assertions. */
function bytes(id: string): number[][] {
  return loadDocumentUpdates(id).map((buf) => [...buf]);
}

describe('crdt persistence', () => {
  setupDb();

  it('appends updates and loads them oldest-first', () => {
    appendDocumentUpdate('a', Buffer.from([1]));
    appendDocumentUpdate('a', Buffer.from([2, 3]));
    expect(bytes('a')).toEqual([[1], [2, 3]]);
    expect(pendingUpdateCount('a')).toBe(2);
  });

  it('compaction folds the log into a snapshot and truncates it', () => {
    appendDocumentUpdate('a', Buffer.from([1]));
    appendDocumentUpdate('a', Buffer.from([2]));
    compactDocument('a', Buffer.from([9, 9, 9]));
    expect(bytes('a')).toEqual([[9, 9, 9]]);
    expect(pendingUpdateCount('a')).toBe(0);

    // Subsequent appends land after the snapshot.
    appendDocumentUpdate('a', Buffer.from([4]));
    expect(bytes('a')).toEqual([[9, 9, 9], [4]]);
  });

  it('remove clears snapshot and log', () => {
    appendDocumentUpdate('a', Buffer.from([1]));
    compactDocument('a', Buffer.from([9]));
    removeDocumentCrdt('a');
    expect(bytes('a')).toEqual([]);
  });

  it('keeps notes isolated', () => {
    appendDocumentUpdate('a', Buffer.from([1]));
    appendDocumentUpdate('b', Buffer.from([2]));
    expect(bytes('a')).toEqual([[1]]);
    expect(bytes('b')).toEqual([[2]]);
  });

  it('returns nothing for an unknown note', () => {
    expect(bytes('missing')).toEqual([]);
  });
});
