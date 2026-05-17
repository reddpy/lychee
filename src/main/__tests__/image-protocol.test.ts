/**
 * Tests for resolveImagePath — the path-traversal guard for the
 * lychee-image:// protocol handler. See GitHub issue #114.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveImagePath } from '../image-protocol';

const IMAGES_DIR = path.resolve('/tmp/lychee-test/images');

describe('resolveImagePath — happy path', () => {
  it('accepts a uuid-style filename', () => {
    const r = resolveImagePath('lychee-image://image/abc-123.png', IMAGES_DIR);
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(IMAGES_DIR, 'abc-123.png'));
  });

  it('accepts URL-encoded spaces in filenames', () => {
    const r = resolveImagePath('lychee-image://image/my%20image.png', IMAGES_DIR);
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(IMAGES_DIR, 'my image.png'));
  });
});

describe('resolveImagePath — path traversal', () => {
  it('rejects simple ../ traversal', () => {
    expect(resolveImagePath('lychee-image://image/../etc/passwd', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects deeply nested ../ traversal', () => {
    expect(resolveImagePath('lychee-image://image/../../../../../etc/passwd', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects URL-encoded ../ (%2e%2e)', () => {
    expect(resolveImagePath('lychee-image://image/%2e%2e/%2e%2e/etc/passwd', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects mixed encoded/literal traversal', () => {
    expect(resolveImagePath('lychee-image://image/foo/..%2f..%2fetc/passwd', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects traversal that resolves to imagesDir parent', () => {
    expect(resolveImagePath('lychee-image://image/..', IMAGES_DIR).ok).toBe(false);
  });
});

describe('resolveImagePath — absolute paths', () => {
  it('rejects an absolute Unix path', () => {
    expect(resolveImagePath('lychee-image://image//etc/passwd', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects a URL-encoded absolute path', () => {
    expect(resolveImagePath('lychee-image://image/%2Fetc%2Fpasswd', IMAGES_DIR).ok).toBe(false);
  });
});

describe('resolveImagePath — round-trip traversal', () => {
  // ../ followed by re-entry into imagesDir resolves back inside — must accept.
  it('accepts a path that traverses up but lands back inside imagesDir', () => {
    const dirName = path.basename(IMAGES_DIR);
    const r = resolveImagePath(`lychee-image://image/../${dirName}/abc.png`, IMAGES_DIR);
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(IMAGES_DIR, 'abc.png'));
  });

  // ../ followed by re-entry into a sibling dir escapes — must reject.
  it('rejects ../ that lands in a sibling directory', () => {
    expect(resolveImagePath('lychee-image://image/../other/abc.png', IMAGES_DIR).ok).toBe(false);
  });

  // Multiple ../ that escape past imagesDir's parent must reject.
  it('rejects ../ followed by absolute-looking suffix', () => {
    expect(resolveImagePath('lychee-image://image/../../images/abc.png', IMAGES_DIR).ok).toBe(false);
  });
});

describe('resolveImagePath — benign edge cases', () => {
  // A literal "..." filename (3+ dots) is not a traversal marker; treat as filename.
  it('accepts a filename consisting only of dots (e.g. "...")', () => {
    const r = resolveImagePath('lychee-image://image/...', IMAGES_DIR);
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(IMAGES_DIR, '...'));
  });

  // Subdirectories under imagesDir are accepted (no current code writes them,
  // but the guard shouldn't reject a structurally valid descendant).
  it('accepts a nested path that stays inside imagesDir', () => {
    const r = resolveImagePath('lychee-image://image/sub/foo.png', IMAGES_DIR);
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(IMAGES_DIR, 'sub', 'foo.png'));
  });
});

describe('resolveImagePath — malformed input', () => {
  it('rejects an empty filename', () => {
    expect(resolveImagePath('lychee-image://image/', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects a path equal to imagesDir itself (".")', () => {
    expect(resolveImagePath('lychee-image://image/.', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects null-byte injection', () => {
    expect(resolveImagePath('lychee-image://image/foo.png%00../../etc/passwd', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects malformed URI encoding', () => {
    expect(resolveImagePath('lychee-image://image/%E0%A4%A', IMAGES_DIR).ok).toBe(false);
  });

  it('rejects URLs with the wrong scheme/host prefix', () => {
    expect(resolveImagePath('file:///etc/passwd', IMAGES_DIR).ok).toBe(false);
    expect(resolveImagePath('lychee-image://other/abc.png', IMAGES_DIR).ok).toBe(false);
  });
});
