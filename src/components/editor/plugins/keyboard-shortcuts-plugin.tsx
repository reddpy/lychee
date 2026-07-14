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
import { $findMatchingParent } from "@lexical/utils"
import { $isListItemNode, ListItemNode } from "@lexical/list"
import {
  $convertListItemToParagraph,
  $isCaretAtListItemStart,
} from "./list-backspace"
import { $insertMatchingChecklistItemBefore } from "./list-enter"
import { OPEN_LINK_EDITOR_COMMAND } from "./link-editor-plugin"

/**
 * After a block is replaced by another, nudge the scroll position so the new
 * block lands where the old one was. Prevents the cursor from visually jumping
 * when the two blocks have different top margins. `oldTop` is the old block's
 * viewport-relative top, captured *before* the DOM change.
 */
function compensateScroll(
  editor: LexicalEditor,
  oldTop: number | undefined,
  newKey: string
): void {
  if (oldTop === undefined) return
  requestAnimationFrame(() => {
    const newDom = editor.getElementByKey(newKey)
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

  compensateScroll(editor, oldTop, paragraph.getKey())

  return true
}

/**
 * Backspace at the start of a list item converts it back to a paragraph in
 * place (Notion-style), instead of Lexical's default of merging the item up
 * into the one above it (issue #222). Compensates scroll so the line doesn't
 * visually shift when the list-item and paragraph margins differ.
 */
function exitListItemToParagraph(
  editor: LexicalEditor,
  listItem: ListItemNode,
  event: KeyboardEvent
): boolean {
  const oldDom = editor.getElementByKey(listItem.getKey())
  const oldTop = oldDom?.getBoundingClientRect().top

  const paragraph = $convertListItemToParagraph(listItem)
  if (paragraph === null) return false

  event.preventDefault()
  compensateScroll(editor, oldTop, paragraph.getKey())
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
            const listItem = $findMatchingParent(anchorNode, $isListItemNode)

            // Enter at the start of a checked task creates a new checked task
            // above it. The original task and its checked state remain with
            // its content below, matching Notion (#240).
            if (
              $isListItemNode(listItem) &&
              $isCaretAtListItemStart(listItem, anchorNode, selection.anchor.offset) &&
              $insertMatchingChecklistItemBefore(listItem)
            ) {
              event.preventDefault()
              return true
            }

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

        // Backspace at the start of a list item → convert it back to a
        // paragraph in place (Notion-style), rather than merging up (#222).
        // Guard on offset === 0 first so mid-text backspaces (the common case)
        // skip the ancestor walk entirely.
        if (key === "Backspace" && !isModifier && !shiftKey) {
          const selection = $getSelection()
          if (
            $isRangeSelection(selection) &&
            selection.isCollapsed() &&
            selection.anchor.offset === 0
          ) {
            const anchorNode = selection.anchor.getNode()
            const listItem = $findMatchingParent(anchorNode, $isListItemNode)
            if (
              $isListItemNode(listItem) &&
              $isCaretAtListItemStart(listItem, anchorNode, 0) &&
              exitListItemToParagraph(editor, listItem, event)
            ) {
              return true
            }
          }
        }

        // End / Home — normalize macOS, which defaults to scroll-to-end-of-document
        // instead of moving the caret. Selection.modify('lineboundary') handles
        // visually-wrapped lines correctly on all platforms.
        if ((key === "End" || key === "Home") && !isModifier) {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return false
          event.preventDefault()
          const domSelection = window.getSelection()
          domSelection?.modify(
            shiftKey ? "extend" : "move",
            key === "End" ? "forward" : "backward",
            "lineboundary"
          )
          return true
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

        // Cmd/Ctrl + Shift + H = Highlight
        if (key === "h" && shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "highlight")
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
