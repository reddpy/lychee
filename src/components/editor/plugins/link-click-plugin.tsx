"use client"

import { JSX, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"

function openExternalUrl(url: string) {
  window.lychee.invoke("shell.openExternal", { url }).catch((err) => {
    console.error("Failed to open URL:", err)
  })
}

function LinkTooltip({ position, url }: { position: { x: number; y: number }; url: string }) {
  return createPortal(
    <div
      className="fixed z-50 px-3 py-1.5 text-xs bg-popover text-popover-foreground border rounded-md shadow-md pointer-events-none animate-in fade-in-0 zoom-in-95"
      style={{
        left: position.x,
        top: position.y + 8,
      }}
    >
      <span className="text-muted-foreground">⌘+click to open </span>
      <span className="font-medium">
        {url.length > 35 ? url.slice(0, 35) + "..." : url}
      </span>
    </div>,
    document.body
  )
}

export function LinkClickPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [hoveredLink, setHoveredLink] = useState<{ url: string; x: number; y: number } | null>(null)
  const [cmdHeld, setCmdHeld] = useState(false)
  const hoverTimeoutRef = useRef<number | null>(null)
  const currentLinkRef = useRef<HTMLAnchorElement | null>(null)

  // Track Cmd/Ctrl key state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        setCmdHeld(true)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        setCmdHeld(false)
      }
    }

    const handleBlur = () => {
      setCmdHeld(false)
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [])

  // Update cursor on link when Cmd state changes
  useEffect(() => {
    if (currentLinkRef.current) {
      currentLinkRef.current.style.cursor = cmdHeld ? "pointer" : ""
    }
  }, [cmdHeld])

  // Handle mouse events on links
  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const linkElement = target.closest("a") as HTMLAnchorElement | null

      if (linkElement) {
        const href = linkElement.getAttribute("href")
        if (href) {
          currentLinkRef.current = linkElement
          // Update cursor based on current Cmd state
          linkElement.style.cursor = cmdHeld ? "pointer" : ""

          // Clear any existing timeout
          if (hoverTimeoutRef.current) {
            window.clearTimeout(hoverTimeoutRef.current)
          }
          // Show tooltip after short delay
          hoverTimeoutRef.current = window.setTimeout(() => {
            const rect = linkElement.getBoundingClientRect()
            setHoveredLink({ url: href, x: rect.left, y: rect.bottom })
          }, 150)
          return
        }
      }
    }

    const handleMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const linkElement = target.closest("a") as HTMLAnchorElement | null
      const relatedTarget = event.relatedTarget as HTMLElement | null

      // Check if we're leaving a link
      if (linkElement && (!relatedTarget || !linkElement.contains(relatedTarget))) {
        linkElement.style.cursor = ""
        currentLinkRef.current = null
        if (hoverTimeoutRef.current) {
          window.clearTimeout(hoverTimeoutRef.current)
        }
        setHoveredLink(null)
      }
    }

    const handleClick = (event: MouseEvent) => {
      if (!event.metaKey && !event.ctrlKey) return

      const target = event.target as HTMLElement
      const linkElement = target.closest("a")
      if (!linkElement) return

      const href = linkElement.getAttribute("href")
      if (!href) return

      event.preventDefault()
      event.stopPropagation()
      setHoveredLink(null)
      openExternalUrl(href)
    }

    rootElement.addEventListener("mouseover", handleMouseOver)
    rootElement.addEventListener("mouseout", handleMouseOut)
    rootElement.addEventListener("click", handleClick)

    return () => {
      if (hoverTimeoutRef.current) {
        window.clearTimeout(hoverTimeoutRef.current)
      }
      rootElement.removeEventListener("mouseover", handleMouseOver)
      rootElement.removeEventListener("mouseout", handleMouseOut)
      rootElement.removeEventListener("click", handleClick)
    }
  }, [editor, cmdHeld])

  if (hoveredLink) {
    return <LinkTooltip position={{ x: hoveredLink.x, y: hoveredLink.y }} url={hoveredLink.url} />
  }

  return null
}
