import { BrowserWindow } from "electron";
import fs from "fs";
import { randomUUID } from "crypto";
import type { DocumentRow, NoteMetadata } from "../shared/documents";
import { CONTENT_SCHEMA_VERSION } from "../shared/documents";
import { parseFrontmatter, serializeFrontmatter } from "../shared/frontmatter";
import { stripLeadingTitle, resolveTitle, resolveNewTitle } from "../shared/markdown-title";
import { revisionOf } from "../shared/hash";
import { conflictCopyPath, markdownStem, parentMarkdownPath, planVaultPaths } from "../shared/vault-path";
import {
  classifyVaultChange,
  isConflictCopyPath,
  type VaultFileChangedEvent,
  type VaultResolveRequest,
} from "../shared/vault-watch";
import { isDeletedState, tombstoneSupersedes, type TombstoneState } from "../shared/tombstone";
import {
  getDocumentById,
  findDocumentByVaultPath,
  importDocument,
  listDocumentTree,
  listVaultBackedDocuments,
  moveDocument,
  restoreDocument,
  setDocumentMetadata,
  trashDocument,
  updateDocument,
} from "./repos/documents";
import { getSetting } from "./repos/settings";
import { appendTombstones, readTombstones } from "./tombstones";
import { exportAssetsToVault, importAssetsFromVault } from "./assets";
import { resolveVaultRoot } from "./mcp-config";
import {
  writeVaultFile,
  trashVaultEntry,
  restoreVaultEntry,
  purgeVaultEntry,
  resolveWithinVault,
  scanVaultDirectory,
  vaultEntryExists,
} from "./vault";
import { VaultWatcher, type VaultFileEvent } from "./vault-watcher";

import {
  VAULT_LOCATION_KEY,
  VAULT_WATCH_DIRECTORY_KEY,
  VAULT_WATCH_ENABLED_KEY,
  getVaultDirectory,
} from "./vault-location";

export {
  VAULT_LOCATION_KEY,
  VAULT_WATCH_DIRECTORY_KEY,
  VAULT_WATCH_ENABLED_KEY,
} from "./vault-location";

/**
 * Orchestrates watched-file changes against the database. All DB and file writes
 * live here; the renderer only performs markdown ⇄ Lexical conversion (which must
 * run where the React-coupled node modules can load) and calls back with the
 * result.
 *
 * Consistency rules:
 * - Our own writes are suppressed and also ignored via the stored baseline.
 * - An external delete trashes the note it belonged to (unless the file was
 *   renamed/moved); our own rename/trash/purge operations update the note's
 *   path or `deletedAt` before removing the file, so they are never mistaken
 *   for external deletes.
 * - An external edit is applied only when the DB has not changed since export;
 *   otherwise the external edit is preserved as a conflict copy and the canonical
 *   file is restored from the DB. Nothing is silently lost.
 */
export class VaultSync {
  private readonly watcher: VaultWatcher;
  /** Paths currently being applied (prevents duplicate/concurrent imports). */
  private readonly pending = new Set<string>();
  /** Paths that changed again while pending, to re-process after resolve. */
  private readonly queued = new Set<string>();
  /** Cached vault path map; TTL-bounded so an import burst stays O(N). */
  private pathCache: { at: number; map: Map<string, string> } | null = null;
  /** Cached tombstone state; TTL-bounded. */
  private tombstoneCache: { at: number; map: Map<string, TombstoneState> } | null = null;
  /**
   * Whether the startup index reconcile has completed. Until it has, file
   * events are queued instead of processed. Main starts the watcher before the
   * renderer's bootstrap reconciles duplicates/hierarchy from the files, and
   * processing in scan order would race that reconcile (two files claiming one
   * id could both be applied, or the wrong one could win).
   */
  private reconciled = false;

  constructor(private readonly send: (event: VaultFileChangedEvent) => void) {
    this.watcher = new VaultWatcher(
      (event) => this.onFileEvent(event),
      () => this.reconcileTombstones(),
    );
  }

  /**
   * Allow file events to be processed after the startup index reconcile. Any
   * event that arrived while waiting is re-read now so nothing is dropped.
   */
  markReconciled(): void {
    if (this.reconciled) return;
    this.reconciled = true;
    const queued = [...this.queued];
    this.queued.clear();
    for (const relativePath of queued) this.watcher.refresh(relativePath);
  }

