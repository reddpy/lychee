// @vitest-environment happy-dom
/**
 * THROWAWAY SPIKE (part 2) — node-type coverage, real concurrency, idempotency,
 * and stress. Complements yjs-binding.spike.test.ts (the minimal gate).
 * See feature_research/spike-findings.md.
 *
 * Run: pnpm exec vitest run src/spike/yjs-node-coverage.spike.test.ts
 */
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";

vi.mock("@/components/editor/nodes/bookmark-component", () => ({
  BookmarkComponent: (): null => null,
}));
vi.mock("@/components/editor/nodes/image-component", () => ({
  ImageComponent: (): null => null,
}));

import { createBinding, syncLexicalUpdateToYjs, syncYjsChangesToLexical, type Binding } from "@lexical/yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode, $createListNode, $createListItemNode } from "@lexical/list";
import { CodeNode, CodeHighlightNode, $createCodeNode, $createCodeHighlightNode } from "@lexical/code";
import { LinkNode, AutoLinkNode, $createLinkNode, $createAutoLinkNode } from "@lexical/link";
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableCellNode,
} from "@lexical/table";
import {
  HorizontalRuleNode,
  $createHorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";
import { TitleNode, $createTitleNode } from "@/components/editor/nodes/title-node";
import { ImageNode, $createImageNode } from "@/components/editor/nodes/image-node";
import { BookmarkNode, $createBookmarkNode } from "@/components/editor/nodes/bookmark-node";

const NODES = [
  TitleNode,
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  HorizontalRuleNode,
  ImageNode,
  BookmarkNode,
];

function fakeProvider(): any {
  return {
    awareness: {
      getLocalState: (): null => null,
      setLocalState: () => {},
      getStates: () => new Map<number, unknown>(),
      on: () => {},
      off: () => {},
    },
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  };
}

type Bound = {
  editor: LexicalEditor;
  binding: Binding;
  doc: Y.Doc;
  updateCount: number;
  dispose: () => void;
};

function makeBoundEditor(id: string): Bound {
  const editor = createHeadlessEditor({ namespace: "spike", nodes: NODES, onError: (e) => { throw e; } });
  const provider = fakeProvider();
  const doc = new Y.Doc();
  const docMap = new Map([[id, doc]]);
  const binding = createBinding(editor, provider, id, doc, docMap);
  const state: Bound = { editor, binding, doc, updateCount: 0, dispose: () => {} };

  doc.on("update", () => { state.updateCount++; });

  const unregister = editor.registerUpdateListener(
    ({ prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags }) => {
      if (tags.has("skip-collab")) return;
      syncLexicalUpdateToYjs(binding, provider, prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags);
    },
  );
  const sharedType = binding.root.getSharedType();
  const observer = (events: unknown, transaction: { origin: unknown }) => {
    if (transaction.origin !== binding) {
      syncYjsChangesToLexical(binding, provider, events as never, false, () => {});
    }
  };
  sharedType.observeDeep(observer as never);

  state.dispose = () => { unregister(); sharedType.unobserveDeep(observer as never); };
  return state;
}

function flush(b: Bound) {
  b.editor.update(() => {}, { discrete: true });
}

function syncInto(target: Bound, source: Bound) {
  Y.applyUpdate(target.doc, Y.encodeStateAsUpdate(source.doc));
  flush(target);
}

function jsonOf(b: Bound): any {
  return b.editor.getEditorState().toJSON();
}

function build(b: Bound, fn: () => void) {
  b.editor.update(fn, { discrete: true });
}

describe("Yjs node-type coverage", () => {
  it("round-trips a document containing every registered node type", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => {
      const root = $getRoot();
      root.clear();

      const title = $createTitleNode();
      title.append($createTextNode("Everything Note"));

      const h2 = $createHeadingNode("h2");
      h2.append($createTextNode("A heading"));

      const quote = $createQuoteNode();
      quote.append($createTextNode("A quote"));

      // nested bullet list
      const list = $createListNode("bullet");
      const li1 = $createListItemNode();
      li1.append($createTextNode("item 1"));
      const li2 = $createListItemNode();
      const nested = $createListNode("bullet");
      const nli = $createListItemNode();
      nli.append($createTextNode("nested item"));
      nested.append(nli);
      li2.append(nested);
      list.append(li1, li2);

      // checklist
      const check = $createListNode("check");
      const cli = $createListItemNode(true);
      cli.append($createTextNode("done task"));
      check.append(cli);

      // numbered list
      const numbered = $createListNode("number");
      const numli = $createListItemNode();
      numli.append($createTextNode("first"));
      numbered.append(numli);

      // code block with a highlight node
      const code = $createCodeNode("javascript");
      code.append($createCodeHighlightNode("const x = 1;", undefined));

      // link + autolink in a paragraph
      const linkPara = $createParagraphNode();
      const link = $createLinkNode("https://example.com");
      link.append($createTextNode("a link"));
      const autolink = $createAutoLinkNode("https://auto.example.com");
      autolink.append($createTextNode("https://auto.example.com"));
      linkPara.append(link, $createTextNode(" and "), autolink);

      // table 2x2
      const table = $createTableNode();
      for (let r = 0; r < 2; r++) {
        const row = $createTableRowNode();
        for (let c = 0; c < 2; c++) {
          const cell = $createTableCellNode(0);
          const p = $createParagraphNode();
          p.append($createTextNode(`r${r}c${c}`));
          cell.append(p);
          row.append(cell);
        }
        table.append(row);
      }

      const hr = $createHorizontalRuleNode();

      const image = $createImageNode({ imageId: "img-1", altText: "alt", alignment: "center", width: 100, height: 80 });

      // bookmark with TRUTHY volatile fields — observe whether they sync
      const bookmark = $createBookmarkNode({
        url: "https://example.com/a",
        title: "T",
        description: "D",
        imageUrl: "https://example.com/og.png",
        faviconUrl: "https://example.com/fav.ico",
        autoResolve: true,
        hydrationAttempted: true,
      });

      root.append(title, h2, quote, list, check, numbered, code, linkPara, table, hr, image, bookmark);
    });

    const b = makeBoundEditor("doc1");
    syncInto(b, a);

    const aj = JSON.stringify(jsonOf(a));
    const bj = JSON.stringify(jsonOf(b));
    expect(bj).toEqual(aj);

    // Sanity: every expected type is present after round-trip.
    const types = new Set<string>();
    (function walk(n: any) {
      if (!n) return;
      if (n.type) types.add(n.type);
      (n.children ?? []).forEach(walk);
    })(jsonOf(b).root);
    for (const t of ["title","heading","quote","list","listitem","code","code-highlight","link","autolink","table","tablerow","tablecell","horizontalrule","image","bookmark","paragraph","text"]) {
      expect(types.has(t), `missing type after round-trip: ${t}`).toBe(true);
    }

    a.dispose(); b.dispose();
  });

  it("OBSERVATION: bookmark volatile fields (autoResolve/hydrationAttempted) DO sync", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => {
      const root = $getRoot(); root.clear();
      const t = $createTitleNode(); t.append($createTextNode("x"));
      const bm = $createBookmarkNode({ url: "https://e.com", autoResolve: true, hydrationAttempted: true });
      root.append(t, bm);
    });
    const b = makeBoundEditor("doc1");
    syncInto(b, a);
    const bm = jsonOf(b).root.children.find((c: any) => c.type === "bookmark");
    // Documents the need for excludedProperties: these per-device fields cross the wire.
    expect(bm.autoResolve).toBe(true);
    expect(bm.hydrationAttempted).toBe(true);
    a.dispose(); b.dispose();
  });
});

