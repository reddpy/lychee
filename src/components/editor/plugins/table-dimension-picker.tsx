"use client"

import { useState, useCallback } from "react"

const MIN_GRID = 5
const MAX_GRID = 10

interface TableDimensionPickerProps {
  onInsert: (rows: number, columns: number) => void
}

export function TableDimensionPicker({ onInsert }: TableDimensionPickerProps) {
  const [hoverRow, setHoverRow] = useState(0)
  const [hoverCol, setHoverCol] = useState(0)

  // Grid grows as the cursor nears the edge
  const gridRows = Math.min(Math.max(MIN_GRID, hoverRow + 2), MAX_GRID)
  const gridCols = Math.min(Math.max(MIN_GRID, hoverCol + 2), MAX_GRID)

  const handleClick = useCallback(() => {
    if (hoverRow > 0 && hoverCol > 0) {
      onInsert(hoverRow, hoverCol)
    }
  }, [hoverRow, hoverCol, onInsert])

  return (
    <div
      className="flex flex-col items-center gap-2 p-2"
      onMouseLeave={() => {
        setHoverRow(0)
        setHoverCol(0)
      }}
    >
      <div
        className="grid gap-[3px]"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        }}
      >
        {Array.from({ length: gridRows }, (_, row) =>
          Array.from({ length: gridCols }, (_, col) => {
            const isSelected = row < hoverRow && col < hoverCol
            return (
              <div
                key={`${row}-${col}`}
                className={
                  "h-[18px] w-[18px] rounded-[3px] border transition-colors duration-75 " +
                  (isSelected
                    ? "border-primary/60 bg-primary/20"
                    : "border-[hsl(var(--border))] bg-background")
                }
                onMouseEnter={() => {
                  setHoverRow(row + 1)
                  setHoverCol(col + 1)
                }}
                onClick={handleClick}
              />
            )
          })
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {hoverRow > 0 && hoverCol > 0
          ? `${hoverRow} × ${hoverCol}`
          : "Select dimensions"}
      </span>
    </div>
  )
}
