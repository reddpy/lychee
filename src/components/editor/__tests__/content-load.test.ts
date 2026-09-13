import { describe, it, expect, vi } from "vitest"

vi.mock("@/components/editor/nodes/reference-component", () => ({
  ReferenceComponent: (): null => null,
}))

import { createHeadlessEditor } from "@lexical/headless"
import type { LexicalEditor } from "lexical"

import { nodes } from "@/components/editor/nodes"
import { parseDocumentContent } from "@/components/editor/content-load"
import { CONTENT_SCHEMA_VERSION } from "@/shared/documents"

function text(value: string): any {
  return {
    type: "text",
    version: 1,
    text: value,
    format: 0,
    detail: 0,
    mode: "normal",
    style: "",
    direction: null,
  }
}

function paragraphChildren(children: unknown[]): any {
  return {
    type: "paragraph",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children,
  }
}

function stateWith(children: unknown[]): any {
  return {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children,
    },
  }
}

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "content-load-test",
    nodes,
    onError: (error) => {
      throw error
    },
  })
}

describe("parseDocumentContent", () => {
  it("reports empty content without error", () => {
    expect(parseDocumentContent({ content: "" }).status).toBe("empty")
    expect(parseDocumentContent({ content: "   " }).status).toBe("empty")
    expect(parseDocumentContent({ content: undefined }).status).toBe("empty")
  })

  it("treats malformed JSON-looking content as markdown", () => {
    const result = parseDocumentContent({ content: "{not json" })
    expect(result.status).toBe("ready")
  })

  it("treats valid JSON without a Lexical root as markdown", () => {
    const result = parseDocumentContent({ content: JSON.stringify({ foo: "bar" }) })
    expect(result.status).toBe("ready")
  })

  it("does not accumulate content across successive markdown loads", () => {
    const first = parseDocumentContent({ content: "# First\n\nfirst body" })
    const second = parseDocumentContent({ content: "# Second\n\nsecond body" })
    expect(first.status).toBe("ready")
    expect(second.status).toBe("ready")
    if (second.status !== "ready") return
    const json = JSON.stringify(second.editorState)
    expect(json).toContain("Second")
    expect(json).not.toContain("First")
    expect(json).not.toContain("first body")
  })

  it("loads valid known content as ready", () => {
    const result = parseDocumentContent({
      content: JSON.stringify(stateWith([paragraphChildren([text("hello")])])),
    })
    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.preservedUnknownTypes).toEqual([])
    expect(result.schemaAhead).toBe(false)
  })

  it("migrates legacy image nodes to reference nodes", () => {
    const result = parseDocumentContent({
      content: JSON.stringify(
        stateWith([
          {
            type: "image",
            version: 1,
            sourceUrl: "https://example.com/pic.png",
            imageId: "img-1",
            altText: "Pic",
          },
        ]),
      ),
    })
    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    const first = (result.editorState as any).root.children[0]
    expect(first.type).toBe("reference")
    expect(first.displayMode).toBe("image")
    expect(first.url).toBe("https://example.com/pic.png")
    expect(first.imageId).toBe("img-1")
  })

  it("flags content written by a newer content schema", () => {
    const content = JSON.stringify(stateWith([paragraphChildren([text("hi")])]))
    const ahead = parseDocumentContent({
      content,
      contentSchemaVersion: CONTENT_SCHEMA_VERSION + 1,
    })
    expect(ahead.status).toBe("ready")
    if (ahead.status === "ready") expect(ahead.schemaAhead).toBe(true)

    const current = parseDocumentContent({ content, contentSchemaVersion: CONTENT_SCHEMA_VERSION })
    if (current.status === "ready") expect(current.schemaAhead).toBe(false)
  })
})

describe("unknown-node preservation (#286)", () => {
  const content = JSON.stringify(
    stateWith([
      paragraphChildren([text("before")]),
      {
        type: "future-node",
        version: 1,
        foo: "bar",
        children: [text("hidden")],
      },
      paragraphChildren([text("after")]),
    ]),
  )

  it("wraps the unknown node instead of aborting the parse", () => {
    const result = parseDocumentContent({ content })
    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.preservedUnknownTypes).toEqual(["future-node"])

    const children = (result.editorState as any).root.children
    expect(children.map((c: any) => c.type)).toEqual(["paragraph", "unknown", "paragraph"])
    expect(children[1].raw).toMatchObject({ type: "future-node", foo: "bar" })
  })

  it("keeps content on both sides of the unknown node through a load/save cycle", () => {
    const result = parseDocumentContent({ content })
    if (result.status !== "ready") throw new Error("expected ready")

    const editor = makeEditor()
    editor.setEditorState(editor.parseEditorState(JSON.stringify(result.editorState)))

    const out = editor.getEditorState().toJSON() as any
    const serialized = JSON.stringify(out)

    expect(serialized).toContain('"before"')
    expect(serialized).toContain('"after"')

    const types = out.root.children.map((c: any) => c.type)
    expect(types).toEqual(["paragraph", "unknown", "paragraph"])

    // The original payload is preserved verbatim inside the envelope, so an
    // upgraded build can restore it.
    expect(out.root.children[1].raw).toMatchObject({ type: "future-node", foo: "bar" })
    expect(out.root.children[1].raw.children[0].text).toBe("hidden")
  })

  it("unwraps a preserved node once the build knows the raw type", () => {
    const result = parseDocumentContent({ content })
    if (result.status !== "ready") throw new Error("expected ready")

    const editor = makeEditor()
    editor.setEditorState(editor.parseEditorState(JSON.stringify(result.editorState)))
    const saved = JSON.stringify(editor.getEditorState().toJSON())

    // Simulate an upgraded build that now registers "future-node".
    const upgradedKnownTypes = new Set([...nodes.map((n) => n.getType()), "future-node", "paragraph", "text", "root"])
    const upgraded = parseDocumentContent({ content: saved, knownTypes: upgradedKnownTypes })
    if (upgraded.status !== "ready") throw new Error("expected ready")
    expect(upgraded.preservedUnknownTypes).toEqual([])
    const children = (upgraded.editorState as any).root.children
    expect(children.map((c: any) => c.type)).toEqual(["paragraph", "future-node", "paragraph"])
    expect(children[1].foo).toBe("bar")
  })

  it("preserves an unknown node nested inline inside a paragraph", () => {
    const inlineContent = JSON.stringify(
      stateWith([
        paragraphChildren([text("a"), { type: "future-inline", foo: 1 }, text("b")]),
      ]),
    )

    const result = parseDocumentContent({ content: inlineContent })
    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.preservedUnknownTypes).toEqual(["future-inline"])

    const editor = makeEditor()
    editor.setEditorState(editor.parseEditorState(JSON.stringify(result.editorState)))
    const out = editor.getEditorState().toJSON() as any
    const serialized = JSON.stringify(out)
    expect(serialized).toContain('"a"')
    expect(serialized).toContain('"b"')
    expect(serialized).toContain("future-inline")
  })
})
