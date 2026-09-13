/**
 * Title handling helpers for the Obsidian-style model: a note's title is its
 * filename, and the markdown body never carries it. These helpers migrate older
 * files that still begin with a `# Title` line matching the note title.
 */

/** True when the value is legacy Lexical JSON rather than markdown. */
function isLegacyJson(markdown: string): boolean {
  return markdown.trimStart().startsWith("{");
}

/**
 * Remove a leading level-one heading when it matches `title` (the filename stem).
 * Used when adopting files written by an older build that stored the title in
 * the body. Headings deeper in the document are untouched.
 */
export function stripLeadingTitle(markdown: string, title: string): string {
  if (isLegacyJson(markdown)) return markdown;

  const lines = markdown.split("\n");
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index === -1) return markdown;

  const match = /^#\s+(.*)$/.exec(lines[index].trim());
  if (!match || match[1].trim() !== title.trim()) return markdown;

  const next = [...lines];
  next.splice(index, 1);
  return next.join("\n").replace(/^\n+/, "");
}

/**
 * Filename stems that mean "this note has no title". The vault writer names an
 * untitled note `Untitled.md` and de-duplicates siblings as `Untitled (2).md`,
 * so these must never be adopted back as a real title — otherwise every
 * round-trip would turn a blank note into one titled `Untitled`, then
 * `Untitled (2)`, and so on.
 */
const BLANK_TITLE_STEM = /^untitled( \(\d+\))?$/i;

export function isBlankTitleStem(stem: string | null | undefined): boolean {
  return BLANK_TITLE_STEM.test((stem ?? "").trim());
}

/**
 * Decide a note's title from its two on-disk hints, relative to the title the
 * note already had. Frontmatter `title` is authoritative; a changed filename
 * stem is adopted only when the frontmatter title did not change (an external
 * rename). Blank stems and the legacy `Untitled` sentinel resolve to "".
 * `currentTitle` is the last known title.
 *
 * Comparisons are case-insensitive: on macOS/Windows `canonical.md` and the
 * title `Canonical` are the same file, so a case-only difference must not be
 * mistaken for a rename (it would otherwise lowercase the title).
 */
export function resolveTitle(args: {
  frontmatterTitle?: string | null;
  stemTitle?: string | null;
  currentTitle: string;
}): string {
  const { currentTitle } = args;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const frontmatter = args.frontmatterTitle?.trim();
  if (frontmatter !== undefined && !same(frontmatter, currentTitle)) {
    return isBlankTitleStem(frontmatter) ? "" : frontmatter;
  }
  const stem = args.stemTitle?.trim();
  if (stem && !same(stem, currentTitle)) {
    return isBlankTitleStem(stem) ? "" : stem;
  }
  return isBlankTitleStem(currentTitle) ? "" : currentTitle;
}

/**
 * Resolve the title for a newly discovered file that has no DB row yet: an
 * explicit (legacy) frontmatter title wins, otherwise the filename stem, with
 * the blank-note sentinel resolving to "".
 */
export function resolveNewTitle(args: {
  frontmatterTitle?: string | null;
  stemTitle?: string | null;
}): string {
  const frontmatter = args.frontmatterTitle?.trim();
  if (frontmatter) return isBlankTitleStem(frontmatter) ? "" : frontmatter;
  const stem = args.stemTitle?.trim();
  return stem && !isBlankTitleStem(stem) ? stem : "";
}
