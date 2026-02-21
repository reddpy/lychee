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
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

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

export function deleteImage(id: string): void {
  const db = getDb();
  const row = db.prepare(`SELECT filename FROM images WHERE id = ?`).get(id) as ImageRow | undefined;
  if (!row) return;

  const filePath = path.join(getImagesDir(), row.filename);
  try { fs.unlinkSync(filePath); } catch { /* file may already be gone */ }

  db.prepare(`DELETE FROM images WHERE id = ?`).run(id);
}
