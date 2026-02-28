"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  DELETE_LINE_COMMAND,
  PASTE_COMMAND,
} from "lexical"
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $findCellNode,
  $findTableNode,
  $insertTableRowAtSelection,
  $insertTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $deleteTableColumnAtSelection,
  TableCellHeaderStates,
  TableCellNode,
} from "@lexical/table"
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  X,
  Trash2,
  Rows3,
  Columns3,
  Settings2,
} from "lucide-react"

function TableActionBar({
  editor,
  tableCellNode,
}: {
  editor: ReturnType<typeof useLexicalComposerContext>[0]
  tableCellNode: TableCellNode
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const cellKey = tableCellNode.getKey()
    const update = () => {
      editor.getEditorState().read(() => {
        const cellNode = $getNodeByKey(cellKey)
        if (!cellNode) {
          setPosition(null)
          return
        }
        const tableNode = $findTableNode(cellNode)
        if (!tableNode) {
          setPosition(null)
          return
        }
        const cellElem = editor.getElementByKey(cellKey)
        if (!cellElem) {
          setPosition(null)
          return
        }
        const cellRect = cellElem.getBoundingClientRect()
        setPosition({
          // Vertically centered, right edge inset
          top: cellRect.top + cellRect.height / 2,
          left: cellRect.right - 4,
        })
      })
    }

    update()

    // ResizeObserver repositions when cell dimensions change (e.g. column resizing)
    const cellElem = editor.getElementByKey(cellKey)
    const resizeObserver = cellElem ? new ResizeObserver(update) : null
    if (cellElem && resizeObserver) resizeObserver.observe(cellElem)

    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [editor, tableCellNode])

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    window.addEventListener("mousedown", handleClick)
    return () => window.removeEventListener("mousedown", handleClick)
  }, [open])

  // Close menu when cell changes
  useEffect(() => { setOpen(false) }, [tableCellNode])

  const run = useCallback((fn: () => void) => {
    editor.update(fn)
    setOpen(false)
  }, [editor])

  const insertRowAbove = useCallback(() => run(() => {
    $insertTableRowAtSelection(false); $setSelection(null)
  }), [run])

  const insertRowBelow = useCallback(() => run(() => {
    $insertTableRowAtSelection(true); $setSelection(null)
  }), [run])

  const insertColumnLeft = useCallback(() => run(() => {
    $insertTableColumnAtSelection(false); $setSelection(null)
  }), [run])

  const insertColumnRight = useCallback(() => run(() => {
    $insertTableColumnAtSelection(true); $setSelection(null)
  }), [run])

  const deleteRow = useCallback(() => run(() => {
    $deleteTableRowAtSelection(); $setSelection(null)
  }), [run])

  const deleteColumn = useCallback(() => run(() => {
    $deleteTableColumnAtSelection(); $setSelection(null)
  }), [run])

  const deleteTable = useCallback(() => run(() => {
    const tableNode = $findTableNode(tableCellNode)
    if (tableNode) {
      const paragraph = $createParagraphNode()
      tableNode.insertAfter(paragraph)
      tableNode.remove()
      paragraph.selectStart()
    }
  }), [run, tableCellNode])

  if (!position) return null

  const iconClass = "h-3.5 w-3.5"
  const btnBase = "flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground"
  const insertBtnClass = `${btnBase} hover:bg-accent hover:text-accent-foreground`
  const deleteBtnClass = `${btnBase} hover:bg-destructive/10 hover:text-destructive`
  const dividerClass = "my-0.5 h-px w-full bg-[hsl(var(--border))]"

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 flex flex-col items-end table-action-menu"
      style={{ top: position.top, left: position.left, transform: "translateX(-100%)" }}
    >
      {/* Trigger */}
      <button
        ref={triggerRef}
        className="flex items-center justify-center rounded p-0.5 text-muted-foreground opacity-60 hover:opacity-100 hover:text-accent-foreground animate-in fade-in-0 -translate-y-1/2"
        onClick={() => setOpen((v) => !v)}
        title="Table actions"
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>

      {/* Expanded vertical menu */}
      {open && (
        <div className="mt-1 flex flex-col rounded-md border border-[hsl(var(--border))] bg-popover p-1 shadow-md animate-in fade-in-0 slide-in-from-top-1">
            <button className={insertBtnClass} onClick={insertRowAbove} title="Insert row above">
              <ArrowUp className={iconClass} />
              <Rows3 className={iconClass} />
              <span>Add Row</span>
            </button>
            <button className={insertBtnClass} onClick={insertRowBelow} title="Insert row below">
              <ArrowDown className={iconClass} />
              <Rows3 className={iconClass} />
              <span>Add Row</span>
            </button>
            <button className={insertBtnClass} onClick={insertColumnLeft} title="Insert column left">
              <ArrowLeft className={iconClass} />
              <Columns3 className={iconClass} />
              <span>Add Col</span>
            </button>
            <button className={insertBtnClass} onClick={insertColumnRight} title="Insert column right">
              <ArrowRight className={iconClass} />
              <Columns3 className={iconClass} />
              <span>Add Col</span>
            </button>

            <div className={dividerClass} />

            <button className={deleteBtnClass} onClick={deleteRow} title="Delete row">
              <X className={iconClass} />
              <Rows3 className={iconClass} />
              <span>Del Row</span>
            </button>
            <button className={deleteBtnClass} onClick={deleteColumn} title="Delete column">
              <X className={iconClass} />
              <Columns3 className={iconClass} />
              <span>Del Col</span>
            </button>

            <div className={dividerClass} />

            <button className={deleteBtnClass} onClick={deleteTable} title="Delete table">
              <Trash2 className={iconClass} />
              <span>Del Table</span>
            </button>
        </div>
      )}
    </div>,
    document.body
  )
}

