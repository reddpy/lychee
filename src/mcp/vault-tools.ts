import fs from "fs";
import path from "path";
import { parseFrontmatter, serializeFrontmatter } from "../shared/frontmatter";
import { revisionOf } from "../shared/hash";
import { markdownStem, sanitizeFileStem, siblingFileStem } from "../shared/vault-path";
import { isDeletedState, tombstoneSupersedes, type TombstoneState } from "../shared/tombstone";
import {
  resolveWithinVault,
  renameVaultEntry,
  restoreVaultEntry,
  scanVaultDirectory,
  trashVaultEntry,
  writeVaultFile,
} from "../main/vault";
import { appendTombstone, readTombstones } from "../main/tombstone-io";

/**
 * Vault-backed tools shared by the MCP server (and unit-testable directly).
 *
 * Read tools operate on the markdown files, so they work whether or not the app
 * is running. Writes preserve frontmatter and are optimistic: callers may pass
 * the `revision` they last read, and the write is refused if the file changed —
 * the same revision guard the app uses.
 */

const INTERNAL_LINK = /https:\/\/note\.lychee\.invalid\/([A-Za-z0-9._-]+)/g;

export interface NoteSummary {
  id: string;
  title: string;
  relativePath: string;
  created?: string;
  updated?: string;
  order?: number;
}

export interface NoteDocument extends NoteSummary {
  markdown: string;
  body: string;
  revision: string;
}

function activeEntries(vault: string) {
  const { entries } = scanVaultDirectory(vault);
  const tombstones = readTombstones(vault);
  return entries.filter((entry) => {
    const state = entry.id ? tombstones.get(entry.id) : undefined;
    return !(state && isDeletedState(state) && tombstoneSupersedes(state, entry.updated));
  });
}

function toSummary(entry: {
  relativePath: string;
  id?: string;
  title?: string;
  created?: string;
  updated?: string;
  order?: number;
}): NoteSummary {
  const stem = entry.relativePath.replace(/\\/g, "/").split("/").pop() ?? entry.relativePath;
  return {
    id: entry.id ?? "",
    title: entry.title?.trim() || stem.replace(/\.md$/i, ""),
    relativePath: entry.relativePath,
    created: entry.created,
    updated: entry.updated,
    order: entry.order,
  };
}

export function listNotes(vault: string): NoteSummary[] {
  return activeEntries(vault).map(toSummary);
}

function findEntry(vault: string, idOrPath: string) {
  const normalized = idOrPath.replace(/\\/g, "/");
  return activeEntries(vault).find(
    (entry) => entry.id === idOrPath || entry.relativePath === normalized,
  );
}

export function getNote(vault: string, idOrPath: string): NoteDocument | null {
  const entry = findEntry(vault, idOrPath);
  if (!entry) return null;

  const absolute = resolveWithinVault(vault, entry.relativePath);
  let markdown: string;
  try {
    markdown = fs.readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
  const { body } = parseFrontmatter(markdown);
  return { ...toSummary(entry), markdown, body, revision: revisionOf(markdown) };
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}

export interface SearchHit extends NoteSummary {
  snippet: string;
}

export function searchNotes(vault: string, query: string, limit = 20): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: SearchHit[] = [];
  for (const entry of activeEntries(vault)) {
    const summary = toSummary(entry);
    const haystack = `${summary.title}\n${entry.body}`;
    const index = haystack.toLowerCase().indexOf(needle);
    if (index === -1) continue;
    hits.push({ ...summary, snippet: snippetAround(haystack, index, needle.length) });
    if (hits.length >= limit) break;
  }
  return hits;
}

export interface Backlink {
  id: string;
  title: string;
  relativePath: string;
}

/** Notes whose body links to `id` via the internal note URL. */
export function findBacklinks(vault: string, id: string): Backlink[] {
  const backlinks: Backlink[] = [];
  for (const entry of activeEntries(vault)) {
    if (entry.id === id) continue;
    let found = false;
    for (const match of entry.body.matchAll(INTERNAL_LINK)) {
      if (match[1] === id) {
        found = true;
        break;
      }
    }
    if (found) {
      const summary = toSummary(entry);
      backlinks.push({ id: summary.id, title: summary.title, relativePath: summary.relativePath });
    }
  }
  return backlinks;
}

