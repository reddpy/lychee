/**
 * Shared setup for all document test files.
 *
 * Each test file imports this to get:
 * - All document repo functions
 * - beforeEach/afterEach DB lifecycle
 * - The `db` reference for direct SQL assertions
 *
 * IMPORTANT: Each test file must also include these vi.mock() calls
 * at the top level (Vitest hoists them, so they must be in the test file):
 *
 *   vi.mock('electron', () => ({
 *     app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
 *   }));
 *   vi.mock('../../db', () => ({
 *     getDb: () => getTestDb(),
 *   }));
 */

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { beforeEach, afterEach } from 'vitest';
import {
  createTestDb,
  closeTestDb,
  getTestDb,
  insertDoc,
  getAllDocs,
  getSortOrders,
  getAllDocsForParent,
} from '../helpers';

import {
  listDocuments,
  listTrashedDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  trashDocument,
  restoreDocument,
  permanentDeleteDocument,
  moveDocument,
} from '../../repos/documents';

// Mutable ref that each beforeEach updates
let db: BetterSqlite3Database;

function setupDb() {
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    closeTestDb();
  });
}

function getDb() {
  return db;
}

export {
  setupDb,
  getDb,
  getTestDb,
  insertDoc,
  getAllDocs,
  getSortOrders,
  getAllDocsForParent,
  listDocuments,
  listTrashedDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  trashDocument,
  restoreDocument,
  permanentDeleteDocument,
  moveDocument,
};
