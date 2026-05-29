/**
 * Tests for the Linux update-poll version comparison (see src/main/updater.ts).
 * The mac/win path delegates comparison to update.electronjs.org; only Linux
 * compares tags locally, so prerelease handling matters here.
 */

import { describe, it, expect } from 'vitest';
import { isNewerRelease, normalizeTag, pickNewerTag } from '../update-version';

describe('normalizeTag', () => {
  it('returns null for empty / nullish input', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
    expect(normalizeTag(null)).toBeNull();
  });

  it('strips a leading "v" or "V" and surrounding whitespace', () => {
    expect(normalizeTag('v0.1.1')).toBe('0.1.1');
    expect(normalizeTag('V0.1.1')).toBe('0.1.1');
    expect(normalizeTag('  v0.1.1  ')).toBe('0.1.1');
  });

  it('preserves prerelease identifiers', () => {
    expect(normalizeTag('0.1.0-alpha.2')).toBe('0.1.0-alpha.2');
    expect(normalizeTag('v1.0.0-rc.1')).toBe('1.0.0-rc.1');
  });

  it('drops build metadata (no precedence)', () => {
    expect(normalizeTag('0.1.0+build.5')).toBe('0.1.0');
  });

  it('coerces loose-but-recognizable tags', () => {
    expect(normalizeTag('0.1')).toBe('0.1.0');
    expect(normalizeTag('release-1.2.3')).toBe('1.2.3');
  });

  it('returns null for unparseable tags', () => {
    expect(normalizeTag('nightly')).toBeNull();
    expect(normalizeTag('not-a-version')).toBeNull();
  });
});

