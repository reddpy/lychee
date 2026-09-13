import { describe, it, expect, vi } from "vitest"

vi.mock("@/components/editor/nodes/reference-component", () => ({
  ReferenceComponent: (): null => null,
}))

import { createHeadlessEditor } from "@lexical/headless"
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
} from "lexical"
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text"
import { $createCodeNode } from "@lexical/code"
import { $createListNode, $createListItemNode } from "@lexical/list"
import { $createLinkNode } from "@lexical/link"
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode"
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown"

import { nodes } from "@/components/editor/nodes"
import { MARKDOWN_TRANSFORMERS } from "@/components/editor/markdown-transformers"
import { NEVER_MATCH } from "@/components/editor/plugins/markdown-export-only"
import { TITLE_EXPORT } from "@/components/editor/plugins/title-markdown-transformer"
import { REFERENCE_EXPORT } from "@/components/editor/plugins/reference-markdown-transformer"
import { TABLE_EXPORT } from "@/components/editor/plugins/table-markdown-transformer"

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "markdown-roundtrip-test",
    nodes,
    onError: (error) => {
      throw error
    },
  })
}

function update(editor: LexicalEditor, fn: () => void): void {
  editor.update(fn, { discrete: true })
}

function toMarkdown(editor: LexicalEditor): string {
  let markdown = ""
  editor.getEditorState().read(() => {
    markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS)
  })
  return markdown
}

function fromMarkdown(editor: LexicalEditor, markdown: string): void {
  update(editor, () => {
    $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS)
  })
}

function topLevelTypes(editor: LexicalEditor): string[] {
  const types: string[] = []
  editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) types.push(child.getType())
  })
  return types
}

describe("markdown transformer contract", () => {
  // Regression guard for the truncation class of bug: an export-only
  // transformer used `/(?:)/`, which matches the empty string in EVERY line.
  // The markdown importer then treated each line (and, for the multiline table
  // transformer, the whole document) as handled and silently dropped it.
  it("export-only transformers never match import input", () => {
    const lines = ["# Title", "plain paragraph", "- item", "| a | b |", "---", "```ts", ""]
    for (const line of lines) {
      expect(NEVER_MATCH.test(line)).toBe(false)
      expect(line.match(TITLE_EXPORT.regExp)).toBeNull()
      expect(line.match(REFERENCE_EXPORT.regExp)).toBeNull()
      expect(line.match(TABLE_EXPORT.regExpStart)).toBeNull()
    }
  })

  it("imports a full markdown document instead of dropping it", () => {
    const markdown = [
      "# Heading",
      "",
      "A paragraph with **bold**.",
      "",
      "- one",
      "- two",
      "",
      "> quote",
      "",
      "```ts",
      "const x = 1",
      "```",
      "",
      "---",
    ].join("\n")

    const editor = makeEditor()
    fromMarkdown(editor, markdown)

    const types = topLevelTypes(editor)
    expect(types).toContain("heading")
    expect(types).toContain("paragraph")
    expect(types).toContain("list")
    expect(types).toContain("quote")
    expect(types).toContain("code")
    expect(types).toContain("horizontalrule")
  })

  it("round-trips a horizontal rule through export and import", () => {
    const editor = makeEditor()
    update(editor, () => {
      $getRoot().clear()
      $getRoot().append($createHorizontalRuleNode())
    })
    expect(toMarkdown(editor)).toBe("***")

    // `---` is accepted on import even though export canonicalizes to `***`.
    const imported = makeEditor()
    fromMarkdown(imported, "---")
    expect(topLevelTypes(imported)).toEqual(["horizontalrule"])
    expect(toMarkdown(imported)).toBe("***")
  })

  it("is idempotent for representable blocks (md -> nodes -> md is stable)", () => {
    const markdown = [
      "# Heading",
      "",
      "A paragraph with **bold** and [link](https://example.com).",
      "",
      "> quote",
      "",
      "- one",
      "- two",
      "",
      "```ts",
      "const x = 1",
      "```",
      "",
      "---",
      "",
      "![Pic](https://example.com/pic.png)",
    ].join("\n")

    const first = makeEditor()
    fromMarkdown(first, markdown)
    const once = toMarkdown(first)

    const second = makeEditor()
    fromMarkdown(second, once)
    const twice = toMarkdown(second)

    expect(twice).toBe(once)
  })

  it("imports a markdown image as a reference node (not a plain image)", () => {
    const editor = makeEditor()
    fromMarkdown(editor, "![Pic](https://example.com/pic.png)")
    expect(topLevelTypes(editor)).toEqual(["reference"])
  })

  it("keeps inline formatting inside paragraphs across a round-trip", () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const bold = $createTextNode("bold")
      bold.toggleFormat("bold")
      paragraph.append(bold, $createTextNode(" and "))
      const link = $createLinkNode("https://example.com")
      link.append($createTextNode("link"))
      paragraph.append(link)
      root.append(paragraph)
    })

    const markdown = toMarkdown(editor)
    expect(markdown).toContain("**bold**")
    expect(markdown).toContain("[link](https://example.com)")

    const imported = makeEditor()
    fromMarkdown(imported, markdown)
    expect(toMarkdown(imported)).toBe(markdown)
  })

  it("preserves heading and quote nodes across a round-trip", () => {
    const editor = makeEditor()
    update(editor, () => {
      const root = $getRoot()
      root.clear()
      root.append($createHeadingNode("h2").append($createTextNode("Subhead")))
      root.append($createQuoteNode().append($createTextNode("quoted")))
      root.append(
        $createListNode("bullet").append(
          $createListItemNode().append($createTextNode("item")),
        ),
      )
      root.append($createCodeNode("ts").append($createTextNode("const x = 1")))
    })

    const markdown = toMarkdown(editor)
    const imported = makeEditor()
    fromMarkdown(imported, markdown)
    expect(topLevelTypes(imported)).toEqual(["heading", "quote", "list", "code"])
  })
})
