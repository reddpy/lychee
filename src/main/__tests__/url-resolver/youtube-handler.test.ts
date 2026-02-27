/**
 * Tests for YouTube URL detection in the resolver handler chain.
 *
 * The youtubeHandler is regex-only (no network call) and must match
 * before imageByExtensionHandler and contentTypeProbeHandler.
 *
 * Key things tested:
 * - Standard watch URLs, short URLs, embed URLs, Shorts URLs
 * - Extra query params, playlists, timestamps
 * - Invalid/partial YouTube URLs that should NOT match
 * - YouTube handler takes priority over content-type probe
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

describe('URL Resolver — YouTube Handler', () => {
  setupResolverDb();

  // ────────────────────────────────────────────────────────
  // Standard URL Formats
  // ────────────────────────────────────────────────────────

  it('detects standard youtube.com/watch URL', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
      expect(result.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    }
  });

  it('detects youtu.be short URL', async () => {
    const result = await resolveUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  it('detects youtube.com/embed URL', async () => {
    const result = await resolveUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  it('detects youtube.com/shorts URL', async () => {
    const result = await resolveUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  // ────────────────────────────────────────────────────────
  // Query Param Variations
  // ────────────────────────────────────────────────────────

  it('extracts video ID when URL has extra query params', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&index=2');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  it('extracts video ID when v= is not the first param', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  it('extracts video ID with timestamp param', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  it('detects youtu.be short URL with timestamp', async () => {
    const result = await resolveUrl('https://youtu.be/dQw4w9WgXcQ?t=120');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  // ────────────────────────────────────────────────────────
  // Protocol / Subdomain Variations
  // ────────────────────────────────────────────────────────

  it('detects URL without www subdomain', async () => {
    const result = await resolveUrl('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  it('detects HTTP (non-HTTPS) YouTube URL', async () => {
    const result = await resolveUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    }
  });

  // ────────────────────────────────────────────────────────
  // Video ID character set (A-Z, a-z, 0-9, -, _)
  // ────────────────────────────────────────────────────────

  it('extracts video ID with hyphens and underscores', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=a-B_c1D2e3F');
    expect(result.type).toBe('youtube');
    if (result.type === 'youtube') {
      expect(result.videoId).toBe('a-B_c1D2e3F');
    }
  });

  // ────────────────────────────────────────────────────────
  // Non-matching URLs (should NOT trigger YouTube handler)
  // ────────────────────────────────────────────────────────

  it('does not match youtube.com homepage', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://www.youtube.com');
    expect(result.type).not.toBe('youtube');
  });

  it('does not match youtube.com/channel URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.type).not.toBe('youtube');
  });

  it('does not match youtube.com/playlist URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    expect(result.type).not.toBe('youtube');
  });

  it('does not match video ID shorter than 11 characters', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://www.youtube.com/watch?v=short');
    expect(result.type).not.toBe('youtube');
  });

  it('does not match non-YouTube domain with similar path', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
    });

    const result = await resolveUrl('https://notyoutube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).not.toBe('youtube');
  });

  // ────────────────────────────────────────────────────────
  // Priority: YouTube handler runs before content-type probe
  // ────────────────────────────────────────────────────────

  it('resolves YouTube URL without making any network request', async () => {
    const result = await resolveUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result.type).toBe('youtube');
    // No fetch calls — YouTube handler is pure regex
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
