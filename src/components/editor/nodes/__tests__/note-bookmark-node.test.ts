/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  createEditor,
  type ElementNode,
  type TextNode,
} from "lexical"

import {
  $createNoteBookmarkNode,
  $isNoteBookmarkNode,
  NoteBookmarkNode,
} from "../note-bookmark-node"
import {
  $findBookmarkInBlock,
  $getBookmarkBlock,
  $isBlockBookmarked,
  $toggleBookmarkForSelection,
} from "../../plugins/note-bookmark-plugin"

function createTestEditor() {
  return createEditor({
    namespace: "note-bookmark-test",
    nodes: [NoteBookmarkNode],
    onError: (error) => {
      throw error
    },
  })
}

function seedParagraph(editor: ReturnType<typeof createTestEditor>, text: string) {
  editor.update(
    () => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(text))
      $getRoot().append(paragraph)
    },
    { discrete: true },
  )
}

describe("NoteBookmarkNode serialization", () => {
  it("round-trips through JSON with its label and createdAt", () => {
    const editor = createTestEditor()
    const createdAt = "2026-01-02T03:04:05.000Z"
    editor.update(
      () => {
        $getRoot().append($createNoteBookmarkNode({ label: "Chapter one", createdAt }))
      },
      { discrete: true },
    )

    const serialized = JSON.stringify(editor.getEditorState().toJSON())
    expect(serialized).toContain('"type":"note-bookmark"')
    expect(serialized).toContain("Chapter one")

    const restored = createTestEditor()
    restored.setEditorState(restored.parseEditorState(serialized))
    restored.getEditorState().read(() => {
      const node = $getRoot().getFirstChild()
      expect($isNoteBookmarkNode(node)).toBe(true)
      const bookmark = node as NoteBookmarkNode
      expect(bookmark.getLabel()).toBe("Chapter one")
      expect(bookmark.getCreatedAt()).toBe(createdAt)
    })
  })

  it("contributes no text content", () => {
    const editor = createTestEditor()
    seedParagraph(editor, "hello world")
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild() as ElementNode
        paragraph.splice(0, 0, [$createNoteBookmarkNode({ label: "mark" })])
      },
      { discrete: true },
    )

    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
      "hello world",
    )
  })
})

describe("bookmark helpers", () => {
  it("toggle adds a marker to the selected block and uses the selection as its label", () => {
    const editor = createTestEditor()
    seedParagraph(editor, "Hello world")

    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild() as ElementNode
        const text = paragraph.getFirstChild() as TextNode
        text.select(0, 5)
        expect($toggleBookmarkForSelection()).toBe(true)
      },
      { discrete: true },
    )

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild() as ElementNode
      expect($isBlockBookmarked(paragraph)).toBe(true)
      expect($findBookmarkInBlock(paragraph)?.getLabel()).toBe("Hello")
    })
  })

  it("falls back to the block text when the selection is collapsed", () => {
    const editor = createTestEditor()
    seedParagraph(editor, "Whole block label")

    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild() as ElementNode
        const text = paragraph.getFirstChild() as TextNode
        text.select(3, 3)
        expect($toggleBookmarkForSelection()).toBe(true)
      },
      { discrete: true },
    )

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild() as ElementNode
      expect($findBookmarkInBlock(paragraph)?.getLabel()).toBe("Whole block label")
    })
  })

  it("toggling an already-bookmarked block removes the marker", () => {
    const editor = createTestEditor()
    seedParagraph(editor, "Toggle me")

    const selectBlock = () => {
      const paragraph = $getRoot().getFirstChild() as ElementNode
      const text = paragraph.getChildren().find($isTextNode) as TextNode
      text.select(0, 6)
      return $toggleBookmarkForSelection()
    }

    editor.update(() => expect(selectBlock()).toBe(true), { discrete: true })
    editor.update(() => expect(selectBlock()).toBe(true), { discrete: true })

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild() as ElementNode
      expect($isBlockBookmarked(paragraph)).toBe(false)
      expect($getBookmarkBlock(paragraph)).toBe(paragraph)
    })
  })
})
