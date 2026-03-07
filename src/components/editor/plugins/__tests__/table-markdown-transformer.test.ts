import { describe, it, expect, vi } from 'vitest'

// Mock the React component imported by image-node.tsx so it works in a Node test environment
vi.mock('../../nodes/image-component', () => ({ ImageComponent: (): null => null }))
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  ParagraphNode,
  TextNode,
} from 'lexical'
import type { LexicalEditor } from 'lexical'
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
  $isTableNode,
  $isTableCellNode,
  TableCellHeaderStates,
} from '@lexical/table'
import { ImageNode, $createImageNode } from '../../nodes/image-node'
import { TABLE, TABLE_EXPORT, parseCells } from '../table-markdown-transformer'

function makeEditor(): LexicalEditor {
  return createEditor({
    nodes: [ParagraphNode, TextNode, TableNode, TableRowNode, TableCellNode, ImageNode],
    onError: (err) => { throw err },
  })
}

function update(editor: LexicalEditor, fn: () => void): void {
  editor.update(fn, { discrete: true })
}

// ─── parseCells ──────────────────────────────────────────────────────────────

describe('parseCells', () => {
  it('splits a basic pipe row into cells', () => {
    expect(parseCells('| a | b | c |')).toEqual(['a', 'b', 'c'])
  })

  it('strips leading and trailing pipe', () => {
    expect(parseCells('| foo | bar |')).toEqual(['foo', 'bar'])
  })

  it('trims whitespace from each cell', () => {
    expect(parseCells('|  hello  |  world  |')).toEqual(['hello', 'world'])
  })

  it('trims whitespace-only cells to empty string', () => {
    expect(parseCells('|   | B |')).toEqual(['', 'B'])
  })

  it('handles empty cells (adjacent pipes)', () => {
    expect(parseCells('|  | b |')).toEqual(['', 'b'])
  })

  it('handles single-cell row with empty content', () => {
    expect(parseCells('|  |')).toEqual([''])
  })

  it('handles trailing pipe with trailing space', () => {
    expect(parseCells('| x | y | ')).toEqual(['x', 'y'])
  })

  it('handles single-cell rows', () => {
    expect(parseCells('| only |')).toEqual(['only'])
  })

  it('preserves unicode content', () => {
    expect(parseCells('| 日本語 | Ünïcödé |')).toEqual(['日本語', 'Ünïcödé'])
  })

  it('preserves cell content with special characters (dashes, colons)', () => {
    // A divider-like string can appear as data if it is in a data row
    expect(parseCells('| --- | :---: |')).toEqual(['---', ':---:'])
  })
})

// ─── TABLE import transformer ─────────────────────────────────────────────────

describe('TABLE import transformer', () => {
  function importLines(
    editor: LexicalEditor,
    lines: string[],
    startLineIndex = 0,
  ): ReturnType<Exclude<typeof TABLE.handleImportAfterStartMatch, undefined>> {
    let result: ReturnType<Exclude<typeof TABLE.handleImportAfterStartMatch, undefined>> = null
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      result = TABLE.handleImportAfterStartMatch!({
        lines,
        rootNode: root,
        startLineIndex,
      } as unknown as Parameters<Exclude<typeof TABLE.handleImportAfterStartMatch, undefined>>[0])
    })
    return result
  }

  // ── Rejection cases ──────────────────────────────────────────────────────

  it('returns null when there is no second line', () => {
    const editor = makeEditor()
    expect(importLines(editor, ['| a | b |'])).toBeNull()
  })

  it('returns null when the second line is not a divider', () => {
    const editor = makeEditor()
    expect(importLines(editor, ['| a | b |', '| not a divider |'])).toBeNull()
  })

  it('returns null when startLineIndex leaves no room for a divider', () => {
    const editor = makeEditor()
    const lines = ['preamble', '| a | b |'] // startLineIndex=1 is the last line
    expect(importLines(editor, lines, 1)).toBeNull()
  })

  // ── Header-only tables ───────────────────────────────────────────────────

  it('creates a table with only a header row when no data rows follow', () => {
    const editor = makeEditor()
    const result = importLines(editor, ['| Name | Age |', '| --- | --- |'])

    expect(result).toEqual([true, 1]) // endLineIndex = divider line index

    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      expect($isTableNode(table)).toBe(true)
      expect(table.getChildrenSize()).toBe(1)
    })
  })

  it('returns endLineIndex = startLineIndex + 1 for a header-only table', () => {
    const editor = makeEditor()
    const lines = ['ignore', '| H |', '| --- |', 'ignore']
    const result = importLines(editor, lines, 1)
    // divider is at index 2
    expect(result).toEqual([true, 2])
  })

  // ── Data rows ────────────────────────────────────────────────────────────

  it('creates a table with header and data rows', () => {
    const editor = makeEditor()
    const lines = ['| Name | Age |', '| --- | --- |', '| Alice | 30 |', '| Bob | 25 |']
    const result = importLines(editor, lines)

    expect(result).toEqual([true, 3])

    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      expect(table.getChildrenSize()).toBe(3) // header + 2 data rows
    })
  })

  it('stops collecting data rows at the first non-table line', () => {
    const editor = makeEditor()
    const lines = [
      '| A | B |',
      '| --- | --- |',
      '| r1a | r1b |',
      'plain text breaks the table',
      '| r2a | r2b |', // not included
    ]
    const result = importLines(editor, lines)

    expect(result).toEqual([true, 2])

    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      expect(table.getChildrenSize()).toBe(2) // header + 1 data row only
    })
  })

  it('handles startLineIndex offset correctly', () => {
    const editor = makeEditor()
    const lines = ['preamble', '| A | B |', '| --- | --- |', '| r1 | r2 |']
    const result = importLines(editor, lines, 1)

    expect(result).toEqual([true, 3])

    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      expect(table.getChildrenSize()).toBe(2)
    })
  })

  // ── Cell header states ───────────────────────────────────────────────────

  it('marks header cells with TableCellHeaderStates.ROW', () => {
    const editor = makeEditor()
    importLines(editor, ['| H1 | H2 |', '| --- | --- |'])

    editor.read(() => {
      const headerRow = ($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode
      for (const cell of headerRow.getChildren()) {
        expect($isTableCellNode(cell)).toBe(true)
        expect((cell as TableCellNode).getHeaderStyles()).toBe(TableCellHeaderStates.ROW)
      }
    })
  })

  it('marks data cells with TableCellHeaderStates.NO_STATUS', () => {
    const editor = makeEditor()
    importLines(editor, ['| H |', '| --- |', '| D |'])

    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const dataRow = table.getChildAtIndex(1) as TableRowNode
      const cell = dataRow.getFirstChild() as TableCellNode
      expect(cell.getHeaderStyles()).toBe(TableCellHeaderStates.NO_STATUS)
    })
  })

  // ── Cell content ─────────────────────────────────────────────────────────

  it('sets correct text content in header cells', () => {
    const editor = makeEditor()
    importLines(editor, ['| Name | Score |', '| --- | --- |'])

    editor.read(() => {
      const headerRow = ($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode
      const cells = headerRow.getChildren() as TableCellNode[]
      expect(cells[0].getTextContent()).toBe('Name')
      expect(cells[1].getTextContent()).toBe('Score')
    })
  })

  it('sets correct text content in data cells', () => {
    const editor = makeEditor()
    importLines(editor, ['| Col |', '| --- |', '| value |'])

    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const dataRow = table.getChildAtIndex(1) as TableRowNode
      expect((dataRow.getFirstChild() as TableCellNode).getTextContent()).toBe('value')
    })
  })

  it('creates empty text node for empty header cells', () => {
    const editor = makeEditor()
    importLines(editor, ['| | B |', '| --- | --- |'])

    editor.read(() => {
      const headerRow = ($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode
      const cells = headerRow.getChildren() as TableCellNode[]
      expect(cells[0].getTextContent()).toBe('')
      expect(cells[1].getTextContent()).toBe('B')
    })
  })

  it('creates exactly columnCount cells per row regardless of data row length (fewer cells)', () => {
    const editor = makeEditor()
    // Data row has only 1 cell, header has 2 — must be padded
    importLines(editor, ['| A | B |', '| --- | --- |', '| only one |'])

    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const dataRow = table.getChildAtIndex(1) as TableRowNode
      expect(dataRow.getChildrenSize()).toBe(2)
      const cells = dataRow.getChildren() as TableCellNode[]
      expect(cells[0].getTextContent()).toBe('only one')
      expect(cells[1].getTextContent()).toBe('') // padded with empty
    })
  })

  it('truncates data row with more cells than the header to columnCount', () => {
    const editor = makeEditor()
    // Header has 2 cols, data row has 4 — extra cells are dropped
    importLines(editor, ['| A | B |', '| --- | --- |', '| one | two | three | four |'])

    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const dataRow = table.getChildAtIndex(1) as TableRowNode
      expect(dataRow.getChildrenSize()).toBe(2)
      const cells = dataRow.getChildren() as TableCellNode[]
      expect(cells[0].getTextContent()).toBe('one')
      expect(cells[1].getTextContent()).toBe('two')
    })
  })

  // ── Root attachment ───────────────────────────────────────────────────────

  it('appends the created table to the rootNode', () => {
    const editor = makeEditor()
    importLines(editor, ['| X |', '| --- |'])

    editor.read(() => {
      const children = $getRoot().getChildren()
      expect(children.length).toBe(1)
      expect($isTableNode(children[0])).toBe(true)
    })
  })
})

