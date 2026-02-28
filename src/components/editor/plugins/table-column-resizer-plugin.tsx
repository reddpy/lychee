"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getNodeByKey } from "lexical"
import {
  TableCellNode,
  TableNode,
  TableRowNode,
  $isTableNode,
} from "@lexical/table"

const MIN_COL_WIDTH = 60
const RESIZER_CLASS = "EditorTheme__tableCellResizer"

export function TableColumnResizerPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const resizerCleanups = new Map<string, () => void>()

    function isLastColumn(cellElem: HTMLElement): boolean {
      const tr = cellElem.parentElement
      if (!tr) return true
      return cellElem === tr.lastElementChild
    }

    function removeResizer(cellKey: string) {
      const cleanup = resizerCleanups.get(cellKey)
      if (cleanup) {
        cleanup()
        resizerCleanups.delete(cellKey)
      }
    }

    function setupResizer(cellKey: string) {
      removeResizer(cellKey)

      const cellElem = editor.getElementByKey(cellKey)
      if (!cellElem) return
      if (isLastColumn(cellElem)) return

      const resizer = document.createElement("div")
      resizer.className = RESIZER_CLASS
      cellElem.appendChild(resizer)

      const onPointerDown = (e: PointerEvent) => {
        e.preventDefault()
        e.stopPropagation()

        const td = cellElem
        const tr = td.parentElement
        if (!tr) return
        const tableElem = td.closest("table")
        if (!tableElem) return

        const colIndex = Array.from(tr.children).indexOf(td)
        if (colIndex < 0) return

        // Read current state
        let tableNodeKey: string | null = null
        let startWidths: number[] = []
        let needsInit = false

        editor.getEditorState().read(() => {
          const cellNode = $getNodeByKey(cellKey)
          if (!cellNode) return
          const parent = cellNode.getParent()
          if (!parent) return
          const tableNode = parent.getParent()
          if (!tableNode || !$isTableNode(tableNode)) return

          tableNodeKey = tableNode.getKey()
          const colWidths = tableNode.getColWidths()
          if (colWidths && colWidths.length > 0) {
            startWidths = [...colWidths]
          } else {
            needsInit = true
          }
        })

        // Initialize col widths from DOM measurements if needed
        if (needsInit && tableNodeKey) {
          const firstRow = tableElem.querySelector("tr")
          if (!firstRow) return
          const cells = firstRow.children
          const widths: number[] = []
          for (let i = 0; i < cells.length; i++) {
            widths.push((cells[i] as HTMLElement).offsetWidth)
          }
          editor.update(
            () => {
              const tableNode = $getNodeByKey(tableNodeKey!) as TableNode | null
              if (!tableNode || !$isTableNode(tableNode)) return
              tableNode.setColWidths(widths)
            },
            { tag: "history-merge" }
          )
          startWidths = widths
        }

        if (!tableNodeKey || startWidths.length === 0) return
        if (colIndex >= startWidths.length - 1) return

        const startX = e.clientX
        let rafId = 0
        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
        document.body.setAttribute("data-col-resizing", "")
        resizer.classList.add("active")

        const onPointerMove = (moveEvent: PointerEvent) => {
          cancelAnimationFrame(rafId)
          rafId = requestAnimationFrame(() => {
            const dx = moveEvent.clientX - startX
            const maxDx = startWidths[colIndex + 1] - MIN_COL_WIDTH
            const minDx = -(startWidths[colIndex] - MIN_COL_WIDTH)
            const clampedDx = Math.max(minDx, Math.min(maxDx, dx))

            const leftWidth = startWidths[colIndex] + clampedDx
            const rightWidth = startWidths[colIndex + 1] - clampedDx

            editor.update(
              () => {
                const tableNode = $getNodeByKey(tableNodeKey!) as TableNode | null
                if (!tableNode || !$isTableNode(tableNode)) return
                const newWidths = [...startWidths]
                newWidths[colIndex] = leftWidth
                newWidths[colIndex + 1] = rightWidth
                tableNode.setColWidths(newWidths)
              },
              { tag: "history-merge" }
            )
          })
        }

        const onPointerUp = () => {
          cancelAnimationFrame(rafId)
          document.removeEventListener("pointermove", onPointerMove)
          document.removeEventListener("pointerup", onPointerUp)
          document.body.style.cursor = ""
          document.body.style.userSelect = ""
          document.body.removeAttribute("data-col-resizing")
          resizer.classList.remove("active")
        }

        document.addEventListener("pointermove", onPointerMove)
        document.addEventListener("pointerup", onPointerUp)
      }

      resizer.addEventListener("pointerdown", onPointerDown)

      resizerCleanups.set(cellKey, () => {
        resizer.removeEventListener("pointerdown", onPointerDown)
        resizer.remove()
      })
    }

    function syncRowResizers(rowElem: HTMLElement) {
      for (const cell of Array.from(rowElem.children)) {
        const key = (cell as HTMLElement).getAttribute("data-lexical-node-key")
        if (!key) continue
        const hasResizer = cell.querySelector(`.${RESIZER_CLASS}`)
        const last = cell === rowElem.lastElementChild
        if (last && hasResizer) {
          removeResizer(key)
        } else if (!last && !hasResizer) {
          setupResizer(key)
        }
      }
    }

    const removeCellListener = editor.registerMutationListener(
      TableCellNode,
      (mutations) => {
        for (const [key, type] of mutations) {
          if (type === "destroyed") {
            removeResizer(key)
          } else if (type === "created") {
            setupResizer(key)
          }
        }
      }
    )

    const removeRowListener = editor.registerMutationListener(
      TableRowNode,
      (mutations) => {
        for (const [key, type] of mutations) {
          if (type === "destroyed") continue
          const rowElem = editor.getElementByKey(key)
          if (rowElem) syncRowResizers(rowElem)
        }
      }
    )

    return () => {
      removeCellListener()
      removeRowListener()
      for (const cleanup of resizerCleanups.values()) {
        cleanup()
      }
      resizerCleanups.clear()
    }
  }, [editor])

  return null
}
