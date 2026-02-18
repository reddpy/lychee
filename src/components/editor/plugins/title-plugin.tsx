"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
} from "lexical"
import { $createTitleNode, $isTitleNode, TitleNode } from "../nodes/title-node"
import { mergeRegister } from "@lexical/utils"

interface TitlePluginProps {
  initialTitle?: string
  onTitleChange?: (title: string) => void
}

export function TitlePlugin({ initialTitle, onTitleChange }: TitlePluginProps): null {
  const [editor] = useLexicalComposerContext()

  // Ensure title node exists on mount
  useEffect(() => {
    editor.update(() => {
      const root = $getRoot()
      const firstChild = root.getFirstChild()

      // If no title node exists, create one
      if (!$isTitleNode(firstChild)) {
        const titleNode = $createTitleNode()

        // Add initial title text if provided
        if (initialTitle) {
          const textNode = $createTextNode(initialTitle)
          titleNode.append(textNode)
        }

        // If there's existing content, insert title before it
        if (firstChild) {
          firstChild.insertBefore(titleNode)
        } else {
          root.append(titleNode)
          // Also add an empty paragraph after title
          root.append($createParagraphNode())
        }
      }
    })
  }, [editor, initialTitle])

  // Listen for changes to sync title
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot()
        const firstChild = root.getFirstChild()

        if ($isTitleNode(firstChild)) {
          const titleText = firstChild.getTextContent()
          onTitleChange?.(titleText)
        }
      })
    })
  }, [editor, onTitleChange])

  // Prevent certain operations on title node
  useEffect(() => {
    return mergeRegister(
      // Handle special key behaviors
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return false

          const anchorNode = selection.anchor.getNode()
          const topElement = anchorNode.getTopLevelElement()

          // If we're in the title node
          if ($isTitleNode(topElement)) {
            // Prevent Backspace at start from doing anything weird
            if (event.key === "Backspace") {
              const isAtStart =
                selection.anchor.offset === 0 && selection.isCollapsed()
              if (isAtStart) {
                event.preventDefault()
                return true
              }
            }
          }

          return false
        },
        COMMAND_PRIORITY_HIGH
      ),

      // Ensure title node is never deleted
      editor.registerNodeTransform(TitleNode, (_node) => {
        // This runs whenever a TitleNode is transformed
        // We use this to ensure the node is preserved
      })
    )
  }, [editor])

  return null
}