  start(directory: string): void {
    // A restart (e.g. main starts the watcher before the renderer bridge is
    // ready, then bootstrap calls watchStart) must re-process every path. Without
    // this, the pre-renderer scan leaves paths stuck in `pending`, and later
    // rescans only queue them — so real files never get imported.
    this.pending.clear();
    this.queued.clear();
    this.watcher.start(directory);
    this.reconcileTombstones();
  }

  stop(): void {
    this.pending.clear();
    this.queued.clear();
    this.watcher.stop();
  }

  getDirectory(): string | null {
    return this.watcher.getDirectory();
  }

  status(): { running: boolean; directory: string | null } {
    return { running: this.watcher.isRunning(), directory: this.watcher.getDirectory() };
  }

  suppress(relativePath: string, revision: string): void {
    this.watcher.suppress(relativePath, revision);
  }

  /**
   * Write a note's current database state to its vault file. Called by the IPC
   * handlers after a save so the markdown file is always the durable source of
   * truth, even when the watcher is not running.
   */
  writeNoteToVault(id: string, fsync = true, rename = true): void {
    const note = getDocumentById(id);
    if (!note) return;
    if (rename) {
      // Canonical placement is a whole-tree concern: sibling suffixes shift and
      // two notes' target paths can collide, so route through the collision-safe
      // sweep (which also rewrites this note).
      this.sweepPaths(fsync, [id]);
      return;
    }
    const directory = this.watcher.getDirectory() ?? getVaultDirectory();
    this.pathCache = null;
    const desiredPath = this.pathMap().get(id);
    if (!desiredPath) return;
    const currentPath = note.metadata.vaultRelativePath ?? desiredPath;
    this.writeCanonical(directory, currentPath, note, note.content, note.content, { fsync });
  }

  /**
   * Commit any pending file rename for a note without rewriting it. Called on
   * blur/tab-switch/quit so title edits don't rename the file mid-typing.
   */
  commitNote(_id: string): void {
    this.sweepPaths(false);
  }

  /** Drop caches after structural changes (create/move/import/delete). */
  invalidatePaths(): void {
    this.pathCache = null;
  }

  /**
   * Enforce the canonical filename for every note. Writes each affected note's
   * file from the database at its canonical path, then removes the now-stale
   * old file (unless another note now owns that path). This is collision-safe:
   * swapping or suffix-shifting paths never overwrite the wrong note.
   *
   * `forceRewriteIds` are rewritten even when their path is unchanged (e.g. a
   * content/metadata save that must land in the file).
   */
  sweepPaths(fsync = false, forceRewriteIds: string[] = []): void {
    try {
      const directory = this.watcher.getDirectory() ?? this.vaultDirectory();
      if (!directory) return;
      this.pathCache = null;
      const desired = this.pathMap();
      const desiredLower = new Set([...desired.values()].map((path) => path.toLowerCase()));
      const force = new Set(forceRewriteIds);

      const affected: Array<{ id: string; from?: string; to: string }> = [];
      for (const [id, to] of desired) {
        const note = getDocumentById(id);
        if (!note) continue;
        const from = note.metadata.vaultRelativePath;
        if (from === to && !force.has(id)) continue;
        affected.push({ id, from, to });
      }
      if (affected.length === 0) return;

      // Phase 1: write every affected note at its canonical path.
      for (const item of affected) {
        const note = getDocumentById(item.id);
        if (!note) continue;
        this.writeCanonical(directory, item.to, note, note.content, note.content, { fsync });
      }

      // Phase 2: drop stale old files that no note claims any more.
      for (const item of affected) {
        if (!item.from || item.from === item.to) continue;
        if (desiredLower.has(item.from.toLowerCase())) continue;
        try {
          fs.rmSync(resolveWithinVault(directory, item.from), { force: true });
        } catch {
          // Best-effort cleanup.
        }
      }
    } catch (error) {
      console.error("Vault path sweep failed:", error);
    }
  }

  /** Parent note id implied by a file's folder, using actual on-disk paths. */
  private resolveParentIdByActualPath(directory: string, relativePath: string): string | null {
    const parentPath = parentMarkdownPath(relativePath);
    if (!parentPath) return null;
    const { entries } = scanVaultDirectory(directory);
    const parentId = entries.find(
      (entry) => entry.relativePath.toLowerCase() === parentPath.toLowerCase(),
    )?.id;
    return parentId && getDocumentById(parentId) ? parentId : null;
  }

