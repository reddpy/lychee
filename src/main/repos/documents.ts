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
      `SELECT id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt
       FROM documents
       WHERE deletedAt IS NULL
       ORDER BY updatedAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as DocumentRow[];
}

export function listTrashedDocuments(params: {
  limit?: number;
  offset?: number;
}): DocumentRow[] {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  return db
    .prepare(
      `SELECT id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt
       FROM documents
       WHERE deletedAt IS NOT NULL
       ORDER BY deletedAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as DocumentRow[];
}

export function getDocumentById(id: string): DocumentRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt
       FROM documents
       WHERE id = ?`,
    )
    .get(id) as DocumentRow | undefined;
  return row ?? null;
}

export function createDocument(input: {
  title?: string;
  content?: string;
  parentId?: string | null;
  emoji?: string | null;
}): DocumentRow {
  const db = getDb();

  const createdAt = nowIso();
  const doc: DocumentRow = {
    id: randomUUID(),
    title: (() => {
      const t = (input.title?.trim() ?? '') || ''
      return t === 'Untitled' ? '' : t
    })(),
    content: input.content ?? '',
    createdAt,
    updatedAt: createdAt,
    parentId: input.parentId ?? null,
    emoji: input.emoji ?? null,
    deletedAt: null,
  };

  db.prepare(
    `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    doc.id,
    doc.title,
    doc.content,
    doc.createdAt,
    doc.updatedAt,
    doc.parentId,
    doc.emoji,
    doc.deletedAt,
  );

  return doc;
}

export function updateDocument(
  id: string,
  patch: {
    title?: string;
    content?: string;
    parentId?: string | null;
    emoji?: string | null;
  },
): DocumentRow {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) {
    throw new Error(`Document not found: ${id}`);
  }

  const next: DocumentRow = {
    ...existing,
    title:
      patch.title === undefined ? existing.title : patch.title.trim(),
    content: patch.content === undefined ? existing.content : patch.content,
    parentId:
      patch.parentId === undefined ? existing.parentId : patch.parentId ?? null,
    emoji: patch.emoji === undefined ? existing.emoji : patch.emoji ?? null,
    deletedAt: existing.deletedAt,
    updatedAt: nowIso(),
  };

  db.prepare(
    `UPDATE documents
     SET title = ?, content = ?, updatedAt = ?, parentId = ?, emoji = ?
     WHERE id = ?`,
  ).run(
    next.title,
    next.content,
    next.updatedAt,
    next.parentId,
    next.emoji,
    id,
  );

  return next;
}

export function deleteDocument(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

/** Trash a document and all its nested descendants (cascade to trash). Returns doc + list of all trashed ids for UI. */
export function trashDocument(id: string): { document: DocumentRow; trashedIds: string[] } {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) {
    throw new Error(`Document not found: ${id}`);
  }
  const deletedAt = nowIso();
  // Get id + all descendant ids before updating
  const trashedRows = db
    .prepare(
      `WITH RECURSIVE descendants(descId) AS (
         SELECT ? AS descId
         UNION ALL
         SELECT d.id FROM documents d INNER JOIN descendants dec ON d.parentId = dec.descId
       )
       SELECT descId FROM descendants`,
    )
    .all(id) as { descId: string }[];
  const trashedIds = trashedRows.map((r) => r.descId);
  // Trash this document and all descendants
  db.prepare(
    `WITH RECURSIVE descendants(descId) AS (
       SELECT id FROM documents WHERE parentId = ?
       UNION ALL
       SELECT d.id FROM documents d INNER JOIN descendants dec ON d.parentId = dec.descId
     )
     UPDATE documents SET deletedAt = ?, updatedAt = ?
     WHERE id = ? OR id IN (SELECT descId FROM descendants)`,
  ).run(id, deletedAt, deletedAt, id);
  return {
    document: { ...existing, deletedAt, updatedAt: deletedAt },
    trashedIds,
  };
}

/** Restore a document and all its trashed descendants. Returns the restored document and all restored ids. */
export function restoreDocument(id: string): { document: DocumentRow; restoredIds: string[] } {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) {
    throw new Error(`Document not found: ${id}`);
  }
  if (!existing.deletedAt) {
    return { document: existing, restoredIds: [id] };
  }
  const updatedAt = nowIso();
  // Restore this doc and all trashed descendants (recursive: same parent chain, all currently trashed)
  const tree = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT ? AS id WHERE (SELECT deletedAt FROM documents WHERE id = ?) IS NOT NULL
         UNION ALL
         SELECT d.id FROM documents d INNER JOIN tree t ON d.parentId = t.id WHERE d.deletedAt IS NOT NULL
       )
       SELECT id FROM tree WHERE id IS NOT NULL`,
    )
    .all(id, id) as { id: string }[];
  const restoredIds = tree.map((r) => r.id);
  if (restoredIds.length > 0) {
    const placeholders = restoredIds.map(() => '?').join(',');
    db.prepare(
      `UPDATE documents SET deletedAt = NULL, updatedAt = ? WHERE id IN (${placeholders})`,
    ).run(updatedAt, ...restoredIds);
  }
  const doc: DocumentRow = { ...existing, deletedAt: null, updatedAt };
  return { document: doc, restoredIds };
}

/** Permanently delete a document and all its descendants from the database. */
export function permanentDeleteDocument(id: string): { deletedIds: string[] } {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) {
    throw new Error(`Document not found: ${id}`);
  }
  const tree = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT ?
         UNION ALL
         SELECT d.id FROM documents d INNER JOIN tree t ON d.parentId = t.id
       )
       SELECT id FROM tree`,
    )
    .all(id) as { id: string }[];
  const deletedIds = tree.map((r) => r.id);
  const placeholders = deletedIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM documents WHERE id IN (${placeholders})`).run(...deletedIds);
  return { deletedIds };
}

