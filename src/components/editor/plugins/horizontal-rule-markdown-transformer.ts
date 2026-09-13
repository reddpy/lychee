import type { ElementTransformer } from "@lexical/markdown"
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode"

/**
 * Markdown representation for HorizontalRuleNode.
 *
 * Lexical 0.44 ships this transformer only inside the React
 * `MarkdownShortcutPlugin`'s `DEFAULT_TRANSFORMERS`, not in `@lexical/markdown`,
 * so passing an explicit transformer list drops it. Mirrors the upstream
 * definition: accepts `---`, `***`, or `___` (with an optional trailing space so
 * the live typing shortcut fires) and exports the canonical `***` to avoid
 * colliding with YAML frontmatter or setext headings.
 */
export const HORIZONTAL_RULE: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? "***" : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const line = $createHorizontalRuleNode()
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(line)
    } else {
      parentNode.insertBefore(line)
    }
    line.selectNext()
  },
  type: "element",
}
