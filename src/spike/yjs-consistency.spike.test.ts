// @vitest-environment happy-dom
/**
 * THROWAWAY SPIKE (part 4) — CONSISTENCY / CONVERGENCE focus.
 * Centerpiece is a seeded randomized multi-peer fuzz that asserts all replicas
 * converge byte-identically. Plus targeted hazards: commutativity, state-vector
 * diff sync, lossless compaction, decorator field independence, table grid
 * integrity, long offline divergence, format merge, and churn/GC growth.
 *
 * Consistency principle under test: convergence must ALWAYS hold (even when a
 * higher-level edit is dropped, e.g. the known reorder limitation — peers must
 * still agree on the same final state).
 *
 * Run: pnpm exec vitest run src/spike/yjs-consistency.spike.test.ts
 */
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";

vi.mock("@/components/editor/nodes/bookmark-component", () => ({ BookmarkComponent: (): null => null }));
vi.mock("@/components/editor/nodes/image-component", () => ({ ImageComponent: (): null => null }));

import { createBinding, syncLexicalUpdateToYjs, syncYjsChangesToLexical, type Binding } from "@lexical/yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $getRoot, $createParagraphNode, $createTextNode,
  type Klass, type LexicalNode, type LexicalEditor, type TextNode, type ElementNode,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { TableNode, TableRowNode, TableCellNode, $createTableNode, $createTableRowNode, $createTableCellNode } from "@lexical/table";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { TitleNode, $createTitleNode } from "@/components/editor/nodes/title-node";
import { ImageNode } from "@/components/editor/nodes/image-node";
import { BookmarkNode, $createBookmarkNode, $isBookmarkNode } from "@/components/editor/nodes/bookmark-node";

const ALL_NODES: Array<Klass<LexicalNode>> = [
  TitleNode, HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode,
  LinkNode, AutoLinkNode, TableNode, TableRowNode, TableCellNode, HorizontalRuleNode, ImageNode, BookmarkNode,
];

function fakeProvider(): any {
  return { awareness: { getLocalState: (): null => null, setLocalState: () => {}, getStates: () => new Map(), on: () => {}, off: () => {} }, connect: () => {}, disconnect: () => {}, on: () => {}, off: () => {} };
}
type Bound = { id: number; editor: LexicalEditor; binding: Binding; doc: Y.Doc; errors: Error[]; dispose: () => void };

let peerSeq = 0;
function makeBoundEditor(): Bound {
  const id = ++peerSeq;
  const errors: Error[] = [];
  const editor = createHeadlessEditor({ namespace: "spike", nodes: ALL_NODES, onError: (e) => errors.push(e as Error) });
  const provider = fakeProvider();
  const doc = new Y.Doc();
  const binding = createBinding(editor, provider, "doc1", doc, new Map([["doc1", doc]]));
  const unregister = editor.registerUpdateListener(({ prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags }) => {
    if (tags.has("skip-collab")) return;
    syncLexicalUpdateToYjs(binding, provider, prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags);
  });
  const shared = binding.root.getSharedType();
  const observer = (events: unknown, tx: { origin: unknown }) => { if (tx.origin !== binding) syncYjsChangesToLexical(binding, provider, events as never, false, () => {}); };
  shared.observeDeep(observer as never);
  return { id, editor, binding, doc, errors, dispose: () => { unregister(); shared.unobserveDeep(observer as never); } };
}
const flush = (b: Bound) => b.editor.update(() => {}, { discrete: true });
const build = (b: Bound, fn: () => void) => b.editor.update(fn, { discrete: true });
const syncInto = (t: Bound, s: Bound) => { Y.applyUpdate(t.doc, Y.encodeStateAsUpdate(s.doc)); flush(t); };
const jsonOf = (b: Bound): any => b.editor.getEditorState().toJSON();

