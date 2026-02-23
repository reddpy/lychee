/**
 * Shared setup for all image test files.
 *
 * Each test file imports this to get:
 * - All image repo functions
 * - beforeEach/afterEach DB lifecycle + mock clearing
 * - The `db` reference for direct SQL assertions
 * - `fs` and `net` mock references
 *
 * IMPORTANT: Each test file must also include these vi.mock() calls
 * at the top level (Vitest hoists them, so they must be in the test file):
 *
 *   vi.mock('electron', () => ({
 *     app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
 *     net: { fetch: vi.fn() },
 *   }));
 *   vi.mock('fs', () => ({
 *     default: {
 *       mkdirSync: vi.fn(),
 *       writeFileSync: vi.fn(),
 *       unlinkSync: vi.fn(),
 *     },
 *     mkdirSync: vi.fn(),
 *     writeFileSync: vi.fn(),
 *     unlinkSync: vi.fn(),
 *   }));
 *   vi.mock('../../db', () => ({
 *     getDb: () => getTestDb(),
 *   }));
 */

import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, closeTestDb, getTestDb } from '../helpers';

import {
  saveImage,
  getImagePath,
  downloadImage,
  deleteImage,
} from '../../repos/images';

import _fs from 'fs';
import { net as _net } from 'electron';

// Re-export the typed mock references
const fs = _fs;
const net = _net;

// Mutable ref that each beforeEach updates
let db: BetterSqlite3Database;

function setupImageDb() {
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

export {
  setupImageDb,
  getDb,
  getTestDb,
  fs,
  net,
  saveImage,
  getImagePath,
  downloadImage,
  deleteImage,
};
