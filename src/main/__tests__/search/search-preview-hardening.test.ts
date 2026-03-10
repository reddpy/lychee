import { describe, it, expect } from "vitest";

import {
  buildHighlightedSnippet,
  countOccurrences,
  extractPlainText,
  scoreDocument,
} from "../../../shared/search-preview";
import {
  applySerializedHighlights,
  buildHighlightedPreviewStateFromParsed,
  TEXT_FORMAT_HIGHLIGHT,
} from "../../../shared/search-preview-state";

type LexicalLikeState = {
  root?: {
    type?: string;
    version?: number;
    children?: unknown;
  };
};

function makeLargeLexicalState(repetitions: number): LexicalLikeState {
  return {
    root: {
      type: "root",
      version: 1,
      children: Array.from({ length: repetitions }, (_, i) => ({
        type: "paragraph",
        children: [
          {
            type: "text",
            text: `line ${i} alpha beta gamma delta`,
            format: 0,
            detail: 0,
            mode: "normal",
            style: "",
            version: 1,
          },
        ],
      })),
    },
  };
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function randomJsonNode(rand: () => number, depth = 0): unknown {
  if (depth > 4) {
    const primitives = [null, true, false, Math.floor(rand() * 100), `leaf-${Math.floor(rand() * 10)}`];
    return primitives[Math.floor(rand() * primitives.length)];
  }
  const kind = Math.floor(rand() * 4);
  if (kind === 0) {
    const obj: Record<string, unknown> = {};
    const keys = ["text", "code", "description", "url", "altText", "caption", "noop", "meta"];
    const count = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i += 1) {
      const key = keys[Math.floor(rand() * keys.length)];
      obj[key] = rand() > 0.45 ? randomJsonNode(rand, depth + 1) : `value-${Math.floor(rand() * 50)}`;
    }
    return obj;
  }
  if (kind === 1) {
    const length = Math.floor(rand() * 5);
    return Array.from({ length }, () => randomJsonNode(rand, depth + 1));
  }
  if (kind === 2) {
    return `str-${Math.floor(rand() * 999)}`;
  }
  return Math.floor(rand() * 1000);
}

describe("Search Preview — Hardening", () => {
  describe("Unicode and grapheme behavior", () => {
    it("counts emoji with skin tone modifiers correctly", () => {
      const text = "👍🏽 start 👍🏽 end";
      expect(countOccurrences(text, "👍🏽")).toBe(2);
    });

    it("matches emoji snippets without corrupting graphemes", () => {
      const snippet = buildHighlightedSnippet("before 👍🏽 middle after", "👍🏽", 8);
      expect(snippet?.match).toBe("👍🏽");
    });

    it("is accent-sensitive across precomposed vs combining forms", () => {
      const combining = "Cafe\u0301 menu";
      expect(countOccurrences(combining, "é")).toBe(0);
      expect(countOccurrences(combining, "e\u0301")).toBe(1);
    });

    it("keeps scoring case-insensitive for ASCII title matching", () => {
      expect(scoreDocument("WAL Tracker", "wal")).toBe(200);
    });
  });

  describe("Large payload durability", () => {
    it("extracts plain text from large lexical payload without truncation", () => {
      const state = makeLargeLexicalState(3000);
      const input = JSON.stringify(state);
      const extracted = extractPlainText(input);
      expect(extracted.length).toBeGreaterThan(20000);
      expect(extracted).toContain("line 0 alpha beta gamma delta");
      expect(extracted).toContain("line 2999 alpha beta gamma delta");
    });

    it("applies highlights across large state and marks many matches", () => {
      const state = makeLargeLexicalState(2000) as {
        root: { children: { children: { type: string; text?: string; format?: number }[] }[] };
      };
      const highlighted = applySerializedHighlights(state, "beta");
      const serialized = JSON.stringify(highlighted);
      expect(serialized.length).toBeGreaterThan(100000);
      const matchCount = highlighted.root.children.reduce((count, para) => {
        return (
          count +
          para.children.filter(
            (node) => node.type === "text" && ((node.format ?? 0) & TEXT_FORMAT_HIGHLIGHT) !== 0,
          ).length
        );
      }, 0);
      expect(matchCount).toBeGreaterThan(1500);
    });
  });

  describe("Fuzz/property safety for extraction", () => {
    it("never throws on randomized nested JSON structures", () => {
      const rand = seededRandom(20260313);
      for (let i = 0; i < 120; i += 1) {
        const node = randomJsonNode(rand);
        const json = JSON.stringify(node);
        expect(() => extractPlainText(json)).not.toThrow();
      }
    });

    it("always returns a string from randomized JSON input", () => {
      const rand = seededRandom(9173);
      for (let i = 0; i < 80; i += 1) {
        const json = JSON.stringify(randomJsonNode(rand));
        const output = extractPlainText(json);
        expect(typeof output).toBe("string");
      }
    });
  });

  describe("Corruption/failure-mode handling", () => {
    it("handles parsed states with missing root safely", () => {
      const serialized = buildHighlightedPreviewStateFromParsed({} as LexicalLikeState, "beta");
      expect(typeof serialized).toBe("string");
      expect(JSON.parse(serialized as string)).toEqual({});
    });

    it("handles parsed states with non-array children without crashing", () => {
      const malformed = {
        root: {
          type: "root",
          version: 1,
          children: { not: "an-array" },
        },
      } as unknown as LexicalLikeState;
      const serialized = buildHighlightedPreviewStateFromParsed(malformed, "beta");
      expect(typeof serialized).toBe("string");
      const roundTrip = JSON.parse(serialized as string) as { root: { children: unknown } };
      expect(roundTrip.root.children).toEqual({ not: "an-array" });
    });

    it("handles children arrays that include null/primitive/object mixtures", () => {
      const malformed = {
        root: {
          type: "root",
          version: 1,
          children: [
            null,
            42,
            "raw",
            { type: "paragraph", children: [null, { type: "text", text: "beta hit", format: 0 }] },
          ],
        },
      } as unknown as LexicalLikeState;
      const serialized = buildHighlightedPreviewStateFromParsed(malformed, "beta");
      const roundTrip = JSON.parse(serialized as string) as {
        root: { children: unknown[] };
      };
      expect(roundTrip.root.children[0]).toBeNull();
      expect(roundTrip.root.children[1]).toBe(42);
      expect(roundTrip.root.children[2]).toBe("raw");
      const paragraph = roundTrip.root.children[3] as { children: { text?: string; format?: number }[] };
      const highlighted = paragraph.children.find(
        (n) => n && typeof n === "object" && "text" in n && n.text === "beta",
      );
      expect(highlighted).toBeTruthy();
      expect(((highlighted?.format ?? 0) & TEXT_FORMAT_HIGHLIGHT) !== 0).toBe(true);
    });
  });
});
