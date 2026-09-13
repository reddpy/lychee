import { describe, it, expect, vi } from "vitest"

vi.mock("@/components/editor/nodes/reference-component", () => ({
  ReferenceComponent: (): null => null,
}))

import { createHeadlessEditor } from "@lexical/headless"
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical"

import { nodes } from "@/components/editor/nodes"
import { $createTitleNode } from "@/components/editor/nodes/title-node"
import { $createReferenceNode } from "@/components/editor/nodes/reference-node"
import { parseFrontmatter } from "@/shared/frontmatter"
import type { DocumentRow } from "@/shared/documents"
import { buildVaultEntries, buildVaultEntriesProgressive } from "../vault-export"

function contentFor(build: () => void): string {
  const editor = createHeadlessEditor({ nodes, onError: (error) => { throw error } })
  editor.update(() => {
    const root = $getRoot()
    root.clear()
    $createTitleNode()
    build()
  }, { discrete: true })
  return JSON.stringify(editor.getEditorState().toJSON())
}

function doc(overrides: Partial<DocumentRow> & { id: string; title: string }): DocumentRow {
  return {
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    parentId: null,
    emoji: null,
    deletedAt: null,
    sortOrder: 0,
    metadata: {},
    ...overrides,
  }
}

describe("buildVaultEntries", () => {
  it("builds frontmatter + body for a note tree", () => {
    const parent = doc({
      id: "p",
      title: "Parent Note",
      content: contentFor(() => {
        $getRoot().append($createParagraphNode().append($createTextNode("hello")))
      }),
    })
    const child = doc({ id: "c", title: "Child", parentId: "p", sortOrder: 0 })

    const entries = buildVaultEntries([parent, child])
    const byPath = new Map(entries.map((entry) => [entry.relativePath, entry.contents]))

    expect(byPath.has("Parent Note.md")).toBe(true)
    expect(byPath.has("Parent Note/Child.md")).toBe(true)

    const parentFile = byPath.get("Parent Note.md")!
    const { data, body } = parseFrontmatter(parentFile)
    expect(data).toMatchObject({ id: "p", title: "Parent Note", contentSchemaVersion: 1 })
    // The title lives in frontmatter; the body carries no title line.
    expect(body).toContain("hello")
    expect(body).not.toContain("# Parent Note")
  })

  it("encodes decorator nodes into the body", () => {
    const note = doc({
      id: "n",
      title: "Refs",
      content: contentFor(() => {
        $getRoot().append(
          $createReferenceNode({
            displayMode: "card",
            url: "https://example.com",
            title: "Example",
            description: "desc",
          }),
        )
      }),
    })

    const [entry] = buildVaultEntries([note])
    expect(entry.contents).toContain("[Example](https://example.com)")
    expect(entry.contents).toContain("```lychee-reference")
    expect(entry.contents).toContain('"description":"desc"')
  })

  it("exports an empty note with frontmatter and no body", () => {
    const [entry] = buildVaultEntries([doc({ id: "empty", title: "Empty Note", content: "" })])
    expect(entry.relativePath).toBe("Empty Note.md")
    const { data, body } = parseFrontmatter(entry.contents)
    expect(data.id).toBe("empty")
    expect(data.title).toBe("Empty Note")
    expect(body.trim()).toBe("")
  })

  it("exports JSON-looking content as markdown text", () => {
    const [entry] = buildVaultEntries([doc({ id: "bad", title: "Bad", content: "{not json" })])
    expect(entry.relativePath).toBe("Bad.md")
    expect(entry.contents).toContain("{not json")
  })
})

describe("buildVaultEntriesProgressive", () => {
  it("matches the synchronous build and reports progress", async () => {
    const documents = Array.from({ length: 45 }, (_, index) =>
      doc({ id: `n${index}`, title: `Note ${index}`, sortOrder: index }),
    )
    const sync = buildVaultEntries(documents)

    const progress: number[] = []
    const progressive = await buildVaultEntriesProgressive(documents, (done) => progress.push(done))

    expect(progressive).toEqual(sync)
    expect(progress.length).toBeGreaterThan(1)
    expect(progress[progress.length - 1]).toBe(45)
  })
})
