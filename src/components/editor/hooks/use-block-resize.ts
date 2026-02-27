import { useCallback, useState, type RefObject } from "react"

interface UseBlockResizeOptions {
  /** Ref to the element being resized. For images, this is the <img>; for YouTube, this is the container. */
  resizeRef: RefObject<HTMLElement | null>
  /** Ref to the outer container (used for max-width calculation). */
  containerRef: RefObject<HTMLElement | null>
  /** 'preserve' keeps the element's natural aspect ratio (images); 'fixed' uses a fixed 16:9 ratio (YouTube). */
  aspectMode: "preserve" | "fixed"
  /** Called with the final dimensions after resize ends. */
  applySize: (width: number, height: number | undefined) => void
}

export function useBlockResize({
  resizeRef,
  containerRef,
  aspectMode,
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
      const aspect = aspectMode === "fixed" ? 16 / 9 : startWidth / startHeight
      const maxWidth = containerRef.current?.parentElement?.offsetWidth ?? 800
      const minWidth = aspectMode === "fixed" ? 200 : 100

      const onMove = (me: PointerEvent) => {
        let dx = me.clientX - startX
        if (side === "left") dx = -dx
        const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx))

        if (aspectMode === "preserve") {
          const newHeight = newWidth / aspect
          el.style.width = `${newWidth}px`
          el.style.height = `${newHeight}px`
        } else {
          el.style.width = `${newWidth}px`
        }
      }

      const onUp = () => {
        document.removeEventListener("pointermove", onMove)
        document.removeEventListener("pointerup", onUp)

        const finalWidth = Math.round(resizeRef.current?.offsetWidth ?? startWidth)
        const finalHeight = aspectMode === "preserve"
          ? Math.round(resizeRef.current?.offsetHeight ?? startHeight)
          : undefined

        applySize(finalWidth, finalHeight)
        setTimeout(() => setIsResizing(false), 100)
      }

      document.addEventListener("pointermove", onMove)
      document.addEventListener("pointerup", onUp)
    },
    [resizeRef, containerRef, aspectMode, applySize],
  )

  return { isResizing, onResizeStart }
}
