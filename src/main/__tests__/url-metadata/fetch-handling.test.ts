/**
 * Tests for HTTP fetch handling and response edge cases.
 *
 * Covers: content-type variations, HTTP errors, network failures, null/empty
 * response bodies, XHTML, 50KB read limit, fetch options.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFetch = vi.fn();
vi.mock('electron', () => ({
  net: {
    fetch: (...args: unknown[]) => mockFetch(...args),
  },
}));

import { fetchUrlMetadata, createMockHtmlResponse } from './setup';

function mockHtmlResponse(html: string, ok = true, contentType = 'text/html') {
  createMockHtmlResponse(mockFetch, html, ok, contentType);
}

describe('URL Metadata — Fetch & Response Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Content-type variations ───────────────────────────────

  it('handles content-type with charset parameter', () => {
    mockHtmlResponse(
      `<html><head><title>Charset Test</title></head></html>`,
      true,
      'text/html; charset=utf-8',
    );

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Charset Test');
    });
  });

  it.fails('parses application/xhtml+xml content-type as HTML', () => {
    let consumed = false;
    const html = `<html><head><meta property="og:title" content="XHTML Page"><title>XHTML Title</title></head></html>`;
    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (consumed) return Promise.resolve({ done: true, value: undefined });
        consumed = true;
        return Promise.resolve({ done: false, value: new TextEncoder().encode(html) });
      }),
      cancel: vi.fn(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('application/xhtml+xml'),
      },
      body: { getReader: () => reader },
    });

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('XHTML Page');
    });
  });

  it('returns URL as title for non-HTML content-type', () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('image/png'),
      },
    });

    return fetchUrlMetadata('https://example.com/photo.png').then((result) => {
      expect(result.title).toBe('https://example.com/photo.png');
      expect(result.description).toBe('');
    });
  });

  it('treats missing content-type as non-HTML', () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue(null),
      },
    });

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('https://example.com');
    });
  });

  // ── HTTP and network errors ───────────────────────────────

  it('returns empty result on HTTP error', () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: vi.fn() },
    });

    return fetchUrlMetadata('https://example.com/missing').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
      expect(result.url).toBe('https://example.com/missing');
    });
  });

  it('returns empty result on network error', () => {
    mockFetch.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));

    return fetchUrlMetadata('https://nonexistent.test').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
      expect(result.url).toBe('https://nonexistent.test');
    });
  });

  // ── Response body edge cases ──────────────────────────────

  it('returns empty result when response body is null', () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('text/html'),
      },
      body: null,
    });

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
    });
  });

  // response.body?.getReader() returns undefined when getReader doesn't exist.
  // Use a body with getReader that returns undefined to hit the `if (!reader)` path.
  it('returns empty result when getReader returns undefined', () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('text/html'),
      },
      body: { getReader: (): undefined => undefined },
    });

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
      expect(result.url).toBe('https://example.com');
    });
  });

  it('handles empty HTML body gracefully', () => {
    mockHtmlResponse('');

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
      expect(result.imageUrl).toBe('');
      expect(result.faviconUrl).toBe('https://example.com/favicon.ico');
    });
  });

  it('handles whitespace-only HTML body', () => {
    mockHtmlResponse('   \n\t  \n  ');

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
    });
  });

  it('handles garbled HTML without crashing', () => {
    mockHtmlResponse('dkfjh3294\\x00\\xff<><<<>>>not real html at all');

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
    });
  });

  // ── Multi-chunk streaming ──────────────────────────────────

  // Real responses arrive in multiple chunks. The while loop accumulates
  // them with TextDecoder({ stream: true }). OG tags might span chunks.
  it('accumulates multiple chunks to extract metadata', () => {
    const chunk1 = '<html><head><meta property="og:tit';
    const chunk2 = 'le" content="Split Across Chunks">';
    const chunk3 = '<title>Fallback</title></head></html>';

    let callCount = 0;
    const reader = {
      read: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ done: false, value: new TextEncoder().encode(chunk1) });
        if (callCount === 2) return Promise.resolve({ done: false, value: new TextEncoder().encode(chunk2) });
        if (callCount === 3) return Promise.resolve({ done: false, value: new TextEncoder().encode(chunk3) });
        return Promise.resolve({ done: true, value: undefined });
      }),
      cancel: vi.fn(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'content-type') return 'text/html';
          return null;
        }),
      },
      body: { getReader: () => reader },
    });

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Split Across Chunks');
    });
  });

  // Verify reader.cancel() is called after reading completes.
  it('cancels the reader after extracting metadata', () => {
    let consumed = false;
    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (consumed) return Promise.resolve({ done: true, value: undefined });
        consumed = true;
        return Promise.resolve({
          done: false,
          value: new TextEncoder().encode('<html><head><title>Test</title></head></html>'),
        });
      }),
      cancel: vi.fn(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'content-type') return 'text/html';
          return null;
        }),
      },
      body: { getReader: () => reader },
    });

    return fetchUrlMetadata('https://example.com').then(() => {
      expect(reader.cancel).toHaveBeenCalled();
    });
  });

  // The 10s timeout creates an AbortController and calls abort().
  // If fetch takes too long, the catch block returns empty.
  it('returns empty result when fetch is aborted (timeout simulation)', () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

    return fetchUrlMetadata('https://slow-site.example.com').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
      expect(result.url).toBe('https://slow-site.example.com');
    });
  });

  // ── Read limit and fetch options ──────────────────────────

  it('reads up to 50KB of HTML for metadata extraction', () => {
    const padding = 'x'.repeat(40_000);
    mockHtmlResponse(`
      <html><head>
        ${padding}
        <meta property="og:title" content="Found After Padding">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Found After Padding');
    });
  });

  it('passes redirect: follow and abort signal to fetch', () => {
    mockHtmlResponse(`<html><head><title>Test</title></head></html>`);

    return fetchUrlMetadata('https://example.com').then(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          redirect: 'follow',
          signal: expect.anything(),
        }),
      );
    });
  });

  it('always includes the original URL in the result', () => {
    mockHtmlResponse(`<html><head><title>Test</title></head></html>`);

    return fetchUrlMetadata('https://example.com/specific-page').then(
      (result) => {
        expect(result.url).toBe('https://example.com/specific-page');
      },
    );
  });
});