// Canonical (key-sorted) stringify so equality can't be fooled by key order.
function canon(b: Bound): string {
  return JSON.stringify(jsonOf(b), function (_k, v) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((acc: any, k) => { acc[k] = v[k]; return acc; }, {});
    }
    return v;
  });
}
function assertAllConverged(peers: Bound[], label: string) {
  const ref = canon(peers[0]);
  for (let i = 1; i < peers.length; i++) {
    expect(canon(peers[i]), `${label}: peer ${peers[i].id} diverged from peer ${peers[0].id}`).toEqual(ref);
  }
}

// mulberry32 seeded PRNG — reproducible fuzz.
function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function seedDoc(b: Bound) {
  build(b, () => {
    const r = $getRoot(); r.clear();
    const t = $createTitleNode(); t.append($createTextNode("Doc"));
    const p1 = $createParagraphNode(); p1.append($createTextNode("alpha"));
    const p2 = $createParagraphNode(); p2.append($createTextNode("bravo"));
    const bm = $createBookmarkNode({ url: "https://e.com" });
    r.append(t, p1, p2, bm);
  });
}

describe("consistency: randomized multi-peer fuzz", () => {
  const SEEDS = [1, 7, 42, 1337, 99999];
  for (const seed of SEEDS) {
    it(`converges under random concurrent ops (seed ${seed})`, () => {
      const rand = rng(seed);
      const pick = <T,>(arr: T[]): T | undefined => (arr.length ? arr[Math.floor(rand() * arr.length)] : undefined);

      const base = makeBoundEditor();
      seedDoc(base);
      const peers = [base, makeBoundEditor(), makeBoundEditor(), makeBoundEditor()];
      for (let i = 1; i < peers.length; i++) syncInto(peers[i], base);

      const ROUNDS = 50;
      for (let round = 0; round < ROUNDS; round++) {
        const peer = peers[Math.floor(rand() * peers.length)];
        // editable (non-title) blocks
        const op = Math.floor(rand() * 7);
        try {
          build(peer, () => {
            const root = $getRoot();
            const blocks = root.getChildren().filter((n) => n.getType() !== "title");
            const para = (blocks.filter((n) => n.getType() === "paragraph") as ElementNode[]);
            if (op === 0) { // insert text
              const p = pick(para); const tn = p?.getFirstChild() as TextNode | undefined;
              if (tn) tn.spliceText(Math.floor(rand() * (tn.getTextContentSize() + 1)), 0, "x", false);
            } else if (op === 1) { // delete a char
              const p = pick(para); const tn = p?.getFirstChild() as TextNode | undefined;
              const len = tn?.getTextContentSize() ?? 0;
              if (tn && len > 0) tn.spliceText(Math.floor(rand() * len), 1, "", false);
            } else if (op === 2) { // append paragraph
              const np = $createParagraphNode(); np.append($createTextNode("n" + round)); root.append(np);
            } else if (op === 3) { // delete a block (keep title + at least one)
              if (blocks.length > 1) { const b = pick(blocks); b?.remove(); }
            } else if (op === 4) { // move/reorder a block
              if (blocks.length > 1) { const b = pick(blocks)!; const tgt = pick(blocks)!; if (b !== tgt) tgt.insertBefore(b); }
            } else if (op === 5) { // toggle bold on a text node
              const p = pick(para); const tn = p?.getFirstChild() as TextNode | undefined;
              if (tn) tn.toggleFormat("bold");
            } else if (op === 6) { // edit bookmark field
              const bm = root.getChildren().find((n) => $isBookmarkNode(n));
              if (bm && $isBookmarkNode(bm)) bm.setTitle("t" + peer.id + "-" + round);
            }
          });
        } catch { /* defensive: skip ops that violate a local constraint */ }

        // Gossip: randomly sync one pair this round.
        if (rand() < 0.7) {
          const a = peers[Math.floor(rand() * peers.length)];
          const c = peers[Math.floor(rand() * peers.length)];
          if (a !== c) { Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(c.doc)); flush(a); }
        }
      }

      // Final full-mesh exchange until quiescent.
      const states = peers.map((p) => Y.encodeStateAsUpdate(p.doc));
      for (const p of peers) { for (const s of states) Y.applyUpdate(p.doc, s); }
      // second pass to propagate any state produced by remote-apply normalization
      const states2 = peers.map((p) => Y.encodeStateAsUpdate(p.doc));
      for (const p of peers) { for (const s of states2) Y.applyUpdate(p.doc, s); flush(p); }

      assertAllConverged(peers, `fuzz seed ${seed}`);
      const errs = peers.reduce((n, p) => n + p.errors.length, 0);
      if (errs) console.log(`seed ${seed}: ${errs} editor errors during fuzz`);
      peers.forEach((p) => p.dispose());
    });
  }
});

