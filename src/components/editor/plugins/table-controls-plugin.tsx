"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
} from "lexical"
import {
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableNode,
  $moveTableColumn,
  TableNode,
} from "@lexical/table"
import { GripHorizontal, GripVertical, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { emitToolbarExclusive, onToolbarExclusive } from "@/components/lexical-editor"
import {
  $appendColumn,
  $appendRow,
  $deleteColumnAt,
  $deleteRowAt,
  $moveRow,
  cellIndices,
  computeSlot,
  measure,
  pointerScope,
  type Axis,
  type Cell,
  type ColGeom,
  type Geom,
  type HoverScope,
} from "@/components/editor/plugins/table-ops"

// Small grip/+ buttons that straddle the table's own edges. Each button's hit
// area equals its visible size (no oversized invisible strip), so hover only
// triggers when the pointer is actually on the control.
const HANDLE_LONG = 22 // grip length along its edge
const HANDLE_SHORT = 15 // grip thickness across the edge
const ADD_BAR = 24 // thickness of the add-row / add-column bar buttons
const ADD_GAP = 0 // flush with the table edge (no dead zone to cross)
const DROP_OVERHANG = 14 // how far the drop-line extends past the edge
// Pointer travel (px) before a handle press becomes a drag rather than a click.
const DRAG_THRESHOLD = 4
// How far outside the table edges the pointer may roam before we hide the
// controls. Covers the edge buttons plus an open delete menu.
const HOVER_PAD = 40

const TABLE_SELECTOR = "table.EditorTheme__table"
const CONTROLS_CLASS = "table-controls"
// Toolbar-exclusivity channel: opening the delete menu closes other panels.
const EXCLUSIVE_KEY = "__table-controls__"

interface DragState {
  axis: Axis
  from: number
  clientX: number
  clientY: number
}
type Selected = { axis: Axis; index: number } | null

/**
 * Hover-driven table chrome: column/row drag handles on the table edges, "+"
 * bars on the right/bottom edges to append, and a click-to-select handle that
 * surfaces a small delete menu. Replaces the old per-cell action menu.
 */
export function TableControlsPlugin(): React.ReactElement | null {
  const [editor] = useLexicalComposerContext()
  const [active, setActive] = useState<HTMLTableElement | null>(null)
  const [geom, setGeom] = useState<Geom | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [selected, setSelected] = useState<Selected>(null)
  // Handles are scoped to the pointer's row/column (hover) and/or the cursor's
  // cell. By default nothing shows.
  const [hover, setHover] = useState<HoverScope | null>(null)
  const [cursorCell, setCursorCell] = useState<Cell | null>(null)

  // Refs mirror state so document-level pointer handlers read fresh values.
  const activeRef = useRef<HTMLTableElement | null>(null)
  const geomRef = useRef<Geom | null>(null)
  const draggingRef = useRef(false)
  const selectedRef = useRef<Selected>(null)
  // The table the pointer is over vs. the table holding the cursor. `active` is
  // whichever exists (hover wins), so controls appear for either reason.
  const hoverTableRef = useRef<HTMLTableElement | null>(null)
  const cursorTableRef = useRef<HTMLTableElement | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  activeRef.current = active
  geomRef.current = geom
  selectedRef.current = selected

  const syncActive = useCallback(() => {
    setActive(hoverTableRef.current ?? cursorTableRef.current)
  }, [])

  // Re-derive the hovered row/column from the latest pointer position against the
  // current geometry. Pass fresh geom right after a re-measure (geomRef lags a
  // render). Geometry-based so it stays correct after rows/columns shift.
  const recomputeHover = useCallback((g?: Geom | null) => {
    const geo = g ?? geomRef.current
    const p = pointerRef.current
    if (!geo || !p || !hoverTableRef.current) {
      setHover((prev) => (prev ? null : prev))
      return
    }
    const s = pointerScope(p, geo)
    setHover((prev) => (prev && prev.row === s.row && prev.col === s.col ? prev : s))
  }, [])

  // Track the cell holding the text cursor (re-derived from the live DOM, so its
  // index follows the cell even when a reorder moves it). Value-deduped so
  // typing within a cell doesn't churn renders.
  const recomputeCursor = useCallback(() => {
    const key = editor.getEditorState().read(() => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel)) return null
      const cell = $getTableCellNodeFromLexicalNode(sel.anchor.getNode())
      return cell ? cell.getKey() : null
    })
    const cellEl = key
      ? (editor.getElementByKey(key) as HTMLTableCellElement | null)
      : null
    const table = cellEl?.closest(TABLE_SELECTOR) as HTMLTableElement | null
    cursorTableRef.current = table ?? null
    const next = table && cellEl ? cellIndices(table, cellEl) : null
    setCursorCell((prev) =>
      (!prev && !next) ||
      (prev && next && prev.row === next.row && prev.col === next.col)
        ? prev
        : next,
    )
    syncActive()
  }, [editor, syncActive])

  // ── Hover detection ───────────────────────────────────────────────────────
  // mouseover only tells us which table the pointer entered; the exact row/col
  // comes from geometry (works in the grip gutters too).
  const onOver = useCallback(
    (e: Event) => {
      const target = e.target as HTMLElement | null
      const me = e as MouseEvent
      pointerRef.current = { x: me.clientX, y: me.clientY }
      hoverTableRef.current =
        (target?.closest?.(TABLE_SELECTOR) as HTMLTableElement | null) ?? null
      syncActive()
      recomputeHover()
    },
    [syncActive, recomputeHover],
  )

  useEffect(() => {
    return editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("mouseover", onOver)
      root?.addEventListener("mouseover", onOver)
    })
  }, [editor, onOver])

  // Track the pointer and clear the hover source once it leaves the table region
  // (unless mid-drag or a delete menu is open). `active` may persist via cursor.
  useEffect(() => {
    if (!active) return
    const onMove = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
      if (draggingRef.current || selectedRef.current) return
      const r = active.getBoundingClientRect()
      const inside =
        e.clientX >= r.left - HOVER_PAD &&
        e.clientX <= r.right + HOVER_PAD &&
        e.clientY >= r.top - HOVER_PAD &&
        e.clientY <= r.bottom + HOVER_PAD
      if (inside) {
        recomputeHover()
      } else {
        hoverTableRef.current = null
        setHover(null)
        syncActive()
      }
    }
    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [active, syncActive, recomputeHover])

  // ── Cursor detection ──────────────────────────────────────────────────────
  useEffect(() => {
    return editor.registerUpdateListener(recomputeCursor)
  }, [editor, recomputeCursor])

  // ── Geometry tracking ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) {
      setGeom(null)
      return
    }
    let raf = 0
    const update = () => {
      raf = 0
      if (!document.contains(active)) {
        hoverTableRef.current = null
        cursorTableRef.current = null
        setActive(null)
        return
      }
      const g = measure(active)
      geomRef.current = g // keep the ref fresh so the re-scope below sees it
      setGeom(g)
      // A re-measure means geometry shifted (move/delete/resize/scroll) — the
      // pointer may now sit over a different row/column, so re-scope the hover.
      recomputeHover(g)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", schedule, true)
    window.addEventListener("resize", schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(active)
    const unregister = editor.registerUpdateListener(schedule)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", schedule, true)
      window.removeEventListener("resize", schedule)
      ro.disconnect()
      unregister()
    }
  }, [active, editor, recomputeHover])

  // ── Lexical mutations ─────────────────────────────────────────────────────
  const withTableNode = useCallback(
    (run: (table: TableNode) => void, opts?: { keepSelection?: boolean }) => {
      const tableEl = activeRef.current
      if (!tableEl) return
      editor.update(() => {
        // Lexical doesn't tag the DOM with node keys, so map the element back to
        // its node directly (walks ancestors to the registered table element).
        const node = $getNearestNodeFromDOMNode(tableEl)
        if (!node) return
        const tableNode = $isTableNode(node)
          ? node
          : $getTableNodeFromLexicalNodeOrThrow(node)
        if (opts?.keepSelection) {
          // Insertions/moves only touch the selection to anchor the edit; snap it
          // back afterwards so the cursor never visibly jumps. The referenced
          // nodes survive the edit, so the saved selection stays valid.
          const prev = $getSelection()?.clone() ?? null
          run(tableNode)
          $setSelection(prev)
        } else {
          run(tableNode)
        }
      })
      // Only pull focus for actions that intentionally move the cursor (delete).
      // keepSelection actions keep whatever focus/selection the user already had.
      if (!opts?.keepSelection) editor.focus()
    },
    [editor],
  )

  const appendColumn = useCallback(() => {
    // Measure the current columns so a never-resized table gets seeded widths and
    // the new column adds width (scrolls) rather than squeezing the rest.
    const firstRowEl = activeRef.current?.querySelector("tr")
    const seed = firstRowEl
      ? Array.from(firstRowEl.children).map((c) => (c as HTMLElement).offsetWidth)
      : undefined
    withTableNode((table) => $appendColumn(table, seed), { keepSelection: true })
  }, [withTableNode])

  const appendRow = useCallback(() => {
    withTableNode($appendRow, { keepSelection: true })
  }, [withTableNode])

  const moveColumn = useCallback(
    (from: number, to: number) => {
      // Reorders cells in place (Lexical), so selection + colWidths survive.
      withTableNode((table) => $moveTableColumn(table, from, to))
    },
    [withTableNode],
  )

  const moveRow = useCallback(
    (from: number, to: number) => {
      // keepSelection: the moved row's cells keep their keys, so restoring the
      // saved selection keeps the cursor from vanishing (a plain remove()+
      // reinsert would clear it), matching column-move behaviour.
      withTableNode((table) => $moveRow(table, from, to), { keepSelection: true })
    },
    [withTableNode],
  )

  const deleteColumn = useCallback(
    (index: number) => {
      withTableNode((table) => $deleteColumnAt(table, index))
      setSelected(null)
    },
    [withTableNode],
  )

  const deleteRow = useCallback(
    (index: number) => {
      withTableNode((table) => $deleteRowAt(table, index))
      setSelected(null)
    },
    [withTableNode],
  )

  // ── Handle drag / click ───────────────────────────────────────────────────
  const startHandle = useCallback(
    (axis: Axis, index: number, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Anchor hover to this table so the post-move re-scope has a reference even
      // if the grip was shown via the cursor (pointer never entered a cell).
      hoverTableRef.current = activeRef.current
      pointerRef.current = { x: e.clientX, y: e.clientY }
      const startX = e.clientX
      const startY = e.clientY
      let dragging = false

      const onMove = (ev: PointerEvent) => {
        if (!dragging) {
          if (
            Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
            Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
          )
            return
          dragging = true
          draggingRef.current = true
          setSelected(null)
          document.body.style.userSelect = "none"
        }
        setDrag({ axis, from: index, clientX: ev.clientX, clientY: ev.clientY })
      }

      const onUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", onMove)
        document.removeEventListener("pointerup", onUp)
        document.body.style.userSelect = ""
        draggingRef.current = false
        setDrag(null)

        const g = geomRef.current
        if (dragging && g) {
          const slot = computeSlot(axis, ev.clientX, ev.clientY, g)
          const to = slot > index ? slot - 1 : slot
          if (to !== index) (axis === "col" ? moveColumn : moveRow)(index, to)
        } else {
          // A plain click toggles the select-to-delete menu for this row/column.
          setSelected((prev) =>
            prev && prev.axis === axis && prev.index === index
              ? null
              : { axis, index },
          )
        }
      }

      document.addEventListener("pointermove", onMove)
      document.addEventListener("pointerup", onUp)
    },
    [moveColumn, moveRow],
  )

  // ── Selection menu lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return
    emitToolbarExclusive(EXCLUSIVE_KEY)
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.(`.${CONTROLS_CLASS}`)) return
      setSelected(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null)
    }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    const off = onToolbarExclusive(EXCLUSIVE_KEY, () => setSelected(null))
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
      off()
    }
  }, [selected])

  if (!active || !geom) return null

  // Visible horizontal span of the table inside its scroll wrapper. All
  // edge-anchored controls clip/pin to this so nothing renders off-screen.
  const visLeft = Math.max(geom.left, geom.clipLeft)
  const visRight = Math.min(geom.left + geom.width, geom.clipRight)
  const colVisible = (c: ColGeom) => {
    const mid = c.left + c.width / 2
    return mid >= geom.clipLeft && mid <= geom.clipRight
  }

  // Which handles to render: the pointer's row/column (hover) and the cursor's
  // cell, plus whatever's being dragged or has its delete menu open.
  const showCols = new Set<number>()
  const showRows = new Set<number>()
  if (active === hoverTableRef.current && hover) {
    if (hover.col != null) showCols.add(hover.col)
    if (hover.row != null) showRows.add(hover.row)
  }
  if (active === cursorTableRef.current && cursorCell) {
    showCols.add(cursorCell.col)
    showRows.add(cursorCell.row)
  }
  if (drag) (drag.axis === "col" ? showCols : showRows).add(drag.from)
  if (selected) (selected.axis === "col" ? showCols : showRows).add(selected.index)

  // Drop indicator line for the in-progress drag.
  let dropLine: React.CSSProperties | null = null
  if (drag) {
    const slot = computeSlot(drag.axis, drag.clientX, drag.clientY, geom)
    if (drag.axis === "col") {
      const c = geom.cols[slot]
      const x = Math.min(c ? c.left : geom.left + geom.width, visRight)
      dropLine = {
        left: x - 1,
        top: geom.top - DROP_OVERHANG,
        width: 2,
        height: geom.height + DROP_OVERHANG,
      }
    } else {
      const r = geom.rows[slot]
      const y = r ? r.top : geom.top + geom.height
      dropLine = {
        top: y - 1,
        left: visLeft - DROP_OVERHANG,
        height: 2,
        width: visRight - visLeft + DROP_OVERHANG,
      }
    }
  }

  // Box highlighting the selected row/column, or the drag source.
  let selBox: React.CSSProperties | null = null
  const highlight: Selected = drag ? { axis: drag.axis, index: drag.from } : selected
  if (highlight?.axis === "col") {
    const c = geom.cols[highlight.index]
    if (c) selBox = { left: c.left, top: geom.top, width: c.width, height: geom.height }
  } else if (highlight) {
    const r = geom.rows[highlight.index]
    if (r) selBox = { left: visLeft, top: r.top, width: visRight - visLeft, height: r.height }
  }

  // Position + contents of the delete menu for the current selection.
  let menu: { style: React.CSSProperties; label: string; onDelete: () => void } | null = null
  if (selected?.axis === "col") {
    const c = geom.cols[selected.index]
    if (c)
      menu = {
        style: {
          left: c.left + c.width / 2,
          top: geom.top - HANDLE_SHORT - 6,
          transform: "translate(-50%, -100%)",
        },
        label: "Delete column",
        onDelete: () => deleteColumn(selected.index),
      }
  } else if (selected) {
    const r = geom.rows[selected.index]
    if (r)
      menu = {
        style: {
          left: geom.left - HANDLE_SHORT - 6,
          top: r.top + r.height / 2,
          transform: "translate(-100%, -50%)",
        },
        label: "Delete row",
        onDelete: () => deleteRow(selected.index),
      }
  }

  const renderHandle = (axis: Axis, index: number, style: React.CSSProperties) => (
    <button
      type="button"
      key={`${axis}-${index}`}
      // data-axis/data-index give e2e a stable target for a specific grip.
      data-axis={axis}
      data-index={index}
      className={cn(
        "table-ctl-handle",
        selected?.axis === axis && selected.index === index && "is-selected",
      )}
      style={{ position: "absolute", pointerEvents: "auto", ...style }}
      title="Drag to reorder · click to select"
      onPointerDown={(e) => startHandle(axis, index, e)}
    >
      {axis === "col" ? (
        <GripHorizontal className="h-3.5 w-3.5" />
      ) : (
        <GripVertical className="h-3.5 w-3.5" />
      )}
    </button>
  )

  const renderAdd = (label: string, onClick: () => void, style: React.CSSProperties) => (
    <button
      type="button"
      className="table-ctl-add"
      style={{ position: "absolute", pointerEvents: "auto", ...style }}
      title={label}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  )

  return createPortal(
    <div
      className={CONTROLS_CLASS}
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 40 }}
    >
      {/* Column handles on the top edge; hidden when scrolled out of view. */}
      {geom.cols.map((c, i) =>
        showCols.has(i) && colVisible(c)
          ? renderHandle("col", i, {
              left: c.left + c.width / 2 - HANDLE_LONG / 2,
              top: geom.top - HANDLE_SHORT + 4,
              width: HANDLE_LONG,
              height: HANDLE_SHORT,
            })
          : null,
      )}

      {/* Row handles pinned to the visible left edge (header rows stay pinned). */}
      {geom.rows.map((r, i) =>
        i < geom.headerRows || !showRows.has(i)
          ? null
          : renderHandle("row", i, {
              top: r.top + r.height / 2 - HANDLE_LONG / 2,
              left: visLeft - HANDLE_SHORT + 4,
              height: HANDLE_LONG,
              width: HANDLE_SHORT,
            }),
      )}

      {renderAdd("Add column", appendColumn, {
        left: visRight + ADD_GAP,
        top: geom.top,
        width: ADD_BAR,
        height: geom.height,
      })}
      {renderAdd("Add row", appendRow, {
        top: geom.top + geom.height + ADD_GAP,
        left: visLeft,
        width: visRight - visLeft,
        height: ADD_BAR,
      })}

      {selBox && (
        <div
          className={cn("table-ctl-selection", drag && "is-dragging")}
          style={{ position: "absolute", ...selBox }}
        />
      )}

      {dropLine && (
        <div className="table-ctl-dropline" style={{ position: "absolute", ...dropLine }} />
      )}

      {menu && (
        <div
          className="table-ctl-menu"
          style={{ position: "absolute", ...menu.style, pointerEvents: "auto" }}
        >
          <button type="button" onClick={menu.onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
            <span>{menu.label}</span>
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
