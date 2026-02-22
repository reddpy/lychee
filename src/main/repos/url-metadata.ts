import type { UrlMetadataResult } from '../../shared/ipc-types';

function extractMeta(html: string, property: string): string {
  // Matches <meta property="og:title" content="..." /> or <meta content="..." property="og:title" />
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']` +
    `|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  const match = html.match(re);
  return match?.[1] || match?.[2] || '';
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() || '';
}

function extractFavicon(html: string, baseUrl: string): string {
  // Look for <link rel="icon" href="..."> or <link rel="shortcut icon" href="...">
  const match = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']*)["']/i)
    || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["'](?:shortcut )?icon["']/i);

  if (match?.[1]) {
    const href = match[1];
    // Resolve relative URLs
    if (href.startsWith('http')) return href;
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return '';
    }
  }

  // Fallback to /favicon.ico
  try {
    const url = new URL(baseUrl);
    return `${url.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

export async function fetchUrlMetadata(url: string): Promise<UrlMetadataResult> {
  const empty: UrlMetadataResult = { title: '', description: '', imageUrl: '', faviconUrl: '', url };

  const { net } = await import('electron');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await net.fetch(url, {
      signal: controller.signal as never,
      redirect: 'follow',
    });

    if (!response.ok) return empty;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return { ...empty, title: url };

    // Only read the first 50KB — OG tags are in <head>
    const reader = response.body?.getReader();
    if (!reader) return empty;

    let html = '';
    const decoder = new TextDecoder();
    const MAX_BYTES = 50_000;

    while (html.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel();

    const title = extractMeta(html, 'og:title') || extractTitle(html);
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    const imageUrl = extractMeta(html, 'og:image');
    const faviconUrl = extractFavicon(html, url);

    return { title, description, imageUrl, faviconUrl, url };
  } catch {
    return empty;
  } finally {
    clearTimeout(timeout);
  }
}
