/**
 * Pure table geometry + node-mutation helpers used by the table controls.
 *
 * Split out from the React plugin so the tricky bits — drop-slot math, hover
 * scoping, header pinning, and the column-width handling that kept biting us
 * (cursor loss / width shrink on row move, scroll-on-add) — can be unit tested
 * with a headless editor instead of a live DOM.
 */
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableRowNode,
  TableNode,
  TableRowNode,
} from "@lexical/table"

export type Axis = "col" | "row"
/** A cell's position within its table. */
export type Cell = { row: number; col: number }
/** Which row/column the pointer is over — either may be null (e.g. in a gutter). */
export type HoverScope = { row: number | null; col: number | null }

export interface ColGeom {
  left: number
  width: number
}
export interface RowGeom {
  top: number
  height: number
  isHeader: boolean
}
export interface Geom {
  left: number
  top: number
  width: number
  height: number
  cols: ColGeom[]
  rows: RowGeom[]
  /** Count of leading header rows that stay pinned to the top (not reorderable). */
  headerRows: number
  /** Horizontal viewport of the table's scroll wrapper — wide tables scroll
   *  inside this, so controls clip/pin to it rather than the full table box. */
  clipLeft: number
  clipRight: number
}

const WRAPPER_SELECTOR = ".EditorTheme__tableScrollableWrapper"
// Slack added around a cell's edges so a pointer in the grip gutter (just
// outside the table) still resolves to that row/column. Tracks the grip size.
const GRIP_PAD = 21

// ── Geometry (pure) ─────────────────────────────────────────────────────────

/** Row/column index of a DOM cell within its table, or null if not resolvable. */
export function cellIndices(
  table: HTMLTableElement,
  cell: HTMLTableCellElement,
): Cell | null {
  const tr = cell.parentElement as HTMLTableRowElement | null
  if (!tr) return null
  const row = Array.from(table.rows).indexOf(tr)
  const col = Array.from(tr.cells).indexOf(cell)
  return row >= 0 && col >= 0 ? { row, col } : null
}

/**
 * Which row/column a viewport point falls over, derived purely from geometry so
 * it stays correct after rows/columns shift. The hit zone extends by the grip
 * gutter: a point in the top gutter still resolves its column, the left gutter
 * its row.
 */
export function pointerScope(p: { x: number; y: number }, g: Geom): HoverScope {
  let row: number | null = null
  if (p.x >= g.left - GRIP_PAD && p.x <= g.left + g.width) {
    for (let i = 0; i < g.rows.length; i++) {
      if (p.y >= g.rows[i].top && p.y <= g.rows[i].top + g.rows[i].height) {
        row = i
        break
      }
    }
  }
  let col: number | null = null
  if (p.y >= g.top - GRIP_PAD && p.y <= g.top + g.height) {
    for (let i = 0; i < g.cols.length; i++) {
      if (p.x >= g.cols[i].left && p.x <= g.cols[i].left + g.cols[i].width) {
        col = i
        break
      }
    }
  }
  return { row, col }
}

/**
 * Which insertion slot (0..n) the pointer is over while dragging. For rows the
 * slot is clamped below any pinned header rows so a row can never be dropped
 * above the header.
 */
export function computeSlot(
  axis: Axis,
  clientX: number,
  clientY: number,
  g: Geom,
): number {
  if (axis === "col") {
    for (let i = 0; i < g.cols.length; i++) {
      if (clientX < g.cols[i].left + g.cols[i].width / 2) return i
    }
    return g.cols.length
  }
  for (let i = g.headerRows; i < g.rows.length; i++) {
    if (clientY < g.rows[i].top + g.rows[i].height / 2) return i
  }
  return Math.max(g.rows.length, g.headerRows)
}

/** Read the live geometry of a rendered table straight from the DOM. */
export function measure(table: HTMLTableElement): Geom | null {
  const rowEls = Array.from(table.rows)
  if (rowEls.length === 0) return null
  const tableRect = table.getBoundingClientRect()
  // The scroll wrapper clips the table horizontally when it's wider than the
  // content column; fall back to the table itself if there's no wrapper.
  const clip = (table.closest(WRAPPER_SELECTOR) ?? table).getBoundingClientRect()

  const rows: RowGeom[] = rowEls.map((row) => {
    const r = row.getBoundingClientRect()
    const cells = Array.from(row.cells)
    const isHeader = cells.length > 0 && cells.every((c) => c.tagName === "TH")
    return { top: r.top, height: r.height, isHeader }
  })
  let headerRows = 0
  while (headerRows < rows.length && rows[headerRows].isHeader) headerRows++

  const cols: ColGeom[] = Array.from(rowEls[0].cells).map((c) => {
    const r = c.getBoundingClientRect()
    return { left: r.left, width: r.width }
  })

  return {
    left: tableRect.left,
    top: tableRect.top,
    width: tableRect.width,
    height: tableRect.height,
    cols,
    rows,
    headerRows,
    clipLeft: clip.left,
    clipRight: clip.right,
  }
}

// ── Node mutations (need an active Lexical read/update context) ──────────────

/** The row nodes of a table. */
export function $tableRows(table: TableNode): TableRowNode[] {
  return table.getChildren().filter($isTableRowNode)
}

/**
 * Append a column at the right. `seedWidths` (the current per-column pixel
 * widths) are applied first when the table has none, so the inserted column
 * *adds* width and the table can scroll rather than squeezing every column.
 */
export function $appendColumn(table: TableNode, seedWidths?: number[]): void {
  const widths = table.getColWidths()
  if ((!widths || widths.length === 0) && seedWidths && seedWidths.length > 0) {
    table.setColWidths(seedWidths)
  }
  const cells = $tableRows(table)[0]?.getChildren() ?? []
  const last = cells[cells.length - 1]
  if (!$isTableCellNode(last)) return
  last.selectStart() // anchor the insert to the last column
  $insertTableColumnAtSelection(true)
}

/** Append a row at the bottom. */
export function $appendRow(table: TableNode): void {
  const rows = $tableRows(table)
  const firstCell = rows[rows.length - 1]?.getChildren()[0]
  if (!$isTableCellNode(firstCell)) return
  firstCell.selectStart() // anchor the insert to the last row
  $insertTableRowAtSelection(true)
}

/**
 * Move a row from `from` to `to`. Column widths are captured and restored
 * because removing a row makes Lexical's table transform renormalise them,
 * which would otherwise shrink the table.
 */
export function $moveRow(table: TableNode, from: number, to: number): void {
  const widths = table.getColWidths()
  const rows = $tableRows(table)
  if (from < 0 || from >= rows.length || to < 0) return
  const moving = rows[from]
  moving.remove()
  const rest = $tableRows(table)
  if (to >= rest.length) rest[rest.length - 1]?.insertAfter(moving)
  else rest[to]?.insertBefore(moving)
  if (widths) table.setColWidths([...widths])
}

/** Delete the column at `index`, keeping at least one column. */
export function $deleteColumnAt(table: TableNode, index: number): void {
  const row0 = $tableRows(table)[0]
  if (!row0 || row0.getChildren().length <= 1) return
  const cell = row0.getChildren()[index]
  if ($isTableCellNode(cell)) {
    cell.selectStart()
    $deleteTableColumnAtSelection()
  }
}

/** Delete the row at `index`, keeping at least one row. */
export function $deleteRowAt(table: TableNode, index: number): void {
  const rows = $tableRows(table)
  if (rows.length <= 1) return
  const cell = rows[index]?.getChildren()[0]
  if ($isTableCellNode(cell)) {
    cell.selectStart()
    $deleteTableRowAtSelection()
  }
}
