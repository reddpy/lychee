/**
 * Tests for URL resolution via file extension detection.
 *
 * The imageByExtensionHandler checks file extension in URL path.
 * Key things tested:
 * - Extension detection with various cases (.png, .PNG, .jpg, .jpeg, .webp, .gif)
 * - Query params and fragment handling
 * - Extensions matched by regex but NOT in MIME_TO_EXT (.svg, .bmp, .ico)
 * - Non-image extensions falling through to content-type probe
 * - Download failure after extension match
 */

import { describe, it, expect, vi } from 'vitest';

const mockFetch = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
  net: { fetch: (...args: unknown[]) => mockFetch(...args) },
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

import { getTestDb } from '../helpers';
vi.mock('../../db', () => ({
  getDb: () => getTestDb(),
}));

import { setupResolverDb, resolveUrl } from './setup';

describe('URL Resolver — Extension Detection', () => {
  setupResolverDb();

  // ────────────────────────────────────────────────────────
  // Core Extension Types
  // ────────────────────────────────────────────────────────

  // .png is the most common image extension. The handler should detect it
  // from the URL path without making any network requests.
  it('detects .png URL by extension', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://example.com/image.png');
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      expect(result.sourceUrl).toBe('https://example.com/image.png');
    }
  });

  // Extension matching must be case-insensitive — URLs from some servers
  // have uppercase extensions like .PNG or .JPG.
  it('detects uppercase extension .PNG (case-insensitive)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://example.com/PHOTO.PNG');
    expect(result.type).toBe('image');
  });

  // .jpg extension (most common JPEG extension).
  it('detects .jpg URL by extension', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/jpeg' },
    });

    const result = await resolveUrl('https://example.com/photo.jpg');
    expect(result.type).toBe('image');
  });

  // .jpeg extension (alternate JPEG extension, matched by jpe?g regex).
  it('detects .jpeg URL by extension', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/jpeg' },
    });

    const result = await resolveUrl('https://example.com/photo.jpeg');
    expect(result.type).toBe('image');
  });

  // .webp extension.
  it('detects .webp URL by extension', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/webp' },
    });

    const result = await resolveUrl('https://example.com/modern.webp');
    expect(result.type).toBe('image');
  });

  // .gif is in IMAGE_EXTENSIONS regex and image/gif is in IMAGE_CONTENT_TYPES.
  it('detects .gif URL by extension', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/gif' },
    });

    const result = await resolveUrl('https://example.com/reaction.gif');
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      expect(result.sourceUrl).toBe('https://example.com/reaction.gif');
    }
  });

  // Uppercase .GIF extension — regex is case-insensitive.
  it('detects uppercase .GIF extension', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/gif' },
    });

    const result = await resolveUrl('https://example.com/FUNNY.GIF');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // URL Variations (query params, fragments, ports, paths)
  // ────────────────────────────────────────────────────────

  // Many image URLs have query parameters (resize params, cache busters).
  // The regex must match the extension even with ?params after it.
  it('detects extension with query parameters', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/jpeg' },
    });

    const result = await resolveUrl(
      'https://example.com/photo.jpg?width=800&quality=90',
    );
    expect(result.type).toBe('image');
  });

  // GIF URL with query params (common on image CDNs).
  it('detects .gif URL with query parameters', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/gif' },
    });

    const result = await resolveUrl('https://cdn.example.com/emoji.gif?size=128&v=2');
    expect(result.type).toBe('image');
  });

  // URL with fragment (#) — fragment is stripped by URL parser, extension still detected.
  it('detects extension in URL with fragment', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/gif' },
    });

    const result = await resolveUrl('https://example.com/img.gif#section');
    expect(result.type).toBe('image');
  });

  // URL with encoded characters.
  it('detects extension in URL with encoded path', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://example.com/my%20photo.png');
    expect(result.type).toBe('image');
  });

  // URL with port number.
  it('detects extension in URL with port', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/jpeg' },
    });

    const result = await resolveUrl('https://example.com:8080/image.jpg');
    expect(result.type).toBe('image');
  });

  // URL with deep path segments.
  it('detects extension in URL with path segments', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/gif' },
    });

    const result = await resolveUrl('https://example.com/a/b/c/d/deep/nested/reaction.gif');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // Extensions matched by regex but NOT in MIME_TO_EXT
  // ────────────────────────────────────────────────────────
  // IMAGE_EXTENSIONS matches .svg, .bmp, .ico but these aren't in
  // MIME_TO_EXT or IMAGE_CONTENT_TYPES. The extension handler detects
  // them and calls downloadImage, which defaults unrecognized content-types
  // to image/png. This is a subtle behavior gap.

  // .svg extension matches regex → download succeeds → saved as .png
  // because image/svg+xml is not in MIME_TO_EXT.
  it('.svg URL: extension matches but download stores as .png (SVG not in MIME_TO_EXT)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/svg+xml' },
    });

    const result = await resolveUrl('https://example.com/icon.svg');
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      // Downloaded but stored as .png due to content-type fallback
      expect(result.filePath).toMatch(/\.png$/);
    }
  });

  // .bmp extension matches regex → download succeeds → saved as .png.
  it('.bmp URL: extension matches but download stores as .png (BMP not in MIME_TO_EXT)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/bmp' },
    });

    const result = await resolveUrl('https://example.com/old.bmp');
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      expect(result.filePath).toMatch(/\.png$/);
    }
  });

  // .ico extension matches regex → download succeeds → saved as .png.
  it('.ico URL: extension matches but download stores as .png (ICO not in MIME_TO_EXT)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/x-icon' },
    });

    const result = await resolveUrl('https://example.com/favicon.ico');
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      expect(result.filePath).toMatch(/\.png$/);
    }
  });

  // ────────────────────────────────────────────────────────
  // Non-image Extensions (should NOT match extension handler)
  // ────────────────────────────────────────────────────────

  // .pdf should NOT match the extension handler, falls through to probe.
  it('.pdf URL falls through to content-type probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/pdf' },
    });

    const result = await resolveUrl('https://example.com/document.pdf');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Unhandled content type');
    }
  });

  // .html should NOT match, falls through to probe.
  it('.html URL returns unsupported via probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/page.html');
    expect(result.type).toBe('unsupported');
  });

  // .mp4 video should NOT match.
  it('.mp4 URL returns unsupported via probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'video/mp4' },
    });

    const result = await resolveUrl('https://example.com/video.mp4');
    expect(result.type).toBe('unsupported');
  });

  // ────────────────────────────────────────────────────────
  // Download Failures
  // ────────────────────────────────────────────────────────

  // If the extension is recognized but the download fails (server error,
  // timeout, etc.), the handler should return 'unsupported' with a reason
  // instead of crashing.
  it('returns unsupported when extension matches but download fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await resolveUrl('https://example.com/broken.png');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to download');
    }
  });

  // GIF download failure — extension matches but server is down.
  it('returns unsupported when .gif extension matches but download fails', async () => {
    mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await resolveUrl('https://example.com/broken.gif');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to download');
    }
  });

  // HTTP error (non-OK response) during download after extension match.
  it('returns unsupported when extension matches but server returns 404', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: (): null => null },
    });

    const result = await resolveUrl('https://example.com/deleted.png');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to download');
    }
  });

  // ────────────────────────────────────────────────────────
  // Regex Edge Cases (pathname matching)
  // ────────────────────────────────────────────────────────

  // URL with multiple dots — the regex matches the LAST extension.
  // "file.backup.png" should match .png, not .backup.
  it('matches extension on filename with multiple dots', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://example.com/file.backup.png');
    expect(result.type).toBe('image');
  });

  // Dot in query param but NOT in path — should NOT match extension handler.
  // The regex runs against pathname only (new URL(url).pathname), so
  // query params are stripped before matching.
  it('does not match extension in query params (only pathname)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/page?file=photo.png');
    expect(result.type).toBe('unsupported');
  });

  // URL with trailing slash — no extension in pathname.
  it('URL with trailing slash has no extension, falls through to probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/images/');
    expect(result.type).toBe('unsupported');
  });

  // URL with no path at all — just a domain.
  it('bare domain URL falls through to probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com');
    expect(result.type).toBe('unsupported');
  });

  // The IMAGE_EXTENSIONS regex has a `(\?.*)?$` group, but since the code
  // runs the regex against `new URL(url).pathname` (which strips query/fragment),
  // this group is dead code. Verify the pathname-based approach works by
  // checking that query params don't leak into the pathname match.
  it('regex runs against pathname not full URL', async () => {
    // URL where query looks like an extension: /api?format=.png
    // pathname is /api — no extension match
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/api?format=.png');
    expect(result.type).toBe('unsupported');
  });

  // Mixed-case extension in the middle of a realistic CDN URL.
  it('detects mixed-case .JpEg extension', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/jpeg' },
    });

    const result = await resolveUrl('https://cdn.example.com/uploads/Photo.JpEg');
    expect(result.type).toBe('image');
  });

  // Extension regex should NOT match "png" without a dot prefix.
  // A path like /something-png should not trigger extension handler.
  it('does not match extension without dot prefix', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/something-png');
    expect(result.type).toBe('unsupported');
  });
});
