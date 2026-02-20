"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isParagraphNode,
  LexicalNode,
  NodeMutation,
} from "lexical"
import { HeadingNode, $isHeadingNode, QuoteNode, $isQuoteNode } from "@lexical/rich-text"
import { ListItemNode, $isListItemNode, $isListNode } from "@lexical/list"
import { $isTitleNode } from "@/components/editor/nodes/title-node"
import { mergeRegister } from "@lexical/utils"

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

function syncPlaceholderForMutations(
  mutations: Map<string, NodeMutation>,
  editor: ReturnType<typeof useLexicalComposerContext>[0]
): void {
  editor.getEditorState().read(() => {
    for (const [key, mutation] of mutations) {
      if (mutation === "destroyed") continue

      const node = $getNodeByKey(key)
      if (!node) continue

      const dom = editor.getElementByKey(key)
      if (!dom) continue

      const placeholder = getPlaceholderText(node)
      if (!placeholder) continue

      const isEmpty = node.getTextContent().length === 0
      if (isEmpty) {
        dom.classList.add(PLACEHOLDER_CLASS)
        dom.setAttribute("data-placeholder", placeholder)
      } else {
        dom.classList.remove(PLACEHOLDER_CLASS)
        dom.removeAttribute("data-placeholder")
      }
    }
  })
}

export function BlockPlaceholderPlugin(): null {
  const [editor] = useLexicalComposerContext()

  // Persistent placeholders via mutation listeners — fire after DOM reconciliation
  useEffect(() => {
    return mergeRegister(
      editor.registerMutationListener(HeadingNode, (mutations) => {
        syncPlaceholderForMutations(mutations, editor)
      }),
      editor.registerMutationListener(QuoteNode, (mutations) => {
        syncPlaceholderForMutations(mutations, editor)
      }),
      editor.registerMutationListener(ListItemNode, (mutations) => {
        syncPlaceholderForMutations(mutations, editor)
      })
    )
  }, [editor])

  // Focus-based placeholder for paragraphs only
  useEffect(() => {
    let prevParagraphDom: HTMLElement | null = null

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        // Clear previous paragraph placeholder
        if (prevParagraphDom) {
          prevParagraphDom.classList.remove(PLACEHOLDER_CLASS)
          prevParagraphDom.removeAttribute("data-placeholder")
          prevParagraphDom = null
        }

        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

        const anchorNode = selection.anchor.getNode()
        const topElement = anchorNode.getTopLevelElement()

        if (
          topElement &&
          $isParagraphNode(topElement) &&
          topElement.getTextContent().length === 0
        ) {
          const dom = editor.getElementByKey(topElement.getKey())
          if (dom) {
            dom.classList.add(PLACEHOLDER_CLASS)
            dom.setAttribute("data-placeholder", getPlaceholderText(topElement)!)
            prevParagraphDom = dom
          }
        }
      })
    })
  }, [editor])

  return null
}
