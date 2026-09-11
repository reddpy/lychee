"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getSelection, $isRangeSelection } from "lexical"

import { useEditorPreferencesStore } from "@/renderer/editor-preferences-store"

/**
 * Typewriter mode: keep the caret's line vertically centered in the viewport
 * when the selection moves. Defaults off — it deliberately drives scrolling,
 * which is otherwise managed by the per-tab scroll restoration.
 */
export function TypewriterPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const typewriterMode = useEditorPreferencesStore((s) => s.typewriterMode)
  const reduceMotion = useEditorPreferencesStore((s) => s.reduceMotion)

  useEffect(() => {
    if (!typewriterMode) return

    const unregister = editor.registerUpdateListener(
      ({ editorState, prevEditorState }) => {
        const moved = editorState.read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return null
          const anchor = selection.anchor
          return { key: anchor.getNode().getKey(), offset: anchor.offset }
        })
        if (!moved) return

        const previous = prevEditorState.read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return null
          const anchor = selection.anchor
          return { key: anchor.getNode().getKey(), offset: anchor.offset }
        })
        if (previous && previous.key === moved.key && previous.offset === moved.offset) {
          return
        }

        requestAnimationFrame(() => {
          editor.getEditorState().read(() => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return
            const element = editor.getElementByKey(selection.anchor.getNode().getKey())
            element?.scrollIntoView({
              block: "center",
              behavior: reduceMotion ? "auto" : "smooth",
            })
          })
        })
      },
    )

    return unregister
  }, [editor, typewriterMode, reduceMotion])

  return null
}
