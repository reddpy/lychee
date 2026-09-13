import { randomUUID, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDb } from '../db';

interface ImageRow {
  id: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  contentHash: string | null;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** SHA-256 of raw image bytes — the content address. */
export function contentHashOf(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function mimeToExtension(mimeType: string): string | undefined {
  return MIME_TO_EXT[mimeType];
}

export function extensionToMime(extension: string): string | undefined {
  return EXT_TO_MIME[extension.toLowerCase()];
}

/** Validate that the buffer starts with known magic bytes for the claimed MIME type. */
function validateMagicBytes(buf: Buffer, mimeType: string): void {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (mimeType === 'image/png') {
    if (buf.length < 8 ||
        buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47 ||
        buf[4] !== 0x0D || buf[5] !== 0x0A || buf[6] !== 0x1A || buf[7] !== 0x0A) {
      throw new Error('Content does not match image/png magic bytes');
    }
    return;
  }
  // JPEG: FF D8 FF
  if (mimeType === 'image/jpeg') {
    if (buf.length < 3 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) {
      throw new Error('Content does not match image/jpeg magic bytes');
    }
    return;
  }
  // GIF: "GIF87a" or "GIF89a"
  if (mimeType === 'image/gif') {
    if (buf.length < 6) {
      throw new Error('Content does not match image/gif magic bytes');
    }
    const sig = buf.toString('ascii', 0, 6);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') {
      throw new Error('Content does not match image/gif magic bytes');
    }
    return;
  }
  // WebP: "RIFF" at 0..3 and "WEBP" at 8..11
  if (mimeType === 'image/webp') {
    if (buf.length < 12 ||
        buf.toString('ascii', 0, 4) !== 'RIFF' ||
        buf.toString('ascii', 8, 12) !== 'WEBP') {
      throw new Error('Content does not match image/webp magic bytes');
    }
    return;
  }
}


function getImagesDir(): string {
  const dir = path.join(app.getPath('userData'), 'images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveImage(data: string, mimeType: string): { id: string; filePath: string } {
  // Strip data URL prefix if present (e.g. "data:image/png;base64,...")
  const base64 = data.includes(',') ? data.split(',')[1] : data;
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) {
    throw new Error('Image data is empty (zero bytes)');
  }
  return saveImageBuffer(buf, mimeType);
}

/**
 * Store raw image bytes. Computes the content hash up front so the vault can map
 * the image to a portable `assets/<hash>.<ext>` path.
 */
export function saveImageBuffer(buf: Buffer, mimeType: string): { id: string; filePath: string } {
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported image type: ${mimeType}`);
  if (buf.length === 0) throw new Error('Image data is empty (zero bytes)');

  validateMagicBytes(buf, mimeType);

  const id = randomUUID();
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(getImagesDir(), filename), buf);

  const db = getDb();
  db.prepare(
    `INSERT INTO images (id, filename, mimeType, createdAt, contentHash) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, filename, mimeType, new Date().toISOString(), contentHashOf(buf));

  return { id, filePath: filename };
}

/** Image metadata needed to materialize a vault asset (or resolve one back). */
export function getImage(
  id: string,
): { id: string; filename: string; mimeType: string; contentHash: string | null } | null {
  const row = getDb()
    .prepare(`SELECT id, filename, mimeType, contentHash FROM images WHERE id = ?`)
    .get(id) as Pick<ImageRow, 'id' | 'filename' | 'mimeType' | 'contentHash'> | undefined;
  return row ?? null;
}

export function findImageByContentHash(
  contentHash: string,
): { id: string; filename: string; mimeType: string } | null {
  const row = getDb()
    .prepare(`SELECT id, filename, mimeType FROM images WHERE contentHash = ?`)
    .get(contentHash) as Pick<ImageRow, 'id' | 'filename' | 'mimeType'> | undefined;
  return row ?? null;
}

export function setImageContentHash(id: string, contentHash: string): void {
  getDb().prepare(`UPDATE images SET contentHash = ? WHERE id = ?`).run(contentHash, id);
}

