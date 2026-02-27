import { randomUUID } from 'crypto';
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
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

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
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported image type: ${mimeType}`);

  const id = randomUUID();
  const filename = `${id}.${ext}`;
  const filePath = path.join(getImagesDir(), filename);

  // Strip data URL prefix if present (e.g. "data:image/png;base64,...")
  const base64 = data.includes(',') ? data.split(',')[1] : data;
  const buf = Buffer.from(base64, 'base64');

  if (buf.length === 0) {
    throw new Error('Image data is empty (zero bytes)');
  }

  validateMagicBytes(buf, mimeType);

  fs.writeFileSync(filePath, buf);

  const db = getDb();
  db.prepare(
    `INSERT INTO images (id, filename, mimeType, createdAt) VALUES (?, ?, ?, ?)`,
  ).run(id, filename, mimeType, new Date().toISOString());

  return { id, filePath: filename };
}

export function getImagePath(id: string): { filePath: string } {
  const db = getDb();
  const row = db.prepare(`SELECT filename FROM images WHERE id = ?`).get(id) as ImageRow | undefined;
  if (!row) throw new Error(`Image not found: ${id}`);
  return { filePath: row.filename };
}

export async function downloadImage(url: string): Promise<{ id: string; filePath: string }> {
  // Dynamic import: net.fetch requires app to be ready
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
    validateMagicBytes(buffer, mimeType);
    const ext = MIME_TO_EXT[mimeType];
    const id = randomUUID();
    const filename = `${id}.${ext}`;
    fs.writeFileSync(path.join(getImagesDir(), filename), buffer);
    const db = getDb();
    db.prepare(
      `INSERT INTO images (id, filename, mimeType, createdAt) VALUES (?, ?, ?, ?)`,
    ).run(id, filename, mimeType, new Date().toISOString());
    return { id, filePath: filename };
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
