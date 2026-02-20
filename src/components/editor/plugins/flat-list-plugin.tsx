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

  // ── Enter on empty list item ──────────────────────────────────────
  useEffect(() => {
    return editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false
        }

        const anchor = selection.anchor.getNode()
        // Walk up to find the list item (anchor could be a TextNode child)
        const listItem = $isListItemNode(anchor)
          ? anchor
          : $isListItemNode(anchor.getParent())
            ? (anchor.getParent() as ListItemNode)
            : null

        if (!listItem || listItem.getChildrenSize() !== 0) {
          return false
        }

        // Empty list item
        const indent = listItem.getIndent()

        if (indent > 0) {
          // Outdent
          listItem.setIndent(indent - 1)
        } else {
          // Convert to paragraph
          const paragraph = $createParagraphNode()
          paragraph
            .setTextStyle(selection.style)
            .setTextFormat(selection.format)
          listItem.replace(paragraph)
          paragraph.select()
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
        const listItem = $isListItemNode(anchor)
          ? anchor
          : $isListItemNode(anchor.getParent())
            ? (anchor.getParent() as ListItemNode)
            : null

        if (!listItem) return false

        // Only handle when cursor is at the very start of the list item
        if (selection.anchor.type === "text") {
          const firstChild = listItem.getFirstChild()
          if (!firstChild || !anchor.is(firstChild)) return false
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

      // Compute the ::before width (the checkbox area)
      const beforeStyles = window.getComputedStyle(target, "::before")
      const beforeWidth = parseFloat(beforeStyles.width) || 18

      // Allow a bit of padding for easier clicking
      const padding = (event as PointerEvent).pointerType === "touch" ? 32 : 4

      if (
        clientX > rect.left - padding &&
        clientX < rect.left + beforeWidth + padding
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
