/**
 * Edge cases for oEmbed fetching and the oEmbed→HTML scraping fallback chain.
 *
 * Tests weird responses, malformed data, provider URL edge cases,
 * and the interaction between oEmbed and the HTML scraper.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFetch = vi.fn();
vi.mock('electron', () => ({
  net: {
    fetch: (...args: unknown[]) => mockFetch(...args),
  },
}));

import { fetchOEmbedMetadata } from '../../repos/oembed';
import { fetchUrlMetadata } from '../../repos/url-metadata';

describe('oEmbed — Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────
  // Response body edge cases
  // ────────────────────────────────────────────────────────

  it('handles oEmbed returning HTML instead of JSON (wrong content-type)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBeNull();
  });

  it('handles oEmbed returning an array instead of an object', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ title: 'Array Item' }]),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    // Arrays don't have .title at the top level — no useful data, falls through
    expect(result).toBeNull();
  });

  it('handles oEmbed returning null JSON body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(null),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    // null.title would throw — should be caught by the try/catch
    expect(result).toBeNull();
  });

  it('handles oEmbed with title containing HTML entities', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'Tom &amp; Jerry — The &quot;Classic&quot; Episode',
        author_name: 'Warner Bros.',
      }),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).not.toBeNull();
    // oEmbed JSON should return decoded strings, but some servers don't
    expect(result!.title).toBe('Tom &amp; Jerry — The &quot;Classic&quot; Episode');
  });

  it('handles oEmbed with numeric title (non-string)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 12345,
        author_name: null,
      }),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).not.toBeNull();
    // || '' fallback handles falsy but not truthy non-strings
    expect(result!.title).toBe(12345 as any);
  });

  // ────────────────────────────────────────────────────────
  // HTTP response edge cases
  // ────────────────────────────────────────────────────────

  it('handles 429 Too Many Requests from oEmbed endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBeNull();
  });

  it('handles 301 redirect from oEmbed endpoint', async () => {
    // net.fetch with redirect: follow should handle this transparently
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Redirected Title' }),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Redirected Title');
  });

  it('handles oEmbed endpoint that hangs (simulated via abort)', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // Provider URL variations
  // ────────────────────────────────────────────────────────

  it('matches Spotify album URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'A Night at the Opera', author_name: 'Queen' }),
    });

    const result = await fetchOEmbedMetadata('https://open.spotify.com/album/1TSZDcvlPtAnekTaItI3qO');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('A Night at the Opera');
  });

  it('matches Spotify episode URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Podcast Episode', author_name: 'Podcaster' }),
    });

    const result = await fetchOEmbedMetadata('https://open.spotify.com/episode/abc123def456');
    expect(result).not.toBeNull();
  });

  it('matches Spotify artist URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Queen', author_name: 'Queen' }),
    });

    const result = await fetchOEmbedMetadata('https://open.spotify.com/artist/1dfeR4HaWDbWqFHLkxsg1d');
    expect(result).not.toBeNull();
  });

  it('does not match spotify.com (without open. subdomain)', async () => {
    const result = await fetchOEmbedMetadata('https://spotify.com/track/abc123');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('matches YouTube embed URL via oEmbed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Embed Test' }),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Embed Test');
  });

  it('matches YouTube Shorts URL via oEmbed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Short Video' }),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    expect(result).not.toBeNull();
  });

  it('matches Vimeo URL with path segments', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Vimeo Video' }),
    });

    const result = await fetchOEmbedMetadata('https://vimeo.com/channels/staffpicks/123456789');
    expect(result).not.toBeNull();
  });

  it('matches TikTok URL with username', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'TikTok Dance' }),
    });

    const result = await fetchOEmbedMetadata('https://www.tiktok.com/@username/video/7123456789');
    expect(result).not.toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // URL encoding in oEmbed endpoint
  // ────────────────────────────────────────────────────────

  it('properly encodes URL with special characters in oEmbed request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Special Chars' }),
    });

    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest&t=30s';
    await fetchOEmbedMetadata(url);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    // The original URL should be encoded in the endpoint query
    expect(calledUrl).toContain(encodeURIComponent(url));
    // Should NOT contain raw & from the original URL
    expect(calledUrl).not.toContain('&list=');
  });

  // ────────────────────────────────────────────────────────
  // Favicon fallback
  // ────────────────────────────────────────────────────────

  it('constructs correct favicon URL for each provider', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Test' }),
    });

    const ytResult = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(ytResult!.faviconUrl).toBe('https://www.youtube.com/favicon.ico');

    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Test' }),
    });

    const spResult = await fetchOEmbedMetadata('https://open.spotify.com/track/abc');
    expect(spResult!.faviconUrl).toBe('https://open.spotify.com/favicon.ico');
  });
});

describe('oEmbed → HTML Scraper Fallback Chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────
  // oEmbed returns empty, HTML scraper has good data
  // ────────────────────────────────────────────────────────

  it('falls through to HTML when oEmbed returns empty object', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // oEmbed returns empty object
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      // HTML scraper fallback
      let consumed = false;
      return Promise.resolve({
        ok: true,
        headers: {
          get: vi.fn().mockImplementation((name: string) => {
            if (name === 'content-type') return 'text/html';
            return null;
          }),
        },
        body: {
          getReader: () => ({
            read: vi.fn().mockImplementation(() => {
              if (consumed) return Promise.resolve({ done: true, value: undefined });
              consumed = true;
              const html = '<html><head><meta property="og:title" content="HTML Fallback"></head></html>';
              return Promise.resolve({ done: false, value: new TextEncoder().encode(html) });
            }),
            cancel: vi.fn(),
          }),
        },
      });
    });

    const result = await fetchUrlMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    // Empty oEmbed fell through — HTML scraper picked it up
    expect(result.title).toBe('HTML Fallback');
    // 2 fetches: oEmbed attempt + HTML scrape
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // ────────────────────────────────────────────────────────
  // oEmbed network error → HTML scraper catches it
  // ────────────────────────────────────────────────────────

  it('falls back to HTML scraper when oEmbed throws network error', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // oEmbed throws
        return Promise.reject(new Error('ECONNRESET'));
      }
      // HTML scraper
      let consumed = false;
      return Promise.resolve({
        ok: true,
        headers: {
          get: vi.fn().mockImplementation((name: string) => {
            if (name === 'content-type') return 'text/html';
            return null;
          }),
        },
        body: {
          getReader: () => ({
            read: vi.fn().mockImplementation(() => {
              if (consumed) return Promise.resolve({ done: true, value: undefined });
              consumed = true;
              const html = '<html><head><meta property="og:title" content="Scraped Title"></head></html>';
              return Promise.resolve({ done: false, value: new TextEncoder().encode(html) });
            }),
            cancel: vi.fn(),
          }),
        },
      });
    });

    const result = await fetchUrlMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.title).toBe('Scraped Title');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // ────────────────────────────────────────────────────────
  // Both oEmbed AND HTML scraper fail
  // ────────────────────────────────────────────────────────

  it('returns empty metadata when both oEmbed and HTML scraper fail', async () => {
    mockFetch.mockRejectedValue(new Error('Total network failure'));

    const result = await fetchUrlMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.imageUrl).toBe('');
    expect(result.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  // ────────────────────────────────────────────────────────
  // Non-provider URL goes straight to HTML (no oEmbed attempt)
  // ────────────────────────────────────────────────────────

  it('Apple Music URL goes directly to HTML scraper (no oEmbed)', async () => {
    let consumed = false;
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'content-type') return 'text/html';
          return null;
        }),
      },
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(() => {
            if (consumed) return Promise.resolve({ done: true, value: undefined });
            consumed = true;
            const html = '<html><head><meta property="og:title" content="Song on Apple Music"></head></html>';
            return Promise.resolve({ done: false, value: new TextEncoder().encode(html) });
          }),
          cancel: vi.fn(),
        }),
      },
    });

    const result = await fetchUrlMetadata('https://music.apple.com/us/album/bohemian-rhapsody/1440806041');
    expect(result.title).toBe('Song on Apple Music');
    // Exactly 1 fetch (HTML scraper), NO oEmbed attempt
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // The fetch was NOT to an oEmbed endpoint
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('oembed');
  });

  it('GitHub URL goes directly to HTML scraper (no oEmbed)', async () => {
    let consumed = false;
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'content-type') return 'text/html';
          return null;
        }),
      },
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(() => {
            if (consumed) return Promise.resolve({ done: true, value: undefined });
            consumed = true;
            const html = '<html><head><meta property="og:title" content="cool-repo"></head></html>';
            return Promise.resolve({ done: false, value: new TextEncoder().encode(html) });
          }),
          cancel: vi.fn(),
        }),
      },
    });

    const result = await fetchUrlMetadata('https://github.com/user/cool-repo');
    expect(result.title).toBe('cool-repo');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