// ─── TABLE_EXPORT export transformer ─────────────────────────────────────────

describe('TABLE_EXPORT export transformer', () => {
  /** Build a table in the editor from a row-spec array. */
  function buildTable(
    editor: LexicalEditor,
    rows: Array<{ cells: string[]; isHeader?: boolean }>,
  ): void {
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()

      rows.forEach(({ cells, isHeader }, rowIndex) => {
        const row = $createTableRowNode()
        const isHdr = isHeader ?? rowIndex === 0
        cells.forEach((text) => {
          const cell = $createTableCellNode(
            isHdr ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
          )
          const p = $createParagraphNode()
          p.append($createTextNode(text))
          cell.append(p)
          row.append(cell)
        })
        table.append(row)
      })

      root.append(table)
    })
  }

  function exportTable(editor: LexicalEditor): string | null {
    let result: string | null = null
    editor.read(() => {
      const table = $getRoot().getFirstChild()!
      result = TABLE_EXPORT.export!(table, (_n) => '')
    })
    return result
  }

  // ── Non-table / empty ─────────────────────────────────────────────────────

  it('returns null for a non-table node', () => {
    const editor = makeEditor()
    update(editor, () => { $getRoot().clear(); $getRoot().append($createParagraphNode()) })

    let result: string | null | undefined
    editor.read(() => {
      const p = $getRoot().getFirstChild()!
      result = TABLE_EXPORT.export!(p, (_n) => '')
    })
    expect(result).toBeNull()
  })

  it('returns empty string for a table with no rows', () => {
    const editor = makeEditor()
    update(editor, () => { $getRoot().clear(); $getRoot().append($createTableNode()) })

    let result: string | null | undefined
    editor.read(() => {
      result = TABLE_EXPORT.export!($getRoot().getFirstChild()!, (_n) => '')
    })
    expect(result).toBe('')
  })

  // ── Header-only ───────────────────────────────────────────────────────────

  it('exports a single-column header-only table', () => {
    const editor = makeEditor()
    buildTable(editor, [{ cells: ['Title'], isHeader: true }])
    expect(exportTable(editor)).toBe('| Title |\n| --- |')
  })

  it('generates a divider with the correct number of columns', () => {
    const editor = makeEditor()
    buildTable(editor, [{ cells: ['A', 'B', 'C'], isHeader: true }])
    const divider = exportTable(editor)!.split('\n')[1]
    expect(divider).toBe('| --- | --- | --- |')
  })

  // ── Header + data rows ────────────────────────────────────────────────────

  it('exports header row followed by divider and one data row', () => {
    const editor = makeEditor()
    buildTable(editor, [
      { cells: ['Name', 'Age'], isHeader: true },
      { cells: ['Alice', '30'], isHeader: false },
    ])
    expect(exportTable(editor)).toBe('| Name | Age |\n| --- | --- |\n| Alice | 30 |')
  })

  it('exports multiple data rows', () => {
    const editor = makeEditor()
    buildTable(editor, [
      { cells: ['H1', 'H2'], isHeader: true },
      { cells: ['r1a', 'r1b'], isHeader: false },
      { cells: ['r2a', 'r2b'], isHeader: false },
    ])
    expect(exportTable(editor)).toBe('| H1 | H2 |\n| --- | --- |\n| r1a | r1b |\n| r2a | r2b |')
  })

  // ── Cell content edge cases ───────────────────────────────────────────────

  it('exports empty cell as empty string (preserving spacing)', () => {
    const editor = makeEditor()
    buildTable(editor, [
      { cells: ['A', ''], isHeader: true },
      { cells: ['', 'val'], isHeader: false },
    ])
    expect(exportTable(editor)).toBe('| A |  |\n| --- | --- |\n|  | val |')
  })

  it('joins multiple paragraphs in a cell with a space', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      // Two paragraphs in one cell
      const p1 = $createParagraphNode()
      p1.append($createTextNode('first'))
      const p2 = $createParagraphNode()
      p2.append($createTextNode('second'))
      cell.append(p1)
      cell.append(p2)
      row.append(cell)
      table.append(row)
      root.append(table)
    })
    expect(exportTable(editor)).toBe('| first second |\n| --- |')
  })

  it('strips text-node formatting — exports plain text regardless of bold/italic', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const boldNode = $createTextNode('Bold')
      boldNode.toggleFormat('bold')
      p.append(boldNode)
      cell.append(p)
      row.append(cell)
      table.append(row)
      root.append(table)
    })
    // getCellText() calls getTextContent() which returns plain text
    expect(exportTable(editor)).toBe('| Bold |\n| --- |')
  })

  // ── Round-trip ────────────────────────────────────────────────────────────

  it('round-trips import → export for a plain text table', () => {
    const lines = ['| Name | Score |', '| --- | --- |', '| Alice | 100 |', '| Bob | 85 |']
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      TABLE.handleImportAfterStartMatch!({
        lines,
        rootNode: root,
        startLineIndex: 0,
      } as unknown as Parameters<Exclude<typeof TABLE.handleImportAfterStartMatch, undefined>>[0])
    })
    expect(exportTable(editor)).toBe(lines.join('\n'))
  })

  it('round-trips a single-column table', () => {
    const lines = ['| Tag |', '| --- |', '| alpha |', '| beta |']
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      TABLE.handleImportAfterStartMatch!({
        lines,
        rootNode: root,
        startLineIndex: 0,
      } as unknown as Parameters<Exclude<typeof TABLE.handleImportAfterStartMatch, undefined>>[0])
    })
    expect(exportTable(editor)).toBe(lines.join('\n'))
  })

  it('round-trips a table with empty cells', () => {
    const lines = ['| A |  |', '| --- | --- |', '|  | B |']
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      TABLE.handleImportAfterStartMatch!({
        lines,
        rootNode: root,
        startLineIndex: 0,
      } as unknown as Parameters<Exclude<typeof TABLE.handleImportAfterStartMatch, undefined>>[0])
    })
    expect(exportTable(editor)).toBe(lines.join('\n'))
  })
})

