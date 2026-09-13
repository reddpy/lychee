import { describe, it, expect } from "vitest"

import {
  stripLeadingTitle,
  resolveTitle,
  resolveNewTitle,
  isBlankTitleStem,
} from "../markdown-title"

describe("stripLeadingTitle", () => {
  it("removes a leading H1 that matches the title", () => {
    expect(stripLeadingTitle("# Hello\n\nbody", "Hello")).toBe("body")
  })

  it("keeps a leading H1 that does not match the title", () => {
    expect(stripLeadingTitle("# Other\n\nbody", "Hello")).toBe("# Other\n\nbody")
  })

  it("ignores deeper headings", () => {
    expect(stripLeadingTitle("body\n\n# Heading", "Hello")).toBe("body\n\n# Heading")
  })

  it("leaves legacy Lexical JSON untouched", () => {
    const json = '{"root":{"children":[]}}'
    expect(stripLeadingTitle(json, "Hello")).toBe(json)
  })

  it("handles leading blank lines", () => {
    expect(stripLeadingTitle("\n\n# Hello\n\nbody", "Hello")).toBe("body")
  })
})

describe("resolveTitle", () => {
  it("prefers a changed frontmatter title", () => {
    expect(
      resolveTitle({ frontmatterTitle: "New", stemTitle: "Old", currentTitle: "Old" }),
    ).toBe("New")
  })

  it("adopts a changed filename stem when frontmatter is unchanged", () => {
    expect(
      resolveTitle({ frontmatterTitle: "Old", stemTitle: "New", currentTitle: "Old" }),
    ).toBe("New")
  })

  it("keeps the current title when nothing changed", () => {
    expect(
      resolveTitle({ frontmatterTitle: "Same", stemTitle: "Same", currentTitle: "Same" }),
    ).toBe("Same")
  })

  it("falls back to the stem when the frontmatter title is absent", () => {
    expect(
      resolveTitle({ frontmatterTitle: undefined, stemTitle: "Stem", currentTitle: "Old" }),
    ).toBe("Stem")
  })

  it("does not adopt a blank-note stem as a title", () => {
    expect(
      resolveTitle({ frontmatterTitle: undefined, stemTitle: "Untitled", currentTitle: "" }),
    ).toBe("")
    expect(
      resolveTitle({
        frontmatterTitle: undefined,
        stemTitle: "Untitled (2)",
        currentTitle: "Untitled (2)",
      }),
    ).toBe("")
  })

  it("normalizes an existing legacy sentinel title to blank", () => {
    expect(
      resolveTitle({ frontmatterTitle: undefined, stemTitle: "Untitled", currentTitle: "Untitled" }),
    ).toBe("")
  })

  it("still adopts a real external rename of a blank note", () => {
    expect(
      resolveTitle({ frontmatterTitle: undefined, stemTitle: "Groceries", currentTitle: "" }),
    ).toBe("Groceries")
  })

  it("does not treat a case-only difference as a rename", () => {
    expect(
      resolveTitle({
        frontmatterTitle: "Canonical",
        stemTitle: "canonical",
        currentTitle: "Canonical",
      }),
    ).toBe("Canonical")
    expect(
      resolveTitle({
        frontmatterTitle: undefined,
        stemTitle: "canonical",
        currentTitle: "Canonical",
      }),
    ).toBe("Canonical")
  })
})

describe("isBlankTitleStem", () => {
  it("matches the blank-note sentinel and its de-dupe variants", () => {
    expect(isBlankTitleStem("Untitled")).toBe(true)
    expect(isBlankTitleStem("untitled (2)")).toBe(true)
    expect(isBlankTitleStem("  Untitled (10)  ")).toBe(true)
  })

  it("does not match real titles", () => {
    expect(isBlankTitleStem("Untitled draft")).toBe(false)
    expect(isBlankTitleStem("My Untitled")).toBe(false)
    expect(isBlankTitleStem("")).toBe(false)
    expect(isBlankTitleStem(null)).toBe(false)
  })
})

describe("resolveNewTitle", () => {
  it("adopts a real filename stem", () => {
    expect(resolveNewTitle({ stemTitle: "Groceries" })).toBe("Groceries")
  })

  it("prefers an explicit legacy frontmatter title", () => {
    expect(resolveNewTitle({ frontmatterTitle: "Old Title", stemTitle: "File" })).toBe("Old Title")
  })

  it("resolves the blank-note sentinel to no title", () => {
    expect(resolveNewTitle({ stemTitle: "Untitled" })).toBe("")
    expect(resolveNewTitle({ stemTitle: "Untitled (3)" })).toBe("")
    expect(resolveNewTitle({ frontmatterTitle: "Untitled", stemTitle: "File" })).toBe("")
  })
})
