"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  DELETE_CHARACTER_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  type LexicalNode,
} from "lexical"
import {
  $isListItemNode,
  ListItemNode,
} from "@/components/editor/nodes/list-item-node"

/**
 * FlatListPlugin — replaces ListPlugin + CheckListPlugin.
 *
 * Handles:
 *  1. Enter on empty list item → outdent or convert to paragraph
 *  2. Checkbox click → toggle checked
 *  3. Pointer-down on checkbox → prevent caret move
 *  4. Ordered-list numbering via data-ordinal attribute
 */
export function FlatListPlugin(): null {
  const [editor] = useLexicalComposerContext()

  // ── Enter inside a list item ─────────────────────────────────────
  // Handles both empty (outdent/convert) and non-empty (split) cases.
  // For non-empty items we let Lexical's insertParagraph() do the heavy
  // lifting (text splits, inline element splits) then clean up any empty
  // duplicate ListItemNodes caused by AutoLinkNode's insertNewAfter
  // delegating to the parent block during $splitNodeAtPoint.
  useEffect(() => {
    return editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false
        }

        // Walk up from anchor to find the enclosing list item
        let listItem: ListItemNode | null = null
        let walk: LexicalNode | null = selection.anchor.getNode()
        while (walk) {
          if ($isListItemNode(walk)) { listItem = walk; break }
          walk = walk.getParent()
        }
        if (!listItem) return false

        // ── Empty list item: outdent or convert to paragraph ──
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

        // ── Non-empty list item: let Lexical split, then clean up ──
        // Snapshot the next sibling key so we know where the original
        // neighbors end (anything between listItem and nextKey is new).
        const nextKey = listItem.getNextSibling()?.getKey() ?? null

        // Let Lexical's insertParagraph handle all the complex inline
        // splitting (text nodes, link nodes, etc.)
        selection.insertParagraph()

        // Clean up: AutoLinkNode.insertNewAfter may have created extra
        // ListItemNodes between the original and the pre-existing next sibling.
        // A normal split should produce exactly 1 new ListItemNode. If there
        // are 2+, merge the extras into the cursor's item then remove them.
        const sel = $getSelection()
        let cursorListItem: ListItemNode | null = null
        if ($isRangeSelection(sel)) {
          let cursorWalk: LexicalNode | null = sel.anchor.getNode()
          while (cursorWalk) {
            if ($isListItemNode(cursorWalk)) {
              cursorListItem = cursorWalk
              break
            }
            cursorWalk = cursorWalk.getParent()
          }
        }

        // Collect all new ListItemNodes created between original and nextKey
        const newItems: ListItemNode[] = []
        let sibling = listItem.getNextSibling()
        while (sibling) {
          if (sibling.getKey() === nextKey) break
          if ($isListItemNode(sibling)) {
            newItems.push(sibling)
          }
          sibling = sibling.getNextSibling()
        }

        // If more than 1 new item, merge extras into the cursor's item
        if (newItems.length > 1 && cursorListItem) {
          for (const item of newItems) {
            if (item.getKey() === cursorListItem.getKey()) continue
            // Move children into cursor's item
            const children = item.getChildren()
            for (const child of children) {
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
  // Must intercept DELETE_CHARACTER_COMMAND before the default handler
  // (COMMAND_PRIORITY_EDITOR) because Lexical's caret-based merge system
  // in deleteCharacter() merges with the previous sibling block before
  // collapseAtStart() is ever called.
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

        // Walk up to find the enclosing list item (anchor may be deeply nested,
        // e.g. TextNode inside LinkNode inside ListItemNode).
        let listItem: ListItemNode | null = null
        let walk: LexicalNode | null = anchor
        while (walk) {
          if ($isListItemNode(walk)) { listItem = walk; break }
          walk = walk.getParent()
        }
        if (!listItem) return false

        // Only handle when cursor is at the very start of the list item.
        // Walk from the anchor back up to the list item, verifying each node
        // is the first child of its parent (i.e. nothing precedes the cursor).
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

  // ── Checkbox click and pointer-down ───────────────────────────────
  useEffect(() => {
    function handleCheckItemEvent(
      event: MouseEvent | PointerEvent,
      callback: () => void
    ): void {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      // Only handle check-type list items
      if (!target.classList.contains("list-item--check")) return

      const rect = target.getBoundingClientRect()
      const clientX = event.clientX

      // Checkbox ::before is always 18px wide (defined in editor-theme.css)
      const checkboxWidth = 18
      const padding = (event as PointerEvent).pointerType === "touch" ? 32 : 4

      if (
        clientX > rect.left - padding &&
        clientX < rect.left + checkboxWidth + padding
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
        // Prevent caret from moving when clicking checkbox
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
 * When a numbered list item is created/updated/destroyed, recompute ordinals
 * for the affected run of consecutive numbered siblings.
 */
function updateOrdinalsForMutations(
  mutations: Map<string, "created" | "updated" | "destroyed">,
  editor: ReturnType<typeof useLexicalComposerContext>[0]
): void {
  const visited = new Set<string>()

  for (const [key, mutation] of mutations) {
    if (mutation === "destroyed") continue

    const node = $getNodeByKey(key)
    if (!$isListItemNode(node)) continue
    if (node.getListType() !== "number") continue

    // Walk forward from this node to update the entire run
    let current: ListItemNode | null = node
    while (current !== null) {
      const k = current.getKey()
      if (visited.has(k)) break
      visited.add(k)

      const dom = editor.getElementByKey(k)
      if (dom) {
        dom.setAttribute("data-ordinal", String(computeOrdinal(current)))
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

/**
 * Compute the ordinal (1, 2, 3, ...) for a numbered list item by counting
 * consecutive preceding siblings of type "number" at the same indent level.
 */
function computeOrdinal(node: ListItemNode): number {
  const indent = node.getIndent()
  let ordinal = 1
  let sibling = node.getPreviousSibling()

  while (sibling !== null) {
    if (!$isListItemNode(sibling)) break
    if (sibling.getListType() !== "number") break
    if (sibling.getIndent() < indent) break
    if (sibling.getIndent() === indent) {
      ordinal++
    }
    // If sibling indent > our indent, skip it (it's a sub-item)
    sibling = sibling.getPreviousSibling()
  }

  return ordinal
}