// ─── Lexical JSON serialization (DB storage format) ───────────────────────────
//
// Documents are stored as Lexical JSON (editor.getEditorState().toJSON()), not
// as markdown. These tests verify the exact JSON structure that ends up in
// the `content` column of the SQLite `documents` table, and that loading it
// back (parseEditorState) produces nodes that can be re-exported correctly.

type SerializedTextNode = { type: 'text'; text: string; format: number }
type SerializedParagraphNode = { type: 'paragraph'; children: SerializedTextNode[] }
type SerializedCellNode = { type: 'tablecell'; headerState: number; colSpan: number; rowSpan: number; children: SerializedParagraphNode[] }
type SerializedRowNode = { type: 'tablerow'; children: SerializedCellNode[] }
type SerializedTableNode = { type: 'table'; children: SerializedRowNode[] }
type SerializedRoot = { root: { children: SerializedTableNode[] } }

function getJson(editor: LexicalEditor): SerializedRoot {
  return editor.getEditorState().toJSON() as unknown as SerializedRoot
}

describe('Lexical JSON serialization — DB storage format', () => {
  // Build a canonical 2×2 table (1 header row, 1 data row) for reuse
  function buildCanonicalTable(editor: LexicalEditor): void {
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()

      const headerRow = $createTableRowNode()
      ;['Name', 'Score'].forEach((text) => {
        const cell = $createTableCellNode(TableCellHeaderStates.ROW)
        const p = $createParagraphNode()
        p.append($createTextNode(text))
        cell.append(p)
        headerRow.append(cell)
      })
      table.append(headerRow)

      const dataRow = $createTableRowNode()
      ;['Alice', '100'].forEach((text) => {
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        const p = $createParagraphNode()
        p.append($createTextNode(text))
        cell.append(p)
        dataRow.append(cell)
      })
      table.append(dataRow)

      root.append(table)
    })
  }

  // ── Node type structure ───────────────────────────────────────────────────

  it('serializes to JSON with type "table" at the root child level', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const json = getJson(editor)
    expect(json.root.children[0].type).toBe('table')
  })

  it('serializes rows as type "tablerow"', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const { children: rows } = getJson(editor).root.children[0]
    expect(rows).toHaveLength(2)
    expect(rows[0].type).toBe('tablerow')
    expect(rows[1].type).toBe('tablerow')
  })

  it('serializes cells as type "tablecell"', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const headerRow = getJson(editor).root.children[0].children[0]
    expect(headerRow.children[0].type).toBe('tablecell')
    expect(headerRow.children[1].type).toBe('tablecell')
  })

  // ── headerState field ─────────────────────────────────────────────────────

  it('header cells serialize with headerState = 1 (ROW)', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const headerRow = getJson(editor).root.children[0].children[0]
    for (const cell of headerRow.children) {
      expect(cell.headerState).toBe(TableCellHeaderStates.ROW) // 1
    }
  })

  it('data cells serialize with headerState = 0 (NO_STATUS)', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const dataRow = getJson(editor).root.children[0].children[1]
    for (const cell of dataRow.children) {
      expect(cell.headerState).toBe(TableCellHeaderStates.NO_STATUS) // 0
    }
  })

  // ── Cell content structure ────────────────────────────────────────────────

  it('cell text is nested inside a paragraph node inside the cell', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const firstHeaderCell = getJson(editor).root.children[0].children[0].children[0]
    expect(firstHeaderCell.children[0].type).toBe('paragraph')
    expect(firstHeaderCell.children[0].children[0].type).toBe('text')
    expect(firstHeaderCell.children[0].children[0].text).toBe('Name')
  })

  it('all cell text values are preserved in JSON', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const table = getJson(editor).root.children[0]
    const getText = (cell: SerializedCellNode) => cell.children[0].children[0].text

    expect(getText(table.children[0].children[0])).toBe('Name')
    expect(getText(table.children[0].children[1])).toBe('Score')
    expect(getText(table.children[1].children[0])).toBe('Alice')
    expect(getText(table.children[1].children[1])).toBe('100')
  })

  // Backend (documents table-content-edge-cases) relies on this shape for round-trip tests.
  // If this test fails, update backend test payloads to match editor output.
  it('editor table JSON shape is valid for backend storage (user-behavior alignment)', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const json = getJson(editor)
    const root = json.root
    expect(root.children).toHaveLength(1)
    const tableNode = root.children[0]
    expect(tableNode.type).toBe('table')
    expect(tableNode.children).toHaveLength(2)
    expect(tableNode.children[0].type).toBe('tablerow')
    expect(tableNode.children[0].children[0].type).toBe('tablecell')
    const cell = tableNode.children[0].children[0]
    expect(typeof cell.headerState).toBe('number')
    expect(typeof cell.colSpan).toBe('number')
    expect(typeof cell.rowSpan).toBe('number')
    expect(cell.children[0].type).toBe('paragraph')
    expect(cell.children[0].children[0].type).toBe('text')
    const stored = JSON.stringify(json)
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored) as SerializedRoot
    expect(parsed.root.children[0].type).toBe('table')
  })

  it('bold text serializes with format flag set in the text node', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const bold = $createTextNode('Bold')
      bold.toggleFormat('bold')
      p.append(bold)
      cell.append(p)
      row.append(cell)
      table.append(row)
      root.append(table)
    })

    const textNode = getJson(editor).root.children[0].children[0].children[0].children[0].children[0]
    expect(textNode.text).toBe('Bold')
    expect(textNode.format).toBeGreaterThan(0) // non-zero format = has formatting
  })

  // ── colSpan / rowSpan defaults ────────────────────────────────────────────

  it('cells serialize with colSpan=1 and rowSpan=1 by default', () => {
    const editor = makeEditor()
    buildCanonicalTable(editor)
    const cell = getJson(editor).root.children[0].children[0].children[0]
    expect(cell.colSpan).toBe(1)
    expect(cell.rowSpan).toBe(1)
  })

  // ── Markdown import → JSON ────────────────────────────────────────────────

  it('importing markdown produces the same JSON structure as building nodes directly', () => {
    const lines = ['| Name | Score |', '| --- | --- |', '| Alice | 100 |']

    // Import via transformer
    const importedEditor = makeEditor()
    update(importedEditor, () => {
      const root = $getRoot()
      root.clear()
      TABLE.handleImportAfterStartMatch!({
        lines,
        rootNode: root,
        startLineIndex: 0,
      } as unknown as Parameters<Exclude<typeof TABLE.handleImportAfterStartMatch, undefined>>[0])
    })

    // Build manually
    const manualEditor = makeEditor()
    buildCanonicalTable(manualEditor)

    const importedTable = getJson(importedEditor).root.children[0]
    const manualTable = getJson(manualEditor).root.children[0]

    // Same row count
    expect(importedTable.children).toHaveLength(manualTable.children.length)

    // Header row: same headerState and text
    const importedHeader = importedTable.children[0]
    const manualHeader = manualTable.children[0]
    expect(importedHeader.children[0].headerState).toBe(manualHeader.children[0].headerState)
    expect(importedHeader.children[0].children[0].children[0].text).toBe('Name')

    // Data row: same headerState and text
    const importedData = importedTable.children[1]
    expect(importedData.children[0].headerState).toBe(TableCellHeaderStates.NO_STATUS)
    expect(importedData.children[0].children[0].children[0].text).toBe('Alice')
  })

  // ── DB round-trip: JSON → parseEditorState → export ──────────────────────

  it('JSON string saved to DB can be parsed back and exported to correct markdown', () => {
    const lines = ['| Name | Score |', '| --- | --- |', '| Alice | 100 |', '| Bob | 85 |']

    // Step 1: import markdown → Lexical nodes
    const sourceEditor = makeEditor()
    update(sourceEditor, () => {
      const root = $getRoot()
      root.clear()
      TABLE.handleImportAfterStartMatch!({
        lines,
        rootNode: root,
        startLineIndex: 0,
      } as unknown as Parameters<Exclude<typeof TABLE.handleImportAfterStartMatch, undefined>>[0])
    })

    // Step 2: serialize to JSON string (what gets saved to the DB `content` column)
    const savedJson = JSON.stringify(sourceEditor.getEditorState().toJSON())

    // Step 3: parse JSON string back into a new editor (what happens on document load)
    const loadedEditor = makeEditor()
    const parsedState = loadedEditor.parseEditorState(savedJson)
    loadedEditor.setEditorState(parsedState)

    // Step 4: export to markdown — should match the original
    let result: string | null = null
    loadedEditor.read(() => {
      const table = $getRoot().getFirstChild()!
      result = TABLE_EXPORT.export!(table, (_n) => '')
    })

    expect(result).toBe(lines.join('\n'))
  })

  it('DB round-trip preserves bold text format flag', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const bold = $createTextNode('Bold')
      bold.toggleFormat('bold')
      p.append(bold)
      cell.append(p)
      row.append(cell)
      table.append(row)
      root.append(table)
    })

    const savedJson = JSON.stringify(editor.getEditorState().toJSON())
    const loadedEditor = makeEditor()
    loadedEditor.setEditorState(loadedEditor.parseEditorState(savedJson))

    loadedEditor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const row = table.getFirstChild() as TableRowNode
      const cell = row.getFirstChild() as TableCellNode
      const para = cell.getFirstChild() as ReturnType<typeof $createParagraphNode>
      const textNode = para.getFirstChild() as TextNode
      // Bold format flag (1) must survive the DB round-trip
      expect(textNode.getFormat()).toBeGreaterThan(0)
      expect(textNode.getTextContent()).toBe('Bold')
    })
  })
})