  /** The vault directory, or null when none is configured/available. */
  private vaultDirectory(): string | null {
    const watched = this.watcher.getDirectory();
    if (watched) return watched;
    try {
      return getVaultDirectory();
    } catch {
      return null;
    }
  }

  /** Move a trashed note's file into `<vault>/.trash/`. */
  trashNoteFiles(ids: string[]): void {
    if (ids.length === 0) return;
    const directory = this.vaultDirectory();
    if (!directory) return;
    for (const id of ids) {
      try {
        const relativePath = getDocumentById(id)?.metadata.vaultRelativePath;
        if (!relativePath) continue;
        trashVaultEntry(directory, relativePath);
      } catch (error) {
        console.error("Vault trash failed:", error);
      }
    }
  }

  /** Move a restored note's file back out of `.trash` to its current path. */
  restoreNoteFiles(ids: string[]): void {
    if (ids.length === 0) return;
    const directory = this.vaultDirectory();
    if (!directory) return;
    this.pathCache = null;
    for (const id of ids) {
      try {
        const note = getDocumentById(id);
        const relativePath = this.pathMap().get(id) ?? note?.metadata.vaultRelativePath;
        if (!relativePath) continue;
        restoreVaultEntry(directory, relativePath);
      } catch (error) {
        console.error("Vault restore failed:", error);
      }
    }
  }

  /** Permanently delete purged notes' files from `.trash` (paths captured pre-delete). */
  purgeNoteFiles(relativePaths: string[]): void {
    if (!relativePaths || relativePaths.length === 0) return;
    const directory = this.vaultDirectory();
    if (!directory) return;
    for (const relativePath of relativePaths) {
      try {
        purgeVaultEntry(directory, relativePath);
      } catch (error) {
        console.error("Vault purge failed:", error);
      }
    }
  }

  /**
   * Rewrite the files for a set of notes in place (no rename). Used after a
   * reorder/re-parent, where siblings' `order`/`parentId` changed in the DB but
   * their files need the new frontmatter.
   */
  rewriteNotes(ids: string[]): void {
    for (const id of ids) {
      try {
        this.writeNoteToVault(id, false, false);
      } catch (error) {
        console.error("Vault rewrite failed:", error);
      }
    }
  }

  /**
   * Rewrite every live sibling under `parentId` so its file's frontmatter `order`
   * matches the database after an operation shifted sibling positions (create,
   * trash, restore). Files are authoritative on the next launch, so a stale
   * `order` on disk would be adopted by `reconcileIndexFromVault` and silently
   * change the sidebar order. `excludeIds` avoids rewriting notes another path
   * already handled (e.g. a fresh export or a forced restore rewrite).
   *
   * Only siblings whose file currently exists are rewritten: during a burst of
   * external deletes the DB rows still exist while their unlink events are
   * queued, and rewriting them here would resurrect a file that is about to be
   * trashed (making its delete look like a no-op).
   */
  rebalanceSiblings(parentId: string | null, excludeIds: Iterable<string> = []): void {
    const exclude = new Set(excludeIds);
    const directory = this.watcher.getDirectory() ?? this.vaultDirectory();
    if (!directory) return;
    const ids: string[] = [];
    for (const node of listDocumentTree()) {
      if (node.parentId !== parentId || exclude.has(node.id)) continue;
      const relativePath = getDocumentById(node.id)?.metadata.vaultRelativePath;
      if (!relativePath) continue;
      try {
        if (vaultEntryExists(directory, relativePath)) ids.push(node.id);
      } catch {
        // Unresolvable path: leave it for the next sweep.
      }
    }
    if (ids.length > 0) this.rewriteNotes(ids);
  }

  /** Called once at startup: resume watching if the user left it enabled. */
  startIfEnabled(): void {
    if (getSetting(VAULT_WATCH_ENABLED_KEY) !== "true") return;
    const directory = getSetting(VAULT_WATCH_DIRECTORY_KEY);
    // Normalize a previously-stored shared folder to the dedicated Lychee
    // subfolder so we never watch an entire shared directory.
    if (directory) {
      const root = resolveVaultRoot(directory);
      this.watcher.start(root);
      this.reconcileTombstones();
    }
  }

