import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from "prosemirror-inputrules"
import { schema } from "../schema"
import { EditorState } from "prosemirror-state"

// ── Headings ──────────────────────────────────────────────

function headingRule(level: number) {
  return textblockTypeInputRule(
    new RegExp(`^(#{${level}})\\s$`),
    schema.nodes.heading,
    { level }
  )
}

// ── Lists (standard PM wrapping rules) ────────────────────

function bulletListRule() {
  return wrappingInputRule(/^\s*[-*+]\s$/, schema.nodes.bullet_list)
}

function orderedListRule() {
  return wrappingInputRule(
    /^\s*(\d+)\.\s$/,
    schema.nodes.ordered_list,
    (match) => ({ order: +match[1] }),
    (match, node) => node.childCount + node.attrs.order === +match[1]
  )
}

// ── Blockquote ────────────────────────────────────────────

function blockquoteRule() {
  return wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote)
}

// ── Horizontal rule ───────────────────────────────────────

function horizontalRuleRule() {
  return new InputRule(
    /^(?:---|___|\*\*\*)\s*$/,
    (state: EditorState, _match: RegExpMatchArray, start: number) => {
      const $start = state.doc.resolve(start)
      if ($start.parent.type !== schema.nodes.paragraph) return null
      const tr = state.tr
      tr.replaceRangeWith(
        $start.before(),
        $start.after(),
        schema.nodes.horizontalRule.create()
      )
      const pos = tr.mapping.map($start.after())
      if (pos >= tr.doc.content.size) {
        tr.insert(tr.doc.content.size, schema.nodes.paragraph.create())
      }
      return tr.scrollIntoView()
    }
  )
}

// ── Code block ────────────────────────────────────────────

function codeBlockRule() {
  return new InputRule(
    /^```$/,
    (state: EditorState, _match: RegExpMatchArray, start: number, end: number) => {
      const $start = state.doc.resolve(start)
      if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), schema.nodes.codeBlock))
        return null
      return state.tr
        .delete(start, end)
        .setBlockType(start, start, schema.nodes.codeBlock, { language: "" })
    }
  )
}

// ── Combined ──────────────────────────────────────────────

export function editorInputRules() {
  return inputRules({
    rules: [
      headingRule(1),
      headingRule(2),
      headingRule(3),
      bulletListRule(),
      orderedListRule(),
      blockquoteRule(),
      horizontalRuleRule(),
      codeBlockRule(),
    ],
  })
}
