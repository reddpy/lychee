import { randomUUID } from 'crypto';
import type { DocumentRow } from '../../shared/documents';
import { getDb } from '../db';

function nowIso() {
  return new Date().toISOString();
}

export function listDocuments(params: {
  limit?: number;
  offset?: number;
}): DocumentRow[] {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  return db
    .prepare(
      `SELECT id, title, content, createdAt, updatedAt
       FROM documents
       ORDER BY updatedAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as DocumentRow[];
}

export function getDocumentById(id: string): DocumentRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, title, content, createdAt, updatedAt
       FROM documents
       WHERE id = ?`,
    )
    .get(id) as DocumentRow | undefined;
  return row ?? null;
}

export function createDocument(input: {
  title?: string;
  content?: string;
}): DocumentRow {
  const db = getDb();

  const createdAt = nowIso();
  const doc: DocumentRow = {
    id: randomUUID(),
    title: input.title?.trim() || 'Untitled',
    content: input.content ?? '',
    createdAt,
    updatedAt: createdAt,
  };

  db.prepare(
    `INSERT INTO documents (id, title, content, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(doc.id, doc.title, doc.content, doc.createdAt, doc.updatedAt);

  return doc;
}

export function updateDocument(
  id: string,
  patch: { title?: string; content?: string },
): DocumentRow {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) {
    throw new Error(`Document not found: ${id}`);
  }

  const next: DocumentRow = {
    ...existing,
    title:
      patch.title === undefined ? existing.title : patch.title.trim() || 'Untitled',
    content: patch.content === undefined ? existing.content : patch.content,
    updatedAt: nowIso(),
  };

  db.prepare(
    `UPDATE documents
     SET title = ?, content = ?, updatedAt = ?
     WHERE id = ?`,
  ).run(next.title, next.content, next.updatedAt, id);

  return next;
}

export function deleteDocument(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