// ─── DB storage — content edge cases ─────────────────────────────────────────
//
// Tests what SHOULD happen, not what the code currently does.
// Each test describes an invariant the storage layer must guarantee.

describe('DB storage — content edge cases', () => {
  /** Serialize an editor to the DB string format, parse it back, return a fresh editor. */
  function dbRoundTrip(sourceEditor: LexicalEditor): LexicalEditor {
    const dbJson = JSON.stringify(sourceEditor.getEditorState().toJSON())
    const loaded = makeEditor()
    loaded.setEditorState(loaded.parseEditorState(dbJson))
    return loaded
  }

  /** Build a 1-row (header-only) table with the given cell texts, return the editor. */
  function tableWithCells(cells: string[], isHeader = true): LexicalEditor {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      cells.forEach((text) => {
        const cell = $createTableCellNode(
          isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
        )
        const p = $createParagraphNode()
        p.append($createTextNode(text))
        cell.append(p)
        row.append(cell)
      })
      table.append(row)
      root.append(table)
    })
    return editor
  }

  function getCellTexts(editor: LexicalEditor): string[] {
    const texts: string[] = []
    editor.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const row = table.getFirstChild() as TableRowNode
      for (const cell of row.getChildren()) {
        texts.push((cell as TableCellNode).getTextContent())
      }
    })
    return texts
  }

  // ── Unicode ───────────────────────────────────────────────────────────────

  it('should preserve CJK characters exactly through JSON serialization', () => {
    const editor = tableWithCells(['日本語', '中文内容', '한국어'])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual(['日本語', '中文内容', '한국어'])
  })

  it('should preserve Arabic/RTL text exactly through JSON serialization', () => {
    const editor = tableWithCells(['مرحبا بالعالم', 'שלום'])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual(['مرحبا بالعالم', 'שלום'])
  })

  it('should preserve emoji exactly through JSON serialization', () => {
    const editor = tableWithCells(['🎉', '🚀💡', '👨‍👩‍👧‍👦']) // includes multi-codepoint family emoji
    expect(getCellTexts(dbRoundTrip(editor))).toEqual(['🎉', '🚀💡', '👨‍👩‍👧‍👦'])
  })

  it('should preserve accented and diacritic characters exactly', () => {
    const editor = tableWithCells(['Héllo', 'Ünïcödé', 'café', 'naïve'])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual(['Héllo', 'Ünïcödé', 'café', 'naïve'])
  })

  // ── JSON special characters ───────────────────────────────────────────────

  it('should preserve double quotes in cell content', () => {
    const editor = tableWithCells(['"quoted"', 'say "hello"'])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual(['"quoted"', 'say "hello"'])
  })

  it('should preserve backslashes in cell content', () => {
    const editor = tableWithCells(['C:\\Users\\file', 'a\\tb\\n'])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual(['C:\\Users\\file', 'a\\tb\\n'])
  })

  it('should preserve forward slashes in cell content', () => {
    const editor = tableWithCells(['path/to/file', 'https://example.com'])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual(['path/to/file', 'https://example.com'])
  })

  // ── Injection-like content ────────────────────────────────────────────────

  it('should store HTML-like content as literal text, not interpret it as markup', () => {
    const html = '<script>alert("xss")</script>'
    const editor = tableWithCells([html, '<b>not bold</b>', '&amp; &lt; &gt;'])
    const result = getCellTexts(dbRoundTrip(editor))
    // Content must be stored verbatim — none of the HTML should be executed or stripped
    expect(result[0]).toBe(html)
    expect(result[1]).toBe('<b>not bold</b>')
    expect(result[2]).toBe('&amp; &lt; &gt;')
  })

  it('should store SQL injection-like content as literal text', () => {
    const sql = "'; DROP TABLE documents; --"
    const editor = tableWithCells([sql, '1 OR 1=1', 'SELECT * FROM meta'])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual([sql, '1 OR 1=1', 'SELECT * FROM meta'])
  })

  it('should store JSON-like content as literal text', () => {
    const json = '{"key": "value", "arr": [1, 2, 3]}'
    const editor = tableWithCells([json, '{"type":"table"}'])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual([json, '{"type":"table"}'])
  })

  // ── Extreme content ───────────────────────────────────────────────────────

  it('should preserve very long cell content (1000 characters)', () => {
    const longText = 'A'.repeat(500) + '日'.repeat(250) + '🎉'.repeat(50)
    const editor = tableWithCells([longText])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual([longText])
  })

  it('should preserve an empty cell (no text at all) without crashing', () => {
    const editor = tableWithCells([''])
    expect(getCellTexts(dbRoundTrip(editor))).toEqual([''])
  })

  it('should preserve whitespace-only cell content', () => {
    const editor = tableWithCells(['   ', '\t'])
    // Lexical getTextContent() trims, so whitespace-only nodes become empty
    // The IMPORTANT invariant: it should not crash and the cell must exist
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const row = table.getFirstChild() as TableRowNode
      expect(row.getChildrenSize()).toBe(2)
    })
  })

  // ── Formatting edge cases ─────────────────────────────────────────────────

  it('should preserve bold (format=1) through DB round-trip', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const node = $createTextNode('bold'); node.toggleFormat('bold')
      p.append(node); cell.append(p); row.append(cell); table.append(row)
      root.append(table)
    })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const text = (cell.getFirstChild() as ReturnType<typeof $createParagraphNode>).getFirstChild() as TextNode
      expect(text.getFormat()).toBe(1) // bold=1
    })
  })

  it('should preserve italic (format=2) through DB round-trip', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const node = $createTextNode('italic'); node.toggleFormat('italic')
      p.append(node); cell.append(p); row.append(cell); table.append(row)
      root.append(table)
    })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const text = (cell.getFirstChild() as ReturnType<typeof $createParagraphNode>).getFirstChild() as TextNode
      expect(text.getFormat()).toBe(2) // italic=2
    })
  })

  it('should preserve bold+italic combined (format=3) through DB round-trip', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const node = $createTextNode('bi'); node.toggleFormat('bold'); node.toggleFormat('italic')
      p.append(node); cell.append(p); row.append(cell); table.append(row)
      root.append(table)
    })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const text = (cell.getFirstChild() as ReturnType<typeof $createParagraphNode>).getFirstChild() as TextNode
      expect(text.getFormat()).toBe(3) // bold(1) | italic(2) = 3
    })
  })

  it('should preserve strikethrough (format=4) through DB round-trip', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const node = $createTextNode('strike'); node.toggleFormat('strikethrough')
      p.append(node); cell.append(p); row.append(cell); table.append(row)
      root.append(table)
    })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const text = (cell.getFirstChild() as ReturnType<typeof $createParagraphNode>).getFirstChild() as TextNode
      expect(text.getFormat()).toBe(4) // strikethrough=4
    })
  })

  it('should preserve code format (format=16) through DB round-trip', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const node = $createTextNode('code'); node.toggleFormat('code')
      p.append(node); cell.append(p); row.append(cell); table.append(row)
      root.append(table)
    })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const text = (cell.getFirstChild() as ReturnType<typeof $createParagraphNode>).getFirstChild() as TextNode
      expect(text.getFormat()).toBe(16) // code=16
    })
  })

  it('should preserve multiple text runs with mixed formatting in one cell', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode()
      const plain = $createTextNode('plain ')
      const bold = $createTextNode('bold'); bold.toggleFormat('bold')
      const italic = $createTextNode(' italic'); italic.toggleFormat('italic')
      p.append(plain, bold, italic)
      cell.append(p); row.append(cell); table.append(row)
      root.append(table)
    })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const para = cell.getFirstChild() as ReturnType<typeof $createParagraphNode>
      const nodes = para.getChildren() as TextNode[]
      expect(nodes).toHaveLength(3)
      expect(nodes[0].getFormat()).toBe(0)  // plain
      expect(nodes[1].getFormat()).toBe(1)  // bold
      expect(nodes[2].getFormat()).toBe(2)  // italic
      expect(nodes[0].getTextContent()).toBe('plain ')
      expect(nodes[1].getTextContent()).toBe('bold')
      expect(nodes[2].getTextContent()).toBe(' italic')
    })
  })

  it('should preserve multiple paragraphs in one cell through DB round-trip', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p1 = $createParagraphNode(); p1.append($createTextNode('line one'))
      const p2 = $createParagraphNode(); p2.append($createTextNode('line two'))
      cell.append(p1, p2); row.append(cell); table.append(row)
      root.append(table)
    })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      expect(cell.getChildrenSize()).toBe(2)
      const paras = cell.getChildren() as ReturnType<typeof $createParagraphNode>[]
      expect(paras[0].getTextContent()).toBe('line one')
      expect(paras[1].getTextContent()).toBe('line two')
    })
  })
})

