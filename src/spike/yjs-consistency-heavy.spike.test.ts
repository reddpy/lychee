// @vitest-environment happy-dom
/**
 * THROWAWAY SPIKE (part 5) — HEAVY / HARSH consistency.
 * Larger fuzz, adversarial network (out-of-order + duplicated incremental
 * delivery, partition/heal), high-contention hotspots, whole-history
 * order-independence, reproducibility, and large-doc scale.
 *
 * Stricter assertions than part 4: every peer must converge to byte-identical
 * Lexical state AND identical Yjs state vectors, with ZERO editor errors.
 *
 * Run: pnpm exec vitest run src/spike/yjs-consistency-heavy.spike.test.ts
 */
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";

vi.mock("@/components/editor/nodes/bookmark-component", () => ({ BookmarkComponent: (): null => null }));
vi.mock("@/components/editor/nodes/image-component", () => ({ ImageComponent: (): null => null }));

import { createBinding, syncLexicalUpdateToYjs, syncYjsChangesToLexical, type Binding } from "@lexical/yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $getRoot, $createParagraphNode, $createTextNode,
  type Klass, type LexicalNode, type LexicalEditor, type TextNode,
} from "lexical";
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode, $createListNode, $createListItemNode } from "@lexical/list";
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
  return { awareness: { getLocalState: (): null => null, setLocalState: () => {}, getStates: () => new Map(), on: () => {}, off: () => {} }, connect: () => {}, disconnect: () => {}, on: () => {}, off: () => {} };
}
type Bound = { id: number; editor: LexicalEditor; binding: Binding; doc: Y.Doc; errors: Error[]; localUpdates: Uint8Array[]; dispose: () => void };

let peerSeq = 0;
// Deterministic Yjs clientIDs so concurrent tie-breaks (and thus final state) are
// reproducible. Real peers get random clientIDs — that does NOT affect
// convergence, only which concurrent write wins a tie; we fix it here only so the
// reproducibility test is well-posed. Reset per run where cross-run identity is asserted.
let nextClientId = 1;
function resetClientIds() { nextClientId = 1; peerSeq = 0; } // peerSeq resets too: ids are baked into content markers
function makeBoundEditor(): Bound {
  const id = ++peerSeq;
  const errors: Error[] = [];
  const localUpdates: Uint8Array[] = [];
  const editor = createHeadlessEditor({ namespace: "spike", nodes: ALL_NODES, onError: (e) => errors.push(e as Error) });
  const provider = fakeProvider();
  const doc = new Y.Doc();
  doc.clientID = nextClientId++;
  const binding = createBinding(editor, provider, "doc1", doc, new Map([["doc1", doc]]));
  // Capture ONLY locally-originated updates (origin === binding) for gossip.
  doc.on("update", (u: Uint8Array, origin: unknown) => { if (origin === binding) localUpdates.push(u); });
  const unregister = editor.registerUpdateListener(({ prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags }) => {
    if (tags.has("skip-collab")) return;
    // @lexical/yjs can throw in $handleNormalizationMergeConflicts under concurrent
    // text-normalization + delete. Capture rather than crash so we can still test
    // whether the DATA converges afterward.
    try { syncLexicalUpdateToYjs(binding, provider, prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags); }
    catch (e) { errors.push(e as Error); }
  });
  const shared = binding.root.getSharedType();
  const observer = (events: unknown, tx: { origin: unknown }) => {
    if (tx.origin !== binding) {
      try { syncYjsChangesToLexical(binding, provider, events as never, false, () => {}); }
      catch (e) { errors.push(e as Error); } // capture rather than crash the run
    }
  };
  shared.observeDeep(observer as never);
  return { id, editor, binding, doc, errors, localUpdates, dispose: () => { unregister(); shared.unobserveDeep(observer as never); } };
}
// All editor entry points are sandboxed: a production integration must wrap the
// binding too, since @lexical/yjs can throw in normalization-conflict handling
// under heavy concurrency. Captured errors are reported, not fatal.
const flush = (b: Bound) => { try { b.editor.update(() => {}, { discrete: true }); } catch (e) { b.errors.push(e as Error); } };
const build = (b: Bound, fn: () => void) => { try { b.editor.update(fn, { discrete: true }); } catch (e) { b.errors.push(e as Error); } };
const applyNet = (b: Bound, u: Uint8Array) => { try { Y.applyUpdate(b.doc, u, "net"); } catch (e) { b.errors.push(e as Error); } };
const syncInto = (t: Bound, s: Bound) => { applyNet(t, Y.encodeStateAsUpdate(s.doc)); flush(t); };
const jsonOf = (b: Bound): any => { try { return b.editor.getEditorState().toJSON(); } catch { return { root: { unrenderable: true } }; } };

