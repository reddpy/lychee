import fs from "fs";
import path from "path";
import type { DocumentRow, NoteMetadata } from "../shared/documents";
import { CONTENT_SCHEMA_VERSION } from "../shared/documents";
import { parseFrontmatter } from "../shared/frontmatter";
import { revisionOf } from "../shared/hash";
import {
  createDocument,
  getDocumentById,
  importDocument,
  listDocumentTree,
  listSubtree,
  makeRoomForNewDocument,
  moveDocument as repoMoveDocument,
  permanentDeleteDocument as repoPurge,
  restoreDocument as repoRestore,
  setDocumentMetadata,
  trashDocument as repoTrash,
  updateDocument as repoUpdateDocument,
} from "./repos/documents";
import { exportAssetsToVault } from "./assets";
import { deriveEntry } from "./vault-entry";
import {
  createNote as storeCreateNote,
  moveNote as storeMoveNote,
  updateNoteFields,
} from "./vault-store";
import { renameVaultEntry } from "./vault";
import { getVaultSync } from "./vault-sync";

/**
 * File-first mutation service for the app.
 *
 * The vault is the source of truth, so app mutations land on disk first and the
 * SQLite `documents` rows are then updated as a projection. This is the same
 * store the standalone MCP server uses, so an in-app edit and an agent edit take
 * exactly the same path.
 *
 * The vault is only known to be active once the renderer has bootstrapped
 * (`vault.bootstrap`) or watching has started. Until then — and in unit tests —
 * the service is a transparent pass-through to the existing DB-first repo, so
 * behavior is unchanged and no filesystem is touched.
 */

let activeVault: string | null = null;

/** Called when the vault becomes available (bootstrap / watch start / location). */
export function setActiveVault(directory: string | null): void {
  activeVault = directory;
}

export function getActiveVault(): string | null {
  return activeVault;
}

/** Best-effort write-through: a failed file write must not fail the DB save. */
function writeThrough(id: string, fsync = true, rename = true): void {
  try {
    getVaultSync().writeNoteToVault(id, fsync, rename, true);
  } catch (error) {
    console.error("Vault write-through failed:", error);
  }
}

export function createNote(payload: {
  title?: string;
  content?: string;
  parentId?: string | null;
  emoji?: string | null;
}): DocumentRow {
  const vault = activeVault;
  if (!vault) {
    const document = createDocument(payload);
    writeThrough(document.id);
    getVaultSync().rebalanceSiblings(document.parentId, [document.id]);
    getVaultSync().sweepPaths();
    return document;
  }

  const parentId = payload.parentId ?? null;
  const parent = parentId ? getDocumentById(parentId) : null;

  let created: ReturnType<typeof storeCreateNote>;
  try {
    // The vault boundary is portable: local `lychee-asset://` tokens become
    // `assets/<hash>` refs on disk, exactly as the write-through path does.
    const body = exportAssetsToVault(vault, payload.content ?? "");
    created = storeCreateNote(vault, {
      title: payload.title ?? "",
      body,
      parentIdOrPath: parent?.metadata.vaultRelativePath ?? null,
      emoji: payload.emoji ?? undefined,
      order: 0,
    });
  } catch (error) {
    // A filesystem error (permissions, disk full) must not block creation.
    console.error("Vault create failed, falling back to DB-first:", error);
    created = { ok: false, reason: "vault_error" };
  }

  if (created.ok === false) {
    if (created.reason === "duplicate_title") throw new Error("Duplicate title");
    // Fall back to the DB-first path (the vault will be reconciled from the index).
    const document = createDocument(payload);
    writeThrough(document.id);
    return document;
  }

  // Project the file we just wrote into the index via the same single-file
  // derivation reconcile and the watcher use, so the index can never disagree
  // with disk.
  makeRoomForNewDocument(parentId, 0);
  const raw = fs.readFileSync(path.join(vault, created.relativePath), "utf8");
  const { data, body: fileBody } = parseFrontmatter(raw);
  const derived = deriveEntry({
    vault,
    relativePath: created.relativePath,
    frontmatterTitle: data.title,
    body: fileBody,
    mode: "import",
    id: created.id,
  });
  const content = derived.content ?? "";
  importDocument({
    id: created.id,
    title: derived.title,
    content,
    parentId,
    emoji: data.emoji ?? null,
    sortOrder: typeof data.order === "number" ? data.order : 0,
    createdAt: data.created,
    updatedAt: data.updated,
    metadata: {
      ...(typeof data.contentSchemaVersion === "number"
        ? { contentSchemaVersion: data.contentSchemaVersion }
        : {}),
      vaultRelativePath: created.relativePath,
      vaultFileRevision: created.revision,
      vaultContentRevision: revisionOf(content),
    },
  });

  // Keep sibling files' `order` dense and move any newly-colliding path into its
  // canonical slot (mirrors the DB-first path).
  const sync = getVaultSync();
  sync.invalidatePaths();
  sync.rebalanceSiblings(parentId, [created.id]);
  sync.sweepPaths();

  return getDocumentById(created.id)!;
}

