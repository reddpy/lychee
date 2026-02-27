import type { ResolvedUrlResult } from '../../shared/ipc-types';
import { downloadImage } from './images';
import { fetchUrlMetadata } from './url-metadata';

interface UrlHandler {
  name: string;
  test: (url: string) => boolean;
  resolve: (url: string) => Promise<ResolvedUrlResult>;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i;
const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8',
};

const YOUTUBE_RE = /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;

const youtubeHandler: UrlHandler = {
  name: 'youtube',
  test: (url) => YOUTUBE_RE.test(url),
  resolve: async (url) => {
    const match = url.match(YOUTUBE_RE);
    return match
      ? { type: 'youtube', videoId: match[1], url }
      : { type: 'unsupported', url, reason: 'YouTube regex failed' };
  },
};

const imageByExtensionHandler: UrlHandler = {
  name: 'image-by-extension',
  test: (url) => IMAGE_EXTENSIONS.test(new URL(url).pathname),
  resolve: async (url) => {
    try {
      const { id, filePath } = await downloadImage(url);
      return { type: 'image', id, filePath, sourceUrl: url };
    } catch {
      return { type: 'unsupported', url, reason: 'Failed to download image' };
    }
  },
};

// Fallback: HEAD request to check Content-Type
const contentTypeProbeHandler: UrlHandler = {
  name: 'content-type-probe',
  test: () => true,
  resolve: async (url) => {
    const { net } = await import('electron');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      // Try HEAD first, fall back to GET if HEAD fails (some servers reject HEAD)
      let response = await net.fetch(url, {
        method: 'HEAD',
        headers: FETCH_HEADERS,
        signal: controller.signal as never,
        redirect: 'follow',
      });

      if (!response.ok) {
        response = await net.fetch(url, {
          method: 'GET',
          headers: FETCH_HEADERS,
          signal: controller.signal as never,
          redirect: 'follow',
        });
      }

      const contentType = response.headers.get('content-type') || '';

      if (IMAGE_CONTENT_TYPES.some((t) => contentType.includes(t))) {
        // It's an image — download it
        const { id, filePath } = await downloadImage(url);
        return { type: 'image', id, filePath, sourceUrl: url };
      }

      if (contentType.includes('text/html')) {
        const meta = await fetchUrlMetadata(url);
        return { type: 'bookmark', url: meta.url, title: meta.title, description: meta.description, imageUrl: meta.imageUrl, faviconUrl: meta.faviconUrl };
      }

      return { type: 'unsupported', url, reason: `Unhandled content type: ${contentType}` };
    } catch {
      return { type: 'unsupported', url, reason: 'Failed to probe URL' };
    } finally {
      clearTimeout(timeout);
    }
  },
};

// Handler registry — order matters, first match wins.
// The fallback (content-type probe) must be last.
const handlers: UrlHandler[] = [
  youtubeHandler,
  imageByExtensionHandler,
  contentTypeProbeHandler,
];

export async function resolveUrl(url: string): Promise<ResolvedUrlResult> {
  for (const handler of handlers) {
    if (handler.test(url)) {
      return handler.resolve(url);
    }
  }
  return { type: 'unsupported', url, reason: 'No handler matched' };
}