  /**
   * Record a delete/restore/purge so other devices converge. Called by the
   * IPC handlers when a vault is being watched. Append-only; never throws on a
   * missing vault.
   */
  recordTombstones(ids: string[], action: "trash" | "restore" | "purge"): void {
    const directory = this.watcher.getDirectory();
    if (!directory || ids.length === 0) return;
    appendTombstones(directory, ids, action);
    this.tombstoneCache = null;
  }

  private tombstones(): Map<string, TombstoneState> {
    const directory = this.watcher.getDirectory();
    if (!directory) return new Map();
    const now = Date.now();
    if (!this.tombstoneCache || now - this.tombstoneCache.at > 1000) {
      this.tombstoneCache = { at: now, map: readTombstones(directory) };
    }
    return this.tombstoneCache.map;
  }

  /**
   * Apply synced tombstones to the local database. A newer edit supersedes a
   * delete (so an edit made on a device that had not seen the delete is not
   * lost); otherwise the note is trashed/restored locally — files included, so
   * the vault stays consistent with the DB.
   */
  reconcileTombstones(): void {
    if (!this.watcher.getDirectory()) return;
    this.tombstoneCache = null;
    const trashed: string[] = [];
    let changed = false;
    for (const [id, state] of this.tombstones()) {
      const note = getDocumentById(id);
      if (!note) continue;
      try {
        if (state.action === "restore") {
          if (note.deletedAt && tombstoneSupersedes(state, note.updatedAt)) {
            const { restoredIds } = restoreDocument(id);
            this.restoreNoteFiles(restoredIds);
            this.sweepPaths(false, restoredIds);
            this.rebalanceSiblings(note.parentId, restoredIds);
            changed = true;
          }
        } else if (!note.deletedAt && tombstoneSupersedes(state, note.updatedAt)) {
          const { trashedIds } = trashDocument(id);
          this.trashNoteFiles(trashedIds);
          this.rebalanceSiblings(note.parentId);
          this.pathCache = null;
          trashed.push(...trashedIds);
          changed = true;
        }
      } catch {
        // A concurrent structural change (e.g. parent gone) must not abort the
        // rest of the reconciliation.
      }
    }
    // Tell the renderer so the sidebar/tabs reflect a tombstone that arrived
    // while the app was running.
    if (changed) this.send({ action: "sync", ids: trashed });
  }

  private onFileEvent(event: VaultFileEvent): void {
    if (!this.reconciled) {
      // Startup reconcile hasn't run yet: remember the path and re-read it once
      // the index is authoritative.
      this.queued.add(event.relativePath);
      return;
    }
    const directory = this.watcher.getDirectory();
    if (!directory) return;
    if (!event.exists || event.contents == null) {
      this.onFileRemoved(event.relativePath, directory);
      return;
    }
    if (!event.relativePath.toLowerCase().endsWith(".md")) return; // notes are markdown only

    const { data, body } = parseFrontmatter(event.contents);
    // Markdown import/apply: swap `assets/<hash>` for local image ids so the
    // renderer can build reference nodes. Conflict copies keep the portable path.
    const localBody = importAssetsFromVault(directory, body);
    const id = typeof data.id === "string" && data.id.length > 0 ? data.id : undefined;

    // A tombstone from another device suppresses re-import even if the file is
    // still present locally (e.g. a delete synced before the file did).
    const tombstone = id ? this.tombstones().get(id) : undefined;
    if (tombstone && isDeletedState(tombstone) && tombstoneSupersedes(tombstone, data.updated)) {
      return;
    }

    const note = id ? getDocumentById(id) : null;

    // External rename/move: the same note id now lives at a different path. The
    // filename is the title (Obsidian model), so this is a retitle. Orphans from
    // the old duplicate-id bug are cleaned up at startup, not handled here.
    const storedPath = note?.metadata.vaultRelativePath;
    const externalRename =
      note != null && storedPath !== undefined && storedPath !== event.relativePath;

    const action = externalRename
      ? "apply"
      : classifyVaultChange({
          exists: true,
          fileRevision: event.revision,
          hasId: Boolean(id),
          note: note
            ? {
                fileRevision: note.metadata.vaultFileRevision,
                contentRevision: note.metadata.vaultContentRevision,
                currentContentRevision: revisionOf(note.content),
              }
            : null,
        });

    if (action === "ignore") return;

    if (action === "adopt" && note) {
      setDocumentMetadata(note.id, {
        vaultFileRevision: event.revision,
        vaultContentRevision: revisionOf(note.content),
        vaultRelativePath: event.relativePath,
      });
      return;
    }

    if (action === "import") {
      if (!this.beginProcessing(event.relativePath)) return;
      this.send({
        action: "import",
        // Preserve the file's identity: the frontmatter id IS the note id.
        id: id!,
        relativePath: event.relativePath,
        // Title is the filename; frontmatter `title` is accepted only from
        // files written by an older build, for migration. The blank-note
        // sentinel (`Untitled`, `Untitled (2)`...) resolves to no title.
        title: resolveNewTitle({
          frontmatterTitle: data.title,
          stemTitle: markdownStem(event.relativePath),
        }),
        parentId: this.parentIdFromVault(directory, event.relativePath),
        sortOrder: typeof data.order === "number" ? data.order : 0,
        emoji: data.emoji ?? null,
        bookmarkedAt: data.bookmarked ?? null,
        createdAt: data.created,
        updatedAt: data.updated,
        contentSchemaVersion: data.contentSchemaVersion,
        body: localBody,
      });
      return;
    }

    if (!id || !note) return;

    if (action === "apply") {
      if (!this.beginProcessing(event.relativePath)) return;
      this.send({
        action: "apply",
        id,
        relativePath: event.relativePath,
        title: data.title?.trim() || undefined,
        emoji: data.emoji ?? null,
        bookmarkedAt: data.bookmarked ?? null,
        sortOrder: typeof data.order === "number" ? data.order : undefined,
        updatedAt: data.updated,
        body: localBody,
      });
      return;
    }

    if (!this.beginProcessing(event.relativePath)) return;
    this.send({
      action: "conflict",
      id,
      relativePath: event.relativePath,
      body,
      existingContent: note.content,
    });
  }

