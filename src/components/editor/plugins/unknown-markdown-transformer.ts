import type {
  ElementTransformer,
  MultilineElementTransformer,
  TextMatchTransformer,
} from "@lexical/markdown"
import { $isUnknownNode, $createUnknownNode, UnknownNode } from "@/components/editor/nodes/unknown-node"
import { decodeInlinePayload, encodeInlinePayload } from "@/components/editor/plugins/markdown-encoding"
import { NEVER_MATCH } from "@/components/editor/plugins/markdown-export-only"

export const UNKNOWN_FENCE_LANG = "lychee-unknown"

const INLINE_PREFIX = "<!--lychee-unknown:b64 "
const INLINE_SUFFIX = "-->"

/**
 * Top-level unknown nodes export as a `lychee-unknown` fenced block holding the
 * original serialized payload verbatim. An element transformer is required
 * because export only consults element transformers for top-level nodes (a
 * decorator would otherwise fall back to `getTextContent()` and lose the shape).
 */
export const UNKNOWN_EXPORT: ElementTransformer = {
  dependencies: [UnknownNode],
  export: (node) =>
    $isUnknownNode(node)
      ? "```" + UNKNOWN_FENCE_LANG + "\n" + JSON.stringify(node.getRaw()) + "\n```"
      : null,
  regExp: NEVER_MATCH, // never matches (export-only)
  replace: () => {},
  type: "element",
}

/**
 * Import a `lychee-unknown` fence. On unparseable JSON, defer to the built-in
 * CODE transformer rather than dropping the block.
 */
export const UNKNOWN_FENCE: MultilineElementTransformer = {
  dependencies: [UnknownNode],
  export: () => null,
  regExpStart: /^```lychee-unknown\s*$/,
  regExpEnd: /^```\s*$/,
  replace: (rootNode, _children, _startMatch, _endMatch, linesInBetween) => {
    if (!linesInBetween) return false
    let raw: unknown
    try {
      raw = JSON.parse(linesInBetween.join("\n"))
    } catch {
      return false
    }
    rootNode.append($createUnknownNode(raw))
  },
  type: "multiline-element",
}

/**
 * Inline/nested unknown nodes (e.g. one preserved inside a paragraph) must not
 * shift to a block position, so they use a self-contained base64 HTML comment.
 */
export const UNKNOWN_INLINE: TextMatchTransformer = {
  dependencies: [UnknownNode],
  export: (node) =>
    $isUnknownNode(node) ? INLINE_PREFIX + encodeInlinePayload(node.getRaw()) + INLINE_SUFFIX : null,
  importRegExp: /<!--lychee-unknown:b64 ([A-Za-z0-9+/=]+)-->/,
  regExp: /<!--lychee-unknown:b64 ([A-Za-z0-9+/=]+)-->$/,
  replace: (textNode, match) => {
    let raw: unknown
    try {
      raw = decodeInlinePayload(match[1])
    } catch {
      return
    }
    const node = $createUnknownNode(raw)
    textNode.replace(node)
  },
  trigger: ">",
  type: "text-match",
}
