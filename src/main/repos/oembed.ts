import type { UrlMetadataResult } from '../../shared/ipc-types';

interface OEmbedProvider {
  name: string;
  /** Regex to match URLs this provider handles. */
  urlPattern: RegExp;
  /** oEmbed API endpoint. `{url}` is replaced with the encoded URL. */
  endpoint: string;
}

// Provider registry — add new entries here to support more services.
const providers: OEmbedProvider[] = [
  {
    name: 'YouTube',
    urlPattern: /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)/,
    endpoint: 'https://www.youtube.com/oembed?url={url}&format=json',
  },
  {
    name: 'Spotify',
    urlPattern: /open\.spotify\.com\//,
    endpoint: 'https://open.spotify.com/oembed?url={url}',
  },
  {
    name: 'SoundCloud',
    urlPattern: /soundcloud\.com\//,
    endpoint: 'https://soundcloud.com/oembed?url={url}&format=json',
  },
  {
    name: 'Vimeo',
    urlPattern: /vimeo\.com\//,
    endpoint: 'https://vimeo.com/api/oembed.json?url={url}',
  },
  {
    name: 'TikTok',
    urlPattern: /tiktok\.com\//,
    endpoint: 'https://www.tiktok.com/oembed?url={url}',
  },
];

function findProvider(url: string): OEmbedProvider | null {
  return providers.find((p) => p.urlPattern.test(url)) ?? null;
}

function faviconFallback(url: string): string {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return '';
  }
}

/**
 * Try to fetch metadata via oEmbed for a known provider.
 * Returns `null` if no provider matches or the request fails.
 */
export async function fetchOEmbedMetadata(url: string): Promise<UrlMetadataResult | null> {
  const provider = findProvider(url);
  if (!provider) return null;

  const { net } = await import('electron');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const endpoint = provider.endpoint.replace('{url}', encodeURIComponent(url));
    const response = await net.fetch(endpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: controller.signal as never,
      redirect: 'follow',
    });

    if (!response.ok) return null;

    const data = await response.json();

    const title = data.title || '';
    const imageUrl = data.thumbnail_url || '';

    // If oEmbed returned nothing useful, fall through to HTML scraping
    if (!title && !imageUrl) return null;

    return {
      title,
      description: data.author_name ? `by ${data.author_name}` : '',
      imageUrl,
      faviconUrl: faviconFallback(url),
      url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