  /**
   * An external delete: trash the note whose file disappeared (and its subtree),
   * unless the same note id still exists elsewhere in the vault — that means the
   * file was renamed/moved, and the matching add/change event will adopt it.
   * Our own rename, trash, and purge operations record the new path or
   * `deletedAt` before removing the old file, so they never land here.
   */
  private onFileRemoved(relativePath: string, directory: string): void {
    if (!relativePath.toLowerCase().endsWith(".md")) return;
    if (isConflictCopyPath(relativePath)) return;
    // A removed path invalidates its own-write baseline, so re-adding the same
    // bytes later (a move back) is not silently swallowed as our own write.
    this.watcher.unsuppress(relativePath);
    // Only act on a genuine delete: a failed read (permissions, transient IO)
    // must not trash a note whose file is still there.
    try {
      if (fs.existsSync(resolveWithinVault(directory, relativePath))) return;
    } catch {
      return;
    }

    const note = findDocumentByVaultPath(relativePath);
    if (!note || note.deletedAt) return;
    if (this.vaultStillHasId(directory, note.id)) return;

    try {
      const { trashedIds } = trashDocument(note.id);
      this.trashNoteFiles(trashedIds);
      this.rebalanceSiblings(note.parentId);
      this.recordTombstones(trashedIds, "trash");
      this.pathCache = null;
      this.send({ action: "delete", relativePath, ids: trashedIds });
    } catch (error) {
      console.error("Vault delete handling failed:", error);
    }
  }

  /**
   * Whether a note id is still present anywhere in the vault (rename guard).
   * Scans fresh every time: a cached scan can be stale mid-rename, which would
   * make the old name's unlink look like a real delete.
   */
  private vaultStillHasId(directory: string, id: string): boolean {
    for (const entry of scanVaultDirectory(directory).entries) {
      if (entry.id === id) return true;
    }
    return false;
  }

  /**
   * The parent note id implied by the on-disk folder layout. Unlike
   * `resolveParentId`, this reads the parent file directly, so it works even
   * when the parent note has not been imported yet (scan-order independence).
   */
  private parentIdFromVault(directory: string, relativePath: string): string | null {
    const parentPath = parentMarkdownPath(relativePath);
    if (!parentPath) return null;
    return (
      scanVaultDirectory(directory).entries.find(
        (entry) => entry.relativePath.toLowerCase() === parentPath.toLowerCase(),
      )?.id ?? null
    );
  }

  /**
   * Signal the renderer that the database changed outside one of its own store
   * actions (e.g. an agent/MCP/script called an IPC mutation directly), so the
   * sidebar and open tabs reload. `ids` is empty: nothing was trashed.
   */
  notifyChanged(): void {
    this.send({ action: "sync", ids: [] });
  }

