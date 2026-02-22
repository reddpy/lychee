import type { ResolvedUrlResult } from '../../shared/ipc-types';
import { downloadImage } from './images';

interface UrlHandler {
  name: string;
  test: (url: string) => boolean;
  resolve: (url: string) => Promise<ResolvedUrlResult>;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i;
const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

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
        signal: controller.signal as never,
        redirect: 'follow',
      });

      if (!response.ok) {
        response = await net.fetch(url, {
          method: 'GET',
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
  imageByExtensionHandler,
  // Future: youtubeHandler, twitterHandler, etc.
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
