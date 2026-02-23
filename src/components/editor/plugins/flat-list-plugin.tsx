"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DELETE_CHARACTER_COMMAND,
  INDENT_CONTENT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalNode,
} from "lexical"
import {
  $isListItemNode,
  ListItemNode,
} from "@/components/editor/nodes/list-item-node"

const MAX_INDENT = 6

/** Walk ancestors from `node` to find the nearest ListItemNode. */
function $findListItemAncestor(node: LexicalNode | null): ListItemNode | null {
  let walk: LexicalNode | null = node
  while (walk) {
    if ($isListItemNode(walk)) return walk
    walk = walk.getParent()
  }
  return null
}

/** Collect all unique ListItemNodes touched by the current selection. */
function $getSelectedListItems(): ListItemNode[] {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return []

  const items: ListItemNode[] = []
  const seen = new Set<string>()
  for (const node of selection.getNodes()) {
    const item = $findListItemAncestor(node)
    if (item && !seen.has(item.getKey())) {
      seen.add(item.getKey())
      items.push(item)
    }
  }
  return items
}

/**
 * FlatListPlugin — replaces ListPlugin + CheckListPlugin.
 *
 * Handles:
 *  1. Enter on empty list item → outdent or convert to paragraph
 *  2. Tab/Shift+Tab → indent/outdent list items (capped at MAX_INDENT)
 *  3. Backspace at start → outdent or convert to paragraph
 *  4. Checkbox click → toggle checked
 *  5. Ordered-list numbering via data-ordinal attribute
 */
export function FlatListPlugin(): null {
  const [editor] = useLexicalComposerContext()

  // ── Enter inside a list item ─────────────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false
        }

        const listItem = $findListItemAncestor(selection.anchor.getNode())
        if (!listItem) return false

        // Empty list item: outdent or convert to paragraph
        if (listItem.getChildrenSize() === 0) {
          const indent = listItem.getIndent()
          if (indent > 0) {
            listItem.setIndent(indent - 1)
          } else {
            const paragraph = $createParagraphNode()
            paragraph
              .setTextStyle(selection.style)
              .setTextFormat(selection.format)
            listItem.replace(paragraph)
            paragraph.select()
          }
          return true
        }

        // Non-empty: let Lexical split, then clean up AutoLinkNode duplicates
        const nextKey = listItem.getNextSibling()?.getKey() ?? null
        selection.insertParagraph()

        const sel = $getSelection()
        const cursorListItem = $isRangeSelection(sel)
          ? $findListItemAncestor(sel.anchor.getNode())
          : null

        // Collect new ListItemNodes created between original and nextKey
        const newItems: ListItemNode[] = []
        let sibling = listItem.getNextSibling()
        while (sibling) {
          if (sibling.getKey() === nextKey) break
          if ($isListItemNode(sibling)) newItems.push(sibling)
          sibling = sibling.getNextSibling()
        }

        // If AutoLinkNode created extras, merge them into the cursor's item
        if (newItems.length > 1 && cursorListItem) {
          for (const item of newItems) {
            if (item.getKey() === cursorListItem.getKey()) continue
            for (const child of item.getChildren()) {
              cursorListItem.append(child)
            }
            item.remove()
          }
        }

        return true
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor])

  // ── Backspace at start of list item ──────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      (isBackward: boolean) => {
        if (!isBackward) return false

        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false
        }
        if (selection.anchor.offset !== 0) return false

        const anchor = selection.anchor.getNode()
        const listItem = $findListItemAncestor(anchor)
        if (!listItem) return false

        // Verify cursor is at the very start (each ancestor is the first child)
        if (selection.anchor.type === "text") {
          let node: LexicalNode | null = anchor
          while (node && !node.is(listItem)) {
            if (node !== node.getParent()?.getFirstChild()) return false
            node = node.getParent()
          }
        }

        const indent = listItem.getIndent()
        if (indent > 0) {
          listItem.setIndent(indent - 1)
          return true
        }

        // At indent 0: convert to paragraph
        const paragraph = $createParagraphNode()
        const children = listItem.getChildren()
        children.forEach((child) => paragraph.append(child))
        listItem.replace(paragraph)
        paragraph.select(0, 0)
        return true
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor])

  // ── Tab/Shift+Tab and indent cap ─────────────────────────────────
  useEffect(() => {
    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        const items = $getSelectedListItems()
        if (items.length === 0) return false

        event.preventDefault()
        for (const item of items) {
          const indent = item.getIndent()
          if (event.shiftKey) {
            if (indent > 0) item.setIndent(indent - 1)
          } else {
            if (indent < MAX_INDENT) item.setIndent(indent + 1)
          }
        }
        return true
      },
      COMMAND_PRIORITY_HIGH
    )

    // Guard against non-Tab indent sources (e.g. toolbar) exceeding the cap
    const unregisterIndent = editor.registerCommand(
      INDENT_CONTENT_COMMAND,
      () => {
        const items = $getSelectedListItems()
        return items.some((item) => item.getIndent() >= MAX_INDENT)
      },
      COMMAND_PRIORITY_HIGH
    )

    return () => {
      unregisterTab()
      unregisterIndent()
    }
  }, [editor])

  // ── Checkbox click and pointer-down ───────────────────────────────
  useEffect(() => {
    function handleCheckItemEvent(
      event: MouseEvent | PointerEvent,
      callback: () => void
    ): void {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.classList.contains("list-item--check")) return

      const rect = target.getBoundingClientRect()
      const checkboxWidth = 18
      const padding = (event as PointerEvent).pointerType === "touch" ? 32 : 4

      if (
        event.clientX > rect.left - padding &&
        event.clientX < rect.left + checkboxWidth + padding
      ) {
        callback()
      }
    }

    function handleClick(event: MouseEvent): void {
      handleCheckItemEvent(event, () => {
        const target = event.target as HTMLElement | null
        if (!target) return

        if (editor.isEditable()) {
          editor.update(() => {
            const lexicalNode = $getNearestNodeFromDOMNode(target)
            if ($isListItemNode(lexicalNode)) {
              target.focus()
              lexicalNode.toggleChecked()
            }
          })
        }
      })
    }

    function handlePointerDown(event: PointerEvent): void {
      handleCheckItemEvent(event, () => {
        event.preventDefault()
      })
    }

    return editor.registerRootListener((rootElement, prevElement) => {
      if (rootElement !== null) {
        rootElement.addEventListener("click", handleClick)
        rootElement.addEventListener("pointerdown", handlePointerDown)
      }
      if (prevElement !== null) {
        prevElement.removeEventListener("click", handleClick)
        prevElement.removeEventListener("pointerdown", handlePointerDown)
      }
    })
  }, [editor])

  // ── Ordered list numbering ────────────────────────────────────────
  useEffect(() => {
    return editor.registerMutationListener(ListItemNode, (mutations) => {
      editor.getEditorState().read(() => {
        updateOrdinalsForMutations(mutations, editor)
      })
    })
  }, [editor])

  return null
}