  /**
   * Enforce one file per note id: any *other* file carrying `id` is an orphan
   * (a duplicate/leftover). Move it to `.trash` so the vault and DB agree.
   */
  private dedupeId(directory: string, id: string, keepPath: string | undefined): void {
    if (!keepPath) return;
    for (const entry of scanVaultDirectory(directory).entries) {
      if (entry.id !== id || entry.relativePath === keepPath) continue;
      try {
        trashVaultEntry(directory, entry.relativePath);
      } catch {
        // Best-effort; the next boot reconcile will clean it up.
      }
    }
  }

  /**
   * Reparent every note whose file is a direct child of `parentPath` (folder-per-
   * note layout) to `parentId`. Used when a parent is imported after its children.
   */
  private adoptChildren(parentId: string, parentPath: string): void {
    const prefix = `${parentPath.replace(/\.md$/i, "")}/`;
    for (const { id, vaultRelativePath } of listVaultBackedDocuments()) {
      if (id === parentId) continue;
      if (!vaultRelativePath.startsWith(prefix)) continue;
      if (vaultRelativePath.slice(prefix.length).includes("/")) continue;
      const child = getDocumentById(id);
      if (child && child.parentId !== parentId) {
        updateDocument(id, { parentId });
      }
    }
  }

  /** Returns false when the path is already being applied (queued instead). */
  private beginProcessing(relativePath: string): boolean {
    if (this.pending.has(relativePath)) {
      this.queued.add(relativePath);
      return false;
    }
    this.pending.add(relativePath);
    return true;
  }

  private pathMap(): Map<string, string> {
    const now = Date.now();
    if (!this.pathCache || now - this.pathCache.at > 1000) {
      this.pathCache = { at: now, map: planVaultPaths(listDocumentTree()) };
    }
    return this.pathCache.map;
  }