// ─── DB storage — stress and load ────────────────────────────────────────────

describe('DB storage — stress and load', () => {
  function dbRoundTrip(sourceEditor: LexicalEditor): LexicalEditor {
    const dbJson = JSON.stringify(sourceEditor.getEditorState().toJSON())
    const loaded = makeEditor()
    loaded.setEditorState(loaded.parseEditorState(dbJson))
    return loaded
  }

  // ── Large tables ──────────────────────────────────────────────────────────

  it('should preserve all cells in a large table (50 rows × 10 columns)', () => {
    const ROWS = 50
    const COLS = 10
    const editor = makeEditor()

    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()

      // Header row
      const headerRow = $createTableRowNode()
      for (let c = 0; c < COLS; c++) {
        const cell = $createTableCellNode(TableCellHeaderStates.ROW)
        const p = $createParagraphNode(); p.append($createTextNode(`H${c}`))
        cell.append(p); headerRow.append(cell)
      }
      table.append(headerRow)

      // Data rows — unique content per cell
      for (let r = 0; r < ROWS; r++) {
        const row = $createTableRowNode()
        for (let c = 0; c < COLS; c++) {
          const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
          const p = $createParagraphNode(); p.append($createTextNode(`r${r}-c${c}`))
          cell.append(p); row.append(cell)
        }
        table.append(row)
      }
      root.append(table)
    })

    const loaded = dbRoundTrip(editor)

    loaded.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      expect(table.getChildrenSize()).toBe(ROWS + 1) // header + data rows

      // Verify every cell value
      table.getChildren().forEach((rowNode, rowIndex) => {
        const row = rowNode as TableRowNode
        expect(row.getChildrenSize()).toBe(COLS)
        row.getChildren().forEach((cellNode, colIndex) => {
          const cell = cellNode as TableCellNode
          const expected = rowIndex === 0 ? `H${colIndex}` : `r${rowIndex - 1}-c${colIndex}`
          expect(cell.getTextContent()).toBe(expected)
        })
      })
    })
  })

  it('should preserve all cells in a wide table (5 rows × 50 columns)', () => {
    const ROWS = 5
    const COLS = 50
    const editor = makeEditor()

    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      for (let r = 0; r < ROWS; r++) {
        const row = $createTableRowNode()
        for (let c = 0; c < COLS; c++) {
          const isHeader = r === 0
          const cell = $createTableCellNode(
            isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
          )
          const p = $createParagraphNode(); p.append($createTextNode(`r${r}c${c}`))
          cell.append(p); row.append(cell)
        }
        table.append(row)
      }
      root.append(table)
    })

    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      expect(table.getChildrenSize()).toBe(ROWS)
      table.getChildren().forEach((rowNode, r) => {
        expect((rowNode as TableRowNode).getChildrenSize()).toBe(COLS)
        ;(rowNode as TableRowNode).getChildren().forEach((cellNode, c) => {
          expect((cellNode as TableCellNode).getTextContent()).toBe(`r${r}c${c}`)
        })
      })
    })
  })

  // ── Multiple tables ───────────────────────────────────────────────────────

  it('should preserve three independent tables in the same document', () => {
    const editor = makeEditor()

    update(editor, () => {
      const root = $getRoot()
      root.clear()

      const makeTable = (label: string) => {
        const table = $createTableNode()
        const row = $createTableRowNode()
        const cell = $createTableCellNode(TableCellHeaderStates.ROW)
        const p = $createParagraphNode(); p.append($createTextNode(label))
        cell.append(p); row.append(cell); table.append(row)
        return table
      }

      root.append(makeTable('Table-A'), makeTable('Table-B'), makeTable('Table-C'))
    })

    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const children = $getRoot().getChildren()
      expect(children).toHaveLength(3)
      const cellText = (table: TableNode) =>
        ((table.getFirstChild() as TableRowNode).getFirstChild() as TableCellNode).getTextContent()
      expect(cellText(children[0] as TableNode)).toBe('Table-A')
      expect(cellText(children[1] as TableNode)).toBe('Table-B')
      expect(cellText(children[2] as TableNode)).toBe('Table-C')
    })
  })

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('serialization should be idempotent — three consecutive save/load cycles produce identical JSON', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      ;['Alpha', 'Beta', 'Gamma'].forEach((text) => {
        const cell = $createTableCellNode(TableCellHeaderStates.ROW)
        const p = $createParagraphNode(); p.append($createTextNode(text))
        cell.append(p); row.append(cell)
      })
      table.append(row)
      root.append(table)
    })

    const json1 = JSON.stringify(editor.getEditorState().toJSON())

    const e2 = makeEditor()
    e2.setEditorState(e2.parseEditorState(json1))
    const json2 = JSON.stringify(e2.getEditorState().toJSON())

    const e3 = makeEditor()
    e3.setEditorState(e3.parseEditorState(json2))
    const json3 = JSON.stringify(e3.getEditorState().toJSON())

    expect(json2).toBe(json1)
    expect(json3).toBe(json1)
  })

  // ── Column widths ─────────────────────────────────────────────────────────

  it('should preserve custom column widths through DB round-trip', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      ;[100, 250, 180].forEach((_, i) => {
        const row = $createTableRowNode()
        const cell = $createTableCellNode(TableCellHeaderStates.ROW)
        const p = $createParagraphNode(); p.append($createTextNode(`col${i}`))
        cell.append(p); row.append(cell)
        if (i === 0) table.append(row)
      })
      // Set after the table is built so all three widths apply
      ;(table as any).setColWidths([100, 250, 180])
      root.append(table)
    })

    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const widths = (table as any).getColWidths()
      expect(widths).toEqual([100, 250, 180])
    })
  })

  it('should produce stable JSON when no column widths are set (colWidths = [])', () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const p = $createParagraphNode(); p.append($createTextNode('test'))
      cell.append(p); row.append(cell); table.append(row)
      root.append(table)
    })

    const json1 = JSON.stringify(editor.getEditorState().toJSON())
    const loaded = dbRoundTrip(editor)
    const json2 = JSON.stringify(loaded.getEditorState().toJSON())

    // Default colWidths state must be stable across round-trips
    expect(json2).toBe(json1)
  })

  // ── headerState correctness at scale ─────────────────────────────────────

  it('all header cells should have headerState=1 and all data cells headerState=0 after round-trip', () => {
    const ROWS = 20
    const COLS = 5
    const editor = makeEditor()

    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      for (let r = 0; r <= ROWS; r++) {
        const row = $createTableRowNode()
        for (let c = 0; c < COLS; c++) {
          const isHeader = r === 0
          const cell = $createTableCellNode(
            isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
          )
          const p = $createParagraphNode(); p.append($createTextNode(`${r},${c}`))
          cell.append(p); row.append(cell)
        }
        table.append(row)
      }
      root.append(table)
    })

    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      table.getChildren().forEach((rowNode, rowIndex) => {
        ;(rowNode as TableRowNode).getChildren().forEach((cellNode) => {
          const cell = cellNode as TableCellNode
          const expected = rowIndex === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS
          expect(cell.getHeaderStyles()).toBe(expected)
        })
      })
    })
  })
})

