/**
 * Tests for URL resolution via content-type probing (fallback handler).
 *
 * URLs without a recognized file extension fall through to the
 * contentTypeProbeHandler which issues HEAD (then GET on failure)
 * requests to detect the content type.
 *
 * Key things tested:
 * - HEAD request probe detecting image content-types
 * - HEAD→GET fallback when servers reject HEAD requests
 * - Content-type with extra params (charset, etc.)
 * - All 4 supported content-types via probe
 * - Unsupported content-types (svg+xml, bmp) rejected by probe
 * - Non-image content types
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

describe('URL Resolver — Content-Type Probe', () => {
  setupResolverDb();

  // ────────────────────────────────────────────────────────
  // HEAD Probe
  // ────────────────────────────────────────────────────────

  // URLs without a file extension (e.g., API endpoints) fall through to
  // the content-type probe handler. If HEAD returns image/*, download it.
  it('probes extensionless URL with HEAD request', async () => {
    // First call: HEAD request → returns image content-type
    // Second call: download (from downloadImage)
    let callCount = 0;
    mockFetch.mockImplementation((_url: string, opts?: { method?: string }) => {
      callCount++;
      if (callCount === 1) {
        // HEAD probe
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/jpeg' },
        });
      }
      // Download
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: { get: () => 'image/jpeg' },
      });
    });

    const result = await resolveUrl('https://example.com/api/avatar/123');
    expect(result.type).toBe('image');
  });

  // Some servers reject HEAD requests (405 Method Not Allowed).
  // The code should fall back to GET in this case.
  it('falls back to GET when HEAD returns non-OK', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // HEAD fails
        return Promise.resolve({
          ok: false,
          status: 405,
          headers: { get: () => '' },
        });
      }
      if (callCount === 2) {
        // GET succeeds with image
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/png' },
        });
      }
      // Download
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: { get: () => 'image/png' },
      });
    });

    const result = await resolveUrl('https://example.com/api/image');
    expect(result.type).toBe('image');
  });

  // Non-image content types should be reported as unsupported.
  it('returns unsupported for non-image content type', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
    });

    const result = await resolveUrl('https://example.com/page');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Unhandled content type');
    }
  });

  // Content-type headers often include parameters like charset.
  // "image/webp; charset=utf-8" should still be detected as an image.
  it('detects image content-type with extra params', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/webp; charset=utf-8' },
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: { get: () => 'image/webp' },
      });
    });

    const result = await resolveUrl('https://example.com/api/photo');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // All 4 Supported Content-Types via Probe
  // ────────────────────────────────────────────────────────

  // GIF detected via content-type probe (extensionless URL, server returns image/gif).
  it('detects GIF via content-type probe on extensionless URL', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // HEAD probe returns image/gif
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/gif' },
        });
      }
      // Download
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: { get: () => 'image/gif' },
      });
    });

    const result = await resolveUrl('https://api.example.com/v1/media/67890');
    expect(result.type).toBe('image');
  });

  // Probe detects image/gif via HEAD.
  it('probe detects image/gif content-type', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/gif' },
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: { get: () => 'image/gif' },
      });
    });

    const result = await resolveUrl('https://example.com/api/media');
    expect(result.type).toBe('image');
  });

  // Probe detects image/webp via HEAD.
  it('probe detects image/webp content-type', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/webp' },
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: { get: () => 'image/webp' },
      });
    });

    const result = await resolveUrl('https://example.com/api/photo');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // Unsupported Image Content-Types (via probe)
  // ────────────────────────────────────────────────────────

  // Probe rejects image/svg+xml — it's NOT in IMAGE_CONTENT_TYPES.
  // Unlike the extension handler (which would still try to download),
  // the probe handler explicitly checks IMAGE_CONTENT_TYPES.
  it('probe rejects image/svg+xml (not in IMAGE_CONTENT_TYPES)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/svg+xml' },
    });

    const result = await resolveUrl('https://example.com/api/icon');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Unhandled content type: image/svg+xml');
    }
  });

  // Probe rejects image/bmp — not in IMAGE_CONTENT_TYPES.
  it('probe rejects image/bmp (not in IMAGE_CONTENT_TYPES)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/bmp' },
    });

    const result = await resolveUrl('https://example.com/api/bitmap');
    expect(result.type).toBe('unsupported');
  });

  // ────────────────────────────────────────────────────────
  // Error Handling
  // ────────────────────────────────────────────────────────

  // Total network failure during probe should return unsupported, not throw.
  it('returns unsupported on network error during probe', async () => {
    mockFetch.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

    const result = await resolveUrl('https://example.com/api/image');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to probe');
    }
  });

  // An invalid URL that can't be parsed by new URL() will throw
  // in the extension handler's test() method. This error should propagate.
  it('throws on malformed URL (cannot parse)', async () => {
    await expect(resolveUrl('not-a-valid-url')).rejects.toThrow();
  });

  // ────────────────────────────────────────────────────────
  // HEAD + GET Both Fail
  // ────────────────────────────────────────────────────────

  // If HEAD returns non-OK and GET also returns non-OK, both probes fail.
  // The function should still return a content-type-based result (empty string).
  it('returns unsupported when both HEAD and GET return non-OK', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => '' },
    });

    const result = await resolveUrl('https://example.com/api/down');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Unhandled content type');
    }
  });

  // HEAD throws network error, GET also throws — both fail entirely.
  // This should hit the catch block.
  it('returns unsupported when HEAD throws and GET also throws', async () => {
    mockFetch.mockRejectedValue(new Error('net::ERR_CONNECTION_RESET'));

    const result = await resolveUrl('https://example.com/api/broken');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to probe');
    }
  });

  // ────────────────────────────────────────────────────────
  // Probe Detects Image but Download Fails
  // ────────────────────────────────────────────────────────

  // HEAD probe succeeds with image content-type, but the subsequent
  // downloadImage call fails. This should hit the catch block.
  it('returns unsupported when probe detects image but download fails', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // HEAD probe succeeds
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/png' },
        });
      }
      // Download fails
      return Promise.reject(new Error('Download timeout'));
    });

    const result = await resolveUrl('https://example.com/api/large-image');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to probe');
    }
  });

  // ────────────────────────────────────────────────────────
  // Empty / Missing Content-Type
  // ────────────────────────────────────────────────────────

  // Server returns no content-type header (null). The code defaults to ''.
  // '' doesn't include any image type, so it's unsupported.
  it('returns unsupported when content-type header is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: (): null => null },
    });

    const result = await resolveUrl('https://example.com/api/mystery');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toBe('Unhandled content type: ');
    }
  });

  // Content-type that CONTAINS an image type as substring but isn't one.
  // "multipart/x-mixed-replace;boundary=image/jpeg" contains "image/jpeg"
  // as a substring. The `includes()` check would match this incorrectly.
  it('false-positive: content-type containing image type as substring', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'multipart/x-mixed-replace;boundary=image/jpeg' },
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: { get: () => 'image/jpeg' },
      });
    });

    const result = await resolveUrl('https://example.com/api/stream');
    // Current behavior: includes() matches the substring, so it's treated as image.
    // This is a known limitation — the check isn't strict.
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // GET Fallback Scenarios
  // ────────────────────────────────────────────────────────

  // HEAD fails (405), GET succeeds but returns non-image content.
  it('HEAD fails, GET fallback returns non-image content-type', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // HEAD fails
        return Promise.resolve({
          ok: false,
          status: 405,
          headers: { get: () => '' },
        });
      }
      // GET returns HTML
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
      });
    });

    const result = await resolveUrl('https://example.com/page-no-extension');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('text/html');
    }
  });

  // HEAD fails with network error (throws), the code re-fetches with GET.
  // But the code doesn't catch HEAD throw — it only checks !response.ok.
  // If HEAD throws, the catch at line 59 fires and returns 'Failed to probe'.
  it('HEAD throws network error — catch fires, no GET fallback', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // HEAD throws
        return Promise.reject(new Error('Connection refused'));
      }
      // GET would succeed — but we never get here
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'image/png' },
      });
    });

    const result = await resolveUrl('https://example.com/api/image');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      // Since HEAD threw, the catch block fires — no GET fallback
      expect(result.reason).toContain('Failed to probe');
    }
    // Only 1 fetch call was made (HEAD), not 2
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ────────────────────────────────────────────────────────
  // Request Method Verification
  // ────────────────────────────────────────────────────────

  // Verify the probe actually sends HEAD first, not GET.
  it('sends HEAD request first during probe', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    await resolveUrl('https://example.com/api/check');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/check',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  // Verify GET fallback uses method: 'GET'.
  it('sends GET request when HEAD fails', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 405,
          headers: { get: () => '' },
        });
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'text/html' },
      });
    });

    await resolveUrl('https://example.com/api/check');

    // First call: HEAD
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://example.com/api/check',
      expect.objectContaining({ method: 'HEAD' }),
    );
    // Second call: GET
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/api/check',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  // Verify redirect: follow is set on probe requests.
  it('sets redirect: follow on probe requests', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    await resolveUrl('https://example.com/api/redirect');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirect: 'follow' }),
    );
  });

  // ────────────────────────────────────────────────────────
  // Timeout / Abort
  // ────────────────────────────────────────────────────────

  // If fetch is aborted (e.g. from the 10s timeout), the catch block fires.
  it('returns unsupported when probe times out (abort)', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

    const result = await resolveUrl('https://slow-server.example.com/api/image');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('Failed to probe');
    }
  });

  // ────────────────────────────────────────────────────────
  // Content-Type Edge Cases
  // ────────────────────────────────────────────────────────

  // image/jpeg with boundary param (unusual but valid HTTP).
  it('detects image/jpeg with extra parameters', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/jpeg; boundary=something' },
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: { get: () => 'image/jpeg' },
      });
    });

    const result = await resolveUrl('https://example.com/api/photo');
    expect(result.type).toBe('image');
  });

  // image/x-icon is NOT in IMAGE_CONTENT_TYPES — should be unsupported via probe.
  it('probe rejects image/x-icon (not in IMAGE_CONTENT_TYPES)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/x-icon' },
    });

    const result = await resolveUrl('https://example.com/api/favicon');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('image/x-icon');
    }
  });

  // image/tiff is NOT in IMAGE_CONTENT_TYPES.
  it('probe rejects image/tiff (not in IMAGE_CONTENT_TYPES)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/tiff' },
    });

    const result = await resolveUrl('https://example.com/api/scan');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('image/tiff');
    }
  });

  // application/octet-stream — generic binary. Should be unsupported.
  it('probe rejects application/octet-stream', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/octet-stream' },
    });

    const result = await resolveUrl('https://example.com/api/download');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('application/octet-stream');
    }
  });
});
