import type { MultilineElementTransformer } from "@lexical/markdown"
import {
  $createParagraphNode,
  $createTextNode,
} from "lexical"
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
  TableCellHeaderStates,
} from "@lexical/table"

const TABLE_ROW_REG_EXP = /^\|(.+)\|\s?$/
const TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-+:? ?)+\|\s?$/

function getCellText(cell: TableCellNode): string {
  // Get all text content from the cell, joining with space if multiple paragraphs
  return cell
    .getChildren()
    .map((child) => child.getTextContent())
    .join(" ")
    .trim()
}

function parseCells(row: string): string[] {
  // Remove leading/trailing pipes and split by pipes
  return row
    .replace(/^\||\|\s?$/g, "")
    .split("|")
    .map((cell) => cell.trim())
}

/**
 * Export-only transformer for TableNode → markdown pipe table.
 * Must be an ElementTransformer (not multiline) so that exportTopLevelElements
 * picks it up when walking root children.
 */
export const TABLE_EXPORT: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node) => {
    if (!$isTableNode(node)) return null

    const rows = node.getChildren()
    if (rows.length === 0) return ""

    const lines: string[] = []

    rows.forEach((row, rowIndex) => {
      if (!$isTableRowNode(row)) return
      const cells = row.getChildren()
      const cellTexts = cells.map((cell) => {
        if (!$isTableCellNode(cell)) return ""
        return getCellText(cell)
      })
      lines.push("| " + cellTexts.join(" | ") + " |")

      // After first row, insert divider
      if (rowIndex === 0) {
        lines.push("| " + cellTexts.map(() => "---").join(" | ") + " |")
      }
    })

    return lines.join("\n")
  },
  regExpStart: /(?:)/, // never matches (export-only)
  replace: () => {},
  type: "multiline-element",
}

/**
 * Import transformer for markdown pipe table → TableNode.
 * Uses handleImportAfterStartMatch for full control over multiline parsing.
 */
export const TABLE: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: () => null, // handled by TABLE_EXPORT
  regExpStart: TABLE_ROW_REG_EXP,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    // Need at least 2 lines: header + divider
    if (startLineIndex + 1 >= lines.length) return null

    // Second line must be a divider
    const dividerLine = lines[startLineIndex + 1]
    if (!TABLE_ROW_DIVIDER_REG_EXP.test(dividerLine)) return null

    // Parse header cells
    const headerCells = parseCells(lines[startLineIndex])
    const columnCount = headerCells.length

    // Collect data rows (lines after divider that match pipe pattern)
    const dataRows: string[][] = []
    let endLineIndex = startLineIndex + 1 // divider line

    for (let i = startLineIndex + 2; i < lines.length; i++) {
      if (!TABLE_ROW_REG_EXP.test(lines[i])) break
      dataRows.push(parseCells(lines[i]))
      endLineIndex = i
    }

    // Build the table node
    const tableNode = $createTableNode()

    // Header row
    const headerRow = $createTableRowNode()
    for (let col = 0; col < columnCount; col++) {
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(headerCells[col] || ""))
      cell.append(paragraph)
      headerRow.append(cell)
    }
    tableNode.append(headerRow)

    // Data rows
    for (const rowCells of dataRows) {
      const row = $createTableRowNode()
      for (let col = 0; col < columnCount; col++) {
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        const paragraph = $createParagraphNode()
        paragraph.append($createTextNode(rowCells[col] || ""))
        cell.append(paragraph)
        row.append(cell)
      }
      tableNode.append(row)
    }

    rootNode.append(tableNode)
    return [true, endLineIndex]
  },
  replace: () => {},
  type: "multiline-element",
}
