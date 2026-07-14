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
import { IMAGE, IMAGE_EXPORT } from "@/components/editor/plugins/image-markdown-transformer"
import { TABLE, TABLE_EXPORT } from "@/components/editor/plugins/table-markdown-transformer"
import { TITLE_EXPORT } from "@/components/editor/plugins/title-markdown-transformer"

/**
 * The canonical Markdown contract for Lychee documents.
 *
 * Keep editor shortcuts and future file exporters on this same list so custom
 * nodes cannot silently disappear or acquire different representations.
 */
export const MARKDOWN_TRANSFORMERS = [
  TITLE_EXPORT,
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  IMAGE_EXPORT,
  TABLE_EXPORT,
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
  IMAGE,
  TABLE,
  LINK,
]
