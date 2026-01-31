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
      `SELECT id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder
       FROM documents
       WHERE deletedAt IS NULL
       ORDER BY sortOrder ASC, updatedAt DESC
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
      `SELECT id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder
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
      `SELECT id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder
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
  const parentId = input.parentId ?? null;

  // Get next sortOrder for siblings (new docs go to the top, so sortOrder = 0, and shift others down)
  db.prepare(
    `UPDATE documents SET sortOrder = sortOrder + 1
     WHERE parentId IS ? AND deletedAt IS NULL`,
  ).run(parentId);

  const doc: DocumentRow = {
    id: randomUUID(),
    title: (() => {
      const t = (input.title?.trim() ?? '') || ''
      return t === 'Untitled' ? '' : t
    })(),
    content: input.content ?? '',
    createdAt,
    updatedAt: createdAt,
    parentId,
    emoji: input.emoji ?? null,
    deletedAt: null,
    sortOrder: 0,
  };

  db.prepare(
    `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    doc.id,
    doc.title,
    doc.content,
    doc.createdAt,
    doc.updatedAt,
    doc.parentId,
    doc.emoji,
    doc.deletedAt,
    doc.sortOrder,
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

  const tx = db.transaction(() => {
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

    // Close the gap in siblings' sortOrder (only for the top-level trashed doc, not descendants)
    db.prepare(
      `UPDATE documents SET sortOrder = sortOrder - 1
       WHERE parentId IS ? AND sortOrder > ? AND deletedAt IS NULL`,
    ).run(existing.parentId, existing.sortOrder);
  });
  tx();

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
    const tx = db.transaction(() => {
      // Make room at the original sortOrder position by shifting siblings
      db.prepare(
        `UPDATE documents SET sortOrder = sortOrder + 1
         WHERE parentId IS ? AND sortOrder >= ? AND deletedAt IS NULL`,
      ).run(existing.parentId, existing.sortOrder);

      // Restore all documents
      const placeholders = restoredIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE documents SET deletedAt = NULL, updatedAt = ? WHERE id IN (${placeholders})`,
      ).run(updatedAt, ...restoredIds);
    });
    tx();
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

/** Get all descendant IDs of a document (for circular reference check). */
function getDescendantIds(db: ReturnType<typeof getDb>, id: string): Set<string> {
  const rows = db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM documents WHERE parentId = ?
         UNION ALL
         SELECT d.id FROM documents d INNER JOIN descendants dec ON d.parentId = dec.id
       )
       SELECT id FROM descendants`,
    )
    .all(id) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Move a document to a new position in the tree.
 * @param id - Document to move
 * @param newParentId - New parent (null for root level)
 * @param newSortOrder - Target sort order among new siblings
 */
export function moveDocument(
  id: string,
  newParentId: string | null,
  newSortOrder: number,
): DocumentRow {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) {
    throw new Error(`Document not found: ${id}`);
  }

  // Prevent moving to self
  if (newParentId === id) {
    throw new Error('Cannot move document into itself');
  }

  // Prevent circular reference (moving to a descendant)
  if (newParentId !== null) {
    const descendants = getDescendantIds(db, id);
    if (descendants.has(newParentId)) {
      throw new Error('Cannot move document into its descendant');
    }
  }

  const oldParentId = existing.parentId;
  const oldSortOrder = existing.sortOrder;
  const changingParent = oldParentId !== newParentId;

  const tx = db.transaction(() => {
    if (changingParent) {
      // Moving to different parent
      // 1. Close gap in old parent's children
      db.prepare(
        `UPDATE documents SET sortOrder = sortOrder - 1
         WHERE parentId IS ? AND sortOrder > ? AND deletedAt IS NULL`,
      ).run(oldParentId, oldSortOrder);

      // 2. Make room in new parent's children
      db.prepare(
        `UPDATE documents SET sortOrder = sortOrder + 1
         WHERE parentId IS ? AND sortOrder >= ? AND deletedAt IS NULL`,
      ).run(newParentId, newSortOrder);

      // 3. Update the document
      db.prepare(
        `UPDATE documents SET parentId = ?, sortOrder = ?, updatedAt = ?
         WHERE id = ?`,
      ).run(newParentId, newSortOrder, nowIso(), id);
    } else {
      // Same parent, just reordering
      if (newSortOrder === oldSortOrder) {
        // No change needed
        return;
      }

      if (newSortOrder < oldSortOrder) {
        // Moving up: shift items between [newSortOrder, oldSortOrder) down by 1
        db.prepare(
          `UPDATE documents SET sortOrder = sortOrder + 1
           WHERE parentId IS ? AND sortOrder >= ? AND sortOrder < ? AND id != ? AND deletedAt IS NULL`,
        ).run(oldParentId, newSortOrder, oldSortOrder, id);
      } else {
        // Moving down: shift items between (oldSortOrder, newSortOrder] up by 1
        db.prepare(
          `UPDATE documents SET sortOrder = sortOrder - 1
           WHERE parentId IS ? AND sortOrder > ? AND sortOrder <= ? AND id != ? AND deletedAt IS NULL`,
        ).run(oldParentId, oldSortOrder, newSortOrder, id);
      }

      // Update the document's sortOrder
      db.prepare(
        `UPDATE documents SET sortOrder = ?, updatedAt = ?
         WHERE id = ?`,
      ).run(newSortOrder, nowIso(), id);
    }
  });

  tx();

  return getDocumentById(id)!;
}
