"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical"

import { useEditorPreferencesStore } from "@/renderer/editor-preferences-store"

const DIM = "editor-focus-dim"
const ACTIVE = "editor-focus-active"

function clearFocusClasses(editor: LexicalEditor): void {
  editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) {
      editor.getElementByKey(child.getKey())?.classList.remove(DIM, ACTIVE)
    }
  })
}

/**
 * Focus mode: dim every top-level block except the one containing the caret.
 * Defaults off, so it only touches the DOM while enabled.
 */
export function FocusModePlugin(): null {
  const [editor] = useLexicalComposerContext()
  const focusMode = useEditorPreferencesStore((s) => s.focusMode)

  useEffect(() => {
    if (!focusMode) {
      clearFocusClasses(editor)
      return
    }

    const apply = () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        const activeKey = $isRangeSelection(selection)
          ? selection.anchor.getNode().getTopLevelElement()?.getKey() ?? null
          : null

        for (const child of $getRoot().getChildren()) {
          const element = editor.getElementByKey(child.getKey())
          if (!element) continue
          const isActive = child.getKey() === activeKey
          element.classList.toggle(DIM, !isActive && activeKey !== null)
          element.classList.toggle(ACTIVE, isActive)
        }
      })
    }

    apply()
    const unregister = editor.registerUpdateListener(apply)
    return () => {
      unregister()
      clearFocusClasses(editor)
    }
  }, [editor, focusMode])

  return null
}