describe('isNewerRelease', () => {
  it('detects a newer patch/minor/major', () => {
    expect(isNewerRelease('0.1.1', '0.1.0')).toBe(true);
    expect(isNewerRelease('0.2.0', '0.1.9')).toBe(true);
    expect(isNewerRelease('1.0.0', '0.9.9')).toBe(true);
  });

  it('returns false for same or older versions', () => {
    expect(isNewerRelease('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerRelease('0.1.0', '0.1.1')).toBe(false);
  });

  it('strips a leading "v"', () => {
    expect(isNewerRelease('v0.1.1', '0.1.0')).toBe(true);
    expect(isNewerRelease('v0.1.0', '0.1.0')).toBe(false);
  });

  it('orders prereleases correctly', () => {
    // A stable release outranks its own prerelease.
    expect(isNewerRelease('0.1.0', '0.1.0-alpha.1')).toBe(true);
    // Later alpha outranks earlier alpha.
    expect(isNewerRelease('0.1.0-alpha.2', '0.1.0-alpha.1')).toBe(true);
    // A prerelease does NOT outrank the matching stable.
    expect(isNewerRelease('0.1.0-alpha.1', '0.1.0')).toBe(false);
    // Next version's prerelease outranks the current stable.
    expect(isNewerRelease('0.2.0-alpha.1', '0.1.0')).toBe(true);
  });

  it('orders prerelease identifiers numerically, not lexically', () => {
    // alpha.10 > alpha.2 numerically (a naive string sort gets this wrong).
    expect(isNewerRelease('0.1.0-alpha.10', '0.1.0-alpha.2')).toBe(true);
    expect(isNewerRelease('0.1.0-beta.1', '0.1.0-alpha.9')).toBe(true);
    expect(isNewerRelease('0.1.0-alpha.1', '0.1.0-alpha.1')).toBe(false);
  });

  it('treats build metadata as equal precedence', () => {
    expect(isNewerRelease('0.1.0+build.9', '0.1.0')).toBe(false);
    expect(isNewerRelease('0.1.0', '0.1.0+build.9')).toBe(false);
  });

  it('returns false for unparseable tags rather than throwing', () => {
    expect(isNewerRelease('not-a-version', '0.1.0')).toBe(false);
    expect(isNewerRelease('', '0.1.0')).toBe(false);
    expect(isNewerRelease('0.1.1', 'garbage')).toBe(false);
    // semver.valid itself tolerates a leading "v" on `current` (app.getVersion
    // never emits one, but the comparison stays correct if it ever did).
    expect(isNewerRelease('0.1.1', 'v0.1.0')).toBe(true);
    expect(isNewerRelease('0.1.0', 'v0.1.0')).toBe(false);
  });
});

describe('pickNewerTag', () => {
  it('returns the greatest newer non-draft tag', () => {
    const releases = [
      { tag_name: 'v0.1.1', draft: false },
      { tag_name: 'v0.2.0', draft: false },
      { tag_name: 'v0.1.5', draft: false },
    ];
    expect(pickNewerTag(releases, '0.1.0')).toBe('0.2.0');
  });

  it('ignores drafts even if they are newer', () => {
    const releases = [
      { tag_name: 'v0.3.0', draft: true },
      { tag_name: 'v0.1.1', draft: false },
    ];
    expect(pickNewerTag(releases, '0.1.0')).toBe('0.1.1');
  });

  it('returns null when nothing is newer', () => {
    const releases = [
      { tag_name: 'v0.1.0', draft: false },
      { tag_name: 'v0.0.9', draft: false },
    ];
    expect(pickNewerTag(releases, '0.1.0')).toBeNull();
  });

  it('includes prereleases', () => {
    const releases = [{ tag_name: 'v0.2.0-alpha.1', draft: false }];
    expect(pickNewerTag(releases, '0.1.0')).toBe('0.2.0-alpha.1');
  });

  it('skips malformed tags', () => {
    const releases = [
      { tag_name: 'nightly', draft: false },
      { tag_name: 'v0.1.2', draft: false },
    ];
    expect(pickNewerTag(releases, '0.1.0')).toBe('0.1.2');
  });

  it('returns null for an empty list', () => {
    expect(pickNewerTag([], '0.1.0')).toBeNull();
  });

  it('returns null when every release is a draft', () => {
    const releases = [
      { tag_name: 'v0.2.0', draft: true },
      { tag_name: 'v0.3.0', draft: true },
    ];
    expect(pickNewerTag(releases, '0.1.0')).toBeNull();
  });

  it('returns null when current is unparseable', () => {
    const releases = [{ tag_name: 'v0.2.0', draft: false }];
    expect(pickNewerTag(releases, 'garbage')).toBeNull();
  });

  it('does not throw on a loose-but-coercible tag (regression)', () => {
    // "0.1" coerces to 0.1.0; the comparison must use the normalized form so
    // semver.gt never sees the raw loose string.
    const releases = [{ tag_name: '0.2', draft: false }];
    expect(() => pickNewerTag(releases, '0.1.0')).not.toThrow();
    expect(pickNewerTag(releases, '0.1.0')).toBe('0.2.0');
  });

  it('survives entries with a missing tag_name', () => {
    const releases = [
      { draft: false } as unknown as { tag_name: string; draft: boolean },
      { tag_name: 'v0.1.5', draft: false },
    ];
    expect(() => pickNewerTag(releases, '0.1.0')).not.toThrow();
    expect(pickNewerTag(releases, '0.1.0')).toBe('0.1.5');
  });

  it('prefers a stable release over its own prerelease when both are newer', () => {
    const releases = [
      { tag_name: 'v0.2.0-alpha.1', draft: false },
      { tag_name: 'v0.2.0', draft: false },
    ];
    expect(pickNewerTag(releases, '0.1.0')).toBe('0.2.0');
  });

  it('handles a large unsorted release list (stress)', () => {
    const releases = Array.from({ length: 5000 }, (_, i) => ({
      tag_name: `v0.${i % 50}.${i % 7}`,
      draft: i % 11 === 0,
    }));
    // Guarantee a clear, non-draft maximum.
    releases.push({ tag_name: 'v9.9.9', draft: false });
    expect(pickNewerTag(releases, '0.1.0')).toBe('9.9.9');
  });
});
