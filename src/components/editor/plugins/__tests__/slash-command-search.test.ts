import { describe, expect, it } from "vitest"
import { filterSlashCommands, type SlashCommandSearchItem } from "../slash-command-search"

const commands: SlashCommandSearchItem[] = [
  { title: "Text", keywords: ["text", "p", "paragraph", "normal", "plain text"] },
  { title: "Heading 1", keywords: ["h1", "heading", "heading1", "header", "title"] },
  { title: "Heading 2", keywords: ["h2", "heading2", "subtitle"] },
  { title: "Heading 3", keywords: ["h3", "heading3", "subheading"] },
  { title: "Bullet List", keywords: ["ul", "unordered", "bullets", "bulletlist"] },
  {
    title: "Numbered List",
    keywords: ["ol", "ordered", "number list", "numberedlist"],
  },
  {
    title: "Check List",
    keywords: ["todo", "checkbox", "checklist", "task", "tasklist"],
  },
  { title: "Quote", keywords: ["quote", "blockquote"] },
  { title: "Code Block", keywords: ["code", "codeblock", "snippet", "pre"] },
  { title: "Divider", keywords: ["div", "hr", "horizontal rule", "separator"] },
  { title: "Table", keywords: ["sheet", "grid", "spreadsheet"] },
]

const titles = (query: string | null): string[] =>
  filterSlashCommands(commands, query).map((command) => command.title)

describe("filterSlashCommands", () => {
  it("returns every command for an empty slash query", () => {
    expect(titles("")).toEqual(commands.map((command) => command.title))
  })

  it("matches labels without requiring their visible spaces", () => {
    expect(titles("heading3")[0]).toBe("Heading 3")
    expect(titles("codeblock")[0]).toBe("Code Block")
    expect(titles("numberedlist")[0]).toBe("Numbered List")
  })

  it("matches common aliases", () => {
    expect(titles("h1")[0]).toBe("Heading 1")
    expect(titles("todo")[0]).toBe("Check List")
    expect(titles("checkbox")[0]).toBe("Check List")
  })

  it.each([
    ["normal", "Text"],
    ["header", "Heading 1"],
    ["bulletlist", "Bullet List"],
    ["numberedlist", "Numbered List"],
    ["tasklist", "Check List"],
    ["quote", "Quote"],
    ["code", "Code Block"],
    ["div", "Divider"],
    ["sheet", "Table"],
  ])("ranks the everyday term %s first for %s", (query, title) => {
    expect(titles(query)[0]).toBe(title)
  })

  it("matches partial and abbreviated terms", () => {
    expect(titles("head2")[0]).toBe("Heading 2")
    expect(titles("buli")[0]).toBe("Bullet List")
    expect(titles("sprd")[0]).toBe("Table")
  })

  it.each([
    ["tex", "Text"],
    ["head1", "Heading 1"],
    ["head2", "Heading 2"],
    ["head3", "Heading 3"],
    ["bull", "Bullet List"],
    ["numb", "Numbered List"],
    ["checkb", "Check List"],
    ["quot", "Quote"],
    ["codeb", "Code Block"],
    ["divi", "Divider"],
    ["tabl", "Table"],
  ])("finds %s as a partial match for %s", (query, title) => {
    expect(titles(query)).toContain(title)
  })

  it("ranks exact aliases ahead of looser fuzzy matches", () => {
    expect(titles("h3")[0]).toBe("Heading 3")
    expect(titles("hr")[0]).toBe("Divider")
  })

  it("handles punctuation as text instead of a regular expression", () => {
    expect(() => titles("[")).not.toThrow()
    expect(titles("[")).toEqual([])
  })
})
