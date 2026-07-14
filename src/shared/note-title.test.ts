import { describe, expect, it } from "vitest";
import { NEW_NOTE_TITLE, displayNoteTitle, hasNoteTitle } from "./note-title";

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

  it("uses 'New Note' as the canonical label", () => {
    expect(NEW_NOTE_TITLE).toBe("New Note");
  });
});

describe("hasNoteTitle", () => {
  it("is true for a real, user-provided title", () => {
    expect(hasNoteTitle("Tokyo Trip")).toBe(true);
    expect(hasNoteTitle("  Tokyo Trip  ")).toBe(true);
  });

  it("is false for blank / whitespace / null / undefined titles", () => {
    expect(hasNoteTitle("")).toBe(false);
    expect(hasNoteTitle("   \n\t ")).toBe(false);
    expect(hasNoteTitle(null)).toBe(false);
    expect(hasNoteTitle(undefined)).toBe(false);
  });

  it("is false for the legacy Untitled sentinel", () => {
    expect(hasNoteTitle("Untitled")).toBe(false);
    expect(hasNoteTitle("  Untitled  ")).toBe(false);
  });

  it("is the inverse of showing the placeholder", () => {
    expect(hasNoteTitle("Real")).toBe(displayNoteTitle("Real") !== NEW_NOTE_TITLE);
    expect(hasNoteTitle("")).toBe(displayNoteTitle("") !== NEW_NOTE_TITLE);
  });
});
