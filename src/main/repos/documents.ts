import { randomUUID } from 'crypto';
import type { DocumentRow, NoteMetadata } from '../../shared/documents';
import { CONTENT_SCHEMA_VERSION } from '../../shared/documents';
import { getDb } from '../db';

function nowIso() {
  return new Date().toISOString();
}

/** Raw row from SQLite where metadata is a JSON string. */
type RawDocumentRow = Omit<DocumentRow, 'metadata'> & { metadata: string };

/** Parse the metadata JSON string into an object. */
function hydrateRow(raw: RawDocumentRow): DocumentRow {
  let metadata: NoteMetadata = {};
  try { metadata = JSON.parse(raw.metadata) ?? {}; } catch { /* default to empty */ }
  return { ...raw, metadata };
}

function hydrateRows(rows: RawDocumentRow[]): DocumentRow[] {
  return rows.map(hydrateRow);
}

export function listDocuments(params: {
  limit?: number;
  offset?: number;
}): DocumentRow[] {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  return hydrateRows(
    db
      .prepare(
        `SELECT id, title, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder, metadata,
                CASE WHEN length(content) > 262144 THEN substr(content, 1, 262144) ELSE content END AS content
         FROM documents
         WHERE deletedAt IS NULL
         ORDER BY sortOrder ASC, updatedAt DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as RawDocumentRow[],
  );
}

export function listTrashedDocuments(params: {
  limit?: number;
  offset?: number;
}): DocumentRow[] {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  return hydrateRows(
    db
      .prepare(
        `SELECT id, title, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder, metadata,
                CASE WHEN length(content) > 262144 THEN substr(content, 1, 262144) ELSE content END AS content
         FROM documents
         WHERE deletedAt IS NOT NULL
         ORDER BY deletedAt DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as RawDocumentRow[],
  );
}

export function getDocumentById(id: string): DocumentRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder, metadata
       FROM documents
       WHERE id = ?`,
    )
    .get(id) as RawDocumentRow | undefined;
  return row ? hydrateRow(row) : null;
}

/**
 * Find a non-trashed note whose last-known vault path matches. Used to attribute
 * an external file deletion to its note.
 */
export function findDocumentByVaultPath(relativePath: string): DocumentRow | null {
  const rows = getDb()
    .prepare(`SELECT id, metadata FROM documents WHERE deletedAt IS NULL`)
    .all() as Array<{ id: string; metadata: string | null }>;
  for (const row of rows) {
    let path: string | undefined;
    try {
      path = (JSON.parse(row.metadata ?? "{}") as { vaultRelativePath?: string })
        .vaultRelativePath;
    } catch {
      path = undefined;
    }
    if (path === relativePath) return getDocumentById(row.id);
  }
  return null;
}

/**
 * Non-trashed notes that have been written to the vault at least once (i.e. have
 * a stored `vaultRelativePath`). Used to detect externally deleted files at boot.
 */
export function listVaultBackedDocuments(): Array<{ id: string; vaultRelativePath: string }> {
  const rows = getDb()
    .prepare(`SELECT id, metadata FROM documents WHERE deletedAt IS NULL`)
    .all() as Array<{ id: string; metadata: string | null }>;
  const out: Array<{ id: string; vaultRelativePath: string }> = [];
  for (const row of rows) {
    try {
      const path = (JSON.parse(row.metadata ?? "{}") as { vaultRelativePath?: string })
        .vaultRelativePath;
      if (typeof path === "string" && path) out.push({ id: row.id, vaultRelativePath: path });
    } catch {
      // Ignore malformed metadata.
    }
  }
  return out;
}

/**
 * Lightweight id/title/parent/sort rows for every non-trashed document. Unlike
 * `listDocuments` it is not paginated — callers that must reason about the whole
 * tree (vault path planning) need every node.
 */
export function listDocumentTree(): Array<{
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
}> {
  return getDb()
    .prepare(`SELECT id, title, parentId, sortOrder FROM documents WHERE deletedAt IS NULL`)
    .all() as Array<{ id: string; title: string; parentId: string | null; sortOrder: number }>;
}

/** Every non-trashed note's id and title (for cleanup / duplicate scans). */
export function listAllDocumentTitles(): Array<{ id: string; title: string }> {
  return getDb()
    .prepare(`SELECT id, title FROM documents WHERE deletedAt IS NULL`)
    .all() as Array<{ id: string; title: string }>;
}

/**
 * Find a non-trashed note with the same (trimmed, case-insensitive) title.
 * Empty titles are not considered duplicates — untitled notes are allowed.
 */
export function findDocumentByTitle(
  title: string,
  excludeId?: string,
): { id: string } | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const db = getDb();
  const row = (
    excludeId
      ? db
          .prepare(
            `SELECT id FROM documents
             WHERE deletedAt IS NULL AND id != ? AND lower(trim(title)) = lower(?)
             LIMIT 1`,
          )
          .get(excludeId, trimmed)
      : db
          .prepare(
            `SELECT id FROM documents
             WHERE deletedAt IS NULL AND lower(trim(title)) = lower(?)
             LIMIT 1`,
          )
          .get(trimmed)
  ) as { id: string } | undefined;
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
    metadata: {},
  };

  db.prepare(
    `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    JSON.stringify(doc.metadata),
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
    metadata?: Partial<NoteMetadata>;
    /**
     * Preserve an external timestamp (vault apply) instead of stamping "now".
     * Omit for user-driven edits so `updatedAt` reflects the moment of change.
     */
    updatedAt?: string;
  },
): DocumentRow {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) {
    throw new Error(`Document not found: ${id}`);
  }

  // Downgrade guard: never overwrite content written by a newer content schema.
  // The renderer already blocks editing in this case; this is defense in depth
  // for IPC callers (agents, future MCP, scripts).
  if (patch.content !== undefined) {
    const existingVersion = existing.metadata.contentSchemaVersion ?? 0;
    if (existingVersion > CONTENT_SCHEMA_VERSION) {
      throw new Error(
        `Refusing to overwrite content written by a newer content schema (v${existingVersion} > v${CONTENT_SCHEMA_VERSION}).`,
      );
    }
  }

  const next: DocumentRow = {
    ...existing,
    title:
      patch.title === undefined ? existing.title : patch.title.trim(),
    content: patch.content === undefined ? existing.content : patch.content,
    parentId:
      patch.parentId === undefined ? existing.parentId : patch.parentId ?? null,
    emoji: patch.emoji === undefined ? existing.emoji : patch.emoji ?? null,
    metadata: patch.metadata ? { ...existing.metadata, ...patch.metadata } : existing.metadata,
    deletedAt: existing.deletedAt,
    updatedAt: patch.updatedAt ?? nowIso(),
  };

  db.prepare(
    `UPDATE documents
     SET title = ?, content = ?, updatedAt = ?, parentId = ?, emoji = ?, metadata = ?
     WHERE id = ?`,
  ).run(
    next.title,
    next.content,
    next.updatedAt,
    next.parentId,
    next.emoji,
    JSON.stringify(next.metadata),
    id,
  );

  return next;
}

