import {
  $createParagraphNode,
  LexicalNode,
  ParagraphNode,
} from "lexical"
import {
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
} from "@lexical/list"

/**
 * Is the caret sitting at the very start of `listItem` — i.e. nothing in the
 * item precedes it? True when the anchor is the item itself at offset 0, or the
 * first leaf with no earlier siblings up the chain.
 */
export function $isCaretAtListItemStart(
  listItem: ListItemNode,
  anchorNode: LexicalNode,
  offset: number
): boolean {
  if (offset !== 0) return false
  if (anchorNode.is(listItem)) return true
  let node: LexicalNode | null = anchorNode
  while (node !== null && !node.is(listItem)) {
    if (node.getPreviousSibling() !== null) return false
    node = node.getParent()
  }
  return node !== null
}

/**
 * Split a list around `listItem`, converting it to a paragraph in place:
 * preceding items stay in the original list, the item becomes a paragraph
 * where it was, and any following items move into a continuation list below it.
 * The caret is placed at the start of the new paragraph.
 *
 * Returns the new paragraph, or null if it declined (nested/indented item, or
 * an item wrapping a nested list) so Lexical's default backspace handling can
 * take over. Pure node mutation — no DOM/scroll side effects.
 */
export function $convertListItemToParagraph(
  listItem: ListItemNode
): ParagraphNode | null {
  const listNode = listItem.getParent()
  if (!$isListNode(listNode)) return null

  // Leave nested/indented items to Lexical's default (outdent) handling.
  if ($isListItemNode(listNode.getParent())) return null

  const itemChildren = listItem.getChildren()

  // A list item wrapping a nested list isn't plain text content — let the
  // default handler deal with it.
  if (itemChildren.some($isListNode)) return null

  // Move the item's inline content into a paragraph in a single splice.
  const paragraph = $createParagraphNode()
  paragraph.append(...itemChildren)
  listNode.insertAfter(paragraph)

  // Items after the converted one can't stay in the original list (a paragraph
  // now sits between them), so reparent them into a continuation list below the
  // paragraph. One variadic append moves them all in a single splice — the same
  // primitive Lexical's own $splitNode uses.
  const followingItems = listItem.getNextSiblings() as ListItemNode[]
  if (followingItems.length > 0) {
    const continuation = $createListNode(
      listNode.getListType(),
      followingItems[0].getValue()
    )
    continuation.append(...followingItems)
    paragraph.insertAfter(continuation)
  }

  listItem.remove()
  if (listNode.isEmpty()) {
    listNode.remove()
  }

  paragraph.selectStart()
  return paragraph
}
