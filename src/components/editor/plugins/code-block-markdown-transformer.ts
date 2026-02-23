import type { MultilineElementTransformer } from "@lexical/markdown"
import {
  $createCodeBlockNode,
  $isCodeBlockNode,
  CodeBlockNode,
} from "@/components/editor/nodes/code-block-node"

const CODE_START_REGEX = /^[ \t]*```([\w-]+)?/
const CODE_END_REGEX = /[ \t]*```$/

export const CODE_BLOCK: MultilineElementTransformer = {
  dependencies: [CodeBlockNode],
  export: (node) => {
    if (!$isCodeBlockNode(node)) return null
    const code = node.getCode()
    const language = node.getLanguage() || ""
    return "```" + language + (code ? "\n" + code : "") + "\n```"
  },
  regExpStart: CODE_START_REGEX,
  regExpEnd: {
    optional: true,
    regExp: CODE_END_REGEX,
  },
  replace: (
    rootNode,
    children,
    startMatch,
    _endMatch,
    linesInBetween,
    _isImport,
  ) => {
    const language = startMatch[1] || ""
    let code = ""

    if (!children && linesInBetween) {
      // Import path: lines between ``` fences
      const lines = [...linesInBetween]
      while (lines.length > 0 && !lines[0].length) {
        lines.shift()
      }
      while (lines.length > 0 && !lines[lines.length - 1].length) {
        lines.pop()
      }
      code = lines.join("\n")
      const codeBlockNode = $createCodeBlockNode(code, language)
      rootNode.replace(codeBlockNode)
    } else if (children) {
      // Live typing shortcut: the markdown plugin splits the text node and
      // passes us the trailing siblings as `children`. After our replace()
      // returns, the plugin removes the leading text node (the ``` trigger).
      //
      // We must NOT call rootNode.replace() here because that destroys the
      // paragraph (and leadingNode inside it) before the plugin can clean up.
      // Instead: insert code block after the paragraph, remove the siblings
      // we were given, and let the plugin remove leadingNode — leaving an
      // empty paragraph that we then clean up.
      code = children.map((c) => c.getTextContent()).join("")
      const codeBlockNode = $createCodeBlockNode(code, language)

      // Remove the sibling nodes (the text after ```)
      for (const child of children) {
        child.remove()
      }

      // Insert code block after the paragraph
      rootNode.insertAfter(codeBlockNode)

      // Select the (now-empty) paragraph after the code block.
      // The plugin will remove leadingNode next, leaving an empty paragraph
      // below the code block — which serves as a natural place to continue typing.
      rootNode.selectStart()
    }
  },
  type: "multiline-element",
}