export type WriteResult =
  | { ok: true; relativePath: string; revision: string }
  | { ok: false; reason: string; currentRevision?: string };

/** The multiset of `lychee-*` fence languages in a body. */
function fenceLanguages(body: string): string[] {
  const languages: string[] = [];
  for (const match of body.matchAll(/```+\s*(lychee-[a-z-]+)/gi)) {
    languages.push(match[1].toLowerCase());
  }
  return languages.sort();
}

/**
 * Replace a note's body, preserving its frontmatter (identity stays stable).
 * Refuses when `expectedRevision` is supplied and the file has changed since.
 *
 * Unless `allowFenceChanges` is set, it also refuses a body edit that would
 * add/remove a `lychee-*` encoded block — the classic way a whole-body agent
 * rewrite silently drops references, bookmarks, or unknown nodes.
 */
export function updateNote(
  vault: string,
  idOrPath: string,
  body: string,
  expectedRevision?: string,
  allowFenceChanges = false,
): WriteResult {
  const entry = findEntry(vault, idOrPath);
  if (!entry) return { ok: false, reason: "note_not_found" };

  const absolute = resolveWithinVault(vault, entry.relativePath);
  let current: string;
  try {
    current = fs.readFileSync(absolute, "utf8");
  } catch {
    return { ok: false, reason: "note_unreadable" };
  }

  const currentRevision = revisionOf(current);
  if (expectedRevision && expectedRevision !== currentRevision) {
    return { ok: false, reason: "revision_mismatch", currentRevision };
  }

  const { data, body: currentBody } = parseFrontmatter(current);
  if (!allowFenceChanges) {
    const before = fenceLanguages(currentBody).join(",");
    const after = fenceLanguages(body).join(",");
    if (before !== after) {
      return { ok: false, reason: "fence_conflict", currentRevision };
    }
  }

  const frontmatter = serializeFrontmatter({
    id: data.id ?? entry.id ?? "",
    title: data.title ?? entry.title ?? "",
    created: data.created,
    updated: new Date().toISOString(),
    contentSchemaVersion: data.contentSchemaVersion,
    order: data.order,
  });
  const next = `${frontmatter}\n${body.replace(/^\n+/, "")}`;
  writeVaultFile(vault, entry.relativePath, next);
  return { ok: true, relativePath: entry.relativePath, revision: revisionOf(next) };
}

/**
 * Targeted text replacement inside a note body. Preserves everything else
 * (including `lychee-*` blocks) and is the preferred edit for agents.
 */
export function replaceInNote(
  vault: string,
  idOrPath: string,
  find: string,
  replace: string,
  expectedRevision?: string,
): WriteResult {
  const note = getNote(vault, idOrPath);
  if (!note) return { ok: false, reason: "note_not_found" };
  if (!find) return { ok: false, reason: "empty_find" };
  if (!note.body.includes(find)) return { ok: false, reason: "find_not_found" };

  const body = note.body.split(find).join(replace);
  // A targeted replacement is explicit, so fence changes are permitted.
  return updateNote(vault, idOrPath, body, expectedRevision ?? note.revision, true);
}

/** Append markdown to the end of a note's body. */
export function appendToNote(
  vault: string,
  idOrPath: string,
  text: string,
  expectedRevision?: string,
): WriteResult {
  const note = getNote(vault, idOrPath);
  if (!note) return { ok: false, reason: "note_not_found" };
  const body = `${note.body.replace(/\s+$/, "")}\n\n${text.trim()}\n`;
  return updateNote(vault, idOrPath, body, expectedRevision ?? note.revision);
}

/**
 * Rename a note by changing its title — the filename *is* the title (Obsidian
 * model), so this moves the file (and its child folder) rather than editing
 * frontmatter or the body. Contents are preserved. Sibling collisions are
 * resolved with a ` (2)` suffix, matching the app's path planner.
 */
export function renameNote(
  vault: string,
  idOrPath: string,
  newTitle: string,
  expectedRevision?: string,
): WriteResult {
  const entry = findEntry(vault, idOrPath);
  if (!entry) return { ok: false, reason: "note_not_found" };

  const title = newTitle.trim();
  if (!title) return { ok: false, reason: "empty_title" };

  const clash = activeEntries(vault).some(
    (candidate) =>
      candidate.id !== entry.id &&
      (candidate.title?.trim() || markdownStem(candidate.relativePath)) === title,
  );
  if (clash) return { ok: false, reason: "duplicate_title" };

  const absolute = resolveWithinVault(vault, entry.relativePath);
  let current: string;
  try {
    current = fs.readFileSync(absolute, "utf8");
  } catch {
    return { ok: false, reason: "note_unreadable" };
  }

  const currentRevision = revisionOf(current);
  if (expectedRevision && expectedRevision !== currentRevision) {
    return { ok: false, reason: "revision_mismatch", currentRevision };
  }

  const normalized = entry.relativePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const directory = slash === -1 ? "" : normalized.slice(0, slash + 1);

  const base = sanitizeFileStem(title);
  let stem = base;
  let suffix = 1;
  let target = `${directory}${stem}.md`;
  while (
    target.toLowerCase() !== normalized.toLowerCase() &&
    fs.existsSync(resolveWithinVault(vault, target))
  ) {
    suffix += 1;
    stem = siblingFileStem(base, suffix);
    target = `${directory}${stem}.md`;
  }

  const samePath =
    target === normalized || target.toLowerCase() === normalized.toLowerCase();
  if (!samePath) {
    renameVaultEntry(vault, entry.relativePath, target);
  } else {
    target = normalized;
  }

  // Frontmatter `title` is authoritative: set it to the exact requested title
  // (the filename may be a sanitized handle that can't represent it).
  const { data, body } = parseFrontmatter(current);
  const next = `${serializeFrontmatter({
    id: data.id ?? entry.id ?? "",
    title,
    emoji: data.emoji,
    bookmarked: data.bookmarked,
    created: data.created,
    updated: new Date().toISOString(),
    contentSchemaVersion: data.contentSchemaVersion,
    order: data.order,
  })}\n${body.replace(/^\n+/, "")}`;
  writeVaultFile(vault, target, next);
  return { ok: true, relativePath: target, revision: revisionOf(next) };
}

/** Files under `<vault>/.trash/`, with their frontmatter id. */
function trashedEntries(vault: string): Array<{ relativePath: string; id?: string }> {
  const results: Array<{ relativePath: string; id?: string }> = [];
  const walk = (directory: string): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const absolute = path.join(directory, dirent.name);
      if (dirent.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!dirent.isFile() || !dirent.name.toLowerCase().endsWith(".md")) continue;
      try {
        const { data } = parseFrontmatter(fs.readFileSync(absolute, "utf8"));
        results.push({
          relativePath: path.relative(vault, absolute).split(path.sep).join("/"),
          id: data.id,
        });
      } catch {
        // Unreadable trash entry: skip.
      }
    }
  };
  walk(path.join(vault, ".trash"));
  return results;
}

/**
 * Move a note under a new parent (or to the vault root). Hierarchy is the folder
 * layout and the title is the filename, so this moves the file (and its child
 * folder) into the parent's folder. Pass `parentIdOrPath` = null for the root.
 */
export function moveNote(
  vault: string,
  idOrPath: string,
  parentIdOrPath: string | null,
  expectedRevision?: string,
): WriteResult {
  const entry = findEntry(vault, idOrPath);
  if (!entry) return { ok: false, reason: "note_not_found" };

  const absolute = resolveWithinVault(vault, entry.relativePath);
  let current: string;
  try {
    current = fs.readFileSync(absolute, "utf8");
  } catch {
    return { ok: false, reason: "note_unreadable" };
  }
  const currentRevision = revisionOf(current);
  if (expectedRevision && expectedRevision !== currentRevision) {
    return { ok: false, reason: "revision_mismatch", currentRevision };
  }

  const normalized = entry.relativePath.replace(/\\/g, "/");
  const noteStem = markdownStem(normalized);
  const noteFolder = normalized.replace(/\.md$/i, "");

  let directory = "";
  if (parentIdOrPath) {
    const parent = findEntry(vault, parentIdOrPath);
    if (!parent) return { ok: false, reason: "parent_not_found" };
    const parentPath = parent.relativePath.replace(/\\/g, "/");
    if (
      parent.id === entry.id ||
      parentPath.toLowerCase() === normalized.toLowerCase() ||
      parentPath.startsWith(`${noteFolder}/`)
    ) {
      return { ok: false, reason: "cycle" };
    }
    directory = `${parentPath.replace(/\.md$/i, "")}/`;
  }

  let stem = noteStem;
  let suffix = 1;
  let target = `${directory}${stem}.md`;
  while (
    target.toLowerCase() !== normalized.toLowerCase() &&
    fs.existsSync(resolveWithinVault(vault, target))
  ) {
    suffix += 1;
    stem = siblingFileStem(noteStem, suffix);
    target = `${directory}${stem}.md`;
  }

  if (target === normalized) {
    return { ok: true, relativePath: normalized, revision: currentRevision };
  }
  renameVaultEntry(vault, entry.relativePath, target);
  return { ok: true, relativePath: target, revision: currentRevision };
}

/** Move a note to `<vault>/.trash/` and record a tombstone so devices converge. */
export function trashNote(
  vault: string,
  idOrPath: string,
  expectedRevision?: string,
): WriteResult {
  const entry = findEntry(vault, idOrPath);
  if (!entry) return { ok: false, reason: "note_not_found" };

  let current: string;
  try {
    current = fs.readFileSync(resolveWithinVault(vault, entry.relativePath), "utf8");
  } catch {
    return { ok: false, reason: "note_unreadable" };
  }
  const currentRevision = revisionOf(current);
  if (expectedRevision && expectedRevision !== currentRevision) {
    return { ok: false, reason: "revision_mismatch", currentRevision };
  }

  trashVaultEntry(vault, entry.relativePath);
  if (entry.id) appendTombstone(vault, entry.id, "trash", "mcp");
  return { ok: true, relativePath: entry.relativePath, revision: currentRevision };
}

/** Restore a trashed note to its original path and record a restore tombstone. */
export function restoreNote(
  vault: string,
  idOrPath: string,
  expectedRevision?: string,
): WriteResult {
  const normalized = idOrPath.replace(/\\/g, "/");
  const entry = trashedEntries(vault).find(
    (candidate) => candidate.id === idOrPath || candidate.relativePath === normalized,
  );
  if (!entry) return { ok: false, reason: "note_not_found" };

  const absolute = resolveWithinVault(vault, entry.relativePath);
  let current: string;
  try {
    current = fs.readFileSync(absolute, "utf8");
  } catch {
    return { ok: false, reason: "note_unreadable" };
  }
  const currentRevision = revisionOf(current);
  if (expectedRevision && expectedRevision !== currentRevision) {
    return { ok: false, reason: "revision_mismatch", currentRevision };
  }

  const original = entry.relativePath.replace(/^\.trash\//, "");
  const base = original.replace(/\.md$/i, "");
  let target = original;
  let suffix = 1;
  while (fs.existsSync(resolveWithinVault(vault, target))) {
    suffix += 1;
    target = `${siblingFileStem(base, suffix)}.md`;
  }

  renameVaultEntry(vault, entry.relativePath, target);
  if (entry.id) appendTombstone(vault, entry.id, "restore", "mcp");
  return { ok: true, relativePath: target, revision: currentRevision };
}

/** Absolute path of a note file, or null. */
export function notePath(vault: string, idOrPath: string): string | null {
  const entry = findEntry(vault, idOrPath);
  return entry ? path.join(vault, entry.relativePath) : null;
}

/** Effective tombstone state for a note id (for callers that need it). */
export function tombstoneState(vault: string, id: string): TombstoneState | undefined {
  return readTombstones(vault).get(id);
}
