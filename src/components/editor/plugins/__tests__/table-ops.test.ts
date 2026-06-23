// @vitest-environment happy-dom
/**
 * Unit tests for the table control operations + geometry math
 * (src/components/editor/plugins/table-ops.ts). These cover the behaviours that
 * regressed during development: drop-slot math with a pinned header, hover
 * scoping into the grip gutters, and the column-width handling on add/move that
 * caused cursor loss / table shrink.
 */
import { describe, it, expect } from "vitest"
import { createHeadlessEditor } from "@lexical/headless"
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  ParagraphNode,
  TextNode,
} from "lexical"
import type { LexicalEditor } from "lexical"
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
  TableCellHeaderStates,
} from "@lexical/table"
import {
  $appendColumn,
  $appendRow,
  $deleteColumnAt,
  $deleteRowAt,
  $moveRow,
  $tableRows,
  cellIndices,
  computeSlot,
  pointerScope,
  type Geom,
} from "../table-ops"

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "table-ops-test",
    nodes: [ParagraphNode, TextNode, TableNode, TableRowNode, TableCellNode],
    onError: (e) => {
      throw e
    },
  })
}

const run = (editor: LexicalEditor, fn: () => void) =>
  editor.update(fn, { discrete: true })

/** Build a `rows`×`cols` table with cell text `"<r><c>"` and append it to root. */
function $buildTable(
  rows: number,
  cols: number,
  opts?: { header?: boolean; colWidths?: number[] },
): TableNode {
  const root = $getRoot()
  root.clear()
  const table = $createTableNode()
  for (let r = 0; r < rows; r++) {
    const row = $createTableRowNode()
    for (let c = 0; c < cols; c++) {
      const header = opts?.header && r === 0
      const cell = $createTableCellNode(
        header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
      )
      const p = $createParagraphNode()
      p.append($createTextNode(`${r}${c}`))
      cell.append(p)
      row.append(cell)
    }
    table.append(row)
  }
  if (opts?.colWidths) table.setColWidths(opts.colWidths)
  root.append(table)
  return table
}

/** A grid of cell text, e.g. `[["00","01"],["10","11"]]`. */
function $grid(table: TableNode): string[][] {
  return $tableRows(table).map((row) =>
    row.getChildren().map((c) => c.getTextContent()),
  )
}

// ─── $appendColumn ───────────────────────────────────────────────────────────

describe("$appendColumn", () => {
  it("adds a column on the right, preserving existing cells", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(2, 2)
      $appendColumn(t)
      grid = $grid(t)
    })
    expect(grid.length).toBe(2)
    expect(grid.every((row) => row.length === 3)).toBe(true)
    expect(grid.map((row) => row.slice(0, 2))).toEqual([
      ["00", "01"],
      ["10", "11"],
    ])
  })

  it("seeds column widths when the table has none so it can grow/scroll", () => {
    const editor = makeEditor()
    let widths: readonly number[] | undefined
    run(editor, () => {
      const t = $buildTable(2, 2)
      $appendColumn(t, [120, 240])
      widths = t.getColWidths()
    })
    expect(widths).toHaveLength(3)
    expect(widths?.slice(0, 2)).toEqual([120, 240])
  })

  it("leaves widths unset when none exist and no seed is given", () => {
    const editor = makeEditor()
    let widths: readonly number[] | undefined
    run(editor, () => {
      const t = $buildTable(2, 2)
      $appendColumn(t)
      widths = t.getColWidths()
    })
    expect(widths === undefined || widths.length === 0).toBe(true)
  })
})

// ─── $appendRow ──────────────────────────────────────────────────────────────

describe("$appendRow", () => {
  it("adds a blank row at the bottom", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(2, 2)
      $appendRow(t)
      grid = $grid(t)
    })
    expect(grid.length).toBe(3)
    expect(grid.slice(0, 2)).toEqual([
      ["00", "01"],
      ["10", "11"],
    ])
    expect(grid[2]).toEqual(["", ""])
  })
})

// ─── $moveRow ────────────────────────────────────────────────────────────────

describe("$moveRow", () => {
  it("moves a row down to a later index", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(3, 2)
      $moveRow(t, 0, 2)
      grid = $grid(t)
    })
    expect(grid).toEqual([
      ["10", "11"],
      ["20", "21"],
      ["00", "01"],
    ])
  })

  it("moves a row up to an earlier index", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(3, 2)
      $moveRow(t, 2, 0)
      grid = $grid(t)
    })
    expect(grid).toEqual([
      ["20", "21"],
      ["00", "01"],
      ["10", "11"],
    ])
  })

  it("preserves column widths (so the table doesn't shrink)", () => {
    const editor = makeEditor()
    let widths: readonly number[] | undefined
    run(editor, () => {
      const t = $buildTable(3, 2, { colWidths: [100, 200] })
      $moveRow(t, 0, 2)
      widths = t.getColWidths()
    })
    expect(widths).toEqual([100, 200])
  })

  it("is a no-op for out-of-range indices", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(2, 2)
      $moveRow(t, 5, 0)
      grid = $grid(t)
    })
    expect(grid).toEqual([
      ["00", "01"],
      ["10", "11"],
    ])
  })
})

