import { describe, it, expect } from "vitest";

import {
  buildHighlightedSnippet,
  countOccurrences,
  extractPlainText,
  normalizedTitle,
  scoreDocument,
} from "../../../shared/search-preview";

describe("Search Preview Utils — Backend Contracts", () => {
  describe("normalizedTitle()", () => {
    it("returns trimmed title when non-empty", () => {
      expect(normalizedTitle("  My note  ")).toBe("My note");
    });

    it("falls back to Untitled for empty title", () => {
      expect(normalizedTitle("")).toBe("Untitled");
    });

    it("falls back to Untitled for whitespace-only title", () => {
      expect(normalizedTitle("   \n\t  ")).toBe("Untitled");
    });
  });

  describe("scoreDocument()", () => {
    it("returns 300 for exact case-insensitive title match", () => {
      expect(scoreDocument("Roadmap", "roadmap")).toBe(300);
    });

    it("returns 200 for prefix match", () => {
      expect(scoreDocument("Roadmap v2", "road")).toBe(200);
    });

    it("returns 100 for contains match", () => {
      expect(scoreDocument("Engineering Roadmap", "map")).toBe(100);
    });

    it("returns -1 when title does not match query", () => {
      expect(scoreDocument("Engineering", "roadmap")).toBe(-1);
    });

    it("uses Untitled fallback when title is blank", () => {
      expect(scoreDocument("   ", "untitled")).toBe(300);
    });

    it("returns 0 for empty query", () => {
      expect(scoreDocument("Anything", "   ")).toBe(0);
    });

    it("trims query before scoring", () => {
      expect(scoreDocument("Roadmap", "  roadmap  ")).toBe(300);
    });
  });

  describe("countOccurrences()", () => {
    it("counts case-insensitive occurrences", () => {
      expect(countOccurrences("Wal wal WAL", "wal")).toBe(3);
    });

    it("counts non-overlapping occurrences only", () => {
      expect(countOccurrences("aaaa", "aa")).toBe(2);
    });

    it("counts one when only one match exists", () => {
      expect(countOccurrences("hello world", "world")).toBe(1);
    });

    it("returns 0 when query is not found", () => {
      expect(countOccurrences("hello world", "xyz")).toBe(0);
    });

    it("returns 0 for empty source", () => {
      expect(countOccurrences("", "abc")).toBe(0);
    });

    it("returns 0 for empty query", () => {
      expect(countOccurrences("abc", "")).toBe(0);
    });

    it("trims query before matching", () => {
      expect(countOccurrences("alpha beta alpha", "  alpha  ")).toBe(2);
    });
  });

  describe("extractPlainText()", () => {
    it("extracts text-like fields recursively from lexical-like JSON", () => {
      const input = JSON.stringify({
        root: {
          children: [
            { type: "paragraph", children: [{ text: "hello" }, { text: "world" }] },
            { type: "code", code: "const x = 1;" },
          ],
        },
      });
      expect(extractPlainText(input)).toBe("hello world const x = 1;");
    });

    it("includes description/url/altText/caption fields", () => {
      const input = JSON.stringify({
        description: "Card description",
        url: "https://example.com",
        altText: "sample image",
        caption: "Figure 1",
      });
      expect(extractPlainText(input)).toBe(
        "Card description https://example.com sample image Figure 1",
      );
    });

    it("ignores unknown string keys that are not text-like", () => {
      const input = JSON.stringify({
        title: "Should not be indexed here",
        foo: "also ignored",
        nested: { bar: "ignored too" },
      });
      expect(extractPlainText(input)).toBe("");
    });

    it("normalizes repeated whitespace in extracted output", () => {
      const input = JSON.stringify({
        text: "  one   two  ",
        nested: { text: "\nthree\t\tfour " },
      });
      expect(extractPlainText(input)).toBe("one two three four");
    });

    it("returns empty string on invalid JSON", () => {
      expect(extractPlainText("{not-json")).toBe("");
    });

    it("returns empty string when content is empty", () => {
      expect(extractPlainText("")).toBe("");
    });
  });

  describe("buildHighlightedSnippet()", () => {
    it("returns null when query is empty", () => {
      expect(buildHighlightedSnippet("hello world", "  ")).toBeNull();
    });

    it("returns null when text is empty", () => {
      expect(buildHighlightedSnippet("", "hello")).toBeNull();
    });

    it("returns null when query does not exist in text", () => {
      expect(buildHighlightedSnippet("hello world", "xyz")).toBeNull();
    });

    it("builds snippet with exact match in the middle", () => {
      const snippet = buildHighlightedSnippet("alpha beta gamma", "beta", 10);
      expect(snippet).toEqual({
        before: "alpha ",
        match: "beta",
        after: " gamma",
      });
    });

    it("matches case-insensitively but preserves original match casing", () => {
      const snippet = buildHighlightedSnippet("alpha BeTa gamma", "beta", 10);
      expect(snippet).toEqual({
        before: "alpha ",
        match: "BeTa",
        after: " gamma",
      });
    });

    it("adds ellipses when window is trimmed on both sides", () => {
      const text = "prefix words here target words there suffix";
      const snippet = buildHighlightedSnippet(text, "target", 4);
      expect(snippet).toEqual({
        before: "...ere ",
        match: "target",
        after: " wor...",
      });
    });

    it("omits leading ellipsis when match starts near beginning", () => {
      const snippet = buildHighlightedSnippet("target appears early in text", "target", 8);
      expect(snippet?.before.startsWith("...")).toBe(false);
    });

    it("omits trailing ellipsis when match is near the end", () => {
      const snippet = buildHighlightedSnippet("text ending has target", "target", 8);
      expect(snippet?.after.endsWith("...")).toBe(false);
    });

    it("normalizes whitespace before snippet generation", () => {
      const snippet = buildHighlightedSnippet("alpha    beta \n gamma", "beta", 10);
      expect(snippet).toEqual({
        before: "alpha ",
        match: "beta",
        after: " gamma",
      });
    });
  });
});