describe("Yjs real concurrency", () => {
  it("merges two concurrent inserts into the SAME text node (char-level)", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => {
      const root = $getRoot(); root.clear();
      const p = $createParagraphNode();
      p.append($createTextNode("Hello world"));
      root.append(p);
    });
    const b = makeBoundEditor("doc1");
    syncInto(b, a);

    // A inserts at offset 5, B inserts at offset 0 — different positions.
    build(a, () => {
      const text = ($getRoot().getFirstChild() as any).getFirstChild() as TextNode;
      text.spliceText(5, 0, " [A]", false);
    });
    build(b, () => {
      const text = ($getRoot().getFirstChild() as any).getFirstChild() as TextNode;
      text.spliceText(0, 0, "[B] ", false);
    });

    // Exchange both directions.
    const aU = Y.encodeStateAsUpdate(a.doc);
    const bU = Y.encodeStateAsUpdate(b.doc);
    Y.applyUpdate(a.doc, bU); flush(a);
    Y.applyUpdate(b.doc, aU); flush(b);

    const aj = JSON.stringify(jsonOf(a));
    const bj = JSON.stringify(jsonOf(b));
    console.log("merged text A:", JSON.stringify(jsonOf(a).root.children[0].children));
    expect(aj).toEqual(bj); // converge
    // both edits survived
    const text = jsonOf(a).root.children[0].children.map((c: any) => c.text).join("");
    expect(text).toContain("[A]");
    expect(text).toContain("[B]");
    a.dispose(); b.dispose();
  });

  it("merges concurrent edits to DIFFERENT table cells", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => {
      const root = $getRoot(); root.clear();
      const table = $createTableNode();
      const row = $createTableRowNode();
      for (let c = 0; c < 2; c++) {
        const cell = $createTableCellNode(0);
        const p = $createParagraphNode(); p.append($createTextNode(`c${c}`));
        cell.append(p); row.append(cell);
      }
      table.append(row);
      root.append(table);
    });
    const b = makeBoundEditor("doc1");
    syncInto(b, a);

    build(a, () => {
      const cellText = ($getRoot().getFirstChild() as any).getFirstChild().getChildAtIndex(0).getFirstChild().getFirstChild() as TextNode;
      cellText.spliceText(2, 0, "-A", false);
    });
    build(b, () => {
      const cellText = ($getRoot().getFirstChild() as any).getFirstChild().getChildAtIndex(1).getFirstChild().getFirstChild() as TextNode;
      cellText.spliceText(2, 0, "-B", false);
    });

    const aU = Y.encodeStateAsUpdate(a.doc);
    const bU = Y.encodeStateAsUpdate(b.doc);
    Y.applyUpdate(a.doc, bU); flush(a);
    Y.applyUpdate(b.doc, aU); flush(b);

    expect(JSON.stringify(jsonOf(a))).toEqual(JSON.stringify(jsonOf(b)));
    a.dispose(); b.dispose();
  });

  it("converges on concurrent delete (A) vs edit (B) of the same paragraph", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => {
      const root = $getRoot(); root.clear();
      const p1 = $createParagraphNode(); p1.append($createTextNode("first"));
      const p2 = $createParagraphNode(); p2.append($createTextNode("second"));
      root.append(p1, p2);
    });
    const b = makeBoundEditor("doc1");
    syncInto(b, a);

    build(a, () => { $getRoot().getChildAtIndex(1)!.remove(); }); // delete p2
    build(b, () => {
      const text = ($getRoot().getChildAtIndex(1) as any).getFirstChild() as TextNode;
      text.spliceText(6, 0, "!", false); // edit p2
    });

    const aU = Y.encodeStateAsUpdate(a.doc);
    const bU = Y.encodeStateAsUpdate(b.doc);
    Y.applyUpdate(a.doc, bU); flush(a);
    Y.applyUpdate(b.doc, aU); flush(b);

    // No assertion on which side wins — only that they converge and don't throw.
    expect(JSON.stringify(jsonOf(a))).toEqual(JSON.stringify(jsonOf(b)));
    a.dispose(); b.dispose();
  });
});

