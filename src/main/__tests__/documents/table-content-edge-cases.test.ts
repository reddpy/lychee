/**
 * Backend tests for document content containing Lexical table nodes.
 * Ensures tables round-trip unchanged for create/update/get, so export
 * (Markdown, HTML, etc.) and other consumers see identical structure.
 *
 * User-behavior alignment:
 * - Payloads use the same structure and required fields as editor.getEditorState().toJSON()
 *   (see table-markdown-transformer.test.ts "Lexical JSON serialization — DB storage format").
 * - The backend does not parse or re-serialize content; it stores the string as-is.
 *   So any valid JSON the editor sends (including optional fields like direction, format, indent)
 *   round-trips unchanged. We test both minimal and full shapes to cover real saves.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
}));
vi.mock('../../db', async () => {
  const { getTestDb } = await import('../helpers');
  return { getDb: () => getTestDb() };
});

import {
  setupDb,
  getDocumentById,
  createDocument,
  updateDocument,
} from './setup';

// ─── Helpers: build Lexical root JSON with table(s) ─────────────────────────
// Shape matches @lexical/table serialization (table → tablerow → tablecell →
// paragraph → text; headerState 0/1, colSpan, rowSpan) so tests mirror user-created content.

type CellSpec = {
  headerState?: number;
  colSpan?: number;
  rowSpan?: number;
  text: string;
};

function cell(headerState: number, text: string, colSpan = 1, rowSpan = 1) {
  return {
    type: 'tablecell' as const,
    headerState,
    colSpan,
    rowSpan,
    children: [
      {
        type: 'paragraph' as const,
        children: [{ type: 'text' as const, text }],
      },
    ],
  };
}

function row(cells: CellSpec[]) {
  return {
    type: 'tablerow' as const,
    children: cells.map((c) =>
      cell(
        c.headerState ?? 0,
        c.text,
        c.colSpan ?? 1,
        c.rowSpan ?? 1,
      ),
    ),
  };
}

function table(rows: CellSpec[][]) {
  return {
    type: 'table' as const,
    children: rows.map((r) => row(r)),
  };
}

function rootWithChildren(children: unknown[]) {
  return {
    root: {
      children,
      type: 'root' as const,
      version: 1,
    },
  };
}

function tableContent(children: unknown[]) {
  return JSON.stringify(rootWithChildren(children));
}

// ─── Round-trip assertion (exact string for export/interop) ─────────────────

function assertRoundTrip(content: string, id: string): void {
  const retrieved = getDocumentById(id)!;
  expect(retrieved.content).toBe(content);
}

describe('Document table content — edge cases and interop', () => {
  setupDb();

  describe('create + get round-trip', () => {
    it('minimal table (1x1) round-trips unchanged', () => {
      const content = tableContent([
        table([[{ headerState: 1, text: 'Only' }]]),
      ]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
      const parsed = JSON.parse(doc.content) as { root: { children: { type: string; children: { children: unknown[] }[] }[] } };
      expect(parsed.root.children[0].type).toBe('table');
      expect(parsed.root.children[0].children).toHaveLength(1);
      expect((parsed.root.children[0].children[0] as { children: unknown[] }).children).toHaveLength(1);
    });

    it('table with empty cells (empty text) round-trips', () => {
      const content = tableContent([
        table([
          [{ headerState: 1, text: 'A' }, { headerState: 1, text: '' }],
          [{ text: '' }, { text: 'B' }],
        ]),
      ]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
    });

    it('table with unicode and emoji in cells round-trips', () => {
      const content = tableContent([
        table([
          [{ headerState: 1, text: '日本語' }, { headerState: 1, text: 'Ünïcödé' }],
          [{ text: '🎉' }, { text: 'αβγ' }],
        ]),
      ]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
    });

    it('table with special characters in cells (export-sensitive) round-trips', () => {
      // Pipes, dashes, colons appear in Markdown tables; quotes and newlines in JSON.
      const content = tableContent([
        table([
          [{ headerState: 1, text: '| pipe |' }, { headerState: 1, text: '---' }],
          [{ text: ':---:' }, { text: 'Say "hello"' }],
        ]),
      ]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
    });

    it('table with newlines and backslash in cell text round-trips', () => {
      const content = tableContent([
        table([
          [{ headerState: 1, text: 'Line1\nLine2' }, { headerState: 1, text: 'Back\\slash' }],
        ]),
      ]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
    });

    it('table with merged cells (colSpan/rowSpan) round-trips', () => {
      // One cell with colSpan=2 occupies two columns; row has only one cell.
      const content = tableContent([
        table([
          [{ headerState: 1, text: 'Merged', colSpan: 2, rowSpan: 1 }],
          [
            { headerState: 0, text: 'A', colSpan: 1, rowSpan: 1 },
            { headerState: 0, text: 'B', colSpan: 1, rowSpan: 1 },
          ],
        ]),
      ]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
      const parsed = JSON.parse(doc.content) as { root: { children: { children: { children: { colSpan: number; rowSpan: number }[] }[] }[] } };
      const firstRow = parsed.root.children[0].children[0] as { children: { colSpan: number; rowSpan: number }[] };
      const firstCell = firstRow.children[0];
      expect(firstCell.colSpan).toBe(2);
      expect(firstCell.rowSpan).toBe(1);
    });

    it('table with only header row (no data rows) round-trips', () => {
      const content = tableContent([
        table([[{ headerState: 1, text: 'H1' }, { headerState: 1, text: 'H2' }]]),
      ]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
    });

    it('document with paragraph + table + paragraph round-trips', () => {
      const content = JSON.stringify({
        root: {
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: 'Before' }] },
            table([[{ headerState: 1, text: 'Mid' }]]),
            { type: 'paragraph', children: [{ type: 'text', text: 'After' }] },
          ],
          type: 'root',
          version: 1,
        },
      });
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
      const parsed = JSON.parse(doc.content) as { root: { children: { type: string }[] } };
      expect(parsed.root.children[0].type).toBe('paragraph');
      expect(parsed.root.children[1].type).toBe('table');
      expect(parsed.root.children[2].type).toBe('paragraph');
    });

    it('document with no table (after table removal) round-trips', () => {
      const content = JSON.stringify({
        root: {
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: 'Only paragraph' }] },
          ],
          type: 'root',
          version: 1,
        },
      });
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
      const parsed = JSON.parse(doc.content) as { root: { children: { type: string }[] } };
      expect(parsed.root.children.some((n: { type: string }) => n.type === 'table')).toBe(false);
      expect(parsed.root.children).toHaveLength(1);
    });

    it('document with multiple tables round-trips', () => {
      const content = tableContent([
        table([[{ headerState: 1, text: 'T1' }]]),
        table([[{ headerState: 1, text: 'T2' }]]),
        table([[{ headerState: 1, text: 'T3' }]]),
      ]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
      const parsed = JSON.parse(doc.content) as { root: { children: { type: string }[] } };
      expect(parsed.root.children.every((n: { type: string }) => n.type === 'table')).toBe(true);
      expect(parsed.root.children).toHaveLength(3);
    });

    it('table with full editor shape (direction, format, indent) round-trips', () => {
      // Same optional fields the editor can emit on root/paragraph (see payload-edge-cases "realistic Lexical JSON").
      const content = JSON.stringify({
        root: {
          children: [
            {
              type: 'table',
              children: [
                {
                  type: 'tablerow',
                  children: [
                    {
                      type: 'tablecell',
                      headerState: 1,
                      colSpan: 1,
                      rowSpan: 1,
                      children: [
                        {
                          type: 'paragraph',
                          children: [{ type: 'text', text: 'A', format: 0, mode: 'normal' }],
                          direction: 'ltr',
                          format: '',
                          indent: 0,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      });
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
    });

    it('wide table (many columns) round-trips', () => {
      const cols = 20;
      const headerRow = Array.from({ length: cols }, (_, i) => ({ headerState: 1 as number, text: `H${i}` }));
      const dataRow = Array.from({ length: cols }, (_, i) => ({ text: `D${i}` }));
      const content = tableContent([table([headerRow, dataRow])]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
      const parsed = JSON.parse(doc.content) as { root: { children: { children: { children: unknown[] }[] }[] } };
      expect(parsed.root.children[0].children[0].children).toHaveLength(cols);
    });
  });

  describe('update round-trip', () => {
    it('replacing content with table round-trips', () => {
      const doc = createDocument({ title: 'Note', content: '{"root":{"children":[],"type":"root","version":1}}' });
      const newContent = tableContent([table([[{ headerState: 1, text: 'New' }]])]);
      updateDocument(doc.id, { content: newContent });
      assertRoundTrip(newContent, doc.id);
    });

    it('updating table content (more rows) round-trips', () => {
      const doc = createDocument({
        content: tableContent([table([[{ headerState: 1, text: 'A' }]])]),
      });
      const expanded = tableContent([
        table([
          [{ headerState: 1, text: 'A' }],
          [{ text: '1' }],
          [{ text: '2' }],
        ]),
      ]);
      updateDocument(doc.id, { content: expanded });
      assertRoundTrip(expanded, doc.id);
    });

    it('replacing table with no-table content (delete row when header-only) round-trips', () => {
      const withTable = tableContent([table([[{ headerState: 1, text: 'H' }]])]);
      const doc = createDocument({ content: withTable });
      const noTable = JSON.stringify({
        root: {
          children: [{ type: 'paragraph', children: [{ type: 'text', text: '' }] }],
          type: 'root',
          version: 1,
        },
      });
      updateDocument(doc.id, { content: noTable });
      assertRoundTrip(noTable, doc.id);
      const parsed = JSON.parse(getDocumentById(doc.id)!.content) as { root: { children: { type: string }[] } };
      expect(parsed.root.children.some((n: { type: string }) => n.type === 'table')).toBe(false);
    });
  });

  describe('stress — large table and many tables', () => {
    it('large table (50 rows × 10 cols) round-trips byte-for-byte', () => {
      const rows = 50;
      const cols = 10;
      const tableRows: CellSpec[][] = [];
      tableRows.push(Array.from({ length: cols }, (_, i) => ({ headerState: 1, text: `H${i}` })));
      for (let r = 0; r < rows - 1; r++) {
        tableRows.push(Array.from({ length: cols }, (_, c) => ({ text: `r${r}c${c}` })));
      }
      const content = tableContent([table(tableRows)]);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
      type ParsedTable = { children: { children: unknown[] }[] };
      const parsed = JSON.parse(doc.content) as { root: { children: ParsedTable[] } };
      const tbl = parsed.root.children[0];
      expect(tbl.children).toHaveLength(rows);
      expect((tbl.children[0] as { children: unknown[] }).children).toHaveLength(cols);
    });

    it('document with 10 tables round-trips unchanged', () => {
      const tables = Array.from({ length: 10 }, (_, i) =>
        table([[{ headerState: 1, text: `Table ${i}` }]]),
      );
      const content = tableContent(tables);
      const doc = createDocument({ content });
      assertRoundTrip(content, doc.id);
    });
  });

  describe('export/interop — exact string equality', () => {
    it('canonical Markdown-style table (header + separator row + data) round-trips for export', () => {
      // Structure that Markdown export would produce: header row + data rows.
      // No "separator" row in Lexical; we store header + data rows only.
      const content = tableContent([
        table([
          [{ headerState: 1, text: 'Name' }, { headerState: 1, text: 'Score' }],
          [{ text: 'Alice' }, { text: '100' }],
          [{ text: 'Bob' }, { text: '85' }],
        ]),
      ]);
      const doc = createDocument({ content });
      const retrieved = getDocumentById(doc.id)!;
      expect(retrieved.content).toBe(content);
      // Re-parse and sanity-check for export code paths
      const parsed = JSON.parse(retrieved.content) as Record<string, unknown>;
      const tbl = (parsed.root as { children: unknown[] }).children[0] as { children: { children: { children: { children: { text: string }[] }[] }[] }[] };
      const textNode = tbl.children[1].children[0].children[0].children[0] as { text: string };
      expect(textNode.text).toBe('Alice');
    });
  });
});
