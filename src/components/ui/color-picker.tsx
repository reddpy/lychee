"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { hexToHsv, hsvToHex, normalizeHex } from "@/renderer/appearance-preferences"

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Themed in-app color picker. Replaces the OS `<input type="color">` dialog so
 * the popup matches the app's rounded, token-driven styling. Controlled: emits
 * a normalized hex string on every change.
 */
export function ColorPickerPopover({
  value,
  onChange,
  children,
  sideOffset = 8,
  align = "start",
}: {
  value: string
  onChange: (hex: string) => void
  children: React.ReactNode
  sideOffset?: number
  align?: "start" | "center" | "end"
}) {
  const [open, setOpen] = React.useState(false)
  const [hsv, setHsv] = React.useState(() => hexToHsv(normalizeHex(value) ?? "#ffffff"))
  const [draft, setDraft] = React.useState(() => normalizeHex(value) ?? "#ffffff")
  const areaRef = React.useRef<HTMLDivElement>(null)

  // Re-sync from the incoming value whenever the popover is closed.
  React.useEffect(() => {
    if (open) return
    const next = normalizeHex(value) ?? "#ffffff"
    setHsv(hexToHsv(next))
    setDraft(next)
  }, [value, open])

  const commitHsv = React.useCallback(
    (next: { h: number; s: number; v: number }) => {
      setHsv(next)
      const hex = hsvToHex(next.h, next.s, next.v)
      setDraft(hex)
      onChange(hex)
    },
    [onChange],
  )

  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v)

  const updateFromPointer = (clientX: number, clientY: number) => {
    const area = areaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    const s = clamp01((clientX - rect.left) / rect.width)
    const v = 1 - clamp01((clientY - rect.top) / rect.height)
    commitHsv({ h: hsv.h, s, v })
  }

  const commitDraft = (raw: string) => {
    const hex = normalizeHex(raw)
    if (!hex) {
      setDraft(currentHex)
      return
    }
    commitHsv(hexToHsv(hex))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-60 rounded-xl border border-[hsl(var(--border))] bg-popover p-3 shadow-lg"
      >
        <div
          ref={areaRef}
          role="slider"
          aria-label="Saturation and brightness"
          aria-valuetext={currentHex}
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            updateFromPointer(event.clientX, event.clientY)
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return
            updateFromPointer(event.clientX, event.clientY)
          }}
          className="relative h-40 w-full touch-none rounded-lg"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h}, 100%, 50%)`,
          }}
        >
          <span
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              backgroundColor: currentHex,
            }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={360}
          value={Math.round(hsv.h)}
          onChange={(event) => commitHsv({ ...hsv, h: Number(event.target.value) })}
          aria-label="Hue"
          className="mt-3 h-3 w-full cursor-pointer appearance-none rounded-full outline-none [background:linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        />

        <div className="mt-3 flex items-center gap-2">
          <span
            className="h-8 w-8 shrink-0 rounded-full border border-[hsl(var(--border))]"
            style={{ backgroundColor: currentHex }}
          />
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commitDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commitDraft((event.target as HTMLInputElement).value)
              }
            }}
            spellCheck={false}
            aria-label="Hex color"
            className="h-8 font-mono text-xs"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