/** Read an image's bytes and return its content hash, backfilling the column. */
export function readImageForAsset(
  id: string,
): { buffer: Buffer; mimeType: string; contentHash: string } | null {
  const row = getDb()
    .prepare(`SELECT filename, mimeType, contentHash FROM images WHERE id = ?`)
    .get(id) as Pick<ImageRow, 'filename' | 'mimeType' | 'contentHash'> | undefined;
  if (!row) return null;

  const imagesDir = getImagesDir();
  const filePath = path.resolve(imagesDir, row.filename);
  if (!filePath.startsWith(path.resolve(imagesDir) + path.sep)) return null;

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }

  const contentHash = row.contentHash ?? contentHashOf(buffer);
  if (!row.contentHash) setImageContentHash(id, contentHash);
  return { buffer, mimeType: row.mimeType, contentHash };
}

export function getImagePath(id: string): { filePath: string } {
  const db = getDb();
  const row = db.prepare(`SELECT filename FROM images WHERE id = ?`).get(id) as ImageRow | undefined;
  if (!row) throw new Error(`Image not found: ${id}`);
  return { filePath: row.filename };
}

/**
 * Return a self-contained data URL for clipboard HTML export.
 *
 * The editor normally renders images through the private lychee-image://
 * protocol. That URL is intentionally app-local, so copying it into another
 * application produces a broken image. Clipboard serialization is synchronous,
 * therefore this read is synchronous as well and only runs for images that are
 * actually part of the copied selection.
 */
export function getImageDataUrl(id: string): { dataUrl: string } {
  const db = getDb();
  const row = db.prepare(
    `SELECT filename, mimeType FROM images WHERE id = ?`,
  ).get(id) as ImageRow | undefined;
  if (!row) throw new Error(`Image not found: ${id}`);

  if (!MIME_TO_EXT[row.mimeType]) {
    throw new Error(`Unsupported image type: ${row.mimeType}`);
  }

  const imagesDir = getImagesDir();
  const filePath = path.resolve(imagesDir, row.filename);
  if (!filePath.startsWith(path.resolve(imagesDir) + path.sep)) {
    throw new Error('Image path escapes the images directory');
  }

  const buffer = fs.readFileSync(filePath);
  validateMagicBytes(buffer, row.mimeType);
  return { dataUrl: `data:${row.mimeType};base64,${buffer.toString('base64')}` };
}

/** Read validated raw bytes for an image (clipboard copy / save-as). */
export function readImageBytes(id: string): { buffer: Buffer; mimeType: string; filename: string } {
  const db = getDb();
  const row = db
    .prepare(`SELECT filename, mimeType FROM images WHERE id = ?`)
    .get(id) as ImageRow | undefined;
  if (!row) throw new Error(`Image not found: ${id}`);

  const imagesDir = getImagesDir();
  const filePath = path.resolve(imagesDir, row.filename);
  if (!filePath.startsWith(path.resolve(imagesDir) + path.sep)) {
    throw new Error('Image path escapes the images directory');
  }

  const buffer = fs.readFileSync(filePath);
  validateMagicBytes(buffer, row.mimeType);
  return { buffer, mimeType: row.mimeType, filename: row.filename };
}

export async function downloadImage(url: string): Promise<{ id: string; filePath: string }> {  // Dynamic import: net.fetch requires app to be ready
  const { net } = await import('electron');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await net.fetch(url, { signal: controller.signal as never });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error('Image data is empty (zero bytes)');
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType) {
      throw new Error('Missing content-type header');
    }
    const mimeType = Object.keys(MIME_TO_EXT).find((m) => contentType.includes(m));
    if (!mimeType) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }
    return saveImageBuffer(buffer, mimeType);
  } finally {
    clearTimeout(timeout);
  }
}

export function deleteImage(id: string): void {
  const db = getDb();
  const row = db.prepare(`SELECT filename FROM images WHERE id = ?`).get(id) as ImageRow | undefined;
  if (!row) return;

  const filePath = path.join(getImagesDir(), row.filename);
  try { fs.unlinkSync(filePath); } catch { /* file may already be gone */ }

  db.prepare(`DELETE FROM images WHERE id = ?`).run(id);
}