/**
 * Recompute ordinals for numbered list items affected by mutations.
 * Skips non-number items early and avoids redundant DOM writes.
 */
function updateOrdinalsForMutations(
  mutations: Map<string, "created" | "updated" | "destroyed">,
  editor: ReturnType<typeof useLexicalComposerContext>[0]
): void {
  const visited = new Set<string>()

  for (const [key, mutation] of mutations) {
    if (mutation === "destroyed") continue

    const node = $getNodeByKey(key)
    if (!$isListItemNode(node) || node.getListType() !== "number") continue

    let current: ListItemNode | null = node
    while (current !== null) {
      const k = current.getKey()
      if (visited.has(k)) break
      visited.add(k)

      const dom = editor.getElementByKey(k)
      if (dom) {
        const newOrdinal = formatOrdinal(computeOrdinal(current), current.getIndent())
        if (dom.getAttribute("data-ordinal") !== newOrdinal) {
          dom.setAttribute("data-ordinal", newOrdinal)
        }
      }

      const next = current.getNextSibling()
      if (
        $isListItemNode(next) &&
        next.getListType() === "number" &&
        next.getIndent() >= node.getIndent()
      ) {
        current = next
      } else {
        break
      }
    }
  }
}

function computeOrdinal(node: ListItemNode): number {
  const indent = node.getIndent()
  let ordinal = 1
  let sibling = node.getPreviousSibling()

  while (sibling !== null) {
    if (!$isListItemNode(sibling)) break
    if (sibling.getListType() !== "number") break
    if (sibling.getIndent() < indent) break
    if (sibling.getIndent() === indent) ordinal++
    sibling = sibling.getPreviousSibling()
  }

  return ordinal
}

/**
 * Format ordinal by indent level:
 *   0, 3: decimal (1, 2, 3)
 *   1, 4: letter  (a, b, c)
 *   2, 5: roman   (i, ii, iii)
 */
function formatOrdinal(ordinal: number, indent: number): string {
  switch (indent % 3) {
    case 1:
      return toLetter(ordinal)
    case 2:
      return toRoman(ordinal)
    default:
      return String(ordinal)
  }
}

function toLetter(n: number): string {
  let result = ""
  while (n > 0) {
    n--
    result = String.fromCharCode(97 + (n % 26)) + result
    n = Math.floor(n / 26)
  }
  return result
}

function toRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
  const syms = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"]
  let result = ""
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) {
      result += syms[i]
      n -= vals[i]
    }
  }
  return result
}
