// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"

vi.mock("@/components/editor/nodes/reference-component", () => ({
  ReferenceComponent: (): null => null,
}))

import { createHeadlessEditor } from "@lexical/headless"
import { registerMarkdownShortcuts } from "@lexical/markdown"
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $createParagraphNode,
  KEY_ENTER_COMMAND,
  TextNode,
  type LexicalEditor,
} from "lexical"

import { nodes } from "@/components/editor/nodes"
import { MARKDOWN_TRANSFORMERS } from "@/components/editor/markdown-transformers"
import { applyChecklistShortcut } from "@/components/editor/plugins/checklist-shortcut-plugin"

type NodeInfo = {
  type: string
  text?: string
  format?: number
  listType?: string
  checked?: boolean
  tag?: string
  language?: string
  children?: NodeInfo[]
}

function makeEditor(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: "markdown-shortcuts-test",
    nodes,
    onError: (error) => {
      throw error
    },
  })
  registerMarkdownShortcuts(editor, MARKDOWN_TRANSFORMERS)
  editor.registerNodeTransform(TextNode, applyChecklistShortcut)
  return editor
}

function reset(editor: LexicalEditor): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      root.append(paragraph)
      paragraph.selectStart()
    },
    { discrete: true },
  )
}

function type(editor: LexicalEditor, input: string): void {
  for (const char of input) {
    editor.update(
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        selection.insertText(char)
      },
      { discrete: true },
    )
  }
  // Let deferred (text-format) transforms commit.
  editor.update(() => {}, { discrete: true })
}

function pressEnter(editor: LexicalEditor): void {
  editor.update(
    () => {
      editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    },
    { discrete: true },
  )
  editor.update(() => {}, { discrete: true })
}

function inspect(editor: LexicalEditor): NodeInfo[] {
  return editor.getEditorState().read(() => {
    const walk = (node: any): NodeInfo => {
      const info: NodeInfo = { type: node.getType() }
      if (node.getType() === "list") info.listType = node.getListType()
      if (node.getType() === "listitem") info.checked = node.getChecked()
      if (node.getType() === "heading") info.tag = node.getTag()
      if (node.getType() === "code") info.language = node.getLanguage()
      if ($isTextNode(node)) {
        info.text = node.getTextContent()
        info.format = node.getFormat()
      }
      if (typeof node.getChildren === "function") {
        info.children = node.getChildren().map(walk)
      }
      return info
    }
    return $getRoot().getChildren().map(walk)
  })
}

function run(input: string, options: { enter?: boolean } = {}): NodeInfo[] {
  const editor = makeEditor()
  reset(editor)
  type(editor, input)
  if (options.enter) pressEnter(editor)
  return inspect(editor)
}

describe("markdown shortcuts — #223 audit", () => {
  it("headings: # / ## / ###", () => {
    expect(run("# H")).toMatchObject([{ type: "heading", tag: "h1" }])
    expect(run("## H")).toMatchObject([{ type: "heading", tag: "h2" }])
    expect(run("### H")).toMatchObject([{ type: "heading", tag: "h3" }])
  })

  it("blockquote: >", () => {
    expect(run("> q")).toMatchObject([{ type: "quote" }])
  })

  it("bullet lists: - / * / +", () => {
    expect(run("- item")).toMatchObject([{ type: "list", listType: "bullet" }])
    expect(run("* item")).toMatchObject([{ type: "list", listType: "bullet" }])
    expect(run("+ item")).toMatchObject([{ type: "list", listType: "bullet" }])
  })

  it("numbered list: 1.", () => {
    expect(run("1. item")).toMatchObject([{ type: "list", listType: "number" }])
  })

  it("checklist: - [ ] / - [x] (plus bare [ ])", () => {
    expect(run("- [ ] todo")).toMatchObject([
      { type: "list", listType: "check", children: [{ checked: false }] },
    ])
    expect(run("- [x] done")).toMatchObject([
      { type: "list", listType: "check", children: [{ checked: true }] },
    ])
    expect(run("* [ ] todo")).toMatchObject([{ type: "list", listType: "check" }])
    expect(run("[ ] todo")).toMatchObject([{ type: "list", listType: "check" }])
  })

  it("leaves a normal bullet untouched", () => {
    expect(run("- plain")).toMatchObject([
      { type: "list", listType: "bullet", children: [{ checked: undefined }] },
    ])
  })

  it("horizontal rule: --- / *** / ___", () => {
    for (const input of ["--- ", "*** ", "___ "]) {
      // The shortcut leaves an empty paragraph after the rule to continue typing.
      expect(run(input)[0]).toMatchObject({ type: "horizontalrule" })
    }
  })

  it("inline code: `code`", () => {
    expect(run("`code`")).toMatchObject([
      { type: "paragraph", children: [{ text: "code", format: 16 }] },
    ])
  })

  it("bold / italic / strikethrough", () => {
    expect(run("**bold**")).toMatchObject([
      { type: "paragraph", children: [{ text: "bold", format: 1 }] },
    ])
    expect(run("*ital*")).toMatchObject([
      { type: "paragraph", children: [{ text: "ital", format: 2 }] },
    ])
    expect(run("~~strike~~")).toMatchObject([
      { type: "paragraph", children: [{ text: "strike", format: 4 }] },
    ])
  })

  it("highlight: ==hi==", () => {
    const result = run("==hi==")
    expect(result[0].children?.[0].text).toBe("hi")
    expect(result[0].children?.[0].format).toBeGreaterThan(0)
  })

  it("link: [text](url)", () => {
    expect(run("[text](https://example.com)")).toMatchObject([
      { type: "paragraph", children: [{ type: "link" }] },
    ])
  })

  it("code block: ``` + Enter, with language", () => {
    expect(run("```", { enter: true })).toMatchObject([{ type: "code" }])
    expect(run("```js", { enter: true })).toMatchObject([{ type: "code", language: "js" }])
  })
})