export interface UpdateNotePatch {
  title?: string;
  content?: string;
  emoji?: string | null;
  parentId?: string | null;
  metadata?: Partial<NoteMetadata>;
  /** Force a durable (fsync) file write. */
  flush?: boolean;
  /** Allow the title edit to rename the file now (commit) vs. in place (autosave). */
  rename?: boolean;
  /** Preserve an explicit timestamp (vault apply) instead of stamping now. */
  updatedAt?: string;
}

/**
 * File-first note update. The body/frontmatter is written to the vault first,
 * then the index row is updated from the same values. Falls back to the DB-first
 * path when the vault is inactive, when the file changed underneath us (so the
 * watcher can resolve the divergence as a conflict copy), or for structural
 * fields not yet inverted (`parentId`).
 */
export function updateNote(id: string, patch: UpdateNotePatch): DocumentRow | null {
  const vault = activeVault;
  if (!vault) {
    const document = repoUpdateDocument(id, patch);
    if (document) writeThrough(id, patch.flush !== false, patch.rename !== false);
    return document;
  }

  const existing = getDocumentById(id);
  if (!existing) return null;

  // Structural changes still go through the index-first path for now.
  if (patch.parentId !== undefined) {
    const document = repoUpdateDocument(id, patch);
    if (document) writeThrough(id, patch.flush !== false, patch.rename !== false);
    return document;
  }

  // The downgrade guard must run before the file write: writing the body first
  // would let an older build clobber a newer schema's content on disk.
  if (patch.content !== undefined) {
    const existingVersion = existing.metadata.contentSchemaVersion ?? 0;
    if (existingVersion > CONTENT_SCHEMA_VERSION) {
      throw new Error(
        `Refusing to overwrite content written by a newer content schema (v${existingVersion} > v${CONTENT_SCHEMA_VERSION}).`,
      );
    }
  }

  const rename = patch.rename !== false;
  const body =
    patch.content === undefined ? undefined : exportAssetsToVault(vault, patch.content);

  const result = updateNoteFields(
    vault,
    id,
    {
      title: patch.title,
      emoji: patch.emoji,
      bookmarked: patch.metadata?.bookmarkedAt,
      body,
      contentSchemaVersion: patch.metadata?.contentSchemaVersion,
    },
    {
      expectedRevision: existing.metadata.vaultFileRevision,
      rename,
      allowFenceChanges: true,
    },
  );

  if (result.ok === false) {
    // A duplicate title is a hard error, not something to paper over DB-first.
    if (result.reason === "duplicate_title") throw new Error("Duplicate title");
    // External edit / unreadable file: keep the old behavior (DB-first with a
    // guarded write-through) so the watcher preserves the external change.
    const document = repoUpdateDocument(id, patch);
    if (document) writeThrough(id, patch.flush !== false, rename);
    return document;
  }

  const document = repoUpdateDocument(id, patch);
  if (!document) return null;
  setDocumentMetadata(id, {
    vaultRelativePath: result.relativePath,
    vaultFileRevision: result.revision,
    vaultContentRevision:
      patch.content === undefined
        ? existing.metadata.vaultContentRevision
        : revisionOf(patch.content),
  });
  // A committed title change may free/move sibling paths; enforce canonical ones.
  if (rename) getVaultSync().sweepPaths();
  return getDocumentById(id)!;
}

// ── Structural operations (file-first) ──────────────────────────────
//
// Hierarchy is the folder layout and order is frontmatter `order`, so the
// durable change is made in the vault first and the SQLite rows are projected
// afterwards. `beginStructuralChange` queues watcher events for the duration so
// the operation's own file changes are never mistaken for external edits.

/** Index-first move, used when the vault is inactive or the file is unreadable. */
function legacyMove(id: string, parentId: string | null, sortOrder: number): DocumentRow {
  const before = getDocumentById(id);
  const document = repoMoveDocument(id, parentId, sortOrder);
  const sync = getVaultSync();
  sync.invalidatePaths();
  const parents = new Set<string | null>([before?.parentId ?? null, document.parentId]);
  const affected = new Set<string>([document.id]);
  try {
    for (const node of listDocumentTree()) {
      if (parents.has(node.parentId)) affected.add(node.id);
    }
  } catch {
    // Best-effort: sibling rewrite is an optimization, not correctness-critical.
  }
  sync.rewriteNotes([...affected]);
  sync.sweepPaths();
  sync.notifyChanged();
  return document;
}

