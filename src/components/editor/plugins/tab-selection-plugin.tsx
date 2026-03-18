import { useLayoutEffect, useRef } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createRangeSelection,
  $getSelection,
  $isRangeSelection,
  $setSelection,
} from "lexical"

type SavedSelection = {
  anchorKey: string
  anchorOffset: number
  anchorType: "text" | "element"
  focusKey: string
  focusOffset: number
  focusType: "text" | "element"
}

/**
 * Saves and restores the Lexical selection per tabId when switching between
 * duplicate tabs that share a single editor instance.
 *
 * On deactivation: reads the current RangeSelection and stashes it keyed by tabId.
 * On activation: restores the stashed selection (or clears it if none saved).
 */
export function TabSelectionPlugin({
  activeTabId,
}: {
  activeTabId: string | null
}): null {
  const [editor] = useLexicalComposerContext()
  const prevTabId = useRef<string | null>(null)
  const cache = useRef<Map<string, SavedSelection | null>>(new Map())

  useLayoutEffect(() => {
    const prev = prevTabId.current
    const curr = activeTabId
    if (prev === curr) return
    prevTabId.current = curr

    // Save outgoing tab's selection
    if (prev != null) {
      editor.getEditorState().read(() => {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) {
          cache.current.set(prev, {
            anchorKey: sel.anchor.key,
            anchorOffset: sel.anchor.offset,
            anchorType: sel.anchor.type,
            focusKey: sel.focus.key,
            focusOffset: sel.focus.offset,
            focusType: sel.focus.type,
          })
        } else {
          cache.current.set(prev, null)
        }
      })
    }

    // Restore incoming tab's selection
    if (curr != null) {
      const saved = cache.current.get(curr)
      const editorRoot = editor.getRootElement()
      const hadFocusBefore = editorRoot
        ? editorRoot === document.activeElement || editorRoot.contains(document.activeElement)
        : false
      editor.update(
        () => {
          if (!saved) {
            $setSelection(null)
            return
          }
          try {
            const sel = $createRangeSelection()
            sel.anchor.set(saved.anchorKey, saved.anchorOffset, saved.anchorType)
            sel.focus.set(saved.focusKey, saved.focusOffset, saved.focusType)
            $setSelection(sel)
          } catch {
            $setSelection(null)
          }
        },
        {
          tag: "history-merge",
          onUpdate: hadFocusBefore
            ? undefined
            : () => {
                const root = editor.getRootElement()
                if (root && (root === document.activeElement || root.contains(document.activeElement))) {
                  root.blur()
                }
              },
        },
      )
    }
  }, [activeTabId, editor])

  return null
}
