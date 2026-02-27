/**
 * Tests for the bookmark fallback in the content-type probe handler.
 *
 * When the probe detects text/html, it calls fetchUrlMetadata and returns
 * a bookmark result instead of unsupported. This makes the embed flow
 * a single IPC call for any HTML page.
 *
 * Key things tested:
 * - text/html triggers bookmark (not unsupported)
 * - Bookmark result contains metadata fields
 * - Non-HTML content types still return unsupported
 * - Bookmark with empty metadata (server returns minimal HTML)
 * - HEAD fails → GET returns HTML → still produces bookmark
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

/** Mock a fetch that returns HTML with a streaming body (matching fetchUrlMetadata's reader pattern). */
function mockHtmlPage(html: string) {
  let consumed = false;
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
      get: vi.fn().mockImplementation((name: string) => {
        if (name === 'content-type') return 'text/html; charset=utf-8';
        return null;
      }),
    },
    body: { getReader: () => reader },
  });
}

describe('URL Resolver — Bookmark Fallback', () => {
  setupResolverDb();

  // ────────────────────────────────────────────────────────
  // Basic Bookmark Creation
  // ────────────────────────────────────────────────────────

  it('returns bookmark for text/html page with OG tags', async () => {
    mockHtmlPage(`
      <html><head>
        <meta property="og:title" content="Example Page">
        <meta property="og:description" content="A test page">
        <meta property="og:image" content="https://example.com/image.png">
        <link rel="icon" href="/favicon.ico">
      </head></html>
    `);

    const result = await resolveUrl('https://example.com/article');
    expect(result.type).toBe('bookmark');
    if (result.type === 'bookmark') {
      expect(result.title).toBe('Example Page');
      expect(result.description).toBe('A test page');
      expect(result.imageUrl).toBe('https://example.com/image.png');
      expect(result.url).toBe('https://example.com/article');
    }
  });

  it('returns bookmark with title fallback to <title> tag', async () => {
    mockHtmlPage(`<html><head><title>Fallback Title</title></head></html>`);

    const result = await resolveUrl('https://example.com/page');
    expect(result.type).toBe('bookmark');
    if (result.type === 'bookmark') {
      expect(result.title).toBe('Fallback Title');
    }
  });

  it('returns bookmark with empty metadata for minimal HTML', async () => {
    mockHtmlPage(`<html><head></head><body>Hello</body></html>`);

    const result = await resolveUrl('https://example.com/minimal');
    expect(result.type).toBe('bookmark');
    if (result.type === 'bookmark') {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
      expect(result.imageUrl).toBe('');
      expect(result.url).toBe('https://example.com/minimal');
    }
  });

  // ────────────────────────────────────────────────────────
  // Non-HTML Still Returns Unsupported
  // ────────────────────────────────────────────────────────

  it('returns unsupported for application/pdf (not bookmark)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/pdf' },
    });

    const result = await resolveUrl('https://example.com/doc.pdf');
    expect(result.type).toBe('unsupported');
    if (result.type === 'unsupported') {
      expect(result.reason).toContain('application/pdf');
    }
  });

  it('returns unsupported for video/mp4 (not bookmark)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'video/mp4' },
    });

    const result = await resolveUrl('https://example.com/video.mp4');
    expect(result.type).toBe('unsupported');
  });

  it('returns unsupported for application/json (not bookmark)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
    });

    const result = await resolveUrl('https://example.com/api/data');
    expect(result.type).toBe('unsupported');
  });

  // ────────────────────────────────────────────────────────
  // HEAD→GET Fallback to Bookmark
  // ────────────────────────────────────────────────────────

  it('HEAD fails, GET returns text/html → produces bookmark', async () => {
    let callCount = 0;
    let consumed = false;
    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (consumed) return Promise.resolve({ done: true, value: undefined });
        consumed = true;
        const html = '<html><head><title>GET Fallback</title></head></html>';
        return Promise.resolve({ done: false, value: new TextEncoder().encode(html) });
      }),
      cancel: vi.fn(),
    };

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
      // GET returns HTML (used by both probe and fetchUrlMetadata)
      return Promise.resolve({
        ok: true,
        headers: {
          get: vi.fn().mockImplementation((name: string) => {
            if (name === 'content-type') return 'text/html';
            return null;
          }),
        },
        body: { getReader: () => reader },
      });
    });

    const result = await resolveUrl('https://example.com/page');
    expect(result.type).toBe('bookmark');
  });

  // ────────────────────────────────────────────────────────
  // Handler Priority
  // ────────────────────────────────────────────────────────

  it('image extension takes priority over bookmark (not reached)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://example.com/photo.png');
    expect(result.type).toBe('image');
  });

  it('YouTube URL takes priority over bookmark (no fetch needed)', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