export function TableActionMenuPlugin(): React.ReactElement | null {
  const [editor] = useLexicalComposerContext()
  const [tableCellNode, setTableCellNode] = useState<TableCellNode | null>(null)

  // Track which table cell the cursor is in
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          setTableCellNode(null)
          return
        }
        const cell = $findCellNode(selection.anchor.getNode())
        setTableCellNode(cell)
      })
    })
  }, [editor])

  // Fix Cmd+Backspace (DELETE_LINE_COMMAND) inside table cells.
  // Lexical's table plugin swallows this command with a TODO comment.
  // We re-implement it using selection.modify to extend to line boundary,
  // then delete the selected text.
  useEffect(() => {
    return editor.registerCommand(
      DELETE_LINE_COMMAND,
      (isForward) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        const cell = $findCellNode(selection.anchor.getNode())
        if (!cell) return false

        // Extend selection to line boundary in the appropriate direction, then delete
        selection.modify("extend", isForward, "lineboundary")
        if (!selection.isCollapsed()) {
          selection.removeText()
        }
        return true
      },
      COMMAND_PRIORITY_CRITICAL
    )
  }, [editor])

  // Paste markdown pipe tables as TableNodes
  useEffect(() => {
    const TABLE_ROW_RE = /^\|(.+)\|\s?$/
    const TABLE_DIVIDER_RE = /^(\| ?:?-+:? ?)+\|\s?$/

    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null
        if (!clipboardData) return false

        const text = clipboardData.getData("text/plain").trim()
        const lines = text.split("\n").map((l) => l.trim())

        // Need at least header + divider
        if (lines.length < 2) return false
        if (!TABLE_ROW_RE.test(lines[0]) || !TABLE_DIVIDER_RE.test(lines[1])) return false

        // All remaining lines must be table rows
        for (let i = 2; i < lines.length; i++) {
          if (lines[i] === "") continue
          if (!TABLE_ROW_RE.test(lines[i])) return false
        }

        event.preventDefault()

        const parseCells = (row: string) =>
          row.replace(/^\||\|\s?$/g, "").split("|").map((c) => c.trim())

        const headerCells = parseCells(lines[0])
        const columnCount = headerCells.length

        // Parse inline markdown (bold, italic, code, strikethrough) into TextNodes
        const INLINE_RE = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~)/g
        const fillCell = (cell: TableCellNode, text: string) => {
          const p = $createParagraphNode()
          let lastIndex = 0
          let match: RegExpExecArray | null
          INLINE_RE.lastIndex = 0
          while ((match = INLINE_RE.exec(text)) !== null) {
            if (match.index > lastIndex) {
              p.append($createTextNode(text.slice(lastIndex, match.index)))
            }
            if (match[2]) { // ***bold italic***
              const node = $createTextNode(match[2])
              node.toggleFormat("bold")
              node.toggleFormat("italic")
              p.append(node)
            } else if (match[3]) { // **bold**
              const node = $createTextNode(match[3])
              node.toggleFormat("bold")
              p.append(node)
            } else if (match[4]) { // *italic*
              const node = $createTextNode(match[4])
              node.toggleFormat("italic")
              p.append(node)
            } else if (match[5]) { // `code`
              const node = $createTextNode(match[5])
              node.toggleFormat("code")
              p.append(node)
            } else if (match[6]) { // ~~strikethrough~~
              const node = $createTextNode(match[6])
              node.toggleFormat("strikethrough")
              p.append(node)
            }
            lastIndex = match.index + match[0].length
          }
          if (lastIndex < text.length) {
            p.append($createTextNode(text.slice(lastIndex)))
          }
          if (p.getChildrenSize() === 0) {
            p.append($createTextNode(""))
          }
          cell.append(p)
        }

        const tableNode = $createTableNode()

        // Header row
        const headerRow = $createTableRowNode()
        for (let col = 0; col < columnCount; col++) {
          const cell = $createTableCellNode(TableCellHeaderStates.ROW)
          fillCell(cell, headerCells[col] || "")
          headerRow.append(cell)
        }
        tableNode.append(headerRow)

        // Data rows
        for (let i = 2; i < lines.length; i++) {
          if (lines[i] === "") continue
          const rowCells = parseCells(lines[i])
          const row = $createTableRowNode()
          for (let col = 0; col < columnCount; col++) {
            const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
            fillCell(cell, rowCells[col] || "")
            row.append(cell)
          }
          tableNode.append(row)
        }

        $insertNodes([tableNode])
        return true
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor])

  if (!tableCellNode) return null

  return <TableActionBar editor={editor} tableCellNode={tableCellNode} />
}
