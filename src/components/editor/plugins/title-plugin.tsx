"use client"

import { useEffect, useRef } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
} from "lexical"
import { $createTitleNode, $isTitleNode, TitleNode } from "../nodes/title-node"

interface TitlePluginProps {
  initialTitle?: string
  onTitleChange?: (title: string) => void
}

const PLACEHOLDER_CLASS = "is-placeholder"

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

  // Toggle is-placeholder on TitleNode lifecycle (create/update). Mutation
  // listeners fire after DOM reconciliation, so getElementByKey is safe here —
  // unlike inside editor.update(), where the DOM for nodes created in the same
  // batch hasn't been committed yet (Lexical defers $commitPendingUpdates to a
  // microtask). registerMutationListener also fires immediately with `created`
  // for any TitleNode already mounted in the DOM at registration time, which
  // covers the reloaded-note path (node imported from JSON before the plugin's
  // effect runs).
  useEffect(() => {
    return editor.registerMutationListener(TitleNode, (mutations) => {
      editor.getEditorState().read(() => {
        for (const [key, mutation] of mutations) {
          if (mutation === "destroyed") continue
          const node = $getNodeByKey(key)
          if (!$isTitleNode(node)) continue
          const dom = editor.getElementByKey(key)
          if (!dom) continue
          dom.classList.toggle(PLACEHOLDER_CLASS, node.getTextContent().length === 0)
        }
      })
    })
  }, [editor])

  // Typing into the TitleNode mutates a child TextNode, which does not fire a
  // mutation on the TitleNode itself — so the placeholder toggle for the
  // text-change case lives here. prevTitleRef gates the work so we only touch
  // the DOM when the text actually changes.
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
                titleDom.classList.toggle(PLACEHOLDER_CLASS, isEmpty)
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
