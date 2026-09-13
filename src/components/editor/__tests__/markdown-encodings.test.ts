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
  type LexicalNode,
} from "lexical"

import { nodes } from "@/components/editor/nodes"
import { $createTitleNode } from "@/components/editor/nodes/title-node"
import { $createReferenceNode, $isReferenceNode } from "@/components/editor/nodes/reference-node"
import { $createNoteBookmarkNode, $isNoteBookmarkNode } from "@/components/editor/nodes/note-bookmark-node"
import { $createUnknownNode, $isUnknownNode } from "@/components/editor/nodes/unknown-node"
import { exportDocumentMarkdown, importDocumentMarkdown } from "@/components/editor/markdown-io"

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "markdown-encodings-test",
    nodes,
    onError: (error) => {
      throw error
    },
  })
}

function edit(editor: LexicalEditor, fn: () => void): void {
  editor.update(fn, { discrete: true })
}

function exportMarkdown(editor: LexicalEditor): string {
  return exportDocumentMarkdown(editor)
}

function importMarkdown(editor: LexicalEditor, markdown: string): void {
  importDocumentMarkdown(editor, markdown)
}

/** Build a document with a leading title (real notes always have one). */
function buildDocument(editor: LexicalEditor, append: () => void): void {
  edit(editor, () => {
    const root = $getRoot()
    root.clear()
    root.append($createTitleNode().append($createTextNode("Note Title")))
    append()
  })
}

function topLevelTypes(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() => $getRoot().getChildren().map((node) => node.getType()))
}

function firstReference(editor: LexicalEditor): Record<string, unknown> | undefined {
  return editor.getEditorState().read(() => {
    const node = $getRoot().getChildren().find($isReferenceNode)
    if (!$isReferenceNode(node)) return undefined
    return {
      url: node.getUrl(),
      title: node.getTitle(),
      altText: node.getAltText(),
      displayMode: node.getDisplayMode(),
      description: node.getDescription(),
      imageUrl: node.getImageUrl(),
      faviconUrl: node.getFaviconUrl(),
      imageId: node.getImageId(),
      width: node.getWidth(),
      height: node.getHeight(),
      alignment: node.getAlignment(),
      autoResolve: node.getAutoResolve(),
      hydrationAttempted: node.getHydrationAttempted(),
    }
  })
}

function findUnknownRaw(editor: LexicalEditor): unknown {
  return editor.getEditorState().read(() => {
    let found: unknown
    const walk = (node: LexicalNode) => {
      if ($isUnknownNode(node)) {
        found = node.getRaw()
        return
      }
      const children = (node as unknown as { getChildren?: () => LexicalNode[] }).getChildren
      if (typeof children === "function") children.call(node).forEach(walk)
    }
    $getRoot().getChildren().forEach(walk)
    return found
  })
}

function findBookmark(editor: LexicalEditor):
  | { label: string; createdAt: string; paragraphText: string }
  | undefined {
  return editor.getEditorState().read(() => {
    for (const top of $getRoot().getChildren()) {
      const children = (top as unknown as { getChildren?: () => LexicalNode[] }).getChildren
      if (typeof children !== "function") continue
      for (const child of children.call(top)) {
        if ($isNoteBookmarkNode(child)) {
          return { label: child.getLabel(), createdAt: child.getCreatedAt(), paragraphText: top.getTextContent() }
        }
      }
    }
    return undefined
  })
}

/** md -> nodes -> md must be stable. */
function roundTrip(base: string, markdown: string): string {
  const editor = makeEditor()
  importMarkdown(editor, markdown)
  expect(exportMarkdown(editor)).toBe(base)
  return base
}

