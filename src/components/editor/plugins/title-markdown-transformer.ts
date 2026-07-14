import type { ElementTransformer } from "@lexical/markdown"
import {
  $isTitleNode,
  TitleNode,
} from "@/components/editor/nodes/title-node"

/**
 * Export the canonical note title as a level-one Markdown heading.
 *
 * This is export-only on purpose. Markdown pasted into an existing note may
 * contain `# Heading`, but that is body content and must remain a HeadingNode;
 * a future full-document importer can explicitly map the first heading to the
 * document title when appropriate.
 */
export const TITLE_EXPORT: ElementTransformer = {
  dependencies: [TitleNode],
  export: (node, exportChildren) => {
    if (!$isTitleNode(node)) return null
    const title = exportChildren(node).trim()
    return title ? `# ${title}` : ""
  },
  regExp: /(?:)/, // never used for import; required by ElementTransformer
  replace: () => {},
  type: "element",
}
