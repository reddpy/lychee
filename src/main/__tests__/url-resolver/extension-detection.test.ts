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

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const mockDownloadImage = vi.fn();
vi.mock('../../repos/images', () => ({
  downloadImage: (...args: unknown[]) => mockDownloadImage(...args),
  saveImage: vi.fn(),
  getImagePath: vi.fn(),
  deleteImage: vi.fn(),
}));

import { setupResolverDb, resolveUrl } from './setup';

describe('URL Resolver — Extension Detection', () => {
  setupResolverDb();

  beforeEach(() => {
    mockDownloadImage.mockResolvedValue({ id: 'mock-id', filePath: 'mock-id.png' });
  });

  // ────────────────────────────────────────────────────────
  // Core Extension Types
  // ────────────────────────────────────────────────────────

  // .png is the most common image extension. The handler should detect it
  // from the URL path and forward the URL to downloadImage.
  it('detects .png URL by extension', async () => {
    const url = 'https://example.com/image.png';
    const result = await resolveUrl(url);
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      expect(result.sourceUrl).toBe(url);
    }
    expect(mockDownloadImage).toHaveBeenCalledWith(url);
  });

  // Extension matching must be case-insensitive — URLs from some servers
  // have uppercase extensions like .PNG or .JPG.
  it('detects uppercase extension .PNG (case-insensitive)', async () => {
    const url = 'https://example.com/PHOTO.PNG';
    const result = await resolveUrl(url);
    expect(result.type).toBe('image');
    expect(mockDownloadImage).toHaveBeenCalledWith(url);
  });

  // .jpg extension (most common JPEG extension).
  it('detects .jpg URL by extension', async () => {
    const result = await resolveUrl('https://example.com/photo.jpg');
    expect(result.type).toBe('image');
  });

  // .jpeg extension (alternate JPEG extension, matched by jpe?g regex).
  it('detects .jpeg URL by extension', async () => {
    const result = await resolveUrl('https://example.com/photo.jpeg');
    expect(result.type).toBe('image');
  });

  // .webp extension.
  it('detects .webp URL by extension', async () => {
    const result = await resolveUrl('https://example.com/modern.webp');
    expect(result.type).toBe('image');
  });

  // .gif is in IMAGE_EXTENSIONS regex and image/gif is in IMAGE_CONTENT_TYPES.
  it('detects .gif URL by extension', async () => {
    const url = 'https://example.com/reaction.gif';
    const result = await resolveUrl(url);
    expect(result.type).toBe('image');
    if (result.type === 'image') {
      expect(result.sourceUrl).toBe(url);
    }
    expect(mockDownloadImage).toHaveBeenCalledWith(url);
  });

  // Uppercase .GIF extension — regex is case-insensitive.
  it('detects uppercase .GIF extension', async () => {
    const result = await resolveUrl('https://example.com/FUNNY.GIF');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // URL Variations (query params, fragments, ports, paths)
  // ────────────────────────────────────────────────────────

  // Many image URLs have query parameters (resize params, cache busters).
  // The handler runs regex against `new URL(url).pathname`, so query params
  // are stripped. But the full URL is forwarded to downloadImage.
  it('detects extension with query parameters', async () => {
    const url = 'https://example.com/photo.jpg?width=800&quality=90';
    const result = await resolveUrl(url);
    expect(result.type).toBe('image');
    expect(mockDownloadImage).toHaveBeenCalledWith(url);
  });

  // GIF URL with query params (common on image CDNs).
  it('detects .gif URL with query parameters', async () => {
    const result = await resolveUrl('https://cdn.example.com/emoji.gif?size=128&v=2');
    expect(result.type).toBe('image');
  });

  // URL with fragment (#) — fragment is stripped by URL parser, extension still detected.
  it('detects extension in URL with fragment', async () => {
    const result = await resolveUrl('https://example.com/img.gif#section');
    expect(result.type).toBe('image');
  });

  // URL with encoded characters.
  it('detects extension in URL with encoded path', async () => {
    const result = await resolveUrl('https://example.com/my%20photo.png');
    expect(result.type).toBe('image');
  });

  // URL with port number.
  it('detects extension in URL with port', async () => {
    const result = await resolveUrl('https://example.com:8080/image.jpg');
    expect(result.type).toBe('image');
  });

  // URL with deep path segments.
  it('detects extension in URL with path segments', async () => {
    const result = await resolveUrl('https://example.com/a/b/c/d/deep/nested/reaction.gif');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // Extensions matched by regex but NOT in MIME_TO_EXT
  // ────────────────────────────────────────────────────────
  // IMAGE_EXTENSIONS matches .svg, .bmp, .ico but these aren't in
  // MIME_TO_EXT or IMAGE_CONTENT_TYPES. The extension handler detects
  // them and calls downloadImage, which rejects unsupported content-types.

  // .svg extension matches regex → downloadImage rejects because
  // image/svg+xml is not in MIME_TO_EXT. User sees nothing embedded.
  it('.svg URL: extension matches but download rejects unsupported content-type', async () => {
    mockDownloadImage.mockRejectedValue(new Error('Unsupported content-type: image/svg+xml'));

    const result = await resolveUrl('https://example.com/icon.svg');
    expect(result.type).toBe('unsupported');
    // Verify the handler still attempted the download (extension matched)
    expect(mockDownloadImage).toHaveBeenCalledWith('https://example.com/icon.svg');
  });

  // .bmp extension matches regex → download rejects unsupported content-type.
  it('.bmp URL: extension matches but download rejects unsupported content-type', async () => {
    mockDownloadImage.mockRejectedValue(new Error('Unsupported content-type: image/bmp'));

    const result = await resolveUrl('https://example.com/old.bmp');
    expect(result.type).toBe('unsupported');
    expect(mockDownloadImage).toHaveBeenCalledWith('https://example.com/old.bmp');
  });

  // .ico extension matches regex → download rejects unsupported content-type.
  it('.ico URL: extension matches but download rejects unsupported content-type', async () => {
    mockDownloadImage.mockRejectedValue(new Error('Unsupported content-type: image/x-icon'));

    const result = await resolveUrl('https://example.com/favicon.ico');
    expect(result.type).toBe('unsupported');
    expect(mockDownloadImage).toHaveBeenCalledWith('https://example.com/favicon.ico');
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
    // downloadImage should NOT be called — extension handler didn't match
    expect(mockDownloadImage).not.toHaveBeenCalled();
  });

  // .html should NOT match extension handler, falls through to probe → bookmark.
  it('.html URL returns bookmark via probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/page.html');
    expect(result.type).toBe('bookmark');
    expect(mockDownloadImage).not.toHaveBeenCalled();
  });

  // .mp4 video should NOT match.
  it('.mp4 URL returns unsupported via probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'video/mp4' },
    });

    const result = await resolveUrl('https://example.com/video.mp4');
    expect(result.type).toBe('unsupported');
    expect(mockDownloadImage).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────
  // Download Failures
  // ────────────────────────────────────────────────────────

  // If the extension is recognized but the download fails (server error,
  // timeout, etc.), the handler should return 'unsupported' with a reason
  // instead of crashing.
  it('returns unsupported when extension matches but download fails', async () => {
    mockDownloadImage.mockRejectedValue(new Error('Network error'));

    const result = await resolveUrl('https://example.com/broken.png');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to download');
    }
  });

  // GIF download failure — extension matches but server is down.
  it('returns unsupported when .gif extension matches but download fails', async () => {
    mockDownloadImage.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await resolveUrl('https://example.com/broken.gif');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to download');
    }
  });

  // HTTP error (non-OK response) during download after extension match.
  it('returns unsupported when extension matches but server returns 404', async () => {
    mockDownloadImage.mockRejectedValue(new Error('HTTP 404'));

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
    const result = await resolveUrl('https://example.com/file.backup.png');
    expect(result.type).toBe('image');
  });

  // Dot in query param but NOT in path — should NOT match extension handler.
  // The regex runs against pathname only (new URL(url).pathname), so
  // query params are stripped before matching. Falls through to probe → bookmark.
  it('does not match extension in query params (only pathname)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/page?file=photo.png');
    expect(result.type).toBe('bookmark');
    expect(mockDownloadImage).not.toHaveBeenCalled();
  });

  // URL with trailing slash — no extension in pathname. Falls through to probe → bookmark.
  it('URL with trailing slash has no extension, falls through to probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/images/');
    expect(result.type).toBe('bookmark');
  });

  // URL with no path at all — just a domain. Falls through to probe → bookmark.
  it('bare domain URL falls through to probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com');
    expect(result.type).toBe('bookmark');
  });

  // The IMAGE_EXTENSIONS regex has a `(\?.*)?$` group, but since the code
  // runs the regex against `new URL(url).pathname` (which strips query/fragment),
  // this group is dead code. Verify the pathname-based approach works by
  // checking that query params don't leak into the pathname match.
  it('regex runs against pathname not full URL', async () => {
    // URL where query looks like an extension: /api?format=.png
    // pathname is /api — no extension match. Falls through to probe → bookmark.
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/api?format=.png');
    expect(result.type).toBe('bookmark');
  });

  // Mixed-case extension in the middle of a realistic CDN URL.
  it('detects mixed-case .JpEg extension', async () => {
    const result = await resolveUrl('https://cdn.example.com/uploads/Photo.JpEg');
    expect(result.type).toBe('image');
  });

  // Extension regex should NOT match "png" without a dot prefix.
  // A path like /something-png should not trigger extension handler. Falls through to probe → bookmark.
  it('does not match extension without dot prefix', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://example.com/something-png');
    expect(result.type).toBe('bookmark');
  });
});