export function deleteDocument(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

/**
 * Update only the metadata JSON, without touching `content` or `updatedAt`.
 * Used for internal bookkeeping (e.g. vault revision baselines) that must not
 * appear as a user-visible edit.
 */
export function setDocumentMetadata(id: string, patch: Partial<NoteMetadata>): void {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) return;
  const metadata: NoteMetadata = { ...existing.metadata, ...patch };
  db.prepare(`UPDATE documents SET metadata = ? WHERE id = ?`).run(
    JSON.stringify(metadata),
    id,
  );
}

/**
 * Update index columns from a vault file (files are authoritative for metadata
 * and hierarchy). Does not touch `content`.
 */
export function applyIndexFields(
  id: string,
  fields: {
    title?: string;
    content?: string;
    emoji?: string | null;
    sortOrder?: number;
    parentId?: string | null;
    createdAt?: string;
    updatedAt?: string;
    metadata?: NoteMetadata;
  },
): void {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) return;

  db.prepare(
    `UPDATE documents
     SET title = ?, content = ?, emoji = ?, sortOrder = ?, parentId = ?, createdAt = ?, updatedAt = ?, metadata = ?
     WHERE id = ?`,
  ).run(
    fields.title ?? existing.title,
    fields.content ?? existing.content,
    fields.emoji === undefined ? existing.emoji : fields.emoji,
    fields.sortOrder ?? existing.sortOrder,
    fields.parentId === undefined ? existing.parentId : fields.parentId,
    fields.createdAt ?? existing.createdAt,
    fields.updatedAt ?? existing.updatedAt,
    JSON.stringify(fields.metadata ?? existing.metadata),
    id,
  );
}

/**
 * Additively import a document under an explicit id. If the id already exists
 * the import is skipped (`created: false`) — import never overwrites or deletes.
 * A `parentId` that does not exist falls back to the root.
 */
