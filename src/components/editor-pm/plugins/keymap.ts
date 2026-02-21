import { keymap } from "prosemirror-keymap"
import { EditorState, Transaction } from "prosemirror-state"
import { toggleMark, exitCode } from "prosemirror-commands"
import { schema } from "../schema"

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean

// ── Mark toggle commands ──────────────────────────────────

const toggleBold: Command = toggleMark(schema.marks.bold)
const toggleItalic: Command = toggleMark(schema.marks.italic)
const toggleUnderline: Command = toggleMark(schema.marks.underline)
const toggleStrikethrough: Command = toggleMark(schema.marks.strikethrough)
const toggleCode: Command = toggleMark(schema.marks.code)

// ── Block commands ────────────────────────────────────────

/** Shift+Enter: exit code block, hard break elsewhere. */
const insertHardBreak: Command = (state, dispatch) => {
  const { $from } = state.selection
  if ($from.parent.type.spec.code) return exitCode(state, dispatch)
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(schema.nodes.hardBreak.create()).scrollIntoView())
  }
  return true
}

/** Insert a horizontal rule. */
const insertHorizontalRule: Command = (state, dispatch) => {
  if (dispatch) {
    const { $from } = state.selection
    // Only in top-level block context
    if ($from.parent.type.name === "title") return false
    const tr = state.tr
    tr.replaceSelectionWith(schema.nodes.horizontalRule.create())
    // Add a paragraph after the hr if we're at the end of the doc
    const pos = tr.selection.from
    if (pos >= tr.doc.content.size - 1) {
      tr.insert(tr.doc.content.size, schema.nodes.paragraph.create())
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

// ── Keymap plugin ─────────────────────────────────────────

export function formatKeymap() {
  return keymap({
    "Mod-b": toggleBold,
    "Mod-i": toggleItalic,
    "Mod-u": toggleUnderline,
    "Mod-Shift-s": toggleStrikethrough,
    "Mod-e": toggleCode,
    "Shift-Enter": insertHardBreak,
    "Mod-Shift-Enter": insertHorizontalRule,
  })
}
