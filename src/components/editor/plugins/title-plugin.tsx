"use client"

import { useEffect, useRef } from "react"
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
import { $createTitleNode, $isTitleNode } from "../nodes/title-node"

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

      // Set initial placeholder state
      const titleNode = $getRoot().getFirstChild()
      if ($isTitleNode(titleNode)) {
        const titleDom = editor.getElementByKey(titleNode.getKey())
        if (titleDom) {
          titleDom.classList.toggle("is-placeholder", titleNode.getTextContent().length === 0)
        }
      }
    })
  }, [editor, initialTitle])

  // Listen for changes to sync title and toggle placeholder
  const prevTitleRef = useRef(initialTitle ?? "")
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot()
        const firstChild = root.getFirstChild()

        if ($isTitleNode(firstChild)) {
          const titleText = firstChild.getTextContent()
          if (titleText !== prevTitleRef.current) {
            prevTitleRef.current = titleText
            onTitleChange?.(titleText)

            // Defer DOM class toggle to next frame to avoid blocking the keystroke
            const key = firstChild.getKey()
            const isEmpty = titleText.length === 0
            requestAnimationFrame(() => {
              const titleDom = editor.getElementByKey(key)
              if (titleDom) {
                titleDom.classList.toggle("is-placeholder", isEmpty)
              }
            })
          }
        }
      })
    })
  }, [editor, onTitleChange])

  // Prevent Backspace at start of title from doing anything weird
  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        const anchorNode = selection.anchor.getNode()
        const topElement = anchorNode.getTopLevelElement()

        if ($isTitleNode(topElement)) {
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
    )
  }, [editor])

  return null
}
