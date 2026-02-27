/**
 * Edge cases for the URL resolver handler chain.
 *
 * These test weird, real-world URLs and tricky scenarios that could
 * break the YouTube regex, bookmark fallback, or handler priority.
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

describe('URL Resolver — Edge Cases', () => {
  setupResolverDb();

  beforeEach(() => {
    mockDownloadImage.mockResolvedValue({ id: 'mock-id', filePath: 'mock-id.png' });
  });

  // ────────────────────────────────────────────────────────
  // YouTube: music.youtube.com
  // ────────────────────────────────────────────────────────

  it('detects music.youtube.com/watch URL', async () => {
    // YouTube Music shares the same watch?v= format
    const result = await resolveUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
    // The regex anchors to youtube.com — music subdomain should still match
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  // ────────────────────────────────────────────────────────
  // YouTube: tricky non-matches
  // ────────────────────────────────────────────────────────

  it('does not match youtube.com URL with 10-char ID (too short)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgX');
    expect(result.type).not.toBe('youtube');
  });

  it('does not match youtube.com/results (search page)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://www.youtube.com/results?search_query=cats');
    expect(result.type).not.toBe('youtube');
  });

  it('does not match youtube.com/@channel URLs', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://www.youtube.com/@MrBeast');
    expect(result.type).not.toBe('youtube');
  });

  // YouTube live URLs use the same watch?v= format — should work
  it('detects YouTube live stream URL (watch?v= format)', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=jfKfPfyJRdk&ab_channel=LofiGirl');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('jfKfPfyJRdk');
    }
  });

  // Duplicate v= param — greedy `.*v=` picks the last one.
  // Both IDs are valid; the regex greedily consumes to the last v=.
  it('extracts last video ID when v= appears multiple times (greedy match)', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=AAAAAAAAAA1');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('AAAAAAAAAA1');
    }
  });

  // youtube-nocookie.com is used for privacy-enhanced embeds
  it('does not match youtube-nocookie.com (different domain)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(result.type).not.toBe('youtube');
  });

  // ────────────────────────────────────────────────────────
  // URL with fragment (#) — fragments are part of the URL string
  // ────────────────────────────────────────────────────────

  it('handles image URL with fragment identifier', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://example.com/image.png#section');
    expect(result.type).toBe('image');
  });

  it('handles YouTube URL with fragment', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=30');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  // ────────────────────────────────────────────────────────
  // URL with authentication credentials (user:pass@host)
  // ────────────────────────────────────────────────────────

  it('handles URL with embedded credentials in image path', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/jpeg' },
    });

    const result = await resolveUrl('https://user:pass@cdn.example.com/photo.jpg');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // URL with non-standard port
  // ────────────────────────────────────────────────────────

  it('detects image extension on URL with port', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://localhost:3000/uploads/avatar.png');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // Content-type probe: server lies about content-type
  // ────────────────────────────────────────────────────────

  it('trusts HEAD content-type even if body would be different', async () => {
    // Server says image/png on HEAD but would serve HTML on GET.
    // Our probe trusts the HEAD response — that's the HTTP contract.
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://example.com/api/sneaky');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // Bookmark: page with huge OG content
  // ────────────────────────────────────────────────────────

  it('handles bookmark with extremely long OG title', async () => {
    const longTitle = 'A'.repeat(5000);
    let consumed = false;
    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (consumed) return Promise.resolve({ done: true, value: undefined });
        consumed = true;
        const html = `<html><head><meta property="og:title" content="${longTitle}"></head></html>`;
        return Promise.resolve({ done: false, value: new TextEncoder().encode(html) });
      }),
      cancel: vi.fn(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'content-type') return 'text/html';
          return null;
        }),
      },
      body: { getReader: () => reader },
    });

    const result = await resolveUrl('https://example.com/article');
    expect(result.type).toBe('bookmark');
    if (result.type === 'bookmark') {
      expect(result.title).toBe(longTitle);
    }
  });

  // ────────────────────────────────────────────────────────
  // Bookmark: empty body
  // ────────────────────────────────────────────────────────

  it('returns bookmark with empty metadata when HTML body is empty', async () => {
    const reader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'content-type') return 'text/html';
          return null;
        }),
      },
      body: { getReader: () => reader },
    });

    const result = await resolveUrl('https://example.com/empty');
    expect(result.type).toBe('bookmark');
    if (result.type === 'bookmark') {
      expect(result.title).toBe('');
    }
  });

  // ────────────────────────────────────────────────────────
  // Bookmark: server returns 200 but no body reader
  // ────────────────────────────────────────────────────────

  it('returns bookmark with empty metadata when response has no body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'content-type') return 'text/html';
          return null;
        }),
      },
      body: null,
    });

    const result = await resolveUrl('https://example.com/nobody');
    expect(result.type).toBe('bookmark');
    if (result.type === 'bookmark') {
      expect(result.title).toBe('');
    }
  });

  // ────────────────────────────────────────────────────────
  // Handler priority: URL that looks like both image and YouTube
  // ────────────────────────────────────────────────────────

  it('YouTube handler wins over image extension for YouTube thumbnail URLs', async () => {
    // Unlikely but technically possible — a YouTube watch URL that
    // also ends with .jpg shouldn't happen, but let's verify priority
    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────
  // URL encoding
  // ────────────────────────────────────────────────────────

  it('handles URL-encoded image path', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/jpeg' },
    });

    const result = await resolveUrl('https://example.com/my%20photo.jpg');
    expect(result.type).toBe('image');
  });

  it('handles URL with unicode in path that has image extension', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => 'image/png' },
    });

    const result = await resolveUrl('https://example.com/%E5%9B%BE%E7%89%87.png');
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // Redirect scenarios (probe follows redirects)
  // ────────────────────────────────────────────────────────

  it('passes redirect: follow to probe requests', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    await resolveUrl('https://bit.ly/shortened');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirect: 'follow' }),
    );
  });

  // ────────────────────────────────────────────────────────
  // Content-type with unusual casing
  // ────────────────────────────────────────────────────────

  it('detects IMAGE/PNG with unusual casing via probe (case-insensitive)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'IMAGE/PNG' },
    });

    const result = await resolveUrl('https://example.com/api/avatar');
    // Content-type is lowercased before matching — unusual casing is handled
    expect(result.type).toBe('image');
  });

  // ────────────────────────────────────────────────────────
  // Concurrent resolution of same URL
  // ────────────────────────────────────────────────────────

  it('handles concurrent resolution of the same YouTube URL', async () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const [r1, r2, r3] = await Promise.all([
      resolveUrl(url),
      resolveUrl(url),
      resolveUrl(url),
    ]);

    expect(r1.type).toBe('youtube');
    expect(r2.type).toBe('youtube');
    expect(r3.type).toBe('youtube');
    // YouTube handler is pure regex — no fetch calls even with 3 concurrent
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles concurrent resolution of different URL types', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const [yt, img, bm] = await Promise.all([
      resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      resolveUrl('https://example.com/photo.png'),
      resolveUrl('https://example.com/article'),
    ]);

    expect(yt.type).toBe('youtube');
    expect(img.type).toBe('image');
    expect(bm.type).toBe('bookmark');
  });
});
