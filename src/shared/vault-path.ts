/**
 * Vault path planning: map the note tree onto the folder-per-note layout.
 *
 *   <vault>/
 *     Parent Note.md      <- parent body
 *     Parent Note/        <- children of Parent Note
 *       Child A.md
 *
 * Directory location encodes hierarchy, so a re-parent in Finder is a legitimate
 * edit. Filenames are display-only: identity is the frontmatter `id`.
 */

export interface VaultDoc {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
}

/** A file to write, relative to the vault root. */
export interface VaultWriteEntry {
  relativePath: string;
  contents: string;
  /** The note this file was exported from, when known. Used for write baselines. */
  noteId?: string;
}

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/**
 * Filenames are capped in BYTES, not characters: most filesystems limit a name
 * to 255 bytes (NAME_MAX), so an emoji/accented title needs far fewer
 * characters. This leaves room for the `.md` extension and a dedup suffix.
 */
const MAX_STEM_BYTES = 200;
/** Keep the full POSIX path well under common OS limits (Windows MAX_PATH). */
const MAX_PATH_BYTES = 220;

const utf8 = new TextEncoder();

/** Truncate a string to at most `maxBytes` UTF-8 bytes, on a code-point boundary. */
function truncateToBytes(value: string, maxBytes: number): string {
  let total = 0;
  let out = "";
  for (const char of value) {
    const size = utf8.encode(char).length;
    if (total + size > maxBytes) break;
    total += size;
    out += char;
  }
  return out;
}

/**
 * Trim a stem to `maxBytes` UTF-8 bytes without leaving trailing dots/spaces
 * (which Windows strips, silently colliding with another name). Never empty.
 */
export function capFileStem(stem: string, maxBytes: number = MAX_STEM_BYTES): string {
  const out = truncateToBytes(stem, maxBytes);
  const trimmed = out.replace(/[. ]+$/g, '');
  return trimmed || 'Untitled';
}

/**
 * Sanitize a title into a safe cross-platform file stem (no extension). Handles
 * illegal characters (the union of POSIX, macOS, and Windows rules), NFC
 * normalization, reserved Windows names, leading dots (dotfiles are ignored by
 * the watcher), trailing dots/spaces, control characters, and byte-length
 * limits. Idempotent. The *title* itself is never mangled — it lives in
 * frontmatter; only this derived filename is.
 */
export function sanitizeFileStem(title: string, maxBytes: number = MAX_STEM_BYTES): string {
  let stem = (title || '').normalize('NFC');
  // eslint-disable-next-line no-control-regex
  stem = stem.replace(/[\u0000-\u001f\u007f]/g, '');
  // `/` and NUL are illegal on POSIX; `:` on macOS; `< > : " \ | ? *` on Windows.
  stem = stem.replace(/[\\/:*?"<>|]/g, '-');
  stem = stem.replace(/\s+/g, ' ').trim();
  // Never create a dotfile: it (and any dot-directory) is invisible to the
  // watcher and to the vault reader.
  stem = stem.replace(/^\.+/, '');
  stem = stem.replace(/[. ]+$/g, '');
  stem = capFileStem(stem, maxBytes);
  if (RESERVED_WINDOWS_NAMES.test(stem)) stem = capFileStem(`_${stem}`, maxBytes);
  return stem;
}

/** A deduped sibling stem (`Note (2)`), byte-capped while keeping the suffix. */
export function siblingFileStem(
  base: string,
  suffix: number,
  maxBytes: number = MAX_STEM_BYTES,
): string {
  if (suffix <= 1) return base;
  const suffixText = ` (${suffix})`;
  const room = Math.max(8, maxBytes - utf8.encode(suffixText).length);
  return capFileStem(`${capFileStem(base, room)}${suffixText}`, maxBytes);
}

/** The file stem (no extension) of a relative markdown path. */
export function markdownStem(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const file = normalized.slice(normalized.lastIndexOf('/') + 1);
  return file.toLowerCase().endsWith('.md') ? file.slice(0, -3) : file;
}

/**
 * The markdown file that holds the parent of `relativePath`, using the
 * folder-per-note layout: `A/B.md` belongs to the note at `A.md`. Returns null
 * for a root-level note.
 */
export function parentMarkdownPath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index === -1) return null;
  return `${normalized.slice(0, index)}.md`;
}

/** Sibling path for a conflicting write: `Note.md` -> `Note (conflict <ts>).md`. */
export function conflictCopyPath(
  relativePath: string,
  isoTimestamp: string,
  /** Disambiguates multiple conflicts in the same second: 0, 1, 2 -> no/2/3. */
  index = 0,
): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const directory = slash === -1 ? '' : normalized.slice(0, slash + 1);
  const file = slash === -1 ? normalized : normalized.slice(slash + 1);
  const hasExtension = file.toLowerCase().endsWith('.md');
  const stem = hasExtension ? file.slice(0, -3) : file;
  const extension = hasExtension ? '.md' : '';
  const stamp = isoTimestamp.slice(0, 19).replace('T', ' ').replace(/:/g, '-');
  const suffix = index > 0 ? ` (conflict ${stamp} ${index + 1})` : ` (conflict ${stamp})`;
  const room = Math.max(8, MAX_STEM_BYTES - utf8.encode(suffix).length);
  const conflictStem = sanitizeFileStem(`${capFileStem(stem, room)}${suffix}`);
  return `${directory}${conflictStem}${extension}`;
}

/**
 * Compute a relative POSIX path (`Foo/Bar.md`) for every document. Sibling
 * stems are de-duplicated (`Meeting (2)`). Documents whose `parentId` is missing
 * or part of a cycle are placed at the root rather than dropped.
 */
export function planVaultPaths(documents: VaultDoc[]): Map<string, string> {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const byParent = new Map<string | null, VaultDoc[]>();

  for (const doc of documents) {
    const parent = doc.parentId && byId.has(doc.parentId) ? doc.parentId : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(doc);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  const paths = new Map<string, string>();

  const place = (parentId: string | null, parentDir: string): void => {
    const siblings = byParent.get(parentId) ?? [];
    const used = new Set<string>();
    // Budget the stem so the full path stays under OS limits as folders nest.
    const maxStem = Math.max(
      8,
      Math.min(MAX_STEM_BYTES, MAX_PATH_BYTES - utf8.encode(parentDir).length - 4),
    );

    for (const doc of siblings) {
      if (paths.has(doc.id)) continue; // cycle guard

      const base = sanitizeFileStem(doc.title, maxStem);
      let stem = base;
      let suffix = 1;
      while (used.has(stem.toLowerCase())) {
        suffix += 1;
        stem = siblingFileStem(base, suffix, maxStem);
      }
      used.add(stem.toLowerCase());

      const relative = parentDir ? `${parentDir}/${stem}` : stem;
      paths.set(doc.id, `${relative}.md`);
      place(doc.id, relative);
    }
  };

  place(null, '');

  // Any document not reached from a root (broken parent chain / cycle) is placed
  // at the vault root so nothing is silently omitted.
  for (const doc of documents) {
    if (paths.has(doc.id)) continue;
    const base = sanitizeFileStem(doc.title);
    let stem = base;
    let suffix = 1;
    while ([...paths.values()].some((p) => p.toLowerCase() === `${stem}.md`.toLowerCase())) {
      suffix += 1;
      stem = siblingFileStem(base, suffix);
    }
    paths.set(doc.id, `${stem}.md`);
  }

  return paths;
}
