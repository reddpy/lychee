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

    const unregister = editor.registerRootListener((rootElement, prevElement) => {
      cleanup?.()
      cleanup = null

      if (!rootElement) return

      let main: HTMLElement | null = rootElement.parentElement
      while (main && main.tagName !== "MAIN") main = main.parentElement
      if (!main) return

      const handler = (event: MouseEvent) => {
        if ((event.target as HTMLElement).closest?.("[contenteditable]")) return
        if (event.clientY <= rootElement.getBoundingClientRect().bottom) return

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

      main.addEventListener("click", handler)
      cleanup = () => main!.removeEventListener("click", handler)
    })

    return () => {
      cleanup?.()
      unregister()
    }
  }, [editor])

  return null
}
