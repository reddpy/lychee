import type { TextMatchTransformer } from "@lexical/markdown"
import {
  $createNoteBookmarkNode,
  $isNoteBookmarkNode,
  NoteBookmarkNode,
} from "@/components/editor/nodes/note-bookmark-node"
import { decodeInlinePayload, encodeInlinePayload } from "@/components/editor/plugins/markdown-encoding"

const PREFIX = "<!--lychee-bookmark:b64 "
const SUFFIX = "-->"

/**
 * Note bookmarks are zero-width inline markers with no markdown representation.
 * Encode them as a self-contained HTML comment so they survive round-trips while
 * staying invisible in rendered markdown. `getTextContent()` stays empty so word
 * counts / search / previews are unaffected.
 */
export const NOTE_BOOKMARK: TextMatchTransformer = {
  dependencies: [NoteBookmarkNode],
  export: (node) =>
    $isNoteBookmarkNode(node)
      ? PREFIX +
        encodeInlinePayload({ label: node.getLabel(), createdAt: node.getCreatedAt() }) +
        SUFFIX
      : null,
  importRegExp: /<!--lychee-bookmark:b64 ([A-Za-z0-9+/=]+)-->/,
  regExp: /<!--lychee-bookmark:b64 ([A-Za-z0-9+/=]+)-->$/,
  replace: (textNode, match) => {
    let data: { label?: string; createdAt?: string }
    try {
      data = decodeInlinePayload(match[1])
    } catch {
      return
    }
    const node = $createNoteBookmarkNode({ label: data.label, createdAt: data.createdAt })
    textNode.replace(node)
  },
  trigger: ">",
  type: "text-match",
}
