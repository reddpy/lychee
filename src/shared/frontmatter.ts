/**
 * YAML frontmatter for vault markdown files.
 *
 * Deliberately a tiny, dependency-free subset: the schema is fixed and known, so
 * we do not need a general YAML parser (and its attack surface). Strings are
 * emitted as JSON string literals, which are valid YAML double-quoted scalars, so
 * arbitrary titles/IDs survive exactly. Unknown keys are ignored on parse.
 */

export interface VaultFrontmatter {
  id: string;
  /**
   * Deprecated / migration only. The note's title is its filename (Obsidian
   * model); this field is read when adopting older files but is never written.
   */
  title?: string;
  /** Native emoji character for the note icon (app metadata, not body prose). */
  emoji?: string;
  /** ISO date the note was bookmarked/starred, if any. */
  bookmarked?: string;
  created?: string;
  updated?: string;
  contentSchemaVersion?: number;
  order?: number;
}

const DELIMITER = '---';

/** JSON-quote a string so it is a valid YAML double-quoted scalar. */
function quote(value: string): string {
  return JSON.stringify(value);
}

export function serializeFrontmatter(data: VaultFrontmatter): string {
  const lines: string[] = [DELIMITER];
  lines.push(`id: ${quote(data.id)}`);
  if (data.title) lines.push(`title: ${quote(data.title)}`);
  if (data.emoji) lines.push(`emoji: ${quote(data.emoji)}`);
  if (data.bookmarked) lines.push(`bookmarked: ${quote(data.bookmarked)}`);
  if (data.created) lines.push(`created: ${quote(data.created)}`);
  if (data.updated) lines.push(`updated: ${quote(data.updated)}`);
  if (typeof data.contentSchemaVersion === 'number') {
    lines.push(`content_schema_version: ${data.contentSchemaVersion}`);
  }
  if (typeof data.order === 'number') lines.push(`order: ${data.order}`);
  lines.push(DELIMITER);
  return lines.join('\n') + '\n';
}

function parseValue(raw: string): string | number {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * Split a markdown document into its frontmatter and body. A document with no
 * leading `---` block (or an unterminated one) is treated as body-only.
 */
export function parseFrontmatter(markdown: string): {
  data: Partial<VaultFrontmatter> & { id?: string; title?: string };
  body: string;
} {
  const normalized = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown;
  if (!normalized.startsWith(DELIMITER)) {
    return { data: {}, body: markdown };
  }

  const lines = normalized.split('\n');
  if (lines[0].trim() !== DELIMITER) return { data: {}, body: markdown };

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === DELIMITER) {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: {}, body: markdown };

  const data: Record<string, string | number> = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    data[key] = parseValue(line.slice(separator + 1));
  }

  const body = lines.slice(end + 1).join('\n').replace(/^\n/, '');
  const result: Partial<VaultFrontmatter> & { id?: string; title?: string } = {};
  if (typeof data.id === 'string') result.id = data.id;
  if (typeof data.title === 'string') result.title = data.title;
  if (typeof data.emoji === 'string') result.emoji = data.emoji;
  if (typeof data.bookmarked === 'string') result.bookmarked = data.bookmarked;
  if (typeof data.created === 'string') result.created = data.created;
  if (typeof data.updated === 'string') result.updated = data.updated;
  if (typeof data.content_schema_version === 'number') {
    result.contentSchemaVersion = data.content_schema_version;
  }
  if (typeof data.order === 'number') result.order = data.order;

  return { data: result, body };
}
