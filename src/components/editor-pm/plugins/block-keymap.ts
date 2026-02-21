/**
 * Notion-style overrides on top of PM defaults.
 *
 * baseKeymap handles: Enter (splitBlock), Backspace (joinBackward), etc.
 * prosemirror-schema-list handles: Enter in list (splitListItem),
 *   Tab (sinkListItem), Shift-Tab (liftListItem).
 *
 * We only add:
 * - Enter in title → create paragraph after (never split)
 * - Enter on empty heading → convert to paragraph
 * - Backspace at start of heading → convert to paragraph
 */

import { keymap } from "prosemirror-keymap"
import {
  splitListItem,
  liftListItem,
  sinkListItem,
} from "prosemirror-schema-list"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { schema } from "../schema"

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean

// ── Enter ─────────────────────────────────────────────────

const handleEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection as TextSelection
  if (!empty) return false

  const parent = $from.parent

  // Title: Enter creates a paragraph after, never splits
  if (parent.type === schema.nodes.title) {
    if (!dispatch) return true
    const after = $from.after()
    const tr = state.tr.insert(after, schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
    dispatch(tr.scrollIntoView())
    return true
  }

  // Empty heading → convert to paragraph
  if (parent.type === schema.nodes.heading && parent.content.size === 0) {
    if (!dispatch) return true
    dispatch(state.tr.setNodeMarkup($from.before(), schema.nodes.paragraph).scrollIntoView())
    return true
  }

  // Let PM list commands and baseKeymap handle everything else
  return false
}

// ── Backspace ─────────────────────────────────────────────

const handleBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection as TextSelection
  if (!empty || $from.parentOffset !== 0) return false

  // Heading at start → convert to paragraph
  if ($from.parent.type === schema.nodes.heading) {
    if (!dispatch) return true
    dispatch(state.tr.setNodeMarkup($from.before(), schema.nodes.paragraph).scrollIntoView())
    return true
  }

  return false
}

// ── Export ─────────────────────────────────────────────────

export function blockKeymap() {
  return keymap({
    "Enter": handleEnter,
    "Backspace": handleBackspace,
    "Tab": sinkListItem(schema.nodes.list_item),
    "Shift-Tab": liftListItem(schema.nodes.list_item),
  })
}

/** List-specific Enter (split list item). Should be registered before blockKeymap. */
export function listKeymap() {
  return keymap({
    "Enter": splitListItem(schema.nodes.list_item),
  })
}
