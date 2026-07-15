import { describe, expect, it } from "vitest"

import {
  createInternalNoteUrl,
  parseInternalNoteUrl,
  rankNoteLinkCandidates,
} from "./internal-note-link"

const documents = [
  { id: "source", title: "Source", updatedAt: "2026-07-14T10:00:00.000Z" },
  { id: "exact", title: "Project", updatedAt: "2026-07-14T09:00:00.000Z" },
  { id: "prefix", title: "Project notes", updatedAt: "2026-07-14T12:00:00.000Z" },
  { id: "contains", title: "Summer project archive", updatedAt: "2026-07-14T13:00:00.000Z" },
  { id: "body-only", title: "Unrelated", updatedAt: "2026-07-14T14:00:00.000Z" },
  { id: "untitled", title: "", updatedAt: "2026-07-14T15:00:00.000Z" },
]

describe("internal note URLs", () => {
  it("round-trips a stable document ID", () => {
    const url = createInternalNoteUrl("8e03fe21-87ce-4de9-b34d-13bcf3ecf9d5")

    expect(url).toBe("https://note.lychee.invalid/8e03fe21-87ce-4de9-b34d-13bcf3ecf9d5")
    expect(parseInternalNoteUrl(url)).toEqual({
      documentId: "8e03fe21-87ce-4de9-b34d-13bcf3ecf9d5",
    })
  })

  it("keeps a future heading fragment from changing the page target", () => {
    expect(parseInternalNoteUrl("https://note.lychee.invalid/document-id#overview")).toEqual({
      documentId: "document-id",
    })
  })

  it.each([
    "https://example.com",
    "https://document.lychee.invalid/document-id",
    "https://note.lychee.invalid",
    "https://note.lychee.invalid/first/second",
    "https://note.lychee.invalid/%",
    "not a URL",
  ])("rejects non-note URL %s", (url) => {
    expect(parseInternalNoteUrl(url)).toBeNull()
  })

  it("rejects an empty document ID when creating a link", () => {
    expect(() => createInternalNoteUrl("   ")).toThrow(/document ID/)
  })
})

describe("note-link title search", () => {
  it("excludes the source and ranks exact, prefix, then substring matches", () => {
    const results = rankNoteLinkCandidates(documents, "project", "source")

    expect(results.map((result) => result.document.id)).toEqual([
      "exact",
      "prefix",
      "contains",
    ])
  })

  it("searches titles only", () => {
    expect(rankNoteLinkCandidates(documents, "body-only content", "source")).toEqual([])
  })

  it("shows recent notes for an empty query and uses the canonical blank title", () => {
    const results = rankNoteLinkCandidates(documents, "", "source", 2)

    expect(results.map((result) => [result.document.id, result.displayTitle])).toEqual([
      ["untitled", "New Note"],
      ["body-only", "Unrelated"],
    ])
  })

  it("honors a zero result limit", () => {
    expect(rankNoteLinkCandidates(documents, "", "source", 0)).toEqual([])
  })
})
