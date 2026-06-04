import { describe, expect, it } from "vitest";
import { NEW_NOTE_TITLE, displayNoteTitle } from "./note-title";

describe("displayNoteTitle", () => {
  it("returns the trimmed title when present", () => {
    expect(displayNoteTitle("Roadmap")).toBe("Roadmap");
    expect(displayNoteTitle("  Roadmap  ")).toBe("Roadmap");
  });

  it("falls back to the canonical label for empty/whitespace titles", () => {
    expect(displayNoteTitle("")).toBe(NEW_NOTE_TITLE);
    expect(displayNoteTitle("   \n\t ")).toBe(NEW_NOTE_TITLE);
  });

  it("treats null/undefined as untitled", () => {
    expect(displayNoteTitle(null)).toBe(NEW_NOTE_TITLE);
    expect(displayNoteTitle(undefined)).toBe(NEW_NOTE_TITLE);
  });

  it("maps the legacy Untitled sentinel to the canonical label", () => {
    expect(displayNoteTitle("Untitled")).toBe(NEW_NOTE_TITLE);
    expect(displayNoteTitle("  Untitled  ")).toBe(NEW_NOTE_TITLE);
  });

  it("does not treat a title that merely contains 'Untitled' as empty", () => {
    expect(displayNoteTitle("Untitled draft")).toBe("Untitled draft");
  });

  it("uses 'New Page' as the canonical label", () => {
    expect(NEW_NOTE_TITLE).toBe("New Page");
  });
});
