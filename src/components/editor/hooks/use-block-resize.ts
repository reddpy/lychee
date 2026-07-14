import { useCallback, useState, type RefObject } from "react"

interface UseBlockResizeOptions {
  /** Ref to the image being resized. */
  resizeRef: RefObject<HTMLElement | null>
  /** Ref to the outer container (used for max-width calculation). */
  containerRef: RefObject<HTMLElement | null>
  /** Called with the final dimensions after resize ends. */
  applySize: (width: number, height: number) => void
}

export function useBlockResize({
  resizeRef,
  containerRef,
  applySize,
}: UseBlockResizeOptions) {
  const [isResizing, setIsResizing] = useState(false)

  const onResizeStart = useCallback(
    (e: React.PointerEvent, side: "left" | "right") => {
      e.preventDefault()
      e.stopPropagation()
      const el = resizeRef.current
      if (!el) return
      setIsResizing(true)

      const startX = e.clientX
      const startWidth = el.offsetWidth
      const startHeight = el.offsetHeight
      const aspect = startWidth / startHeight
      const maxWidth = containerRef.current?.parentElement?.offsetWidth ?? 800
      const minWidth = 100

      const onMove = (me: PointerEvent) => {
        let dx = me.clientX - startX
        if (side === "left") dx = -dx
        const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx))

        const newHeight = newWidth / aspect
        el.style.width = `${newWidth}px`
        el.style.height = `${newHeight}px`
      }

      const onUp = () => {
        document.removeEventListener("pointermove", onMove)
        document.removeEventListener("pointerup", onUp)

        const finalWidth = Math.round(resizeRef.current?.offsetWidth ?? startWidth)
        const finalHeight = Math.round(resizeRef.current?.offsetHeight ?? startHeight)

        applySize(finalWidth, finalHeight)
        setTimeout(() => setIsResizing(false), 100)
      }

      document.addEventListener("pointermove", onMove)
      document.addEventListener("pointerup", onUp)
    },
    [resizeRef, containerRef, applySize],
  )

  return { isResizing, onResizeStart }
}