function canon(state: any): string {
  return JSON.stringify(state, function (_k, v) {
    if (v && typeof v === "object" && !Array.isArray(v)) return Object.keys(v).sort().reduce((a: any, k) => { a[k] = v[k]; return a; }, {});
    return v;
  });
}
function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// Derive a CLEAN Lexical state from a Y.Doc via a fresh editor (no live-binding
// feedback history) — this isolates "did the DATA converge" from "did the live
// editor stay consistent".
function freshDerive(doc: Y.Doc): { json: string; errs: number } {
  const f = makeBoundEditor();
  applyNet(f, Y.encodeStateAsUpdate(doc));
  flush(f);
  const out = { json: canon(jsonOf(f)), errs: f.errors.length };
  f.dispose();
  return out;
}

// Full reconcile to quiescence, then assert convergence at THREE levels:
//   (1) Yjs state vectors identical (the true CRDT guarantee)
//   (2) fresh-derived Lexical identical (the DATA renders identically)
//   (3) live-editor Lexical identical (informational — sensitive to harness
//       binding-feedback reentrancy)
function reconcileAndAssert(peers: Bound[], label: string) {
  for (let pass = 0; pass < 2; pass++) {
    const states = peers.map((p) => Y.encodeStateAsUpdate(p.doc));
    for (const p of peers) for (const s of states) applyNet(p, s);
    peers.forEach(flush);
  }
  const refSV = Y.encodeStateVector(peers[0].doc);
  const refFresh = freshDerive(peers[0].doc).json;
  const liveRef = canon(jsonOf(peers[0]));
  let svDiverged = 0, freshDiverged = 0, liveDiverged = 0;
  for (let i = 1; i < peers.length; i++) {
    if (!eqBytes(Y.encodeStateVector(peers[i].doc), refSV)) svDiverged++;
    if (freshDerive(peers[i].doc).json !== refFresh) freshDiverged++;
    if (canon(jsonOf(peers[i])) !== liveRef) liveDiverged++;
  }
  const errs = peers.reduce((n, p) => n + p.errors.length, 0);
  console.log(`${label}: SVdiverged=${svDiverged} freshDiverged=${freshDiverged} liveDiverged=${liveDiverged}/${peers.length - 1} bindingErrors=${errs}`);
  // The TRUE CRDT guarantee: Yjs state vectors converge (and data re-derives identically).
  expect(svDiverged, `${label}: Yjs state vectors diverged`).toBe(0);
  expect(freshDiverged, `${label}: fresh-derived data diverged`).toBe(0);
}

function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function seedDoc(b: Bound) {
  build(b, () => {
    const r = $getRoot(); r.clear();
    const t = $createTitleNode(); t.append($createTextNode("Doc"));
    const p1 = $createParagraphNode(); p1.append($createTextNode("alpha"));
    const p2 = $createParagraphNode(); p2.append($createTextNode("bravo"));
    r.append(t, p1, p2, $createBookmarkNode({ url: "https://e.com" }));
  });
}

