// @vitest-environment happy-dom
/**
 * THROWAWAY SPIKE (part 3) — ADVERSARIAL edge cases. Tries to BREAK the binding.
 * Several of these are expected to surface real constraints, not just pass.
 * See feature_research/spike-findings.md.
 *
 * Run: pnpm exec vitest run src/spike/yjs-edge-cases.spike.test.ts
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
  type Klass,
  type LexicalNode,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { TitleNode, $createTitleNode } from "@/components/editor/nodes/title-node";
import { ImageNode } from "@/components/editor/nodes/image-node";
import { BookmarkNode, $createBookmarkNode, $isBookmarkNode } from "@/components/editor/nodes/bookmark-node";

const ALL_NODES: Array<Klass<LexicalNode>> = [
  TitleNode, HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode,
  LinkNode, AutoLinkNode, TableNode, TableRowNode, TableCellNode, HorizontalRuleNode, ImageNode, BookmarkNode,
];

function fakeProvider(): any {
  return {
    awareness: { getLocalState: (): null => null, setLocalState: () => {}, getStates: () => new Map<number, unknown>(), on: () => {}, off: () => {} },
    connect: () => {}, disconnect: () => {}, on: () => {}, off: () => {},
  };
}

type Bound = {
  editor: LexicalEditor;
  binding: Binding;
  doc: Y.Doc;
  updates: Uint8Array[];
  errors: Error[];
  dispose: () => void;
};

function makeBoundEditor(id: string, opts?: { nodes?: Array<Klass<LexicalNode>>; captureErrors?: boolean }): Bound {
  const errors: Error[] = [];
  const editor = createHeadlessEditor({
    namespace: "spike",
    nodes: opts?.nodes ?? ALL_NODES,
    onError: (e) => { if (opts?.captureErrors) errors.push(e as Error); else throw e; },
  });
  const provider = fakeProvider();
  const doc = new Y.Doc();
  const binding = createBinding(editor, provider, id, doc, new Map([[id, doc]]));
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));

  const unregister = editor.registerUpdateListener(
    ({ prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags }) => {
      if (tags.has("skip-collab")) return;
      syncLexicalUpdateToYjs(binding, provider, prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags);
    },
  );
  const sharedType = binding.root.getSharedType();
  const observer = (events: unknown, transaction: { origin: unknown }) => {
    if (transaction.origin !== binding) syncYjsChangesToLexical(binding, provider, events as never, false, () => {});
  };
  sharedType.observeDeep(observer as never);
  return { editor, binding, doc, updates, errors, dispose: () => { unregister(); sharedType.unobserveDeep(observer as never); } };
}

const flush = (b: Bound) => b.editor.update(() => {}, { discrete: true });
const build = (b: Bound, fn: () => void) => b.editor.update(fn, { discrete: true });
const syncInto = (t: Bound, s: Bound) => { Y.applyUpdate(t.doc, Y.encodeStateAsUpdate(s.doc)); flush(t); };
const jsonOf = (b: Bound): any => b.editor.getEditorState().toJSON();
const exchange = (a: Bound, b: Bound) => {
  const aU = Y.encodeStateAsUpdate(a.doc), bU = Y.encodeStateAsUpdate(b.doc);
  Y.applyUpdate(a.doc, bU); Y.applyUpdate(b.doc, aU); flush(a); flush(b);
};

function pairFromBase(buildBase: () => void): [Bound, Bound] {
  const a = makeBoundEditor("doc1");
  build(a, buildBase);
  const b = makeBoundEditor("doc1");
  syncInto(b, a);
  return [a, b];
}

describe("adversarial: text merge", () => {
  it("two inserts at the SAME offset interleave deterministically and converge", () => {
    const [a, b] = pairFromBase(() => {
      const r = $getRoot(); r.clear();
      const p = $createParagraphNode(); p.append($createTextNode("Hello world")); r.append(p);
    });
    build(a, () => { (($getRoot().getFirstChild() as any).getFirstChild() as TextNode).spliceText(5, 0, "AAA", false); });
    build(b, () => { (($getRoot().getFirstChild() as any).getFirstChild() as TextNode).spliceText(5, 0, "BBB", false); });
    exchange(a, b);
    expect(JSON.stringify(jsonOf(a))).toEqual(JSON.stringify(jsonOf(b)));
    const text = jsonOf(a).root.children[0].children.map((c: any) => c.text).join("");
    console.log("same-offset merge:", JSON.stringify(text));
    expect(text).toContain("AAA");
    expect(text).toContain("BBB");
    a.dispose(); b.dispose();
  });

  it("preserves an emoji (surrogate pair) when both peers edit around it", () => {
    const [a, b] = pairFromBase(() => {
      const r = $getRoot(); r.clear();
      const p = $createParagraphNode(); p.append($createTextNode("Hi 😀 there")); r.append(p);
    });
    // "Hi " = 3 code units, emoji = 2 (surrogate pair) at offset 3-4.
    build(a, () => { (($getRoot().getFirstChild() as any).getFirstChild() as TextNode).spliceText(3, 0, "X", false); }); // before emoji
    build(b, () => { (($getRoot().getFirstChild() as any).getFirstChild() as TextNode).spliceText(5, 0, "Y", false); }); // after emoji
    exchange(a, b);
    const text = jsonOf(a).root.children[0].children.map((c: any) => c.text).join("");
    console.log("emoji merge:", JSON.stringify(text));
    expect(JSON.stringify(jsonOf(a))).toEqual(JSON.stringify(jsonOf(b)));
    expect(text).toContain("😀"); // emoji intact, not split
    a.dispose(); b.dispose();
  });
});

describe("adversarial: structure", () => {
  // Shared scenario: A reorders (moves p3 to front), B concurrently edits p1.
  function moveVsEdit(): [Bound, Bound] {
    const [a, b] = pairFromBase(() => {
      const r = $getRoot(); r.clear();
      for (let i = 0; i < 4; i++) { const p = $createParagraphNode(); p.append($createTextNode(`p${i}`)); r.append(p); }
    });
    build(a, () => {
      const r = $getRoot();
      const moved = r.getChildAtIndex(3)!;
      r.getChildAtIndex(0)!.insertBefore(moved);
    });
    build(b, () => { (($getRoot().getChildAtIndex(1) as any).getFirstChild() as TextNode).spliceText(2, 0, "!", false); });
    exchange(a, b);
    return [a, b];
  }

  it("concurrent MOVE vs edit converges and does not duplicate/lose the moved node", () => {
    const [a, b] = moveVsEdit();
    expect(JSON.stringify(jsonOf(a))).toEqual(JSON.stringify(jsonOf(b)));
    const p3count = jsonOf(a).root.children.filter((c: any) =>
      (c.children ?? []).some((t: any) => t.text === "p3")).length;
    console.log("move+edit children:", jsonOf(a).root.children.map((c: any) => (c.children ?? []).map((t: any) => t.text).join("")));
    expect(p3count).toBe(1); // moved node present exactly once, converged
    a.dispose(); b.dispose();
  });

  // KNOWN LIMITATION (tree-CRDT move = delete+reinsert): a concurrent edit on a
  // sibling is dropped when another peer reorders. Encoded with it.fails so the
  // suite stays green AND we get alerted if a future lexical/yjs version fixes it.
  // Mitigation TBD — see feature_research/spike-findings.md.
  it.fails("KNOWN LIMITATION: concurrent edit is LOST when a peer reorders a sibling", () => {
    const [a] = moveVsEdit();
    const texts = jsonOf(a).root.children.map((c: any) => (c.children ?? []).map((t: any) => t.text).join(""));
    expect(texts).toContain("p1!"); // currently fails: B's edit vanished
  });

  it("TitleNode invariant: is the title still unique + first after a concurrent prepend?", () => {
    const [a, b] = pairFromBase(() => {
      const r = $getRoot(); r.clear();
      const t = $createTitleNode(); t.append($createTextNode("Title")); r.append(t);
      const p = $createParagraphNode(); p.append($createTextNode("body")); r.append(p);
    });
    // Both peers prepend a paragraph before the title (raw tree op — bypasses
    // the command-level guards that normally keep TitleNode first).
    build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("A-pre")); $getRoot().getFirstChild()!.insertBefore(p); });
    build(b, () => { const p = $createParagraphNode(); p.append($createTextNode("B-pre")); $getRoot().getFirstChild()!.insertBefore(p); });
    exchange(a, b);
    expect(JSON.stringify(jsonOf(a))).toEqual(JSON.stringify(jsonOf(b)));
    const children = jsonOf(a).root.children;
    const titleCount = children.filter((c: any) => c.type === "title").length;
    const titleIndex = children.findIndex((c: any) => c.type === "title");
    console.log(`title: count=${titleCount} index=${titleIndex} order=${children.map((c: any) => c.type)}`);
    // Document reality: CRDT does NOT enforce app invariants. Title stays unique
    // (Yjs won't duplicate it) but is NOT guaranteed first — normalization must
    // re-assert position after remote applies.
    expect(titleCount).toBe(1);
    a.dispose(); b.dispose();
  });
});

describe("adversarial: decorator-field concurrency (the bookmark risk)", () => {
  it("two peers set DIFFERENT bookmark metadata concurrently — converges (last-writer per field)", () => {
    const [a, b] = pairFromBase(() => {
      const r = $getRoot(); r.clear();
      const t = $createTitleNode(); t.append($createTextNode("x"));
      const bm = $createBookmarkNode({ url: "https://e.com" });
      r.append(t, bm);
    });
    build(a, () => { $getRoot().getChildren().forEach((n) => { if ($isBookmarkNode(n)) n.setTitle("Title from A"); }); });
    build(b, () => { $getRoot().getChildren().forEach((n) => { if ($isBookmarkNode(n)) n.setTitle("Title from B"); }); });
    exchange(a, b);
    const aj = JSON.stringify(jsonOf(a)), bj = JSON.stringify(jsonOf(b));
    const titleA = jsonOf(a).root.children.find((c: any) => c.type === "bookmark").title;
    console.log("concurrent bookmark title winner:", titleA);
    expect(aj).toEqual(bj); // must converge to the same winner
    expect(["Title from A", "Title from B"]).toContain(titleA);
    a.dispose(); b.dispose();
  });
});

describe("adversarial: cross-version & transport", () => {
  it("syncing a Y.Doc with an UNKNOWN node type into a client missing that node surfaces an error", () => {
    // A has bookmarks; B's editor is NOT given BookmarkNode (simulates older client).
    const a = makeBoundEditor("doc1");
    build(a, () => {
      const r = $getRoot(); r.clear();
      const t = $createTitleNode(); t.append($createTextNode("x"));
      r.append(t, $createBookmarkNode({ url: "https://e.com" }));
    });
    const bNodes = ALL_NODES.filter((n) => n !== BookmarkNode);
    const b = makeBoundEditor("doc1", { nodes: bNodes, captureErrors: true });
    let threw = false;
    try { syncInto(b, a); } catch { threw = true; }
    console.log(`unknown-node: threw=${threw} capturedErrors=${b.errors.length}`);
    // Either path is a failure signal we must handle (graceful unknown-node strategy).
    expect(threw || b.errors.length > 0).toBe(true);
    a.dispose(); b.dispose();
  });

  it("applies incremental updates delivered OUT OF ORDER and still converges", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => { const r = $getRoot(); r.clear(); const p = $createParagraphNode(); p.append($createTextNode("base")); r.append(p); });

    const b = makeBoundEditor("doc1");
    syncInto(b, a);

    // Capture two causally-dependent incremental updates from A.
    a.updates.length = 0;
    build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("first")); $getRoot().append(p); });
    build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("second")); $getRoot().append(p); });
    const [u1, u2] = a.updates;

    // Deliver out of order: u2 before u1.
    Y.applyUpdate(b.doc, u2);
    Y.applyUpdate(b.doc, u1);
    flush(b);

    expect(JSON.stringify(jsonOf(b))).toEqual(JSON.stringify(jsonOf(a)));
    a.dispose(); b.dispose();
  });

  it("3 peers each edit and all converge", () => {
    const a = makeBoundEditor("doc1");
    build(a, () => { const r = $getRoot(); r.clear(); const p = $createParagraphNode(); p.append($createTextNode("shared")); r.append(p); });
    const b = makeBoundEditor("doc1"); syncInto(b, a);
    const c = makeBoundEditor("doc1"); syncInto(c, a);

    build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("from A")); $getRoot().append(p); });
    build(b, () => { const p = $createParagraphNode(); p.append($createTextNode("from B")); $getRoot().append(p); });
    build(c, () => { const p = $createParagraphNode(); p.append($createTextNode("from C")); $getRoot().append(p); });

    // Full mesh exchange.
    const uA = Y.encodeStateAsUpdate(a.doc), uB = Y.encodeStateAsUpdate(b.doc), uC = Y.encodeStateAsUpdate(c.doc);
    [a, b, c].forEach((peer) => { Y.applyUpdate(peer.doc, uA); Y.applyUpdate(peer.doc, uB); Y.applyUpdate(peer.doc, uC); flush(peer); });

    const aj = JSON.stringify(jsonOf(a));
    expect(JSON.stringify(jsonOf(b))).toEqual(aj);
    expect(JSON.stringify(jsonOf(c))).toEqual(aj);
    // all three edits present
    const texts = jsonOf(a).root.children.flatMap((c: any) => (c.children ?? []).map((t: any) => t.text));
    expect(texts).toEqual(expect.arrayContaining(["from A", "from B", "from C"]));
    a.dispose(); b.dispose(); c.dispose();
  });
});
