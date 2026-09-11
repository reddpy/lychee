"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $createParagraphNode, $getRoot, $isParagraphNode } from "lexical"

/**
 * Clicking in the empty space below the last block creates a new paragraph
 * and focuses it — matches Notion behavior so users can always add content
 * after non-text blocks like images or bookmarks.
 */
export function ClickToAppendPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    let cleanup: (() => void) | null = null

    const unregister = editor.registerRootListener((rootElement) => {
      cleanup?.()
      cleanup = null

      if (!rootElement) return

      const main = rootElement.closest("main")
      if (!main) return

      let pointerStart: { x: number; y: number } | null = null
      const onPointerDown = (event: PointerEvent) => {
        pointerStart = { x: event.clientX, y: event.clientY }
      }

      const handler = (event: MouseEvent) => {
        const start = pointerStart
        pointerStart = null
        if (!editor.isEditable()) return
        if (event.defaultPrevented || event.button !== 0 || event.detail > 1) return
        // A drag selection can end in blank space too; it must not append.
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return

        const target = event.target
        if (!(target instanceof Element)) return
        // Text and interactive content own their clicks; only the root's own
        // blank space should append a paragraph.
        if (target !== rootElement && target.closest("[contenteditable]")) return

        // Compare against the last block rather than the editor's min-height so
        // the first block on a short note is as easy to click past as the last.
        const lastBlock = rootElement.lastElementChild
        const lastBottom = lastBlock
          ? lastBlock.getBoundingClientRect().bottom
          : rootElement.getBoundingClientRect().top
        if (event.clientY <= lastBottom) return

        event.preventDefault()
        editor.update(() => {
          const root = $getRoot()
          const last = root.getLastChild()
          if ($isParagraphNode(last) && last.getTextContent() === "") {
            last.selectEnd()
            return
          }
          const paragraph = $createParagraphNode()
          root.append(paragraph)
          paragraph.selectEnd()
        })
      }

      main.addEventListener("pointerdown", onPointerDown)
      main.addEventListener("click", handler)
      cleanup = () => {
        main.removeEventListener("pointerdown", onPointerDown)
        main.removeEventListener("click", handler)
      }
    })

    return () => {
      cleanup?.()
      unregister()
    }
  }, [editor])

  return null
}
