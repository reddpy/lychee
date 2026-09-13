import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $isListItemNode, $isListNode } from "@lexical/list"
import { $getSelection, $isRangeSelection, TextNode } from "lexical"

const CHECKLIST_MARKER = /^\[([ xX])\]\s/

/**
 * Turns a bullet list item that starts with a markdown task marker into a real
 * checklist item.
 *
 * Lexical's `UNORDERED_LIST` shortcut fires on `- ` before `[ ]` is typed, so by
 * the time the marker lands the text is already inside a list item and the
 * normal markdown shortcut pipeline (which only runs at the document root) can
 * no longer see it. `registerCheckList` only handles clicks/space, not markdown.
 * This transform closes that gap: `- [ ] task` / `- [x] task` (also `*`/`+`)
 * become a `check` list with the marker stripped and the checked state set.
 *
 * Guarded to an active collapsed selection so merely opening a note does not
 * silently rewrite stored content.
 */
export function applyChecklistShortcut(node: TextNode): void {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
  if (selection.anchor.getNode() !== node) return

  const listItem = node.getParent()
  if (!$isListItemNode(listItem)) return
  const list = listItem.getParent()
  if (!$isListNode(list) || list.getListType() !== "bullet") return
  if (listItem.getFirstChild() !== node) return

  const text = node.getTextContent()
  const match = CHECKLIST_MARKER.exec(text)
  if (!match) return

  node.setTextContent(text.slice(match[0].length))
  list.setListType("check")
  listItem.setChecked(match[1].toLowerCase() === "x")
}

export function ChecklistShortcutPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerNodeTransform(TextNode, applyChecklistShortcut)
  }, [editor])

  return null
}