describe("markdown encodings — reference", () => {
  it("round-trips a card with all non-markdown fields", () => {
    const editor = makeEditor()
    buildDocument(editor, () => {
      $getRoot().append(
        $createReferenceNode({
          displayMode: "card",
          url: "https://example.com",
          title: "Example",
          description: "A description",
          imageUrl: "https://example.com/og.png",
          faviconUrl: "https://example.com/favicon.ico",
          autoResolve: true,
          hydrationAttempted: true,
        }),
      )
    })

    const markdown = exportMarkdown(editor)
    expect(markdown).toContain("[Example](https://example.com)")
    expect(markdown).toContain("```lychee-reference")

    const imported = makeEditor()
    importMarkdown(imported, markdown)
    expect(topLevelTypes(imported)).toEqual(["reference"])
    expect(firstReference(imported)).toMatchObject({
      displayMode: "card",
      url: "https://example.com",
      title: "Example",
      description: "A description",
      imageUrl: "https://example.com/og.png",
      faviconUrl: "https://example.com/favicon.ico",
      autoResolve: true,
      hydrationAttempted: true,
    })
    roundTrip(markdown, markdown)
  })

  it("round-trips an image reference with local asset + geometry", () => {
    const editor = makeEditor()
    buildDocument(editor, () => {
      $getRoot().append(
        $createReferenceNode({
          displayMode: "image",
          imageId: "abc-123.png",
          altText: "A picture",
          width: 640,
          height: 480,
          alignment: "center",
        }),
      )
    })

    const markdown = exportMarkdown(editor)
    expect(markdown).toContain("![A picture](lychee-asset://abc-123.png)")

    const imported = makeEditor()
    importMarkdown(imported, markdown)
    expect(firstReference(imported)).toMatchObject({
      displayMode: "image",
      altText: "A picture",
      imageId: "abc-123.png",
      width: 640,
      height: 480,
      alignment: "center",
    })
    roundTrip(markdown, markdown)
  })

  it("round-trips a remote image", () => {
    const editor = makeEditor()
    buildDocument(editor, () => {
      $getRoot().append(
        $createReferenceNode({
          displayMode: "image",
          url: "https://cdn.example.com/pic.png",
          altText: "Remote",
        }),
      )
    })

    const markdown = exportMarkdown(editor)
    const imported = makeEditor()
    importMarkdown(imported, markdown)
    expect(firstReference(imported)).toMatchObject({
      displayMode: "image",
      url: "https://cdn.example.com/pic.png",
      altText: "Remote",
    })
    roundTrip(markdown, markdown)
  })

  it("imports a standalone reference fence", () => {
    const markdown = [
      "# Note Title",
      "",
      "```lychee-reference",
      '{"displayMode":"card","url":"https://standalone.example","title":"Standalone"}',
      "```",
    ].join("\n")

    const editor = makeEditor()
    importMarkdown(editor, markdown)
    expect(firstReference(editor)).toMatchObject({
      displayMode: "card",
      url: "https://standalone.example",
      title: "Standalone",
    })
  })
})

describe("markdown encodings — note bookmark", () => {
  it("round-trips an inline bookmark and surrounding text", () => {
    const editor = makeEditor()
    buildDocument(editor, () => {
      const paragraph = $createParagraphNode()
      paragraph.append(
        $createNoteBookmarkNode({ label: "Chapter 1", createdAt: "2026-01-02T03:04:05.000Z" }),
        $createTextNode("bookmarked text"),
      )
      $getRoot().append(paragraph)
    })

    const markdown = exportMarkdown(editor)
    expect(markdown).toContain("<!--lychee-bookmark:b64 ")

    const imported = makeEditor()
    importMarkdown(imported, markdown)
    expect(findBookmark(imported)).toEqual({
      label: "Chapter 1",
      createdAt: "2026-01-02T03:04:05.000Z",
      paragraphText: "bookmarked text",
    })
    roundTrip(markdown, markdown)
  })
})

describe("markdown encodings — unknown nodes", () => {
  it("round-trips a top-level unknown node verbatim", () => {
    const raw = { type: "future-video", url: "https://v.example/1", meta: { autoplay: true } }
    const editor = makeEditor()
    buildDocument(editor, () => {
      $getRoot().append($createUnknownNode(raw))
    })

    const markdown = exportMarkdown(editor)
    expect(markdown).toContain("```lychee-unknown")
    expect(markdown).toContain('"future-video"')

    const imported = makeEditor()
    importMarkdown(imported, markdown)
    expect(findUnknownRaw(imported)).toEqual(raw)
    roundTrip(markdown, markdown)
  })

  it("round-trips an unknown node nested inside a paragraph", () => {
    const raw = { type: "future-inline", value: 42 }
    const editor = makeEditor()
    buildDocument(editor, () => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode("before "), $createUnknownNode(raw), $createTextNode(" after"))
      $getRoot().append(paragraph)
    })

    const markdown = exportMarkdown(editor)
    const imported = makeEditor()
    importMarkdown(imported, markdown)
    imported.getEditorState().read(() => {
      const text = $getRoot().getChildren().map((node) => node.getTextContent()).join("")
      expect(text).toContain("before")
      expect(text).toContain("after")
    })
    expect(findUnknownRaw(imported)).toEqual(raw)
    roundTrip(markdown, markdown)
  })
})

describe("markdown encodings — title ownership", () => {
  it("does not export the inline title into the body", () => {
    const editor = makeEditor()
    buildDocument(editor, () => {
      $getRoot().append($createParagraphNode().append($createTextNode("body")))
    })

    const markdown = exportMarkdown(editor)
    expect(markdown).toBe("body")
    expect(markdown).not.toContain("Note Title")
  })

  it("treats a leading h1 as ordinary content on import", () => {
    const editor = makeEditor()
    importMarkdown(editor, "# Imported Title\n\nSome body text.")
    expect(topLevelTypes(editor)).toEqual(["heading", "paragraph"])
  })

  it("does not synthesize a title when the markdown has none", () => {
    const editor = makeEditor()
    importMarkdown(editor, "Just body text.")
    expect(topLevelTypes(editor)).toEqual(["paragraph"])
  })

  it("keeps a body h1 as content in place", () => {
    const editor = makeEditor()
    importMarkdown(editor, "Intro paragraph.\n\n# A body heading")
    expect(topLevelTypes(editor)).toEqual(["paragraph", "heading"])
  })
})
