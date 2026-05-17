import path from 'path';

const URL_PREFIX = 'lychee-image://image/';

export interface ResolvedImagePath {
  ok: boolean;
  path?: string;
}

/**
 * Resolve a `lychee-image://image/<filename>` URL to an absolute filesystem path,
 * rejecting anything that escapes `imagesDir` (path traversal, absolute paths,
 * null-byte injection, malformed URI encoding, empty/self references).
 */
export function resolveImagePath(url: string, imagesDir: string): ResolvedImagePath {
  if (!url.startsWith(URL_PREFIX)) return { ok: false };
  const raw = url.slice(URL_PREFIX.length);
  if (!raw) return { ok: false };

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false };
  }
  if (decoded.includes('\0')) return { ok: false };

  const baseDir = path.resolve(imagesDir);
  const resolved = path.resolve(baseDir, decoded);

  if (resolved === baseDir) return { ok: false };
  if (!resolved.startsWith(baseDir + path.sep)) return { ok: false };

  return { ok: true, path: resolved };
}