export function moveNote(id: string, parentId: string | null, sortOrder: number): DocumentRow {
  const vault = activeVault;
  if (!vault) return legacyMove(id, parentId, sortOrder);

  const before = getDocumentById(id);
  if (!before) return legacyMove(id, parentId, sortOrder);

  const sync = getVaultSync();
  sync.beginStructuralChange();
  let moved: ReturnType<typeof storeMoveNote> | null = null;
  try {
    const parent = parentId ? getDocumentById(parentId) : null;
    moved = storeMoveNote(vault, id, parent?.metadata.vaultRelativePath ?? parentId);
    if (moved.ok === false) {
      // Validation/edge cases keep the index-first semantics and error messages.
      return legacyMove(id, parentId, sortOrder);
    }

    const document = repoMoveDocument(id, parentId, sortOrder);
    setDocumentMetadata(id, { vaultRelativePath: moved.relativePath });

    sync.invalidatePaths();
    const parents = new Set<string | null>([before.parentId, document.parentId]);
    const affected = new Set<string>([document.id]);
    for (const node of listDocumentTree()) {
      if (parents.has(node.parentId)) affected.add(node.id);
    }
    sync.rewriteNotes([...affected]);
    sync.sweepPaths();
    sync.notifyChanged();
    return getDocumentById(id)!;
  } catch (error) {
    // Roll the durable file move back so the vault stays in step with the index.
    if (moved && moved.ok && before.metadata.vaultRelativePath) {
      try {
        renameVaultEntry(vault, moved.relativePath, before.metadata.vaultRelativePath);
      } catch {
        // Best-effort rollback; reconcile will settle any residue.
      }
    }
    throw error;
  } finally {
    sync.endStructuralChange();
  }
}

/** Index-first trash, used when the vault is inactive or the note is unknown. */
function legacyTrash(id: string): { document: DocumentRow; trashedIds: string[] } {
  const result = repoTrash(id);
  const sync = getVaultSync();
  sync.trashNoteFiles(result.trashedIds);
  sync.rebalanceSiblings(result.document.parentId);
  sync.sweepPaths();
  sync.recordTombstones(result.trashedIds, "trash");
  return result;
}

export function trashNote(id: string): { document: DocumentRow; trashedIds: string[] } {
  const vault = activeVault;
  if (!vault) return legacyTrash(id);

  const active = listSubtree(id).filter((node) => node.deletedAt === null).map((n) => n.id);
  if (active.length === 0) return legacyTrash(id); // lets the repo raise "not found"

  const sync = getVaultSync();
  sync.beginStructuralChange();
  try {
    // Durable: move the files into `.trash` before the index marks them deleted,
    // so a crash can never leave an index-deleted note still present as a file.
    sync.trashNoteFiles(active);
    const result = repoTrash(id);
    sync.rebalanceSiblings(result.document.parentId);
    sync.sweepPaths();
    sync.recordTombstones(result.trashedIds, "trash");
    return result;
  } finally {
    sync.endStructuralChange();
  }
}

/** Index-first restore, used when the vault is inactive. */
function legacyRestore(id: string): { document: DocumentRow; restoredIds: string[] } {
  const result = repoRestore(id);
  const sync = getVaultSync();
  sync.restoreNoteFiles(result.restoredIds);
  sync.sweepPaths(false, result.restoredIds);
  sync.rebalanceSiblings(result.document.parentId, result.restoredIds);
  sync.recordTombstones(result.restoredIds, "restore");
  return result;
}

export function restoreNote(id: string): { document: DocumentRow; restoredIds: string[] } {
  const vault = activeVault;
  if (!vault) return legacyRestore(id);

  const trashed = listSubtree(id).filter((node) => node.deletedAt !== null).map((n) => n.id);
  if (trashed.length === 0) return legacyRestore(id);

  const sync = getVaultSync();
  sync.beginStructuralChange();
  try {
    sync.restoreNoteFiles(trashed);
    const result = repoRestore(id);
    sync.sweepPaths(false, result.restoredIds);
    sync.rebalanceSiblings(result.document.parentId, result.restoredIds);
    sync.recordTombstones(result.restoredIds, "restore");
    return result;
  } finally {
    sync.endStructuralChange();
  }
}

/** Index-first purge, used when the vault is inactive. */
function legacyPurge(id: string): { deletedIds: string[]; deletedPaths: string[] } {
  const result = repoPurge(id);
  const sync = getVaultSync();
  sync.purgeNoteFiles(result.deletedPaths);
  sync.sweepPaths();
  sync.recordTombstones(result.deletedIds, "purge");
  return result;
}

export function permanentDeleteNote(id: string): {
  deletedIds: string[];
  deletedPaths: string[];
} {
  const vault = activeVault;
  if (!vault) return legacyPurge(id);

  const subtree = listSubtree(id);
  if (subtree.length === 0) return legacyPurge(id);
  const trashedPaths = subtree
    .filter((node) => node.deletedAt !== null && node.vaultRelativePath)
    .map((node) => node.vaultRelativePath!);

  const sync = getVaultSync();
  sync.beginStructuralChange();
  try {
    // Durable: remove the `.trash` files before dropping the index rows.
    sync.purgeNoteFiles(trashedPaths);
    const result = repoPurge(id);
    sync.sweepPaths();
    sync.recordTombstones(result.deletedIds, "purge");
    return result;
  } finally {
    sync.endStructuralChange();
  }
}
