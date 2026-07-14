"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DELETE_LINE_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  SELECT_ALL_COMMAND,
} from "lexical"
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $findCellNode,
  $findTableNode,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
} from "@lexical/table"

/**
 * Table keyboard + paste behaviours. The visual per-cell action menu has been
 * replaced by the hover gutters in {@link TableControlsPlugin}; this plugin now
 * only carries the editing behaviours that have nothing to do with that UI:
 * Tab-adds-a-row, Escape-exits, Cmd+A-selects-cell, Cmd+Backspace, and
 * markdown-table paste.
 */
export function TableActionMenuPlugin(): null {
  const [editor] = useLexicalComposerContext()

  // Tab / Shift+Tab inside a table cell moves between cells (Tab past the last
  // cell adds a row). We own EVERY in-cell case at CRITICAL priority and return
  // true so nothing downstream runs. This is the fix for #140: Lexical's built-in
  // tab handler only advances on a *collapsed* selection, so with a non-collapsed
  // selection (e.g. after Cmd+A) Tab fell through to TabIndentationPlugin, which
  // inserted a tab over the selection and deleted the cell's text.
  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false // e.g. CellSelection → let Lexical handle
        const cell = $findCellNode(selection.anchor.getNode())
        if (!cell) return false // not in a table → normal Tab/indent
        const row = cell.getParent()
        event.preventDefault()

        if (event.shiftKey) {
          // Previous cell, else the last cell of the previous row. At the very
          // first cell, stay put (but still swallow Tab to protect the selection).
          const prev = cell.getPreviousSibling()
          if ($isTableCellNode(prev)) {
            prev.selectStart()
          } else {
            const prevRow = row?.getPreviousSibling()
            if ($isTableRowNode(prevRow)) {
              const last = prevRow.getLastChild()
              if ($isTableCellNode(last)) last.selectStart()
            }
          }
          return true
        }

        // Forward: next cell, else first cell of the next row, else add a row.
        const next = cell.getNextSibling()
        if ($isTableCellNode(next)) {
          next.selectStart()
          return true
        }
        const nextRow = row?.getNextSibling()
        if ($isTableRowNode(nextRow)) {
          const first = nextRow.getFirstChild()
          if ($isTableCellNode(first)) first.selectStart()
          return true
        }
        const newRow = $insertTableRowAtSelection(true)
        const firstCell = newRow?.getFirstChild()
        if ($isTableCellNode(firstCell)) firstCell.selectStart()
        return true
      },
      COMMAND_PRIORITY_CRITICAL,
    )
  }, [editor])

  // Escape inside a table cell (cursor selection) moves the cursor after the table,
  // matching Notion/Google Docs behaviour and enabling slash-command insertion below.
  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false
        const cell = $findCellNode(selection.anchor.getNode())
        if (!cell) return false
        const table = $findTableNode(cell)
        if (!table) return false
        event.preventDefault()
        table.selectNext()
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])

  // Cmd+A inside a table cell selects only that cell's content, not the whole document.
  useEffect(() => {
    return editor.registerCommand(
      SELECT_ALL_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false
        const cell = $findCellNode(selection.anchor.getNode())
        if (!cell) return false
        const first = cell.getFirstDescendant()
        const last = cell.getLastDescendant()
        if (!first || !last) return true
        first.selectStart()
        const sel = $getSelection()
        if ($isRangeSelection(sel)) {
          const offset = $isTextNode(last) ? last.getTextContentSize() : 0
          sel.focus.set(last.getKey(), offset, $isTextNode(last) ? "text" : "element")
        }
        return true
      },
      COMMAND_PRIORITY_CRITICAL,
    )
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

  // Paste markdown pipe tables as TableNodes.
  // Handles multiple tables separated by blank lines, and correctly exits
  // the current table context before inserting when cursor is inside a table.
  useEffect(() => {
    const TABLE_ROW_RE = /^\|(.+)\|\s?$/
    const TABLE_DIVIDER_RE = /^(\| ?:?-+:? ?)+\|\s?$/

    const parseCells = (row: string) =>
      row.replace(/^\||\|\s?$/g, "").split("|").map((c) => c.trim())

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

    const buildTableNode = (headerLine: string, dataLines: string[]) => {
      const headerCells = parseCells(headerLine)
      const columnCount = headerCells.length
      const tableNode = $createTableNode()

      const headerRow = $createTableRowNode()
      for (let col = 0; col < columnCount; col++) {
        const cell = $createTableCellNode(TableCellHeaderStates.ROW)
        fillCell(cell, headerCells[col] || "")
        headerRow.append(cell)
      }
      tableNode.append(headerRow)

      for (const rowLine of dataLines) {
        const rowCells = parseCells(rowLine)
        const row = $createTableRowNode()
        for (let col = 0; col < columnCount; col++) {
          const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
          fillCell(cell, rowCells[col] || "")
          row.append(cell)
        }
        tableNode.append(row)
      }
      return tableNode
    }

    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null
        if (!clipboardData) return false

        const text = clipboardData.getData("text/plain").trim()
        const lines = text.split("\n").map((l) => l.trim())

        // Must start with a valid table header + divider
        if (lines.length < 2) return false
        if (!TABLE_ROW_RE.test(lines[0]) || !TABLE_DIVIDER_RE.test(lines[1])) return false

        // Parse into one or more table blocks separated by blank lines.
        // Non-table content between tables causes us to bail out.
        const tableBlocks: { header: string; dataLines: string[] }[] = []
        let i = 0
        while (i < lines.length) {
          if (lines[i] === "") { i++; continue }
          if (!TABLE_ROW_RE.test(lines[i])) return false // non-table content
          const header = lines[i]
          if (i + 1 >= lines.length || !TABLE_DIVIDER_RE.test(lines[i + 1])) return false
          i += 2
          const dataLines: string[] = []
          while (i < lines.length && lines[i] !== "" && TABLE_ROW_RE.test(lines[i])) {
            dataLines.push(lines[i])
            i++
          }
          tableBlocks.push({ header, dataLines })
        }
        if (tableBlocks.length === 0) return false

        event.preventDefault()

        // If cursor is inside a table cell, move to after that table first so we
        // don't try to nest a table inside a cell.
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          const cellNode = $findCellNode(selection.anchor.getNode())
          if (cellNode) {
            const existingTable = $findTableNode(cellNode)
            if (existingTable) existingTable.selectNext()
          }
        }

        $insertNodes(tableBlocks.map(({ header, dataLines }) => buildTableNode(header, dataLines)))
        return true
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor])

  return null
}