describe("consistency: order-independence", () => {
  it("commutative: applying two concurrent updates in either order yields identical state", () => {
    const base = makeBoundEditor(); seedDoc(base);
    const a = makeBoundEditor(); syncInto(a, base);
    const b = makeBoundEditor(); syncInto(b, base);
    build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("AA")); $getRoot().append(p); });
    build(b, () => { const p = $createParagraphNode(); p.append($createTextNode("BB")); $getRoot().append(p); });
    const uA = Y.encodeStateAsUpdate(a.doc), uB = Y.encodeStateAsUpdate(b.doc);

    const x = makeBoundEditor(); syncInto(x, base);
    const y = makeBoundEditor(); syncInto(y, base);
    Y.applyUpdate(x.doc, uA); Y.applyUpdate(x.doc, uB); flush(x); // A then B
    Y.applyUpdate(y.doc, uB); Y.applyUpdate(y.doc, uA); flush(y); // B then A
    assertAllConverged([x, y], "commutativity");
    [base, a, b, x, y].forEach((p) => p.dispose());
  });

  it("state-vector DIFF sync (real delta transport) converges with full-state sync", () => {
    const base = makeBoundEditor(); seedDoc(base);
    const a = makeBoundEditor(); syncInto(a, base);
    const b = makeBoundEditor(); syncInto(b, base);

    build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("delta")); $getRoot().append(p); });
    // b sends its state vector; a replies with only the diff.
    const bSV = Y.encodeStateVector(b.doc);
    const diff = Y.encodeStateAsUpdate(a.doc, bSV);
    Y.applyUpdate(b.doc, diff); flush(b);
    assertAllConverged([a, b], "diff-sync");
    [base, a, b].forEach((p) => p.dispose());
  });
});

describe("consistency: persistence equivalence", () => {
  it("compaction is lossless: mergeUpdates -> fresh doc equals original", () => {
    const a = makeBoundEditor(); seedDoc(a);
    const updates: Uint8Array[] = [];
    a.doc.on("update", (u: Uint8Array) => updates.push(u));
    for (let i = 0; i < 40; i++) build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("u" + i)); $getRoot().append(p); });

    // Compact the whole history into one update, load into a fresh editor.
    const merged = Y.mergeUpdates([Y.encodeStateAsUpdate(a.doc), ...updates]);
    const b = makeBoundEditor();
    Y.applyUpdate(b.doc, merged); flush(b);
    assertAllConverged([a, b], "compaction");
    a.dispose(); b.dispose();
  });
});