  resolve(request: VaultResolveRequest): void {
    const directory = this.watcher.getDirectory();
    if (!directory) return;

    try {
      if (request.action === "import") {
      const id = request.id;
      const metadata: NoteMetadata = {};
      if (typeof request.contentSchemaVersion === "number") {
        metadata.contentSchemaVersion = request.contentSchemaVersion;
      }
      if (request.bookmarkedAt) metadata.bookmarkedAt = request.bookmarkedAt;
      importDocument({
        id,
        title: request.title,
        content: stripLeadingTitle(request.content, request.title),
        parentId: request.parentId,
        emoji: request.emoji ?? null,
        sortOrder: request.sortOrder,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      const note = getDocumentById(id);
      if (!note) return;
      setDocumentMetadata(id, { vaultRelativePath: request.relativePath });
      // The watcher may import a child before its parent file; when the parent
      // lands, adopt the children whose files sit directly under it so the tree
      // is correct regardless of scan order.
      this.adoptChildren(id, request.relativePath);
      this.pathCache = null;
      // Write canonical content IN PLACE. Do not sweep here: planVaultPaths
      // treats an unknown parent as root, so a child imported before its parent
      // would be relocated out of its folder (and lose its parent link).
      this.writeCanonical(
        directory,
        request.relativePath,
        note,
        note.content,
        note.content,
        { fsync: true },
      );
      return;
    }

    if (request.action === "apply") {
      const existing = getDocumentById(request.id);
      if (!existing) return;
      // Frontmatter title is authoritative; a changed filename stem is a
      // retitle only when the frontmatter title did not change. A path change
      // can also re-parent (folder move).
      const previousPath = existing.metadata.vaultRelativePath;
      const pathChanged = previousPath !== undefined && previousPath !== request.relativePath;
      const title = resolveTitle({
        frontmatterTitle: request.title,
        stemTitle: markdownStem(request.relativePath),
        currentTitle: existing.title,
      });
      const parentId =
        pathChanged && directory
          ? this.resolveParentIdByActualPath(directory, request.relativePath)
          : existing.parentId;
      // `order` from the file is a live reorder; apply it (with sibling shifting).
      const nextOrder =
        typeof request.sortOrder === "number" ? request.sortOrder : existing.sortOrder;
      const movedOrReordered =
        !existing.deletedAt &&
        (parentId !== existing.parentId || nextOrder !== existing.sortOrder);
      updateDocument(request.id, {
        title,
        parentId,
        content: stripLeadingTitle(request.content, title),
        // Adopt the file's own timestamp so ordering/tombstones stay truthful.
        updatedAt: request.updatedAt,
        ...(request.emoji !== undefined ? { emoji: request.emoji } : {}),
        ...(request.bookmarkedAt !== undefined
          ? { metadata: { bookmarkedAt: request.bookmarkedAt } }
          : {}),
      });
      if (movedOrReordered) {
        try {
          moveDocument(request.id, parentId, nextOrder);
        } catch {
          // Field update already applied; a bad target must not abort the apply.
        }
      }
      // The external file is the source: record its path so the canonical
      // write/rename starts from the right place.
      setDocumentMetadata(request.id, { vaultRelativePath: request.relativePath });
      this.pathCache = null;
      this.writeNoteToVault(request.id, true, true);
      this.sweepPaths();
      // A path change can mean a rename/move — or that a second file claimed
      // this id. There must be exactly one file per id, so trash the rest
      // (instead of leaving orphans for the next boot to reconcile).
      if (pathChanged) {
        this.dedupeId(
          directory,
          request.id,
          getDocumentById(request.id)?.metadata.vaultRelativePath,
        );
      }
      // A reorder shifts siblings' `order`, so rewrite their frontmatter too.
      if (movedOrReordered) {
        const parents = new Set<string | null>([existing.parentId, parentId]);
        const affected = new Set<string>([request.id]);
        for (const node of listDocumentTree()) {
          if (parents.has(node.parentId)) affected.add(node.id);
        }
        this.rewriteNotes([...affected]);
      }
      return;
    }

    // conflict: preserve the external edit, then restore the canonical file.
    const note = getDocumentById(request.id);
    if (!note) return;

    const timestamp = new Date().toISOString();
    // Never overwrite an existing conflict copy: disambiguate same-second ones.
    let conflictPath = conflictCopyPath(request.relativePath, timestamp);
    for (let n = 1; fs.existsSync(resolveWithinVault(directory, conflictPath)); n += 1) {
      conflictPath = conflictCopyPath(request.relativePath, timestamp, n);
    }
    const conflictFile =
      serializeFrontmatter({
        id: randomUUID(),
        title: `${note.title || "Note"} (conflict)`,
        created: timestamp,
        updated: timestamp,
        contentSchemaVersion: note.metadata.contentSchemaVersion ?? CONTENT_SCHEMA_VERSION,
        order: note.sortOrder,
      }) +
      "\n" +
      request.conflictContents;
    writeVaultFile(directory, conflictPath, conflictFile);

      this.writeCanonical(directory, request.relativePath, note, request.bodyMarkdown, note.content);
    } finally {
      // Release the path; if it changed again while we were working, re-read it
      // so no external edit is dropped.
      this.pending.delete(request.relativePath);
      if (this.queued.delete(request.relativePath)) {
        this.watcher.refresh(request.relativePath);
      }
    }
  }

  private writeCanonical(
    directory: string,
    relativePath: string,
    note: DocumentRow,
    bodyMarkdown: string,
    contentRevisionSource: string,
    options: { fsync?: boolean } = {},
  ): void {
    const fileContents =
      serializeFrontmatter({
        id: note.id,
        title: note.title,
        emoji: note.emoji ?? undefined,
        bookmarked: note.metadata.bookmarkedAt ?? undefined,
        created: note.createdAt,
        updated: note.updatedAt,
        contentSchemaVersion: note.metadata.contentSchemaVersion ?? CONTENT_SCHEMA_VERSION,
        order: note.sortOrder,
      }) +
      "\n" +
      exportAssetsToVault(directory, stripLeadingTitle(bodyMarkdown, note.title));
    writeVaultFile(directory, relativePath, fileContents, options);
    const fileRevision = revisionOf(fileContents);
    setDocumentMetadata(note.id, {
      vaultFileRevision: fileRevision,
      vaultContentRevision: revisionOf(contentRevisionSource),
      vaultRelativePath: relativePath,
    });
    this.watcher.suppress(relativePath, fileRevision);
  }
}

let instance: VaultSync | null = null;

function broadcast(event: VaultFileChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    win.webContents.send("vault:file-changed", event);
  }
}

export function getVaultSync(): VaultSync {
  if (!instance) instance = new VaultSync(broadcast);
  return instance;
}
