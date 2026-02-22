import type { ElementTransformer, TextMatchTransformer } from "@lexical/markdown"
import { $insertNodeToNearestRoot } from "@lexical/utils"
import {
  $createImageNode,
  $isImageNode,
  ImageNode,
} from "@/components/editor/nodes/image-node"

/**
 * Handles markdown export for top-level ImageNodes (DecoratorNode).
 * exportTopLevelElements() only tries ElementTransformers for top-level nodes,
 * so TextMatchTransformer.export would never be called for block-level images.
 */
export const IMAGE_EXPORT: ElementTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!$isImageNode(node)) return null
    const alt = node.__altText || ""
    const src = node.__src || ""
    return `![${alt}](${src})`
  },
  regExp: /(?:)/, // never matches (export-only)
  replace: () => {},
  type: "element",
}

/**
 * Handles live typing shortcut and markdown import for ![alt](src).
 * Triggers on ')' character — must be ordered before LINK in the
 * TRANSFORMERS array since ![...] and [...] overlap.
 */
export const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: () => null, // handled by IMAGE_EXPORT
  importRegExp: /!(?:\[([^\[]*)\])(?:\(([^(]+)\))/,
  regExp: /!(?:\[([^\[]*)\])(?:\(([^(]+)\))$/,
  replace: (textNode, match) => {
    const [, altText, src] = match
    const isExternal = src.startsWith("http://") || src.startsWith("https://")
    const imageNode = $createImageNode({ src, altText, loading: isExternal })
    // Remove the matched text node, then clean up the empty parent paragraph
    const parent = textNode.getParentOrThrow()
    textNode.remove()
    if (parent.getChildrenSize() === 0) {
      parent.remove()
    }
    // Insert as a proper top-level block (same pattern as HorizontalRulePlugin)
    $insertNodeToNearestRoot(imageNode)
  },
  trigger: ")",
  type: "text-match",
}
