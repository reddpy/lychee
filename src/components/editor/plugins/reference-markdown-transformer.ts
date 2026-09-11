import type { ElementTransformer, TextMatchTransformer } from "@lexical/markdown"
import { $insertNodeToNearestRoot } from "@lexical/utils"
import {
  $createReferenceNode,
  $isReferenceNode,
  ReferenceNode,
} from "@/components/editor/nodes/reference-node"

/**
 * Markdown export for top-level reference blocks. The canonical URL is always
 * the thing that survives:
 *   - image mode → standard markdown image, `![alt](url)`
 *   - card mode  → a plain link, `[title](url)`
 *
 * exportTopLevelElements() only tries ElementTransformers for top-level nodes,
 * so TextMatchTransformer.export would never be called here.
 */
export const REFERENCE_EXPORT: ElementTransformer = {
  dependencies: [ReferenceNode],
  export: (node) => {
    if (!$isReferenceNode(node)) return null
    if (node.getDisplayMode() === "image") {
      const alt = node.getAltText()
      const url = node.getUrl() || node.getSrc()
      return `![${alt}](${url})`
    }
    const title = node.getTitle() || node.getUrl()
    return `[${title}](${node.getUrl()})`
  },
  regExp: /(?:)/, // never matches (export-only)
  replace: () => {},
  type: "element",
}

/**
 * Handles live typing shortcut and markdown import for ![alt](url).
 * Triggers on ')' character — must be ordered before LINK in the
 * TRANSFORMERS array since ![...] and [...] overlap.
 */
export const REFERENCE_IMAGE: TextMatchTransformer = {
  dependencies: [ReferenceNode],
  export: () => null, // handled by REFERENCE_EXPORT
  importRegExp: /!(?:\[([^\[]*)\])(?:\(([^(]+)\))/,
  regExp: /!(?:\[([^\[]*)\])(?:\(([^(]+)\))$/,
  replace: (textNode, match) => {
    const [, altText, src] = match
    const isExternal = /^https?:\/\//.test(src)
    const referenceNode = $createReferenceNode({
      displayMode: "image",
      url: isExternal ? src : "",
      src,
      altText,
      loading: isExternal,
    })
    // Remove the matched text node, then clean up the empty parent paragraph
    const parent = textNode.getParentOrThrow()
    textNode.remove()
    if (parent.getChildrenSize() === 0) {
      parent.remove()
    }
    // Insert as a proper top-level block (same pattern as HorizontalRulePlugin)
    $insertNodeToNearestRoot(referenceNode)
  },
  trigger: ")",
  type: "text-match",
}
