/**
 * Shared setup for all URL resolver test files.
 *
 * Provides DB lifecycle, mockFetch reference, and re-exports.
 *
 * IMPORTANT: Each test file must also include these vi.mock() calls
 * at the top level (Vitest hoists them, so they must be in the test file):
 *
 *   const mockFetch = vi.fn();
 *   vi.mock('electron', () => ({
 *     app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
 *     net: { fetch: (...args: unknown[]) => mockFetch(...args) },
 *   }));
 *   vi.mock('fs', () => ({
 *     default: { mkdirSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn() },
 *   }));
 *   import { getTestDb } from '../helpers';
 *   vi.mock('../../db', () => ({ getDb: () => getTestDb() }));
 */

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, closeTestDb } from '../helpers';
import { resolveUrl } from '../../repos/url-resolver';

// Mutable ref that each beforeEach updates
let db: BetterSqlite3Database;

function setupResolverDb() {
  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });
  afterEach(() => {
    closeTestDb();
  });
}

function getDb() {
  return db;
}

export { setupResolverDb, getDb, resolveUrl };
