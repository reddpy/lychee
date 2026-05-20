export type UrlKind = "image" | "bookmark";

export interface ClassifiedUrl {
  kind: UrlKind;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(?:\?|#|$)/i;

export function classifyUrl(url: string): ClassifiedUrl {
  try {
    if (IMAGE_EXT_RE.test(new URL(url).pathname)) return { kind: "image" };
  } catch {
    // invalid URL — fall through to bookmark
  }
  return { kind: "bookmark" };
}
