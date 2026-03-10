const TEXT_FORMAT_HIGHLIGHT = 1 << 7;

function splitHighlightedTextNode(node: Record<string, unknown>, queryLower: string) {
  const text = typeof node.text === "string" ? node.text : "";
  if (!text) return [node];
  const lower = text.toLowerCase();
  if (!queryLower || !lower.includes(queryLower)) return [node];

  const baseFormat = typeof node.format === "number" ? node.format : 0;
  const parts: Record<string, unknown>[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(queryLower, cursor);
    if (idx < 0) {
      const tail = text.slice(cursor);
      if (tail) parts.push({ ...node, text: tail, format: baseFormat });
      break;
    }
    if (idx > cursor) {
      parts.push({
        ...node,
        text: text.slice(cursor, idx),
        format: baseFormat,
      });
    }
    parts.push({
      ...node,
      text: text.slice(idx, idx + queryLower.length),
      format: baseFormat | TEXT_FORMAT_HIGHLIGHT,
    });
    cursor = idx + queryLower.length;
  }
  return parts;
}

export function applySerializedHighlights<T extends { root?: { children?: unknown } }>(
  state: T,
  query: string,
): T {
  const q = query.trim().toLowerCase();
  if (!q) return state;
  const cloned = JSON.parse(JSON.stringify(state)) as T;

  const walkChildren = (children: unknown[]): unknown[] => {
    const result: unknown[] = [];
    for (const child of children) {
      if (!child || typeof child !== "object") {
        result.push(child);
        continue;
      }
      const node = child as Record<string, unknown>;
      if (node.type === "text") {
        result.push(...splitHighlightedTextNode(node, q));
        continue;
      }
      if (Array.isArray(node.children)) {
        node.children = walkChildren(node.children);
      }
      result.push(node);
    }
    return result;
  };

  if (cloned.root && Array.isArray(cloned.root.children)) {
    cloned.root.children = walkChildren(cloned.root.children) as unknown;
  }
  return cloned;
}

export function buildHighlightedPreviewStateFromParsed<T extends { root?: { children?: unknown } }>(
  parsedState: T | undefined,
  query: string,
) {
  if (!parsedState) return undefined;
  return JSON.stringify(applySerializedHighlights(parsedState, query));
}

export { TEXT_FORMAT_HIGHLIGHT };
