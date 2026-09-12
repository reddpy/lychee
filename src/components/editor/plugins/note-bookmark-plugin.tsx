"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical"
import { $isListItemNode } from "@lexical/list"
import { $isCodeNode } from "@lexical/code"
import { $findMatchingParent } from "@lexical/utils"

import {
  $createNoteBookmarkNode,
  $isNoteBookmarkNode,
  type NoteBookmarkNode,
} from "@/components/editor/nodes/note-bookmark-node"
import { $isTitleNode } from "@/components/editor/nodes/title-node"

/** Toggle a bookmark on the block that currently owns the selection. */
export const TOGGLE_NOTE_BOOKMARK_COMMAND = createCommand<void>(
  "TOGGLE_NOTE_BOOKMARK",
)

/** Remove the bookmark node with the given key. */
export const REMOVE_NOTE_BOOKMARK_COMMAND = createCommand<NodeKey>(
  "REMOVE_NOTE_BOOKMARK",
)

const MAX_LABEL_LENGTH = 120

/**
 * Find the block that should own a bookmark for `node`. List items are their
 * own block; everything else falls back to the top-level element. Code blocks
 * and the note title can't hold an inline marker, so they're excluded.
 */
export function $getBookmarkBlock(node: LexicalNode): ElementNode | null {
  const listItem = $findMatchingParent(node, $isListItemNode)
  if (listItem) return listItem

  const top = node.getTopLevelElement()
  if (top && $isElementNode(top) && !$isCodeNode(top) && !$isTitleNode(top)) {
    return top
  }
  return null
}

/** Resolve the block a bookmark marker lives in (its direct parent). */
export function $getBookmarkBlockForNode(
  bookmark: NoteBookmarkNode,
): ElementNode | null {
  const parent = bookmark.getParent()
  if (parent && $isElementNode(parent) && !$isCodeNode(parent) && !$isTitleNode(parent)) {
    return parent
  }
  return null
}

export function $findBookmarkInBlock(
  block: ElementNode,
): NoteBookmarkNode | undefined {
  return block.getChildren().find($isNoteBookmarkNode)
}

export function $isBlockBookmarked(block: ElementNode): boolean {
  return $findBookmarkInBlock(block) !== undefined
}

function $bookmarkLabel(block: ElementNode, selectionText: string): string {
  const source = selectionText.trim() || block.getTextContent().trim()
  const collapsed = source.replace(/\s+/g, " ").slice(0, MAX_LABEL_LENGTH)
  return collapsed || "Bookmark"
}

/** Toggle a bookmark for the current selection. Returns true when handled. */
export function $toggleBookmarkForSelection(): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false

  const block = $getBookmarkBlock(selection.anchor.getNode())
  if (!block) return false

  const existing = $findBookmarkInBlock(block)
  if (existing) {
    existing.remove()
    return true
  }

  const label = $bookmarkLabel(block, selection.getTextContent())
  block.splice(0, 0, [$createNoteBookmarkNode({ label })])
  return true
}

/**
 * Keeps bookmark markers in sync with the editor: registers the toggle/remove
 * commands and routes the native "Bookmark block" context-menu action to the
 * active tab's editor.
 */
export function NoteBookmarkPlugin({ isActive }: { isActive: boolean }): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const removeToggle = editor.registerCommand(
      TOGGLE_NOTE_BOOKMARK_COMMAND,
      () => {
        let changed = false
        editor.update(() => {
          changed = $toggleBookmarkForSelection()
        })
        return changed
      },
      COMMAND_PRIORITY_EDITOR,
    )

    const removeRemove = editor.registerCommand(
      REMOVE_NOTE_BOOKMARK_COMMAND,
      (key) => {
        let removed = false
        editor.update(() => {
          const node = $getNodeByKey(key)
          if ($isNoteBookmarkNode(node)) {
            node.remove()
            removed = true
          }
        })
        return removed
      },
      COMMAND_PRIORITY_EDITOR,
    )

    return () => {
      removeToggle()
      removeRemove()
    }
  }, [editor])

  useEffect(() => {
    if (!isActive) return
    return window.lychee.on("context-menu:bookmark-block", () => {
      editor.dispatchCommand(TOGGLE_NOTE_BOOKMARK_COMMAND, undefined)
    })
  }, [editor, isActive])

  return null
}

/** Exposed for the drawer: remove a bookmark by node key. */
export function removeBookmarkByKey(editor: LexicalEditor, key: NodeKey): void {
  editor.dispatchCommand(REMOVE_NOTE_BOOKMARK_COMMAND, key)
}