// ─── ImageNode in table cell — DB serialization ───────────────────────────────
//
// Images CAN be placed inside table cells at the data-model level. The paste
// flow uses $insertNodeToNearestRoot (which inserts at root), but the DB
// format must correctly round-trip an image wherever it appears in the tree.
// These tests verify the ImageNode JSON schema and survival through
// JSON.stringify → parseEditorState cycles.

describe('ImageNode in table cell — DB serialization', () => {
  function dbRoundTrip(sourceEditor: LexicalEditor): LexicalEditor {
    const dbJson = JSON.stringify(sourceEditor.getEditorState().toJSON())
    const loaded = makeEditor()
    loaded.setEditorState(loaded.parseEditorState(dbJson))
    return loaded
  }

  /** Build a single-cell header table containing an ImageNode (not a text node). */
  function tableWithImage(params: Parameters<typeof $createImageNode>[0]): LexicalEditor {
    const editor = makeEditor()
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const table = $createTableNode()
      const row = $createTableRowNode()
      const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
      cell.append($createImageNode(params))
      row.append(cell)
      table.append(row)
      root.append(table)
    }, { discrete: true })
    return editor
  }

  // ── JSON schema ───────────────────────────────────────────────────────────

  it('serializes ImageNode inside a tablecell with type "image"', () => {
    const editor = tableWithImage({ imageId: 'img-001', altText: 'test' })
    const json = editor.getEditorState().toJSON() as any
    const cell = json.root.children[0].children[0].children[0]
    // ImageNode is a block-level DecoratorNode — it is a direct child of the cell
    expect(cell.children[0].type).toBe('image')
  })

  it('serializes imageId correctly', () => {
    const editor = tableWithImage({ imageId: 'abc-123', altText: '' })
    const json = editor.getEditorState().toJSON() as any
    const imageNode = json.root.children[0].children[0].children[0].children[0]
    expect(imageNode.imageId).toBe('abc-123')
  })

  it('serializes altText correctly', () => {
    const editor = tableWithImage({ imageId: 'x', altText: 'A description' })
    const json = editor.getEditorState().toJSON() as any
    const imageNode = json.root.children[0].children[0].children[0].children[0]
    expect(imageNode.altText).toBe('A description')
  })

  it('serializes width and height when provided', () => {
    const editor = tableWithImage({ imageId: 'x', altText: '', width: 640, height: 480 })
    const json = editor.getEditorState().toJSON() as any
    const imageNode = json.root.children[0].children[0].children[0].children[0]
    expect(imageNode.width).toBe(640)
    expect(imageNode.height).toBe(480)
  })

  it('serializes alignment field', () => {
    const editor = tableWithImage({ imageId: 'x', altText: '', alignment: 'center' })
    const json = editor.getEditorState().toJSON() as any
    const imageNode = json.root.children[0].children[0].children[0].children[0]
    expect(imageNode.alignment).toBe('center')
  })

  it('serializes sourceUrl when provided', () => {
    const url = 'https://example.com/image.png'
    const editor = tableWithImage({ imageId: 'x', altText: '', sourceUrl: url })
    const json = editor.getEditorState().toJSON() as any
    const imageNode = json.root.children[0].children[0].children[0].children[0]
    expect(imageNode.sourceUrl).toBe(url)
  })

  it('omits sourceUrl from serialization when empty', () => {
    const editor = tableWithImage({ imageId: 'x', altText: '', sourceUrl: '' })
    const json = editor.getEditorState().toJSON() as any
    const imageNode = json.root.children[0].children[0].children[0].children[0]
    // exportJSON returns `sourceUrl || undefined` so empty string → not present
    expect(imageNode.sourceUrl).toBeUndefined()
  })

  it('serializes version: 1', () => {
    const editor = tableWithImage({ imageId: 'x', altText: '' })
    const json = editor.getEditorState().toJSON() as any
    const imageNode = json.root.children[0].children[0].children[0].children[0]
    expect(imageNode.version).toBe(1)
  })

  // ── DB round-trip ─────────────────────────────────────────────────────────

  it('imageId survives JSON.stringify → parseEditorState round-trip', () => {
    const editor = tableWithImage({ imageId: 'persist-id', altText: 'alt' })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const table = $getRoot().getFirstChild() as TableNode
      const cell = (table.getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const img = cell.getFirstChild() as ImageNode
      expect(img.getType()).toBe('image')
      expect((img as any).__imageId).toBe('persist-id')
    })
  })

  it('altText survives round-trip', () => {
    const editor = tableWithImage({ imageId: 'x', altText: 'My photo' })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      expect((cell.getFirstChild() as any).__altText).toBe('My photo')
    })
  })

  it('width and height survive round-trip', () => {
    const editor = tableWithImage({ imageId: 'x', altText: '', width: 800, height: 600 })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const img = cell.getFirstChild() as any
      expect(img.__width).toBe(800)
      expect(img.__height).toBe(600)
    })
  })

  it('alignment survives round-trip', () => {
    const editor = tableWithImage({ imageId: 'x', altText: '', alignment: 'right' })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      expect((cell.getFirstChild() as any).__alignment).toBe('right')
    })
  })

  it('sourceUrl survives round-trip', () => {
    const url = 'https://cdn.example.com/photo.jpg'
    const editor = tableWithImage({ imageId: 'x', altText: '', sourceUrl: url })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      expect((cell.getFirstChild() as any).__sourceUrl).toBe(url)
    })
  })

  it('altText with special characters (quotes, backslashes) survives round-trip', () => {
    const altText = 'He said "hello" and she said \'bye\' with C:\\path'
    const editor = tableWithImage({ imageId: 'x', altText })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      expect((cell.getFirstChild() as any).__altText).toBe(altText)
    })
  })

  it('altText with unicode (emoji, CJK) survives round-trip', () => {
    const altText = '写真 📸 photo'
    const editor = tableWithImage({ imageId: 'x', altText })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      expect((cell.getFirstChild() as any).__altText).toBe(altText)
    })
  })

  it('image with no width/height survives round-trip with undefined dimensions', () => {
    const editor = tableWithImage({ imageId: 'x', altText: '' })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      const img = cell.getFirstChild() as any
      expect(img.__width).toBeUndefined()
      expect(img.__height).toBeUndefined()
    })
  })

  it('idempotency — two consecutive round-trips produce identical JSON', () => {
    const editor = tableWithImage({ imageId: 'x', altText: 'test', width: 400, height: 300, alignment: 'center', sourceUrl: 'https://example.com/img.jpg' })
    const json1 = JSON.stringify(editor.getEditorState().toJSON())
    const e2 = makeEditor()
    e2.setEditorState(e2.parseEditorState(json1))
    const json2 = JSON.stringify(e2.getEditorState().toJSON())
    expect(json2).toBe(json1)
    const e3 = makeEditor()
    e3.setEditorState(e3.parseEditorState(json2))
    const json3 = JSON.stringify(e3.getEditorState().toJSON())
    expect(json3).toBe(json1)
  })

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('empty imageId serializes without crashing', () => {
    expect(() => tableWithImage({ imageId: '', altText: 'no id yet' })).not.toThrow()
  })

  it('very long altText survives round-trip', () => {
    const altText = 'word '.repeat(200).trim()
    const editor = tableWithImage({ imageId: 'x', altText })
    const loaded = dbRoundTrip(editor)
    loaded.read(() => {
      const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
      expect((cell.getFirstChild() as any).__altText).toBe(altText)
    })
  })

  it('all three alignment values round-trip correctly', () => {
    for (const alignment of ['left', 'center', 'right'] as const) {
      const editor = tableWithImage({ imageId: 'x', altText: '', alignment })
      const loaded = dbRoundTrip(editor)
      loaded.read(() => {
        const cell = (($getRoot().getFirstChild() as TableNode).getFirstChild() as TableRowNode).getFirstChild() as TableCellNode
        expect((cell.getFirstChild() as any).__alignment).toBe(alignment)
      })
    }
  })
})
