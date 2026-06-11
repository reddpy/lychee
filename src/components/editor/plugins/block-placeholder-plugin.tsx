"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isParagraphNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  LexicalNode,
  NodeMutation,
} from "lexical"
import { HeadingNode, $isHeadingNode, QuoteNode, $isQuoteNode } from "@lexical/rich-text"
import { $isTitleNode } from "@/components/editor/nodes/title-node"
import {
  ListItemNode,
  $isListItemNode,
  $isListNode,
} from "@lexical/list"
import { $isTableCellNode } from "@lexical/table"
import { mergeRegister } from "@lexical/utils"

const PLACEHOLDER_CLASS = "is-placeholder"

function getPlaceholderText(node: LexicalNode): string | null {
  if ($isTitleNode(node)) return null
  if ($isParagraphNode(node)) {
    if ($isTableCellNode(node.getParent())) return "Type or press '/'"
    return "Type something, or press '/' for commands..."
  }
  if ($isHeadingNode(node)) {
    const tag = node.getTag()
    if (tag === "h1") return "Heading 1"
    if (tag === "h2") return "Heading 2"
    if (tag === "h3") return "Heading 3"
    return "Heading"
  }
  if ($isQuoteNode(node)) return "Enter a quote..."
  if ($isListItemNode(node)) {
    const parent = node.getParent()
    if ($isListNode(parent) && parent.getListType() === "check") return "To-do"
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
    let prevKey: string | null = null
    let focusSyncFrame = 0

    const clearPlaceholder = () => {
      if (prevParagraphDom) {
        prevParagraphDom.classList.remove(PLACEHOLDER_CLASS)
        prevParagraphDom.removeAttribute("data-placeholder")
        prevParagraphDom = null
        prevKey = null
      }
    }

    const syncPlaceholder = () => {
      editor.getEditorState().read(() => {
        const root = editor.getRootElement()
        const hasFocus =
          root !== null &&
          (root === document.activeElement || root.contains(document.activeElement))
        const selection = $getSelection()
        if (!hasFocus || !$isRangeSelection(selection) || !selection.isCollapsed()) {
          clearPlaceholder()
          return
        }

        const anchorNode = selection.anchor.getNode()
        const topElement = anchorNode.getTopLevelElement()

        let key = topElement && $isParagraphNode(topElement) && topElement.getTextContent().length === 0
          ? topElement.getKey()
          : null

        // Lexical's selection can briefly lag the DOM during refocus: clicking
        // into a different block leaves the surviving pre-blur selection in
        // place until the click's selectionchange is ingested. Only show the
        // placeholder if the live DOM caret actually sits in that paragraph,
        // otherwise it flashes on the previously-focused empty block.
        if (key) {
          const dom = editor.getElementByKey(key)
          const domAnchor = document.getSelection()?.anchorNode ?? null
          if (!dom || !domAnchor || !dom.contains(domAnchor)) {
            key = null
          }
        }

        // Skip DOM work if same empty paragraph is still focused
        if (key === prevKey) return

        // Clear previous
        if (prevParagraphDom) {
          prevParagraphDom.classList.remove(PLACEHOLDER_CLASS)
          prevParagraphDom.removeAttribute("data-placeholder")
          prevParagraphDom = null
        }
        prevKey = key

        if (key && topElement) {
          const dom = editor.getElementByKey(key)
          if (dom) {
            dom.classList.add(PLACEHOLDER_CLASS)
            dom.setAttribute("data-placeholder", getPlaceholderText(topElement)!)
            prevParagraphDom = dom
          }
        }
      })
    }

    const cancelFocusSync = () => {
      if (focusSyncFrame) {
        cancelAnimationFrame(focusSyncFrame)
        focusSyncFrame = 0
      }
    }

    return mergeRegister(
      editor.registerUpdateListener(() => {
        syncPlaceholder()
      }),
      // Selection survives blur in Lexical, so the update listener alone never
      // clears the placeholder when focus leaves the editor (e.g. Escape).
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          cancelFocusSync()
          clearPlaceholder()
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      // On refocus, Lexical's selection still holds the pre-blur position until
      // the click's selectionchange is ingested. Syncing synchronously here would
      // briefly paint the placeholder on the previously-focused empty paragraph
      // when the click lands in a different block. Defer one frame so we read the
      // settled, post-click selection instead.
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          cancelFocusSync()
          focusSyncFrame = requestAnimationFrame(() => {
            focusSyncFrame = 0
            syncPlaceholder()
          })
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      cancelFocusSync
    )
  }, [editor])

  return null
}
