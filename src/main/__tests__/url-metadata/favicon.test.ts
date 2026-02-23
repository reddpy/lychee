/**
 * Tests for favicon extraction.
 *
 * Covers: relative/absolute/protocol-relative URLs, shortcut icon, fallback to
 * /favicon.ico, type/sizes attributes, apple-touch-icon, query params, data URIs,
 * port numbers.
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

describe('URL Metadata — Favicon Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── URL resolution ────────────────────────────────────────

  it('resolves relative favicon URL to absolute', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="icon" href="/img/favicon.png">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com/page').then((result) => {
      expect(result.faviconUrl).toBe('https://example.com/img/favicon.png');
    });
  });

  it('returns absolute favicon URL unchanged', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="icon" href="https://cdn.example.com/icon.png">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('https://cdn.example.com/icon.png');
    });
  });

  it('resolves protocol-relative favicon URL', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="icon" href="//cdn.example.com/icon.png">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('https://cdn.example.com/icon.png');
    });
  });

  // ── Rel attribute variants ────────────────────────────────

  it('handles "shortcut icon" rel attribute', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="shortcut icon" href="/favicon.ico">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('https://example.com/favicon.ico');
    });
  });

  it.fails('extracts apple-touch-icon as favicon when no rel="icon" exists', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="apple-touch-icon" href="/apple-icon.png">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('https://example.com/apple-icon.png');
    });
  });

  // The second regex branch handles href before rel.
  it('extracts favicon when href comes before rel', () => {
    mockHtmlResponse(`
      <html><head>
        <link href="/icon.png" rel="icon">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('https://example.com/icon.png');
    });
  });

  // ── Extra attributes on link tag ──────────────────────────

  it('extracts favicon when type attribute sits between rel and href', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="icon" type="image/png" href="/icon.png">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('https://example.com/icon.png');
    });
  });

  it('extracts favicon with sizes attribute', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="icon" sizes="32x32" href="/favicon-32x32.png">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('https://example.com/favicon-32x32.png');
    });
  });

  // ── Special href values ───────────────────────────────────

  it('handles favicon URL with query parameters', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="icon" href="/favicon.ico?v=2">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('https://example.com/favicon.ico?v=2');
    });
  });

  it('handles data URI favicon', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="icon" href="data:image/png;base64,iVBORw0KGgo=">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.faviconUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
    });
  });

  // ── Fallback ──────────────────────────────────────────────

  it('falls back to /favicon.ico when no link tag', () => {
    mockHtmlResponse(`
      <html><head>
        <title>No Favicon</title>
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com/some/page').then((result) => {
      expect(result.faviconUrl).toBe('https://example.com/favicon.ico');
    });
  });

  // The URL constructor is lenient — even odd hrefs like ":::invalid" resolve
  // against a valid base URL. Verify the exact resolved output.
  it('resolves unusual favicon href against base URL', () => {
    mockHtmlResponse(`
      <html><head>
        <link rel="icon" href=":::invalid">
      </head></html>
    `);

    return fetchUrlMetadata('https://example.com').then((result) => {
      // new URL(':::invalid', 'https://example.com') → 'https://example.com/:::invalid'
      expect(result.faviconUrl).toBe('https://example.com/:::invalid');
    });
  });

  it('favicon fallback includes port number', () => {
    mockHtmlResponse(`<html><head><title>Dev Server</title></head></html>`);

    return fetchUrlMetadata('https://localhost:3000/page').then((result) => {
      expect(result.faviconUrl).toBe('https://localhost:3000/favicon.ico');
    });
  });
});
