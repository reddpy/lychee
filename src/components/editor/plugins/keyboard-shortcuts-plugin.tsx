"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_NORMAL,
  KEY_DOWN_COMMAND,
  LexicalEditor,
  ElementNode,
} from "lexical"
import { $isQuoteNode, $isHeadingNode } from "@lexical/rich-text"
import { OPEN_LINK_EDITOR_COMMAND } from "./link-editor-plugin"

/**
 * Replace a block element with a paragraph, compensating scroll position
 * to prevent the cursor from visually jumping when top margins differ.
 */
function exitBlockToParagraph(
  editor: LexicalEditor,
  topElement: ElementNode,
  event: KeyboardEvent
): true {
  event.preventDefault()

  // Capture old element position before DOM changes
  const oldDom = editor.getElementByKey(topElement.getKey())
  const oldTop = oldDom?.getBoundingClientRect().top

  const paragraph = $createParagraphNode()
  topElement.replace(paragraph)
  paragraph.select()

  // After DOM reconciliation, compensate scroll for margin difference
  if (oldTop !== undefined) {
    const paragraphKey = paragraph.getKey()
    requestAnimationFrame(() => {
      const newDom = editor.getElementByKey(paragraphKey)
      if (!newDom) return
      const newTop = newDom.getBoundingClientRect().top
      const shift = oldTop - newTop
      if (Math.abs(shift) > 1) {
        const scrollContainer = editor.getRootElement()
        if (scrollContainer) {
          scrollContainer.scrollTop -= shift
        }
      }
    })
  }

  return true
}

export function KeyboardShortcutsPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        const { key, metaKey, ctrlKey, shiftKey } = event
        const isModifier = metaKey || ctrlKey

        // Enter on empty quote or heading → exit to paragraph
        if (key === "Enter" && !isModifier && !shiftKey) {
          const selection = $getSelection()
          if ($isRangeSelection(selection) && selection.isCollapsed()) {
            const anchorNode = selection.anchor.getNode()
            const topElement = anchorNode.getTopLevelElement()
            if (
              topElement &&
              ($isQuoteNode(topElement) || $isHeadingNode(topElement)) &&
              topElement.getTextContent().length === 0
            ) {
              return exitBlockToParagraph(editor, topElement, event)
            }
          }
        }

        if (!isModifier) return false

        // Cmd/Ctrl + B = Bold
        if (key === "b" && !shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")
          return true
        }

        // Cmd/Ctrl + I = Italic
        if (key === "i" && !shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")
          return true
        }

        // Cmd/Ctrl + U = Underline
        if (key === "u" && !shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")
          return true
        }

        // Cmd/Ctrl + Shift + S = Strikethrough
        if (key === "s" && shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
          return true
        }

        // Cmd/Ctrl + E = Inline Code
        if (key === "e" && !shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")
          return true
        }

        // Cmd/Ctrl + K = Insert/Edit Link
        if (key === "k" && !shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined)
          return true
        }

        return false
      },
      COMMAND_PRIORITY_NORMAL
    )
  }, [editor])

  return null
}
