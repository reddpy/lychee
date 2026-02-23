/**
 * Tests with realistic HTML from real-world websites.
 *
 * Covers: full page heads with many meta tags, minimal pages, missing <head>,
 * malformed HTML with OG tags in <body>.
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

describe('URL Metadata — Realistic Site Patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts metadata from realistic GitHub-style HTML', () => {
    mockHtmlResponse(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>lychee - A note-taking app</title>
        <meta property="og:title" content="lychee">
        <meta property="og:description" content="A beautiful note-taking app built with Electron">
        <meta property="og:image" content="https://repository-images.githubusercontent.com/abc/hero.png">
        <meta property="og:url" content="https://github.com/user/lychee">
        <meta property="og:type" content="object">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="lychee">
        <link rel="icon" class="js-site-favicon" type="image/svg+xml" href="https://github.githubassets.com/favicons/favicon.svg">
        <link rel="alternate icon" type="image/png" href="https://github.githubassets.com/favicons/favicon.png">
      </head>
    `);

    return fetchUrlMetadata('https://github.com/user/lychee').then((result) => {
      expect(result.title).toBe('lychee');
      expect(result.description).toBe('A beautiful note-taking app built with Electron');
      expect(result.imageUrl).toBe('https://repository-images.githubusercontent.com/abc/hero.png');
      expect(result.faviconUrl).toBe('https://github.githubassets.com/favicons/favicon.svg');
    });
  });

  it('handles page with no <head> section', () => {
    mockHtmlResponse(`<html><body><h1>Hello World</h1></body></html>`);

    return fetchUrlMetadata('https://example.com').then((result) => {
      expect(result.title).toBe('');
      expect(result.description).toBe('');
      expect(result.faviconUrl).toBe('https://example.com/favicon.ico');
    });
  });
});
