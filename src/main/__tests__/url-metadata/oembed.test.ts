/**
 * Tests for oEmbed provider registry and metadata fetching.
 *
 * oEmbed is tried first by fetchUrlMetadata — if a provider matches
 * the URL, we get structured JSON (title, thumbnail) without scraping HTML.
 *
 * Key things tested:
 * - Provider matching for YouTube, Spotify, SoundCloud, Vimeo, TikTok
 * - Non-matching URLs fall through (return null)
 * - JSON response mapped to UrlMetadataResult
 * - oEmbed failure falls back gracefully (returns null)
 * - fetchUrlMetadata tries oEmbed first, then HTML scraping
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

describe('oEmbed — Provider Matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────
  // YouTube
  // ────────────────────────────────────────────────────────

  it('matches YouTube watch URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'Never Gonna Give You Up',
        author_name: 'Rick Astley',
        thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      }),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Never Gonna Give You Up');
    expect(result!.description).toBe('by Rick Astley');
    expect(result!.imageUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(result!.faviconUrl).toBe('https://www.youtube.com/favicon.ico');
  });

  it('matches youtu.be short URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Short URL Video', author_name: 'Author' }),
    });

    const result = await fetchOEmbedMetadata('https://youtu.be/dQw4w9WgXcQ');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Short URL Video');
  });

  it('calls the correct YouTube oEmbed endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Test' }),
    });

    await fetchOEmbedMetadata('https://www.youtube.com/watch?v=abc12345678');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('youtube.com/oembed'),
      expect.anything(),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('https://www.youtube.com/watch?v=abc12345678')),
      expect.anything(),
    );
  });

  // ────────────────────────────────────────────────────────
  // Spotify
  // ────────────────────────────────────────────────────────

  it('matches Spotify track URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'Bohemian Rhapsody',
        author_name: 'Queen',
        thumbnail_url: 'https://i.scdn.co/image/album-cover.jpg',
      }),
    });

    const result = await fetchOEmbedMetadata('https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Bohemian Rhapsody');
    expect(result!.description).toBe('by Queen');
    expect(result!.imageUrl).toBe('https://i.scdn.co/image/album-cover.jpg');
    expect(result!.faviconUrl).toBe('https://open.spotify.com/favicon.ico');
  });

  it('matches Spotify playlist URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'Chill Vibes', author_name: 'Spotify' }),
    });

    const result = await fetchOEmbedMetadata('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Chill Vibes');
  });

  // ────────────────────────────────────────────────────────
  // SoundCloud
  // ────────────────────────────────────────────────────────

  it('matches SoundCloud track URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'Some Track',
        author_name: 'Some Artist',
        thumbnail_url: 'https://i1.sndcdn.com/artworks-thumb.jpg',
      }),
    });

    const result = await fetchOEmbedMetadata('https://soundcloud.com/artist/track-name');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Some Track');
    expect(result!.description).toBe('by Some Artist');
  });

  // ────────────────────────────────────────────────────────
  // Vimeo
  // ────────────────────────────────────────────────────────

  it('matches Vimeo video URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'Vimeo Staff Picks',
        author_name: 'Vimeo',
        thumbnail_url: 'https://i.vimeocdn.com/video/thumb.jpg',
      }),
    });

    const result = await fetchOEmbedMetadata('https://vimeo.com/123456789');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Vimeo Staff Picks');
  });

  // ────────────────────────────────────────────────────────
  // TikTok
  // ────────────────────────────────────────────────────────

  it('matches TikTok video URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'Viral Dance',
        author_name: 'tiktoker',
        thumbnail_url: 'https://p16.tiktokcdn.com/thumb.jpg',
      }),
    });

    const result = await fetchOEmbedMetadata('https://www.tiktok.com/@user/video/7123456789012345678');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Viral Dance');
  });

  // ────────────────────────────────────────────────────────
  // Non-matching URLs
  // ────────────────────────────────────────────────────────

  it('returns null for GitHub URL (no oEmbed provider)', async () => {
    const result = await fetchOEmbedMetadata('https://github.com/user/repo');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null for arbitrary URL', async () => {
    const result = await fetchOEmbedMetadata('https://example.com/article');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null for Reddit URL (no oEmbed provider)', async () => {
    const result = await fetchOEmbedMetadata('https://www.reddit.com/r/programming/comments/abc123');
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // Error Handling
  // ────────────────────────────────────────────────────────

  it('returns null when oEmbed endpoint returns non-OK', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=invalid12345');
    expect(result).toBeNull();
  });

  it('returns null when oEmbed endpoint throws network error', async () => {
    mockFetch.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBeNull();
  });

  it('returns null when oEmbed response is not valid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBeNull();
  });

  // ────────────────────────────────────────────────────────
  // Missing Fields
  // ────────────────────────────────────────────────────────

  it('handles missing author_name gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'No Author Video' }),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('No Author Video');
    expect(result!.description).toBe('');
  });

  it('handles missing thumbnail_url gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'No Thumbnail', author_name: 'Author' }),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).not.toBeNull();
    expect(result!.imageUrl).toBe('');
  });

  it('returns null for completely empty JSON response (falls through to HTML)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await fetchOEmbedMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toBeNull();
  });
});

describe('oEmbed — Integration with fetchUrlMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchUrlMetadata uses oEmbed for YouTube instead of scraping HTML', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'oEmbed Title',
        author_name: 'oEmbed Author',
        thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      }),
    });

    const result = await fetchUrlMetadata('https://www.youtube.com/watch?v=abc12345678');
    expect(result.title).toBe('oEmbed Title');
    expect(result.description).toBe('by oEmbed Author');
    // Only one fetch (oEmbed endpoint), NOT two (oEmbed + HTML scrape)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fetchUrlMetadata uses oEmbed for Spotify instead of scraping HTML', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'Spotify Track',
        author_name: 'Artist Name',
        thumbnail_url: 'https://i.scdn.co/image/cover.jpg',
      }),
    });

    const result = await fetchUrlMetadata('https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv');
    expect(result.title).toBe('Spotify Track');
    expect(result.description).toBe('by Artist Name');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fetchUrlMetadata falls back to HTML when oEmbed fails', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // oEmbed fails
        return Promise.resolve({ ok: false, status: 500 });
      }
      // HTML scraping fallback
      let consumed = false;
      const reader = {
        read: vi.fn().mockImplementation(() => {
          if (consumed) return Promise.resolve({ done: true, value: undefined });
          consumed = true;
          const html = '<html><head><title>HTML Fallback Title</title></head></html>';
          return Promise.resolve({ done: false, value: new TextEncoder().encode(html) });
        }),
        cancel: vi.fn(),
      };

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

    const result = await fetchUrlMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.title).toBe('HTML Fallback Title');
    // Two fetches: oEmbed attempt + HTML scrape
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('fetchUrlMetadata skips oEmbed for non-provider URLs', async () => {
    let consumed = false;
    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (consumed) return Promise.resolve({ done: true, value: undefined });
        consumed = true;
        const html = '<html><head><meta property="og:title" content="GitHub Repo"></head></html>';
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

    const result = await fetchUrlMetadata('https://github.com/user/repo');
    expect(result.title).toBe('GitHub Repo');
    // Only one fetch (HTML scrape), no oEmbed attempt
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