describe("Yjs idempotency & stress", () => {
  it("re-applying the same update is a no-op", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => {
      const root = $getRoot(); root.clear();
      const p = $createParagraphNode(); p.append($createTextNode("stable"));
      root.append(p);
    });
    const before = JSON.stringify(jsonOf(a));
    const u = Y.encodeStateAsUpdate(a.doc);
    Y.applyUpdate(a.doc, u);
    Y.applyUpdate(a.doc, u);
    flush(a);
    expect(JSON.stringify(jsonOf(a))).toEqual(before);
    a.dispose();
  });

  it("STRESS: round-trips a large document (1000 paragraphs)", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => {
      const root = $getRoot(); root.clear();
      const title = $createTitleNode(); title.append($createTextNode("big"));
      root.append(title);
      for (let i = 0; i < 1000; i++) {
        const p = $createParagraphNode();
        p.append($createTextNode(`paragraph number ${i} with some text content`));
        root.append(p);
      }
    });
    const update = Y.encodeStateAsUpdate(a.doc);
    const b = makeBoundEditor("doc1");
    syncInto(b, a);

    expect(jsonOf(b).root.children.length).toBe(1001);
    expect(JSON.stringify(jsonOf(b))).toEqual(JSON.stringify(jsonOf(a)));
    console.log(`STRESS 1000 paragraphs: encoded Y.Doc = ${update.length} bytes`);
    a.dispose(); b.dispose();
  });

  it("STRESS: 300 sequential edits accumulate and round-trip (shadow-save pattern)", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => { const r = $getRoot(); r.clear(); r.append($createParagraphNode()); });
    for (let i = 0; i < 300; i++) {
      build(a, () => {
        const p = $createParagraphNode();
        p.append($createTextNode(`edit ${i}`));
        $getRoot().append(p);
      });
    }
    const b = makeBoundEditor("doc1");
    syncInto(b, a);

    expect(JSON.stringify(jsonOf(b))).toEqual(JSON.stringify(jsonOf(a)));
    const full = Y.encodeStateAsUpdate(a.doc);
    // Compaction signal: how big is the doc after 300 incremental updates,
    // and how many raw updates were emitted.
    console.log(`SHADOW 300 edits: ${a.updateCount} yjs updates, encoded = ${full.length} bytes`);
    a.dispose(); b.dispose();
  });
});
