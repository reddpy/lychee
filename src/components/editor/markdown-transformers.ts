import {
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  INLINE_CODE,
  STRIKETHROUGH,
  HIGHLIGHT,
  LINK,
} from "@lexical/markdown"
import {
  REFERENCE_EXPORT,
  REFERENCE_FENCE,
  REFERENCE_IMAGE,
} from "@/components/editor/plugins/reference-markdown-transformer"
import { TABLE, TABLE_EXPORT } from "@/components/editor/plugins/table-markdown-transformer"
import { TITLE_EXPORT } from "@/components/editor/plugins/title-markdown-transformer"
import { HORIZONTAL_RULE } from "@/components/editor/plugins/horizontal-rule-markdown-transformer"
import { NOTE_BOOKMARK } from "@/components/editor/plugins/note-bookmark-markdown-transformer"
import {
  UNKNOWN_EXPORT,
  UNKNOWN_FENCE,
  UNKNOWN_INLINE,
} from "@/components/editor/plugins/unknown-markdown-transformer"

/**
 * The canonical Markdown contract for Lychee documents.
 *
 * Keep editor shortcuts and future file exporters on this same list so custom
 * nodes cannot silently disappear or acquire different representations.
 *
 * `lychee-*` fence transformers MUST stay ahead of `CODE`, whose start regex
 * (` ```\w* `) would otherwise claim a ` ```lychee-reference ` / ` ```lychee-unknown `
 * fence and import it as a code block.
 */
export const MARKDOWN_TRANSFORMERS = [
  TITLE_EXPORT,
  HEADING,
  QUOTE,
  HORIZONTAL_RULE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  REFERENCE_EXPORT,
  UNKNOWN_EXPORT,
  TABLE_EXPORT,
  REFERENCE_FENCE,
  UNKNOWN_FENCE,
  CODE,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  HIGHLIGHT,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  REFERENCE_IMAGE,
  UNKNOWN_INLINE,
  NOTE_BOOKMARK,
  TABLE,
  LINK,
]
