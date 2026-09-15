import { getDb } from "../db";

/**
 * Local Yjs persistence: a compacted snapshot per note plus an append-only
 * update log. Never synced through a cloud folder — the vault markdown files are
 * the portable projection; this table only preserves CRDT lineage locally so
 * offline edits from this device (and, eventually, peers) merge correctly.
 */

function nowIso(): string {
  return new Date().toISOString();
}

/** Every stored update for a note, oldest first (snapshot baseline included). */
export function loadDocumentUpdates(id: string): Buffer[] {
  const db = getDb();
  const snapshot = db
    .prepare(`SELECT snapshot FROM document_crdt WHERE id = ?`)
    .get(id) as { snapshot: Buffer | null } | undefined;
  const updates = db
    .prepare(`SELECT payload FROM document_crdt_updates WHERE id = ? ORDER BY seq ASC`)
    .all(id) as Array<{ payload: Buffer }>;

  const parts: Buffer[] = [];
  if (snapshot?.snapshot) parts.push(snapshot.snapshot);
  for (const row of updates) parts.push(row.payload);
  return parts;
}

export function appendDocumentUpdate(id: string, update: Buffer): void {
  getDb()
    .prepare(`INSERT INTO document_crdt_updates (id, payload, at) VALUES (?, ?, ?)`)
    .run(id, update, nowIso());
}

/**
 * Replace a note's snapshot and drop the accumulated log. `snapshot` is the
 * merged state (lossless — `Y.mergeUpdates`/`encodeStateAsUpdate`), so this is
 * safe to run at any time.
 */
export function compactDocument(id: string, snapshot: Buffer): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO document_crdt (id, snapshot, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot, updatedAt = excluded.updatedAt`,
    ).run(id, snapshot, nowIso());
    db.prepare(`DELETE FROM document_crdt_updates WHERE id = ?`).run(id);
  });
  tx();
}

/** Drop all CRDT state for a note (permanent delete). */
export function removeDocumentCrdt(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM document_crdt WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM document_crdt_updates WHERE id = ?`).run(id);
  });
  tx();
}

/** Number of pending (uncompacted) updates for a note (diagnostics/tests). */
export function pendingUpdateCount(id: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM document_crdt_updates WHERE id = ?`)
    .get(id) as { c: number };
  return row.c;
}
