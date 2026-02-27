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

/** Minimal valid magic byte headers for each supported MIME type. */
const MAGIC_HEADERS: Record<string, Buffer> = {
  'image/png': Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  'image/jpeg': Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
  'image/gif': Buffer.from('GIF89a'),
  'image/webp': Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
};

/** Create a buffer with valid magic bytes for the given MIME type, optionally with extra payload. */
function validImageBuffer(mime: string, extra?: string | number): Buffer {
  const header = MAGIC_HEADERS[mime];
  if (!header) throw new Error(`No magic header for ${mime}`);
  if (extra === undefined) return header;
  const suffix = typeof extra === 'number'
    ? Buffer.alloc(extra, 0xAB)
    : Buffer.from(extra);
  return Buffer.concat([header, suffix]);
}

/** Base64-encoded valid image data for the given MIME type. */
function validImageBase64(mime: string, extra?: string | number): string {
  return validImageBuffer(mime, extra).toString('base64');
}

/** Create an ArrayBuffer (for mock download responses) with valid magic bytes. */
function validImageArrayBuffer(mime: string, extra?: string | number): ArrayBuffer {
  const buf = validImageBuffer(mime, extra);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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
  validImageBase64,
  validImageBuffer,
  validImageArrayBuffer,
};