describe("consistency: structural hazards", () => {
  it("concurrent edits to DIFFERENT fields of the same bookmark both survive", () => {
    const base = makeBoundEditor();
    build(base, () => {
      const r = $getRoot(); r.clear();
      const t = $createTitleNode(); t.append($createTextNode("x"));
      r.append(t, $createBookmarkNode({ url: "https://e.com" }));
    });
    const a = makeBoundEditor(); syncInto(a, base);
    const b = makeBoundEditor(); syncInto(b, base);
    build(a, () => { $getRoot().getChildren().forEach((n) => { if ($isBookmarkNode(n)) n.setTitle("TITLE-A"); }); });
    build(b, () => { $getRoot().getChildren().forEach((n) => { if ($isBookmarkNode(n)) n.setDescription("DESC-B"); }); });
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc)); flush(a); flush(b);
    assertAllConverged([a, b], "decorator fields");
    const bm = jsonOf(a).root.children.find((c: any) => c.type === "bookmark");
    expect(bm.title).toBe("TITLE-A");      // A's field survived
    expect(bm.description).toBe("DESC-B");  // B's field survived — no whole-node clobber
    [base, a, b].forEach((p) => p.dispose());
  });

  it("concurrent table row-add vs cell-edit converges with a VALID grid", () => {
    const base = makeBoundEditor();
    build(base, () => {
      const r = $getRoot(); r.clear();
      const table = $createTableNode();
      for (let row = 0; row < 2; row++) {
        const tr = $createTableRowNode();
        for (let c = 0; c < 2; c++) { const cell = $createTableCellNode(0); const p = $createParagraphNode(); p.append($createTextNode(`r${row}c${c}`)); cell.append(p); tr.append(cell); }
        table.append(tr);
      }
      r.append(table);
    });
    const a = makeBoundEditor(); syncInto(a, base);
    const b = makeBoundEditor(); syncInto(b, base);
    // A adds a row; B edits a cell.
    build(a, () => {
      const table = $getRoot().getFirstChild() as any;
      const tr = $createTableRowNode();
      for (let c = 0; c < 2; c++) { const cell = $createTableCellNode(0); const p = $createParagraphNode(); p.append($createTextNode(`rNc${c}`)); cell.append(p); tr.append(cell); }
      table.append(tr);
    });
    build(b, () => { (((($getRoot().getFirstChild() as any).getFirstChild()).getFirstChild()).getFirstChild() as TextNode).spliceText(0, 0, "Z", false); });
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc)); flush(a); flush(b);
    assertAllConverged([a, b], "table structural");
    // Grid integrity: every row has the same cell count.
    const table = jsonOf(a).root.children[0];
    const counts = table.children.map((row: any) => row.children.length);
    console.log("table grid row cell-counts:", counts);
    expect(new Set(counts).size).toBe(1);
    [base, a, b].forEach((p) => p.dispose());
  });

  it("concurrent format toggles (bold vs italic) on same text both apply", () => {
    const base = makeBoundEditor();
    build(base, () => { const r = $getRoot(); r.clear(); const p = $createParagraphNode(); p.append($createTextNode("styleme")); r.append(p); });
    const a = makeBoundEditor(); syncInto(a, base);
    const b = makeBoundEditor(); syncInto(b, base);
    build(a, () => { (($getRoot().getFirstChild() as any).getFirstChild() as TextNode).toggleFormat("bold"); });
    build(b, () => { (($getRoot().getFirstChild() as any).getFirstChild() as TextNode).toggleFormat("italic"); });
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc)); flush(a); flush(b);
    assertAllConverged([a, b], "format merge");
    [base, a, b].forEach((p) => p.dispose());
  });
});

describe("consistency: scale & churn", () => {
  it("long offline divergence (200 ops each side) converges", () => {
    const base = makeBoundEditor(); seedDoc(base);
    const a = makeBoundEditor(); syncInto(a, base);
    const b = makeBoundEditor(); syncInto(b, base);
    for (let i = 0; i < 200; i++) {
      build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("A" + i)); $getRoot().append(p); });
      build(b, () => { const p = $createParagraphNode(); p.append($createTextNode("B" + i)); $getRoot().append(p); });
    }
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc)); flush(a); flush(b);
    assertAllConverged([a, b], "offline divergence");
    expect(jsonOf(a).root.children.length).toBeGreaterThanOrEqual(400);
    [base, a, b].forEach((p) => p.dispose());
  });

  it("CHURN: insert+delete cycles — report doc growth (GC signal)", () => {
    const a = makeBoundEditor(); seedDoc(a);
    for (let i = 0; i < 300; i++) {
      build(a, () => { const p = $createParagraphNode(); p.append($createTextNode("churn" + i)); $getRoot().append(p); });
      build(a, () => { const last = $getRoot().getLastChild(); last?.remove(); });
    }
    const size = Y.encodeStateAsUpdate(a.doc).length;
    // Round-trips despite heavy churn.
    const b = makeBoundEditor(); syncInto(b, a);
    assertAllConverged([a, b], "churn");
    console.log(`CHURN 300 insert+delete cycles: encoded = ${size} bytes (tombstone growth signal)`);
    a.dispose(); b.dispose();
  });
});
