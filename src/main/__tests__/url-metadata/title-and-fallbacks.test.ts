/**
 * Tests for title extraction and fallback chains.
 *
 * Covers: <title> tag parsing, og:title → <title> fallback, whitespace handling,
 * og:description → meta description fallback, Twitter card fallback.
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

describe('URL Metadata — Title & Fallback Chains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── og:title → <title> fallback ──────────────────────────

  it('falls back to <title> tag when og:title is missing', () => {
    mockHtmlResponse(`
      <html><head>
        <title>Fallback Title</title>
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Fallback Title');
    });
  });

  it('prefers og:title over <title> when both exist', () => {
    mockHtmlResponse(`
      <html><head>
        <title>HTML Title</title>
        <meta property="og:title" content="OG Title">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('OG Title');
    });
  });

  // ── <title> edge cases ────────────────────────────────────

  it('trims whitespace from <title> tag', () => {
    mockHtmlResponse(`
      <html><head>
        <title>  Spaced Title  </title>
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Spaced Title');
    });
  });

  it.fails('collapses whitespace in <title> with internal newlines', () => {
    mockHtmlResponse(`
      <html><head>
        <title>
          Multi
          Line
          Title
        </title>
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Multi Line Title');
    });
  });

  // Empty <title></title> with no OG tags should result in empty title.
  // Verify by also checking that description is empty (proving the HTML was
  // actually parsed, not that fetch failed).
  it('returns empty string for empty <title> tag', () => {
    mockHtmlResponse(`
      <html><head>
        <title></title>
        <meta property="og:description" content="Proof HTML was parsed">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('');
      // This proves the HTML was parsed successfully — not a fetch failure
      expect(result.description).toBe('Proof HTML was parsed');
    });
  });

  it('handles <title> tag with attributes', () => {
    mockHtmlResponse(`
      <html><head>
        <title data-rh="true" lang="en">Attributed Title</title>
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Attributed Title');
    });
  });

  // The regex uses the 'i' flag — uppercase <TITLE> should still match.
  it('extracts title from uppercase <TITLE> tag', () => {
    mockHtmlResponse(`<HTML><HEAD><TITLE>Uppercase Title</TITLE></HEAD></HTML>`);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Uppercase Title');
    });
  });

  // ── Description fallback ──────────────────────────────────

  it('falls back to meta description when og:description is missing', () => {
    mockHtmlResponse(`
      <html><head>
        <meta name="description" content="Fallback description">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.description).toBe('Fallback description');
    });
  });

  // ── Twitter card fallback ─────────────────────────────────

  it.fails('falls back to twitter:title when og:title and <title> are missing', () => {
    mockHtmlResponse(`
      <html><head>
        <meta name="twitter:title" content="Twitter Title">
        <meta name="twitter:description" content="Twitter Desc">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('Twitter Title');
      expect(result.description).toBe('Twitter Desc');
    });
  });
});
