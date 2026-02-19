"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getSelection, $isRangeSelection, $isParagraphNode } from "lexical"

const PLACEHOLDER_CLASS = "is-placeholder"
const PLACEHOLDER_TEXT = "Type something, or press '/' for commands..."

export function ParagraphPlaceholderPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        // Remove placeholder from any previous paragraph
        const root = editor.getRootElement()
        if (!root) return
        const prev = root.querySelector(`p.${PLACEHOLDER_CLASS}`)
        if (prev) {
          prev.classList.remove(PLACEHOLDER_CLASS)
          prev.removeAttribute("data-placeholder")
        }

        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

        const anchorNode = selection.anchor.getNode()
        const topElement = anchorNode.getTopLevelElement()

        if (
          topElement &&
          $isParagraphNode(topElement) &&
          topElement.getTextContent().length === 0
        ) {
          const dom = editor.getElementByKey(topElement.getKey())
          if (dom) {
            dom.classList.add(PLACEHOLDER_CLASS)
            dom.setAttribute("data-placeholder", PLACEHOLDER_TEXT)
          }
        }
      })
    })
  }, [editor])

  return null
}
