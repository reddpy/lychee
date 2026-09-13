import type { LexicalEditor } from "lexical"
import { $getRoot } from "lexical"
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown"
import { $isTitleNode } from "@/components/editor/nodes/title-node"
import { MARKDOWN_TRANSFORMERS } from "@/components/editor/markdown-transformers"

/**
 * Document-level markdown I/O.
 *
 * The note's title is its filename (Obsidian model) and lives in the editor as a
 * leading `TitleNode`, purely as an inline editing affordance. It is NOT part of
 * the markdown body: export drops the title line, and import never synthesizes a
 * title from the content. A `# Heading` in the body is ordinary content.
 */

/** Export the current editor state as a markdown body (no title, no frontmatter). */
export function $exportDocumentMarkdown(): string {
  const markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS)
  const first = $getRoot().getFirstChild()
  if (!$isTitleNode(first)) return markdown
  const newline = markdown.indexOf("\n")
  if (newline === -1) return ""
  return markdown.slice(newline + 1).replace(/^\n+/, "")
}

/** Import a markdown body into the current editor state. */
export function $importDocumentMarkdown(markdown: string): void {
  $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS)
}

/** Convenience wrapper: read the editor state and return markdown. */
export function exportDocumentMarkdown(editor: LexicalEditor): string {
  let markdown = ""
  editor.getEditorState().read(() => {
    markdown = $exportDocumentMarkdown()
  })
  return markdown
}

/** Convenience wrapper: replace the editor state with a parsed markdown body. */
export function importDocumentMarkdown(editor: LexicalEditor, markdown: string): void {
  editor.update(
    () => {
      $importDocumentMarkdown(markdown)
    },
    { discrete: true },
  )
}
