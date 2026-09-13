import { markdownStem, parentMarkdownPath } from './vault-path';

/**
 * Pure planning for importing a scanned vault folder. Resolves duplicate IDs and
 * derives hierarchy from the folder-per-note layout. No filesystem / DB access,
 * so it is fully unit-testable and the caller can preview the plan first.
 *
 * Policy: identity is the frontmatter `id`. Within one scan, duplicates are
 * resolved to a single canonical entry (newest `updated`, then path); every other
 * duplicate is kept as a NEW note (id `null` → caller assigns a fresh UUID) so no
 * content is lost. Import is additive; this planner never signals a delete.
 */

export interface ScannedVaultEntry {
  relativePath: string;
  id?: string;
  title?: string;
  emoji?: string;
  bookmarked?: string;
  created?: string;
  updated?: string;
  contentSchemaVersion?: number;
  order?: number;
  /** Revision of the raw file bytes, used to baseline the watcher on adoption. */
  revision?: string;
  body: string;
}

export interface VaultImportItem {
  relativePath: string;
  /** Stable id to import under, or null to assign a fresh one (duplicate/missing). */
  id: string | null;
  /** Set when this file duplicated another file's id. */
  duplicateOf?: string;
  parentId: string | null;
  title: string;
  emoji: string | null;
  bookmarkedAt: string | null;
  created?: string;
  updated?: string;
  contentSchemaVersion?: number;
  order: number;
  body: string;
}

/** What the renderer sends main to persist (content already converted). */
export interface VaultImportRequest {
  id: string | null;
  title: string;
  content: string;
  parentId: string | null;
  emoji: string | null;
  bookmarkedAt: string | null;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
  contentSchemaVersion?: number;
}

function isRealId(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function planVaultImport(entries: ScannedVaultEntry[]): VaultImportItem[] {
  // 1. Resolve duplicate ids within this scan.
  const byId = new Map<string, ScannedVaultEntry[]>();
  for (const entry of entries) {
    if (!isRealId(entry.id)) continue;
    const group = byId.get(entry.id) ?? [];
    group.push(entry);
    byId.set(entry.id, group);
  }

  const effectiveId = new Map<string, string | null>();
  const duplicateOf = new Map<string, string>();
  for (const [id, group] of byId) {
    const canonicalFirst = [...group].sort((a, b) => {
      const updatedA = a.updated ?? '';
      const updatedB = b.updated ?? '';
      if (updatedA !== updatedB) return updatedA < updatedB ? 1 : -1; // newest first
      return a.relativePath < b.relativePath ? -1 : 1;
    });
    canonicalFirst.forEach((entry, index) => {
      if (index === 0) {
        effectiveId.set(entry.relativePath, id);
      } else {
        effectiveId.set(entry.relativePath, null);
        duplicateOf.set(entry.relativePath, id);
      }
    });
  }
  for (const entry of entries) {
    if (!effectiveId.has(entry.relativePath)) effectiveId.set(entry.relativePath, null);
  }

  // 2. Map hierarchy and order.
  const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const siblingIndex = new Map<string, number>();
  const nextIndex = (parentPath: string | null): number => {
    const key = parentPath ?? '';
    const index = siblingIndex.get(key) ?? 0;
    siblingIndex.set(key, index + 1);
    return index;
  };

  return entries.map((entry) => {
    const parentPath = parentMarkdownPath(entry.relativePath);
    const parentEntry = parentPath ? byPath.get(parentPath) : undefined;
    const parentId = parentEntry
      ? effectiveId.get(parentEntry.relativePath) ?? null
      : null;

    const index = nextIndex(parentPath);
    const frontmatterTitle = entry.title?.trim();
    return {
      relativePath: entry.relativePath,
      id: effectiveId.get(entry.relativePath) ?? null,
      duplicateOf: duplicateOf.get(entry.relativePath),
      parentId,
      title: frontmatterTitle && frontmatterTitle.length > 0 ? frontmatterTitle : markdownStem(entry.relativePath),
      emoji: entry.emoji ?? null,
      bookmarkedAt: entry.bookmarked ?? null,
      created: entry.created,
      updated: entry.updated,
      contentSchemaVersion: entry.contentSchemaVersion,
      order: typeof entry.order === 'number' ? entry.order : index,
      body: entry.body,
    };
  });
}
