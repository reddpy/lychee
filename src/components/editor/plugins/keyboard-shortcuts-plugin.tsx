"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_NORMAL,
  KEY_DOWN_COMMAND,
} from "lexical"
import { OPEN_LINK_EDITOR_COMMAND } from "./link-editor-plugin"

export function KeyboardShortcutsPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        const { key, metaKey, ctrlKey, shiftKey } = event
        const isModifier = metaKey || ctrlKey

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
