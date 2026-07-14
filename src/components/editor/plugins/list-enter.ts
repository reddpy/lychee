import { $createListItemNode, $isListNode, ListItemNode } from "@lexical/list"

/**
 * Insert a new item immediately before a checked checklist item, preserving
 * that checked state.
 *
 * This is the Notion-style result of pressing Enter at the very start of a
 * checked item: the existing content stays checked and moves down, and the
 * newly-created blank item carries the same checked state.
 */
export function $insertMatchingChecklistItemBefore(
  listItem: ListItemNode
): ListItemNode | null {
  const list = listItem.getParent()
  if (!$isListNode(list) || list.getListType() !== "check" || !listItem.getChecked()) {
    return null
  }

  const newItem = $createListItemNode().setChecked(true)
  listItem.insertBefore(newItem)
  newItem.selectStart()
  return newItem
}
