import { createHeadlessEditor } from "@lexical/headless"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  type RangeSelection,
} from "lexical"
import {
  $createLinkNode,
  $toggleLink,
  LinkNode,
} from "@lexical/link"
import { describe, expect, it } from "vitest"

import {
  captureLinkSelection,
  withRestoredLinkSelection,
} from "@/components/editor/plugins/link-selection"
import { createInternalNoteUrl, INTERNAL_NOTE_REL } from "@/shared/internal-note-link"

function createLinkEditor() {
  const editor = createHeadlessEditor({
    namespace: "link-selection-test",
    nodes: [LinkNode],
    onError: (error) => { throw error },
  })

  return editor
}

function seedSelectedText(editor: ReturnType<typeof createLinkEditor>): RangeSelection {
  let savedSelection: RangeSelection | null = null
  editor.update(() => {
    const paragraph = $createParagraphNode()
    const text = $createTextNode("link text")
    paragraph.append(text)
    $getRoot().clear().append(paragraph)
    savedSelection = text.select(0, 4).clone()
  }, { discrete: true })

  if (!savedSelection) throw new Error("Failed to seed a selected range")
  return savedSelection
}

function captureCaret(
  editor: ReturnType<typeof createLinkEditor>,
  content: string,
  offset: number,
): RangeSelection {
  let savedSelection: RangeSelection | null = null
  editor.update(() => {
    const paragraph = $createParagraphNode()
    const text = $createTextNode(content)
    paragraph.append(text)
    $getRoot().clear().append(paragraph)
    savedSelection = captureLinkSelection(text.select(offset, offset))
  }, { discrete: true })

  if (!savedSelection) throw new Error("Failed to capture the caret")
  return savedSelection
}

function firstLink(editor: ReturnType<typeof createLinkEditor>) {
  const state = editor.getEditorState().toJSON() as any
  return state.root.children[0]?.children.find((node: any) => node.type === "link")
}

function documentText(editor: ReturnType<typeof createLinkEditor>) {
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

describe("link popup selection restoration", () => {
  it("applies a web link to text selected before the popup took focus", () => {
    const editor = createLinkEditor()
    const savedSelection = seedSelectedText(editor)

    editor.update(() => $setSelection(null), { discrete: true })
    expect(withRestoredLinkSelection(editor, savedSelection, () => {
      $toggleLink("https://example.com")
    })).toMatchObject({
      isCollapsed: false,
      shouldInsertText: false,
    })

    expect(firstLink(editor)).toMatchObject({
      type: "link",
      url: "https://example.com",
      children: [{ type: "text", text: "link" }],
    })
  })

  it("applies an internal note target to the selected text", () => {
    const editor = createLinkEditor()
    const savedSelection = seedSelectedText(editor)
    const internalUrl = createInternalNoteUrl("target-document")

    editor.update(() => $setSelection(null), { discrete: true })
    expect(withRestoredLinkSelection(editor, savedSelection, () => {
      $toggleLink({
        url: internalUrl,
        rel: INTERNAL_NOTE_REL,
      })
    })).not.toBeNull()

    expect(firstLink(editor)).toMatchObject({
      type: "link",
      url: internalUrl,
      rel: INTERNAL_NOTE_REL,
      children: [{ type: "text", text: "link" }],
    })
  })

  it("uses the word under a collapsed caret as the link label", () => {
    const editor = createLinkEditor()
    const savedSelection = captureCaret(editor, "Read the reference later", 11)
    const internalUrl = createInternalNoteUrl("target-document")

    expect(savedSelection.isCollapsed()).toBe(false)
    editor.update(() => $setSelection(null), { discrete: true })
    withRestoredLinkSelection(editor, savedSelection, () => {
      $toggleLink({ url: internalUrl, rel: INTERNAL_NOTE_REL })
    })

    expect(firstLink(editor)).toMatchObject({
      url: internalUrl,
      children: [{ type: "text", text: "reference" }],
    })
  })

  it.each([
    ["word boundary", "reference later", 9],
    ["whitespace", "reference later", 10],
    ["punctuation", "reference, later", 9],
  ])("keeps the caret collapsed at %s", (_case, content, offset) => {
    const editor = createLinkEditor()
    expect(captureCaret(editor, content, offset).isCollapsed()).toBe(true)
  })

  it.each([
    ["the end of populated text", "existing line", 13, false],
    ["trailing whitespace", "Visit ", 6, true],
    ["a word boundary", "reference later", 9, true],
    ["the start of populated text", "reference", 0, true],
  ])("reports whether Cmd+K should insert text at %s", (_case, content, offset, expected) => {
    const editor = createLinkEditor()
    const savedSelection = captureCaret(editor, content, offset)

    editor.update(() => $setSelection(null), { discrete: true })
    expect(withRestoredLinkSelection(editor, savedSelection, () => {})).toMatchObject({
      isCollapsed: true,
      shouldInsertText: expected,
    })
  })

  it("removes an entire multi-word link when the caret is inside it", () => {
    const editor = createLinkEditor()
    let savedSelection: RangeSelection | null = null
    editor.update(() => {
      const paragraph = $createParagraphNode()
      const link = $createLinkNode("https://example.com")
      const text = $createTextNode("linked phrase with spaces")
      link.append(text)
      paragraph.append(link)
      $getRoot().clear().append(paragraph)
      savedSelection = captureLinkSelection(text.select(9, 9))
    }, { discrete: true })

    if (!savedSelection) throw new Error("Failed to capture the link caret")
    expect(savedSelection.isCollapsed()).toBe(true)

    editor.update(() => $setSelection(null), { discrete: true })
    withRestoredLinkSelection(editor, savedSelection, () => $toggleLink(null))

    expect(firstLink(editor)).toBeUndefined()
    expect(documentText(editor)).toBe("linked phrase with spaces")
  })
})