export function importDocument(input: {
  id: string;
  title: string;
  content: string;
  parentId?: string | null;
  emoji?: string | null;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  metadata?: NoteMetadata;
}): { created: boolean } {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM documents WHERE id = ?`).get(input.id);
  if (existing) return { created: false };

  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;
  const parentExists =
    input.parentId != null &&
    db.prepare(`SELECT id FROM documents WHERE id = ?`).get(input.parentId) !== undefined;

  db.prepare(
    `INSERT INTO documents (id, title, content, createdAt, updatedAt, parentId, emoji, deletedAt, sortOrder, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    input.id,
    input.title.trim(),
    input.content,
    createdAt,
    updatedAt,
    parentExists ? input.parentId : null,
    input.emoji ?? null,
    Math.max(0, Math.floor(input.sortOrder ?? 0)),
    JSON.stringify(input.metadata ?? {}),
  );

  return { created: true };
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
      // Clamp restore position to current sibling count
      const siblingCount = (db.prepare(
        `SELECT COUNT(*) as c FROM documents WHERE parentId IS ? AND deletedAt IS NULL`,
      ).get(existing.parentId) as { c: number }).c;
      const restorePosition = Math.min(existing.sortOrder, siblingCount);

      // Make room at the restore position by shifting siblings
      db.prepare(
        `UPDATE documents SET sortOrder = sortOrder + 1
         WHERE parentId IS ? AND sortOrder >= ? AND deletedAt IS NULL`,
      ).run(existing.parentId, restorePosition);

      // Update the document's sortOrder to the clamped position
      db.prepare(
        `UPDATE documents SET sortOrder = ? WHERE id = ?`,
      ).run(restorePosition, id);

      // Restore all documents
      const placeholders = restoredIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE documents SET deletedAt = NULL, updatedAt = ? WHERE id IN (${placeholders})`,
      ).run(updatedAt, ...restoredIds);
    });
    tx();
  }

  const restored = getDocumentById(id)!;
  return { document: restored, restoredIds };
}

/** Permanently delete a document and all its descendants from the database. */
export function permanentDeleteDocument(id: string): {
  deletedIds: string[];
  deletedPaths: string[];
} {
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
  // Capture file paths before the rows disappear so the caller can purge them.
  const deletedPaths = (
    db
      .prepare(`SELECT metadata FROM documents WHERE id IN (${placeholders})`)
      .all(...deletedIds) as { metadata: string }[]
  )
    .map((row) => {
      try {
        return (JSON.parse(row.metadata) as { vaultRelativePath?: string }).vaultRelativePath;
      } catch {
        return undefined;
      }
    })
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  db.prepare(`DELETE FROM documents WHERE id IN (${placeholders})`).run(...deletedIds);
  return { deletedIds, deletedPaths };
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

  // Reject moving a trashed document — restore it first
  if (existing.deletedAt) {
    throw new Error('Cannot move a trashed document');
  }

  // Prevent moving to self
  if (newParentId === id) {
    throw new Error('Cannot move document into itself');
  }

  // Validate target parent exists and entire ancestor chain is not trashed
  if (newParentId !== null) {
    const parent = getDocumentById(newParentId);
    if (!parent) {
      throw new Error(`Target parent not found: ${newParentId}`);
    }
    if (parent.deletedAt) {
      throw new Error('Cannot move document under a trashed parent');
    }
    // Walk up the ancestor chain to detect zombie nodes (active node under a trashed ancestor)
    let ancestorId = parent.parentId;
    while (ancestorId !== null) {
      const ancestor = getDocumentById(ancestorId);
      if (!ancestor) break;
      if (ancestor.deletedAt) {
        throw new Error('Cannot move document under a trashed parent');
      }
      ancestorId = ancestor.parentId;
    }
  }

  // Prevent circular reference (moving to a descendant)
  if (newParentId !== null) {
    const descendants = getDescendantIds(db, id);
    if (descendants.has(newParentId)) {
      throw new Error('Cannot move document into its descendant');
    }
  }

  // Clamp sortOrder to valid range
  newSortOrder = Math.max(0, Math.floor(newSortOrder));
  const siblingCount = (db.prepare(
    `SELECT COUNT(*) as c FROM documents WHERE parentId IS ? AND deletedAt IS NULL AND id != ?`,
  ).get(newParentId, id) as { c: number }).c;
  newSortOrder = Math.min(newSortOrder, siblingCount);

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