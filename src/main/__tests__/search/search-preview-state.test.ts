import { describe, it, expect } from "vitest";

import {
  applySerializedHighlights,
  buildHighlightedPreviewStateFromParsed,
  TEXT_FORMAT_HIGHLIGHT,
} from "../../../shared/search-preview-state";

type LexicalLikeState = {
  root: {
    type: string;
    version: number;
    children: unknown[];
  };
};

function textNode(text: string, format = 0) {
  return { type: "text", text, format, detail: 0, mode: "normal", style: "", version: 1 };
}

function paragraph(children: unknown[]) {
  return {
    type: "paragraph",
    children,
    direction: null as null,
    format: "",
    indent: 0,
    version: 1,
  };
}

function makeState(children: unknown[]): LexicalLikeState {
  return {
    root: {
      type: "root",
      version: 1,
      children,
    },
  };
}

describe("Search Preview State — Backend Contracts", () => {
  describe("applySerializedHighlights()", () => {
    it("returns same reference when query is blank", () => {
      const state = makeState([paragraph([textNode("alpha beta")])]);
      const result = applySerializedHighlights(state, "   ");
      expect(result).toBe(state);
    });

    it("does not mutate original input state", () => {
      const state = makeState([paragraph([textNode("alpha beta gamma")])]);
      const snapshot = JSON.parse(JSON.stringify(state));
      void applySerializedHighlights(state, "beta");
      expect(state).toEqual(snapshot);
    });

    it("highlights a single match in one text node", () => {
      const state = makeState([paragraph([textNode("alpha beta gamma")])]);
      const result = applySerializedHighlights(state, "beta");
      const children = (result.root.children[0] as { children: { text?: string; format?: number }[] })
        .children;

      expect(children.map((n) => n.text)).toEqual(["alpha ", "beta", " gamma"]);
      expect(children[1]?.format).toBe(TEXT_FORMAT_HIGHLIGHT);
    });

    it("preserves base format while applying highlight bit", () => {
      const baseFormat = 2;
      const state = makeState([paragraph([textNode("alpha beta", baseFormat)])]);
      const result = applySerializedHighlights(state, "beta");
      const children = (result.root.children[0] as { children: { text?: string; format?: number }[] })
        .children;
      expect(children[0]?.format).toBe(baseFormat);
      expect(children[1]?.format).toBe(baseFormat | TEXT_FORMAT_HIGHLIGHT);
    });

    it("handles multiple matches in the same text node", () => {
      const state = makeState([paragraph([textNode("beta x beta y beta")])]);
      const result = applySerializedHighlights(state, "beta");
      const children = (result.root.children[0] as { children: { text?: string; format?: number }[] })
        .children;
      const highlighted = children.filter((n) => (n.format ?? 0) & TEXT_FORMAT_HIGHLIGHT);
      expect(highlighted).toHaveLength(3);
      expect(highlighted.map((n) => n.text)).toEqual(["beta", "beta", "beta"]);
    });

    it("matches case-insensitively and preserves original case in output text", () => {
      const state = makeState([paragraph([textNode("BeTa beta BETA")])]);
      const result = applySerializedHighlights(state, "beta");
      const children = (result.root.children[0] as { children: { text?: string; format?: number }[] })
        .children;
      const highlighted = children.filter((n) => (n.format ?? 0) & TEXT_FORMAT_HIGHLIGHT);
      expect(highlighted.map((n) => n.text)).toEqual(["BeTa", "beta", "BETA"]);
    });

    it("does not highlight overlapping matches", () => {
      const state = makeState([paragraph([textNode("aaaa")])]);
      const result = applySerializedHighlights(state, "aa");
      const children = (result.root.children[0] as { children: { text?: string; format?: number }[] })
        .children;
      const highlighted = children.filter((n) => (n.format ?? 0) & TEXT_FORMAT_HIGHLIGHT);
      expect(highlighted.map((n) => n.text)).toEqual(["aa", "aa"]);
    });

    it("recurses through nested non-text nodes", () => {
      const nested = {
        type: "listitem",
        children: [paragraph([textNode("deep beta value")])],
      };
      const state = makeState([nested]);
      const result = applySerializedHighlights(state, "beta");
      const paraChildren = (
        ((result.root.children[0] as { children: { children: { text?: string; format?: number }[] }[] })
          .children[0] as { children: { text?: string; format?: number }[] }).children
      );
      expect(paraChildren.map((n) => n.text)).toEqual(["deep ", "beta", " value"]);
    });

    it("leaves non-text nodes and primitives intact", () => {
      const state = makeState([
        42,
        "raw",
        { type: "linebreak" },
        paragraph([textNode("alpha")]),
      ]);
      const result = applySerializedHighlights(state, "beta");
      expect(result.root.children[0]).toBe(42);
      expect(result.root.children[1]).toBe("raw");
      expect(result.root.children[2]).toEqual({ type: "linebreak" });
    });

    it("does not alter text nodes with no match", () => {
      const state = makeState([paragraph([textNode("alpha gamma")])]);
      const result = applySerializedHighlights(state, "beta");
      const children = (result.root.children[0] as { children: { text?: string; format?: number }[] })
        .children;
      expect(children).toHaveLength(1);
      expect(children[0]?.text).toBe("alpha gamma");
      expect(children[0]?.format).toBe(0);
    });
  });

  describe("buildHighlightedPreviewStateFromParsed()", () => {
    it("returns undefined for undefined parsed state", () => {
      expect(buildHighlightedPreviewStateFromParsed(undefined, "beta")).toBeUndefined();
    });

    it("returns valid JSON string for highlighted state", () => {
      const parsed = makeState([paragraph([textNode("alpha beta gamma")])]);
      const serialized = buildHighlightedPreviewStateFromParsed(parsed, "beta");
      expect(typeof serialized).toBe("string");
      const roundTrip = JSON.parse(serialized as string) as LexicalLikeState;
      expect(roundTrip.root.type).toBe("root");
    });

    it("produces a deep-cloned payload (no reference sharing)", () => {
      const parsed = makeState([paragraph([textNode("alpha beta")])]);
      const serialized = buildHighlightedPreviewStateFromParsed(parsed, "beta");
      const roundTrip = JSON.parse(serialized as string) as LexicalLikeState;
      expect(roundTrip).not.toBe(parsed);
      expect(roundTrip.root).not.toBe(parsed.root);
      expect(roundTrip.root.children).not.toBe(parsed.root.children);
    });

    it("preserves state shape when query is blank", () => {
      const parsed = makeState([paragraph([textNode("alpha beta")])]);
      const serialized = buildHighlightedPreviewStateFromParsed(parsed, "");
      const roundTrip = JSON.parse(serialized as string) as LexicalLikeState;
      expect(roundTrip).toEqual(parsed);
    });
  });
});
