export type HighlightedSnippet = {
  before: string;
  match: string;
  after: string;
};

const TEXT_LIKE_KEYS = new Set([
  "text",
  "code",
  "description",
  "url",
  "altText",
  "caption",
]);

export function normalizedTitle(title: string) {
  return title.trim() || "Untitled";
}

export function scoreDocument(title: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = normalizedTitle(title).toLowerCase();
  if (t === q) return 300;
  if (t.startsWith(q)) return 200;
  if (t.includes(q)) return 100;
  return -1;
}

export function countOccurrences(text: string, query: string) {
  const source = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!source || !needle) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const idx = source.indexOf(needle, cursor);
    if (idx < 0) break;
    count += 1;
    cursor = idx + needle.length;
  }
  return count;
}

function extractTextFromUnknown(node: unknown, out: string[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child) => extractTextFromUnknown(child, out));
    return;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim() && TEXT_LIKE_KEYS.has(key)) {
      out.push(value.trim());
      continue;
    }
    if (value && typeof value === "object") {
      extractTextFromUnknown(value, out);
    }
  }
}

export function extractPlainText(content: string) {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as unknown;
    const parts: string[] = [];
    extractTextFromUnknown(parsed, parts);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

export function buildHighlightedSnippet(
  text: string,
  query: string,
  radius = 44,
): HighlightedSnippet | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  const q = query.trim();
  if (!normalized || !q) return null;
  const idx = normalized.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return null;

  const start = Math.max(0, idx - radius);
  const end = Math.min(normalized.length, idx + q.length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  const windowText = normalized.slice(start, end).trim();
  const localMatchStart = windowText.toLowerCase().indexOf(q.toLowerCase());
  const localMatchEnd = localMatchStart + q.length;
  if (localMatchStart < 0) {
    return { before: `${prefix}${windowText}${suffix}`, match: "", after: "" };
  }
  return {
    before: `${prefix}${windowText.slice(0, localMatchStart)}`,
    match: windowText.slice(localMatchStart, localMatchEnd),
    after: `${windowText.slice(localMatchEnd)}${suffix}`,
  };
}