// ─── $deleteColumnAt / $deleteRowAt ──────────────────────────────────────────

describe("$deleteColumnAt", () => {
  it("removes the column at the given index", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(2, 3)
      $deleteColumnAt(t, 1)
      grid = $grid(t)
    })
    expect(grid).toEqual([
      ["00", "02"],
      ["10", "12"],
    ])
  })

  it("keeps at least one column", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(2, 1)
      $deleteColumnAt(t, 0)
      grid = $grid(t)
    })
    expect(grid).toEqual([["00"], ["10"]])
  })
})

describe("$deleteRowAt", () => {
  it("removes the row at the given index", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(3, 2)
      $deleteRowAt(t, 1)
      grid = $grid(t)
    })
    expect(grid).toEqual([
      ["00", "01"],
      ["20", "21"],
    ])
  })

  it("keeps at least one row", () => {
    const editor = makeEditor()
    let grid: string[][] = []
    run(editor, () => {
      const t = $buildTable(1, 2)
      $deleteRowAt(t, 0)
      grid = $grid(t)
    })
    expect(grid).toEqual([["00", "01"]])
  })
})

// ─── computeSlot (drop-target math) ──────────────────────────────────────────

const GEOM: Geom = {
  left: 100,
  top: 50,
  width: 300,
  height: 90,
  cols: [
    { left: 100, width: 100 },
    { left: 200, width: 100 },
    { left: 300, width: 100 },
  ],
  rows: [
    { top: 50, height: 30, isHeader: true },
    { top: 80, height: 30, isHeader: false },
    { top: 110, height: 30, isHeader: false },
  ],
  headerRows: 1,
  clipLeft: 100,
  clipRight: 400,
}

describe("computeSlot", () => {
  it("returns the column slot before the pointer", () => {
    expect(computeSlot("col", 120, 0, GEOM)).toBe(0) // before col0 midpoint (150)
    expect(computeSlot("col", 220, 0, GEOM)).toBe(1) // before col1 midpoint (250)
    expect(computeSlot("col", 999, 0, GEOM)).toBe(3) // past the last column
  })

  it("never returns a row slot above the pinned header", () => {
    expect(computeSlot("row", 0, 55, GEOM)).toBe(1) // pointer over header → clamped
    expect(computeSlot("row", 0, 100, GEOM)).toBe(2)
    expect(computeSlot("row", 0, 999, GEOM)).toBe(3) // past the last row
  })
})

// ─── pointerScope (hover scoping) ────────────────────────────────────────────

describe("pointerScope", () => {
  it("resolves both row and column when over a cell", () => {
    expect(pointerScope({ x: 250, y: 95 }, GEOM)).toEqual({ row: 1, col: 1 })
  })

  it("resolves only the column when in the top gutter", () => {
    expect(pointerScope({ x: 250, y: 40 }, GEOM)).toEqual({ row: null, col: 1 })
  })

  it("resolves only the row when in the left gutter", () => {
    expect(pointerScope({ x: 85, y: 95 }, GEOM)).toEqual({ row: 1, col: null })
  })

  it("resolves nothing when far outside the table", () => {
    expect(pointerScope({ x: 10, y: 10 }, GEOM)).toEqual({ row: null, col: null })
  })
})

// ─── cellIndices (DOM → indices) ─────────────────────────────────────────────

describe("cellIndices", () => {
  it("returns the row/column index of a DOM cell", () => {
    const table = document.createElement("table")
    for (let r = 0; r < 2; r++) {
      const tr = document.createElement("tr")
      for (let c = 0; c < 3; c++) tr.appendChild(document.createElement("td"))
      table.appendChild(tr)
    }
    expect(cellIndices(table, table.rows[1].cells[2])).toEqual({ row: 1, col: 2 })
    expect(cellIndices(table, table.rows[0].cells[0])).toEqual({ row: 0, col: 0 })
  })

  it("returns null for a detached cell", () => {
    const table = document.createElement("table")
    table.appendChild(document.createElement("tr"))
    expect(cellIndices(table, document.createElement("td"))).toBeNull()
  })
})