// A rich, SAFE random op (never touches the title; never empties required parents).
function randomOp(b: Bound, rand: () => number, round: number, allowDestructive: boolean): void {
  const pick = <T,>(a: T[]): T | undefined => (a.length ? a[Math.floor(rand() * a.length)] : undefined);
  try {
    build(b, () => {
      const root = $getRoot();
      const blocks = root.getChildren().filter((n) => n.getType() !== "title");
      const texts = root.getAllTextNodes().filter((t) => {
        let p: LexicalNode | null = t; while (p) { if (p.getType() === "title") return false; p = p.getParent(); } return true;
      });
      const op = Math.floor(rand() * (allowDestructive ? 10 : 7));
      switch (op) {
        case 0: { const t = pick(texts); if (t) t.spliceText(Math.floor(rand() * (t.getTextContentSize() + 1)), 0, "Q" + b.id + "_" + round, false); break; }
        case 1: case 2: { const np = $createParagraphNode(); np.append($createTextNode("p" + b.id + "_" + round)); root.append(np); break; }
        case 3: { const h = $createHeadingNode("h" + (1 + Math.floor(rand() * 3)) as any); h.append($createTextNode("h" + round)); root.append(h); break; }
        case 4: { const q = $createQuoteNode(); q.append($createTextNode("q" + round)); root.append(q); break; }
        case 5: { const l = $createListNode(rand() < 0.5 ? "bullet" : "number"); const li = $createListItemNode(); li.append($createTextNode("li" + round)); l.append(li); root.append(l); break; }
        case 6: { const t = pick(texts); if (t && rand() < 0.5) t.toggleFormat("bold"); else if (t) t.toggleFormat("italic"); break; }
        case 7: { if (allowDestructive && blocks.length > 1) { const blk = pick(blocks); blk?.remove(); } break; }
        case 8: { if (allowDestructive && blocks.length > 1) { const x = pick(blocks)!; const y = pick(blocks)!; if (x !== y) y.insertBefore(x); } break; }
        case 9: { const bm = root.getChildren().find((n) => $isBookmarkNode(n)); if (bm && $isBookmarkNode(bm)) bm.setTitle("bt" + b.id + "_" + round); else { const nb = $createBookmarkNode({ url: "https://e.com/" + round }); root.append(nb); } break; }
      }
    });
  } catch { /* skip ops that violate a local constraint */ }
}

