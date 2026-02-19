"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection,
  $isRangeSelection,
  $isParagraphNode,
  LexicalNode,
} from "lexical"
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text"
import { $isListItemNode, $isListNode } from "@lexical/list"
import { $isTitleNode } from "@/components/editor/nodes/title-node"

const PLACEHOLDER_CLASS = "is-placeholder"

function getPlaceholderText(node: LexicalNode): string | null {
  if ($isTitleNode(node)) return null
  if ($isParagraphNode(node)) return "Type something, or press '/' for commands..."
  if ($isHeadingNode(node)) {
    const tag = node.getTag()
    if (tag === "h1") return "Heading 1"
    if (tag === "h2") return "Heading 2"
    if (tag === "h3") return "Heading 3"
    return "Heading"
  }
  if ($isQuoteNode(node)) return "Enter a quote..."
  if ($isListItemNode(node)) {
    const listParent = node.getParent()
    if (listParent && $isListNode(listParent) && listParent.getListType() === "check") return "To-do"
    return "List item"
  }
  return null
}

export function BlockPlaceholderPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = editor.getRootElement()
        if (!root) return

        // Remove placeholder from any previous element
        const prev = root.querySelector(`.${PLACEHOLDER_CLASS}:not(.editor-title)`)
        if (prev) {
          prev.classList.remove(PLACEHOLDER_CLASS)
          prev.removeAttribute("data-placeholder")
        }

        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

        const anchorNode = selection.anchor.getNode()

        // For list items, walk up to the ListItemNode (not top-level)
        let block: LexicalNode | null = null
        let current: LexicalNode | null = anchorNode
        while (current) {
          if ($isListItemNode(current)) {
            block = current
            break
          }
          current = current.getParent()
        }

        // For non-list nodes, use top-level element
        if (!block) {
          block = anchorNode.getTopLevelElement()
        }

        if (!block || block.getTextContent().length > 0) return

        const placeholder = getPlaceholderText(block)
        if (!placeholder) return

        const dom = editor.getElementByKey(block.getKey())
        if (dom) {
          dom.classList.add(PLACEHOLDER_CLASS)
          dom.setAttribute("data-placeholder", placeholder)
        }
      })
    })
  }, [editor])

  return null
}
