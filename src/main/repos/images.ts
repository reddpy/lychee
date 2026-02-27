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