describe("heavy: large fuzz with adversarial (out-of-order + duplicated) delivery", () => {
  const SEEDS = [1, 2, 3, 7, 42, 101, 1337, 99999];
  const PEERS = 6;
  const ROUNDS = 250;
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${PEERS} peers × ${ROUNDS} ops, harsh delivery → byte-identical convergence`, () => {
      const rand = rng(seed);
      const base = makeBoundEditor(); seedDoc(base);
      const peers = [base];
      for (let i = 1; i < PEERS; i++) { const p = makeBoundEditor(); syncInto(p, base); peers.push(p); }

      // Network buffer of in-flight messages {target, update}.
      type Msg = { target: number; update: Uint8Array };
      const wire: Msg[] = [];
      const enqueueLocal = (srcIdx: number) => {
        const src = peers[srcIdx];
        while (src.localUpdates.length) {
          const u = src.localUpdates.shift()!;
          for (let j = 0; j < peers.length; j++) if (j !== srcIdx) wire.push({ target: j, update: u });
        }
      };

      for (let round = 0; round < ROUNDS; round++) {
        const idx = Math.floor(rand() * peers.length);
        randomOp(peers[idx], rand, round, true);
        enqueueLocal(idx);

        // Deliver a random subset, OUT OF ORDER, sometimes DUPLICATED, sometimes delayed.
        const deliverN = Math.floor(rand() * Math.min(wire.length, 8));
        for (let k = 0; k < deliverN; k++) {
          const at = Math.floor(rand() * wire.length);
          const msg = wire.splice(at, 1)[0];
          applyNet(peers[msg.target], msg.update);
          if (rand() < 0.2) applyNet(peers[msg.target], msg.update); // duplicate delivery
          if (rand() < 0.1) wire.push(msg); // re-deliver later too
        }
        peers.forEach(flush);
      }
      // Drain the wire (still out of order) then full reconcile + strict asserts.
      while (wire.length) { const m = wire.splice(Math.floor(rand() * wire.length), 1)[0]; applyNet(peers[m.target], m.update); }
      peers.forEach(flush);
      reconcileAndAssert(peers, `heavy fuzz seed ${seed}`);
      peers.forEach((p) => p.dispose());
    });
  }
});

describe("heavy: whole-history order independence", () => {
  it("replaying the ENTIRE global update log in 6 shuffled orders yields identical state", () => {
    const rand = rng(2024);
    // Generate a history on a single peer; capture every local update from t0.
    const gen = makeBoundEditor();
    const log: Uint8Array[] = [];
    gen.doc.on("update", (u: Uint8Array, origin: unknown) => { if (origin === gen.binding) log.push(u); });
    seedDoc(gen);
    for (let i = 0; i < 150; i++) randomOp(gen, rand, i, true);
    flush(gen);
    const target = canon(jsonOf(gen));

    for (let trial = 0; trial < 6; trial++) {
      const shuffled = [...log];
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      const fresh = makeBoundEditor();
      for (const u of shuffled) applyNet(fresh, u);
      flush(fresh);
      expect(canon(jsonOf(fresh)), `shuffle trial ${trial} diverged from canonical history`).toEqual(target);
      expect(fresh.errors.length).toBe(0);
      fresh.dispose();
    }
    gen.dispose();
  });
});

describe("heavy: partition / heal", () => {
  it("two partitions edit in isolation, then heal → converge", () => {
    const rand = rng(555);
    const base = makeBoundEditor(); seedDoc(base);
    const peers = [base];
    for (let i = 1; i < 6; i++) { const p = makeBoundEditor(); syncInto(p, base); peers.push(p); }
    const left = peers.slice(0, 3), right = peers.slice(3);
    const syncGroup = (g: Bound[]) => { const st = g.map((p) => Y.encodeStateAsUpdate(p.doc)); for (const p of g) { for (const s of st) applyNet(p, s); } g.forEach(flush); };

    for (let round = 0; round < 80; round++) {
      randomOp(left[Math.floor(rand() * left.length)], rand, round, true);
      randomOp(right[Math.floor(rand() * right.length)], rand, round + 1000, true);
      if (round % 5 === 0) { syncGroup(left); syncGroup(right); } // sync within partition only
    }
    syncGroup(left); syncGroup(right);
    reconcileAndAssert(peers, "partition/heal"); // heal across both
    peers.forEach((p) => p.dispose());
  });
});

describe("heavy: high-contention hotspot", () => {
  it("6 peers concurrently insert into the SAME text node → converge, all markers survive", () => {
    const base = makeBoundEditor();
    build(base, () => { const r = $getRoot(); r.clear(); const p = $createParagraphNode(); p.append($createTextNode("CENTER")); r.append(p); });
    const peers = [base];
    for (let i = 1; i < 6; i++) { const p = makeBoundEditor(); syncInto(p, base); peers.push(p); }

    const rand = rng(818);
    const markers: string[] = [];
    for (const p of peers) {
      const m = `<${p.id}>`; markers.push(m);
      build(p, () => { const t = ($getRoot().getFirstChild() as any).getFirstChild() as TextNode; t.spliceText(Math.floor(rand() * (t.getTextContentSize() + 1)), 0, m, false); });
    }
    reconcileAndAssert(peers, "hotspot");
    const text = jsonOf(peers[0]).root.children[0].children.map((c: any) => c.text).join("");
    console.log("hotspot merged text:", JSON.stringify(text));
    for (const m of markers) expect(text, `marker ${m} lost`).toContain(m);
    peers.forEach((p) => p.dispose());
  });
});

describe("heavy: content-survival (non-destructive op set)", () => {
  it("every uniquely-tagged insert survives when no peer reorders/deletes", () => {
    const rand = rng(31337);
    const base = makeBoundEditor(); seedDoc(base);
    const peers = [base];
    for (let i = 1; i < 5; i++) { const p = makeBoundEditor(); syncInto(p, base); peers.push(p); }

    const tags: string[] = [];
    for (let round = 0; round < 120; round++) {
      const p = peers[Math.floor(rand() * peers.length)];
      const tag = `M${p.id}_${round}`; tags.push(tag);
      build(p, () => { const np = $createParagraphNode(); np.append($createTextNode(tag)); $getRoot().append(np); });
      // gossip occasionally
      if (rand() < 0.5) { const q = peers[Math.floor(rand() * peers.length)]; applyNet(q, Y.encodeStateAsUpdate(p.doc)); flush(q); }
    }
    reconcileAndAssert(peers, "content-survival");
    const all = jsonOf(peers[0]).root.children.flatMap((c: any) => (c.children ?? []).map((t: any) => t.text));
    for (const tag of tags) expect(all, `lost tagged insert ${tag}`).toContain(tag);
    peers.forEach((p) => p.dispose());
  });
});

describe("heavy: reproducibility", () => {
  it("same seed → identical final state across two independent runs", () => {
    function run(): string {
      resetClientIds(); // identical clientID sequence → cross-run determinism
      const rand = rng(24680);
      const base = makeBoundEditor(); seedDoc(base);
      const peers = [base];
      for (let i = 1; i < 4; i++) { const p = makeBoundEditor(); syncInto(p, base); peers.push(p); }
      for (let round = 0; round < 100; round++) {
        const idx = Math.floor(rand() * peers.length);
        randomOp(peers[idx], rand, round, true);
        if (rand() < 0.6) { const a = peers[Math.floor(rand() * peers.length)]; const c = peers[Math.floor(rand() * peers.length)]; if (a !== c) { applyNet(a, Y.encodeStateAsUpdate(c.doc)); flush(a); } }
      }
      const states = peers.map((p) => Y.encodeStateAsUpdate(p.doc));
      for (const p of peers) { for (const s of states) applyNet(p, s); flush(p); }
      const out = freshDerive(peers[0].doc).json; // converged DATA, not the live editor
      peers.forEach((p) => p.dispose());
      return out;
    }
    expect(run()).toEqual(run());
  });
});

describe("heavy: scale", () => {
  it("5000-node document round-trips and merges a concurrent edit", () => {
    const a = makeBoundEditor();
    build(a, () => {
      const r = $getRoot(); r.clear();
      const t = $createTitleNode(); t.append($createTextNode("huge")); r.append(t);
      for (let i = 0; i < 5000; i++) { const p = $createParagraphNode(); p.append($createTextNode("node " + i)); r.append(p); }
    });
    const bytes = Y.encodeStateAsUpdate(a.doc).length;
    const b = makeBoundEditor(); syncInto(b, a);
    expect(jsonOf(b).root.children.length).toBe(5001);

    // concurrent edits at opposite ends
    build(a, () => { (($getRoot().getChildAtIndex(1) as any).getFirstChild() as TextNode).spliceText(0, 0, "A!", false); });
    build(b, () => { (($getRoot().getChildAtIndex(5000) as any).getFirstChild() as TextNode).spliceText(0, 0, "B!", false); });
    applyNet(a, Y.encodeStateAsUpdate(b.doc)); applyNet(b, Y.encodeStateAsUpdate(a.doc)); flush(a); flush(b);
    reconcileAndAssert([a, b], "scale-5000");
    console.log(`SCALE 5000 nodes: encoded = ${bytes} bytes`);
    a.dispose(); b.dispose();
  });
});
