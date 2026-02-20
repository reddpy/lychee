"use client"

import { useEffect, useRef } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { createCommand, COMMAND_PRIORITY_LOW } from "lexical"

const HIGHLIGHT_CLASS = "heading-highlight"

/** Dispatch with an HTMLElement to highlight it, or null to clear. */
export const HIGHLIGHT_BLOCK_COMMAND = createCommand<HTMLElement | null>(
  "HIGHLIGHT_BLOCK"
)

export function BlockHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const highlightedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // Handle highlight command from any plugin
    const unregister = editor.registerCommand(
      HIGHLIGHT_BLOCK_COMMAND,
      (element) => {
        const prev = highlightedRef.current
        if (prev) {
          prev.classList.remove(HIGHLIGHT_CLASS)
          highlightedRef.current = null
        }
        if (element) {
          element.classList.add(HIGHLIGHT_CLASS)
          highlightedRef.current = element
        }
        return true
      },
      COMMAND_PRIORITY_LOW
    )

    // Clear highlight when clicking in the editor
    const root = editor.getRootElement()
    if (!root) return unregister

    const clearOnClick = () => {
      if (highlightedRef.current) {
        editor.dispatchCommand(HIGHLIGHT_BLOCK_COMMAND, null)
      }
    }
    root.addEventListener("mousedown", clearOnClick)

    return () => {
      unregister()
      root.removeEventListener("mousedown", clearOnClick)
    }
  }, [editor])

  return null
}
