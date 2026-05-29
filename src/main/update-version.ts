import semver from 'semver';

// Pure version-comparison helpers for the Linux update poll. Kept free of any
// `electron` import so they're unit-testable outside the Electron runtime.

/**
 * Normalizes a GitHub release tag to a canonical semver string, or null if it
 * can't be parsed. Tolerant of surrounding whitespace and a leading "v"/"V".
 * Strict parsing is preferred (keeps prerelease identifiers like -alpha.2);
 * coercion is the fallback for loose tags ("0.1" → "0.1.0").
 */
export function normalizeTag(tag: string | undefined | null): string | null {
  if (!tag) return null;
  const cleaned = tag.trim().replace(/^v/i, '');
  return semver.valid(cleaned) ?? semver.valid(semver.coerce(cleaned) ?? '');
}

/**
 * True when `tag` names a release strictly newer than `current`. Returns false
 * (rather than throwing) for unparseable tags or an unparseable `current`.
 */
export function isNewerRelease(tag: string, current: string): boolean {
  const candidate = normalizeTag(tag);
  if (!candidate || !semver.valid(current)) return false;
  return semver.gt(candidate, current);
}

export type GithubRelease = { tag_name: string; draft: boolean };

/**
 * Picks the greatest non-draft release strictly newer than `current`, returned
 * as a normalized semver string, or null if none. Prereleases are intentionally
 * included — alpha builds ship as prereleases. Never throws on malformed input.
 */
export function pickNewerTag(
  releases: GithubRelease[],
  current: string,
): string | null {
  if (!semver.valid(current)) return null;
  let best: string | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    const candidate = normalizeTag(release.tag_name);
    if (!candidate || !semver.gt(candidate, current)) continue;
    if (best === null || semver.gt(candidate, best)) best = candidate;
  }
  return best;
}
