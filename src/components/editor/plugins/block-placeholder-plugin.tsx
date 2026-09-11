"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  $getRoot,
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
import { useEditorPreferencesStore } from "@/renderer/editor-preferences-store"

const PLACEHOLDER_CLASS = "is-placeholder"

type PlaceholderOptions = {
  slashMenuEnabled: boolean
  showHint: boolean
  showBlockPlaceholders: boolean
  customText: string
}

function getPlaceholderText(node: LexicalNode, options: PlaceholderOptions): string | null {
  if ($isTitleNode(node)) return null
  if ($isParagraphNode(node)) {
    if (!options.showHint) return null
    if (options.customText.trim() !== "") return options.customText
    if ($isTableCellNode(node.getParent())) {
      return options.slashMenuEnabled ? "Type or press '/'" : "Type"
    }
    return options.slashMenuEnabled
      ? "Type something, or press '/' for commands..."
      : "Type something..."
  }
  if (!options.showBlockPlaceholders) return null
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

/** Remove block-label placeholders (headings/quotes/list items), leaving paragraphs. */
function clearBlockPlaceholders(editor: ReturnType<typeof useLexicalComposerContext>[0]): void {
  editor.getEditorState().read(() => {
    const remove = (key: string) => {
      const el = editor.getElementByKey(key)
      el?.classList.remove(PLACEHOLDER_CLASS)
      el?.removeAttribute("data-placeholder")
    }
    for (const child of $getRoot().getChildren()) {
      if ($isParagraphNode(child) || $isTitleNode(child)) continue
      remove(child.getKey())
      if ($isListNode(child)) {
        for (const item of child.getChildren()) remove(item.getKey())
      }
    }
  })
}

function syncPlaceholderForMutations(
  mutations: Map<string, NodeMutation>,
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  options: PlaceholderOptions
): void {
  editor.getEditorState().read(() => {
    for (const [key, mutation] of mutations) {
      if (mutation === "destroyed") continue

      const node = $getNodeByKey(key)
      if (!node) continue

      const dom = editor.getElementByKey(key)
      if (!dom) continue

      const placeholder = getPlaceholderText(node, options)
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
  const slashMenu = useEditorPreferencesStore((s) => s.slashMenu)
  const showHint = useEditorPreferencesStore((s) => s.showHint)
  const hintText = useEditorPreferencesStore((s) => s.hintText)
  const showBlockPlaceholders = useEditorPreferencesStore((s) => s.showBlockPlaceholders)

  // Block labels (headings/quotes/list items) via mutation listeners.
  useEffect(() => {
    if (!showBlockPlaceholders) {
      clearBlockPlaceholders(editor)
      return
    }
    const options: PlaceholderOptions = {
      slashMenuEnabled: slashMenu,
      showHint,
      showBlockPlaceholders,
      customText: hintText,
    }
    return mergeRegister(
      editor.registerMutationListener(HeadingNode, (mutations) => {
        syncPlaceholderForMutations(mutations, editor, options)
      }),
      editor.registerMutationListener(QuoteNode, (mutations) => {
        syncPlaceholderForMutations(mutations, editor, options)
      }),
      editor.registerMutationListener(ListItemNode, (mutations) => {
        syncPlaceholderForMutations(mutations, editor, options)
      })
    )
  }, [editor, slashMenu, showHint, hintText, showBlockPlaceholders])

  // Focus-based typing hint for paragraphs only
  useEffect(() => {
    const options: PlaceholderOptions = {
      slashMenuEnabled: slashMenu,
      showHint,
      showBlockPlaceholders,
      customText: hintText,
    }
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
      if (!showHint) {
        clearPlaceholder()
        return
      }
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
          const text = getPlaceholderText(topElement, options)
          if (dom && text) {
            dom.classList.add(PLACEHOLDER_CLASS)
            dom.setAttribute("data-placeholder", text)
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

    const unregister = mergeRegister(
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
    // Refresh immediately so toggling a placeholder preference updates an
    // already-visible placeholder without waiting for the next keystroke.
    syncPlaceholder()
    return unregister
  }, [editor, slashMenu, showHint, hintText])

  return null
}
