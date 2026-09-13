import type { NoteMetadata } from "../shared/documents";
import { revisionOf } from "../shared/hash";
import { serializeFrontmatter } from "../shared/frontmatter";
import { parentMarkdownPath, planVaultPaths, markdownStem } from "../shared/vault-path";
import { stripLeadingTitle, resolveTitle } from "../shared/markdown-title";
import { applyIndexFields, getDocumentById, listDocumentTree, setDocumentMetadata } from "./repos/documents";
import { scanVaultDirectory, trashVaultEntry, renameVaultEntry, writeVaultFile } from "./vault";
import { importAssetsFromVault } from "./assets";
import type { ScannedVaultEntry } from "../shared/vault-import";

/**
 * Rebuild the SQLite index's metadata and hierarchy from the vault files.
 *
 * Files are authoritative: frontmatter supplies title/emoji/order/dates/bookmark,
 * the folder layout supplies parentage, and the body supplies content. Run at
 * startup and after bootstrap so the index self-heals from the vault; idempotent.
 *
 * Multiple files can share an id (orphans left by a pre-move title change). The
 * newest one wins and the rest are moved to `.trash` so they can never ping-pong
 * stale content back into the note.
 */
export function reconcileIndexFromVault(vault: string): { updated: number } {
  const { entries } = scanVaultDirectory(vault);

  const byId = new Map<string, ScannedVaultEntry[]>();
  for (const entry of entries) {
    if (!entry.id) continue;
    const group = byId.get(entry.id) ?? [];
    group.push(entry);
    byId.set(entry.id, group);
  }

  // Choose the newest entry per id and trash the orphans.
  const chosen = new Map<string, ScannedVaultEntry>();
  for (const [id, group] of byId) {
    if (!getDocumentById(id)) continue; // new file: the watcher imports it
    const picked = [...group].sort((a, b) =>
      (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? ""),
    )[0];
    chosen.set(id, picked);

    for (const entry of group) {
      if (entry === picked) continue;
      try {
        trashVaultEntry(vault, entry.relativePath);
      } catch {
        // A failed cleanup must not abort reconciliation.
      }
    }
  }

  const idByPath = new Map<string, string>();
  // Case-insensitive: macOS/Windows treat `Folder.md` and `folder.md` as the
  // same file, so a child path and its parent note can differ only by case.
  for (const [id, entry] of chosen) idByPath.set(entry.relativePath.toLowerCase(), id);

  const isDescendantOf = (candidateId: string, ancestorId: string): boolean => {
    const seen = new Set<string>();
    let current: string | null = candidateId;
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = getDocumentById(current)?.parentId ?? null;
    }
    return false;
  };

  let updated = 0;
  for (const [id, entry] of chosen) {
    const row = getDocumentById(id);
    if (!row) continue;

    const parentPath = parentMarkdownPath(entry.relativePath);
    let parentId: string | null = parentPath
      ? idByPath.get(parentPath.toLowerCase()) ?? null
      : null;
    if (parentId && !getDocumentById(parentId)) parentId = null;
    // Never point a note at itself or one of its descendants (folder moves can
    // otherwise create cycles that the tree rendering would choke on).
    if (parentId && (parentId === id || isDescendantOf(parentId, id))) {
      parentId = null;
    }

    const metadata: NoteMetadata = {
      ...row.metadata,
      // Track the on-disk path so a later title change/move renames this file
      // instead of leaving another orphan behind.
      vaultRelativePath: entry.relativePath,
    };
    if (entry.bookmarked !== undefined) metadata.bookmarkedAt = entry.bookmarked ?? null;

    // Frontmatter title is authoritative; a changed filename stem is adopted
    // only when the frontmatter title did not change (external rename).
    const adoptedTitle = resolveTitle({
      frontmatterTitle: entry.title,
      stemTitle: markdownStem(entry.relativePath),
      currentTitle: row.title,
    });

    // Files are the source of truth for content. Adopt the file body (rewriting
    // portable `assets/...` back to local image ids) so the index self-heals —
    // this also repairs rows left over from the pre-markdown migration. An empty
    // body is ignored so a not-yet-written file cannot wipe a note.
    const hasBody = entry.body.trim().length > 0;
    const fileContent = hasBody
      ? stripLeadingTitle(importAssetsFromVault(vault, entry.body), adoptedTitle)
      : null;
    if (fileContent !== null) metadata.vaultContentRevision = revisionOf(fileContent);
    // Baseline the file revision we're adopting so the watcher treats the current
    // bytes as ours and does not re-apply every file on the next watch start.
    if (entry.revision) metadata.vaultFileRevision = entry.revision;

    applyIndexFields(id, {
      title: adoptedTitle,
      ...(fileContent !== null ? { content: fileContent } : {}),
      // Only take over when the file explicitly carries the field; older vault
      // files predate emoji/bookmark frontmatter and must not clear the index.
      emoji: entry.emoji === undefined ? row.emoji : entry.emoji,
      sortOrder: typeof entry.order === "number" ? entry.order : row.sortOrder,
      parentId,
      createdAt: entry.created ?? row.createdAt,
      updatedAt: entry.updated ?? row.updatedAt,
      metadata,
    });
    updated += 1;

    // One-time migration: drop the legacy frontmatter `title` and body `# Title`
    // line, so the file matches the filename-as-title model.
    const strippedBody = stripLeadingTitle(entry.body, adoptedTitle);
    if (entry.title !== undefined || strippedBody !== entry.body) {
      const frontmatter = serializeFrontmatter({
        id,
        title: adoptedTitle,
        emoji: entry.emoji,
        bookmarked: entry.bookmarked,
        created: entry.created,
        updated: entry.updated,
        contentSchemaVersion: entry.contentSchemaVersion,
        order: typeof entry.order === "number" ? entry.order : undefined,
      });
      const contents = `${frontmatter}\n${strippedBody}`;
      try {
        writeVaultFile(vault, entry.relativePath, contents);
        setDocumentMetadata(id, { vaultFileRevision: revisionOf(contents) });
      } catch {
        // A failed migration rewrite must not abort reconciliation.
      }
    }
  }

  // Self-heal: if a committed title change never got its rename (e.g. the app
  // was closed mid-commit), move the file to its canonical path now.
  const canonical = planVaultPaths(listDocumentTree());
  for (const [id, entry] of chosen) {
    const desired = canonical.get(id);
    if (desired && desired !== entry.relativePath) {
      try {
        renameVaultEntry(vault, entry.relativePath, desired);
        setDocumentMetadata(id, { vaultRelativePath: desired });
      } catch {
        // A failed rename must not abort reconciliation.
      }
    }
  }

  return { updated };
}
