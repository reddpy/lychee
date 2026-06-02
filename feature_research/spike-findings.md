# Spike findings — Yjs binding validation

Companion to [born-sync-ready-shadow-ydoc-plan.md](./born-sync-ready-shadow-ydoc-plan.md).
Spike code: `src/spike/yjs-binding.spike.test.ts` (throwaway — see "Status" below).
Run: `pnpm exec vitest run src/spike/yjs-binding.spike.test.ts`

## Verdict: GO

Raw Yjs via `@lexical/yjs` is validated against our real custom nodes. All 4
spike tests pass:

1. Registering the real custom nodes (Title, Image, Bookmark) + attaching the
   `@lexical/yjs` binding **does not throw**. (Resolves the research's one
   uncertain 2-1 claim positively.)
2. `setEditorState` does NOT sync into the Y.Doc (documented constraint — see
   below).
3. A note with a **bookmark + image round-trips** EditorState -> Y.Doc ->
   EditorState with **every property preserved**.
4. **Divergent edits on two independent Y.Docs merge to convergence** — CRDT
   lineage works with our node tree.

Verdict stands after heavy adversarial + consistency testing (48 tests across 5
files). **Data convergence is unconditional** — across the harshest 6-peer fuzz
with out-of-order/duplicated delivery, Yjs state vectors and fresh-derived Lexical
never diverged. The pass surfaced **4 design-level risks** the build must handle,
none blockers:
1. Concurrent reorder drops a concurrent sibling edit (content loss, not divergence).
2. TitleNode-first invariant isn't preserved by merge (needs a normalization pass).
3. Cross-version / unknown nodes error (needs version gating).
4. **`@lexical/yjs` throws in normalization-conflict handling under concurrent
   editing — the binding MUST be wrapped defensively; when wrapped, convergence is
   preserved.** (See parts 3 and 5.)

## Versions (all lockstep; no bump needed)

- lexical 0.44.0 (already installed)
- @lexical/yjs 0.44.0  (added, devDep for now)
- @lexical/headless 0.44.0  (added, devDep for now)
- yjs 13.6.31  (added)
- happy-dom (added, devDep — test env; see finding 2)

**`NodeState` (`createState` / `$getState` / `$setState`) IS present in lexical
0.44.** This removes the single biggest cost-expander from the plan: no lexical
version bump is required.

## Key findings / gotchas for the build

### 1. `setEditorState` does not sync to Yjs (headless) — bootstrap via `editor.update`
The binding captures changes only when they flow through `editor.update()` with
real dirty-node tracking. Feeding a saved state via `setEditorState` produced an
**empty** Y.Doc in the headless spike (locked in by spike test #2).

Implication for the shadow engine: it cannot simply `setEditorState(savedJSON)`
to mirror a note into the Y.Doc. Content must be applied through an
`editor.update()` path. The spike bootstraps by constructing nodes with the real
`$create*` factories inside `editor.update(..., {discrete:true})`, which syncs
reliably.

Open item for the build: `@lexical/react`'s `CollaborationPlugin` bootstrap DOES
use `setEditorState` (with `HISTORY_MERGE_TAG`, gated on an empty collab root) —
but it runs in a DOM editor where a full reconcile marks nodes dirty. Whether
headless `setEditorState` ever marks dirty needs confirming during the build; the
safe path (apply via `editor.update`) is proven and should be the default.

### 2. Node files are coupled to the renderer runtime -> run the shadow editor renderer-side
Importing the real node classes transitively pulls in the app shell: the decorator
nodes import their React components, which import `src/renderer/theme-store.ts`,
which calls `window.matchMedia(...)` and `window.lychee.invoke(...)` **at module
load**. In a plain Node context this throws.

Confirms the plan's decision to run the shadow headless editor **in the renderer**
(DOM present), not the main process. If main-process headless is ever wanted, the
node *definitions* would need to be split from their *rendering* components (lazy
component import, or a headless-safe node variant). The spike sidesteps this by
running under `happy-dom` and stubbing the two component modules — the binding
never calls `decorate()`, so this is faithful for serialization testing.

### 3. Add volatile bookmark fields to `excludedProperties`
In the fixture the bookmark's `__autoResolve` / `__hydrationAttempted` were falsy,
so `exportJSON` omitted them and they didn't sync. When truthy they WOULD sync
through the binding. For the real build, add these (and any other per-device
hydration state) to the binding's `excludedProperties` so devices don't churn or
conflict over hydration bookkeeping. Image binary (`imageId` reference) syncs
fine; the binary itself is a separate subsystem (out of scope).

### 4. Remote -> local apply is async
`syncYjsChangesToLexical` applies remote changes via a NON-discrete
`editor.update`, committing on a later microtask. The shadow engine (and tests)
must account for commit timing — the spike flushes with a trailing discrete no-op
`editor.update(() => {}, {discrete:true})` before reading.

## Net effect on the plan

- Biggest risk (lexical bump for NodeState): **eliminated** — 0.44 has it.
- Custom-node binding risk: **retired** — real nodes round-trip and merge.
- New concrete constraints to design around: bootstrap-via-update (finding 1),
  renderer-side execution (finding 2), excludedProperties for hydration state
  (finding 3), async remote apply (finding 4).
- Sizing from the plan (~3-4 weeks) stands, with the most uncertain item resolved.

## Comprehensive coverage (part 2)

Second spike file `src/spike/yjs-node-coverage.spike.test.ts` — 8 tests, all pass.
Expands beyond the minimal gate to full node coverage, real concurrency,
idempotency, and stress.

Run: `pnpm exec vitest run src/spike/yjs-node-coverage.spike.test.ts`

**Node-type coverage — ALL registered types round-trip** (asserted each type is
present after Y.Doc round-trip): title, heading, quote, bullet/numbered/**nested**
lists, **checklist** (checked listitem), code + **code-highlight**, link,
autolink, **table/row/cell** (2x2), horizontalrule, image, bookmark, paragraph,
text. (YouTube excluded per scope.)

**Real concurrency (the part the first spike skipped):**
- ✅ Two concurrent inserts into the SAME text node merge char-level. Result:
  `"[B] Hello [A] world"` — both edits survived, both peers converged.
- ✅ Concurrent edits to DIFFERENT table cells merge and converge.
- ✅ Concurrent delete (peer A removes a paragraph) vs edit (peer B edits it)
  converges without error.
- ✅ Re-applying the same Yjs update is a no-op (idempotent).

**Stress:**
- 1000-paragraph document → encoded Y.Doc = **341,787 bytes (~342 KB)**;
  round-trips equal in ~65 ms.
- Shadow-save pattern: 300 sequential edits → **301 Yjs updates, 84,258 bytes**.
  Concrete confirmation that update history accumulates — **periodic compaction
  (snapshot + truncate log) is needed**, as the plan assumed. Not a blocker, but
  sizes the persistence work.

**New confirmed finding:** bookmark `autoResolve` / `hydrationAttempted` DO cross
the wire when truthy (test asserts it) → `excludedProperties` for these is
**required**, upgraded from "recommended."

Minor: `HorizontalRuleNode` / `$createHorizontalRuleNode` are flagged deprecated
by `@lexical/react` at this version (the import moved upstream). Lychee's
`nodes.ts` uses the same import, so it's consistent and unrelated to sync — just
noting it surfaced.

## Adversarial edge cases (part 3)

Third spike file `src/spike/yjs-edge-cases.spike.test.ts` — tries to BREAK the
binding. 8 pass + 1 documented expected-fail.

Run: `pnpm exec vitest run src/spike/yjs-edge-cases.spike.test.ts`

**Passed (good news):**
- Same-offset concurrent inserts stay contiguous, no character garble:
  `"Hello" + "BBB" + "AAA" + " world"`. Deterministic, converges.
- Emoji / surrogate pair preserved across concurrent edits around it:
  `"Hi X😀Y there"` — not split.
- Concurrent bookmark metadata writes converge (last-writer-wins per field;
  winner was deterministic across peers).
- Out-of-order incremental update delivery (u2 before u1) still converges —
  validates the async folder/object-store transport.
- 3-peer full-mesh exchange converges; all three edits present.
- Concurrent move vs edit converges and the moved node is present exactly once
  (no duplication/loss of the *moved* node itself).

**NEW RISKS surfaced (must design for):**

1. **Concurrent reorder DROPS a concurrent sibling edit. [data loss]**
   When peer A moves a paragraph (reorder) and peer B concurrently edits a
   *different* paragraph, B's edit is **lost** after merge. Root cause: tree-CRDT
   move = delete+reinsert, a known @lexical/yjs limitation. Lychee has
   drag-to-reorder (DraggableBlockPlugin), so this is a genuine risk — low
   frequency for single-user multi-device (Tier 1), higher for realtime collab
   (Tier 2). Encoded as an `it.fails` test so we're alerted if upstream fixes it.
   Mitigation options to evaluate: accept (rare offline collision), avoid true
   moves in the reorder path, or pin/serialize structural ops.

2. **TitleNode invariant is NOT preserved by merge.**
   After two peers each prepend content, the title stayed unique (count=1) but
   ended up at **index 2** — i.e. NOT first (order: paragraph, paragraph, title,
   paragraph). The CRDT enforces no app invariants. The build needs a
   **normalization pass after remote applies** to re-assert TitleNode-first (and
   any other structural invariants), or sync can produce notes with content above
   the title.

3. **Unknown / cross-version node surfaces an error.**
   Syncing a Y.Doc containing a `bookmark` into a client that didn't register
   `BookmarkNode` did not hard-crash but produced an editor error (captured via
   onError). Cross-version sync (older client receives a newer note) needs an
   explicit strategy: version gating, a graceful unknown-node fallback, or
   ensuring the node set is forward-compatible. Reinforced by the existing
   gotcha that the JSON `sanitizeSerializedState` migration layer is **bypassed**
   by Y.Doc content — legacy-format reconciliation has no path today.

## Consistency / convergence (part 4)

Fourth spike file `src/spike/yjs-consistency.spike.test.ts` — 13 tests, all pass.
Convergence-focused, with a seeded randomized multi-peer fuzz as the centerpiece.

Run: `pnpm exec vitest run src/spike/yjs-consistency.spike.test.ts`

**Centerpiece — randomized fuzz: 5 seeds × 4 peers × 50 random ops + random
gossip → ALL peers converge byte-identically** (canonical key-sorted compare).
Op mix includes insert/delete text, append/delete blocks, **reorder/move**,
format toggles, and bookmark-field edits. Key conclusion:

> **Convergence is rock-solid — it holds even when a content-losing op (move)
> occurs.** The move limitation (part 3) is *content loss*, NOT *divergence*: all
> peers still agree on the same final state. Consistency and content-preservation
> are separate guarantees; Yjs gives us the former unconditionally.

**Also verified:**
- **Commutative** — applying two concurrent updates in either order → identical.
- **State-vector diff sync** (the real delta transport: `encodeStateVector` →
  `encodeStateAsUpdate(doc, sv)`) converges with full-state sync.
- **Compaction is lossless** — `Y.mergeUpdates([...history])` loaded into a fresh
  doc equals the original. Validates the planned snapshot+log compaction design.
- **Decorator field independence** — A sets bookmark `title`, B sets
  `description` concurrently → BOTH survive (TITLE-A + DESC-B). No whole-node
  clobber; per-field LWW.
- **Table grid integrity** — concurrent row-add vs cell-edit converges with a
  valid grid (all rows equal cell count `[2,2,2]`).
- **Format merge** — concurrent bold vs italic on the same text both apply.
- **Long offline divergence** — 200 ops on each of two peers, single merge →
  converges (≥400 blocks).
- **Churn / GC** — 300 insert+delete cycles encode to just **4,361 bytes**. Yjs
  garbage-collects tombstones well, so *deletion* churn stays tiny. (Contrast with
  the part-2 finding that *additive* history grows ~84 KB / 300 edits — so
  compaction matters for append-heavy history, not for churn.)

Net: the consistency bar the team cares about (every replica converges, no
divergence, lossless persistence/compaction) is met across fuzz, ordering, diff
sync, structural hazards, and scale. The open items remain the part-3 *semantic*
risks (move drops a concurrent edit; title-first invariant; cross-version nodes),
which are about content/UX, not convergence.

## Heavy / harsh consistency (part 5)

Fifth spike file `src/spike/yjs-consistency-heavy.spike.test.ts` — 14 tests, all
pass. Much larger fuzz + adversarial network + a rigorous 3-level convergence
check. This pass produced the most important finding of the whole effort.

Run: `pnpm exec vitest run src/spike/yjs-consistency-heavy.spike.test.ts`

**Method — 3 levels of convergence (so we can tell data from rendering):**
1. **Yjs state vector** equality (the true CRDT guarantee).
2. **Fresh-derived Lexical** — load each converged Y.Doc into a *clean* editor and
   compare (proves the DATA renders identically, independent of live-editor history).
3. **Live editor** state (informational; sensitive to binding-feedback reentrancy).

**Headline result — convergence is UNCONDITIONAL.** Across 8 seeds × 6 peers ×
250 random ops (insert/delete/append/**reorder**/format/list/heading/quote/bookmark)
with **out-of-order + duplicated** incremental delivery, plus partition/heal,
high-contention hotspot, 200-op offline divergence, 5000-node scale, and a
whole-history shuffle replay:

> **Levels 1 and 2 diverged ZERO times in every test** — even in runs with **275
> caught binding errors**. The data always converges and always re-derives
> identically. Reproducibility confirmed (deterministic given fixed Yjs clientIDs).

**NEW MAJOR FINDING — `@lexical/yjs` live binding throws under concurrent
normalization (must guard).**
Under heavy concurrency, `@lexical/yjs`'s `$handleNormalizationMergeConflicts`
throws `TypeError: Cannot read properties of null (reading 'parent')` (inside
`YText.delete`) — when a remote apply triggers a local adjacent-text-node merge
whose YText content was concurrently deleted. It fired hundreds of times per
heavy-fuzz run. **Critical implications for the build:**
- The binding MUST be wrapped defensively (try/catch on BOTH sync directions).
  **When wrapped, the throws are recoverable — convergence still holds** (proven:
  runs with 200+ caught errors still had SVdiverged=0, freshDiverged=0).
- Most likely under Tier-2 realtime (many simultaneous editors); rare but possible
  for Tier-1 single-user multi-device.
- Action items: wrap the binding, consider reporting upstream, and pin the
  `@lexical/yjs` version (don't float).

**Integration discipline finding (live-editor divergence).**
The live editors *did* diverge under maximally-reentrant delivery (apply remote
updates mid-local-edit, aggressive flushing) — but the SAME converged doc
re-derives identically into a fresh editor (level 2 = 0). So this is an
*integration* concern, not a data one: the real engine must **serialize
remote-apply vs local-edit** (as `CollaborationPlugin` does) rather than applying
remote updates reentrantly. Don't drive the binding the way this stress harness
deliberately does.

**Scale:** 5000-node document encodes to ~1.55 MB; round-trips and merges a
concurrent edit cleanly.

## Status of the spike code

Five throwaway spike files, all green (4 + 8 + 9 + 13 + 14 = 48 tests; 1 is an
intentional `it.fails` documenting the move/edit limitation):
- `src/spike/yjs-binding.spike.test.ts` — minimal go/no-go gate.
- `src/spike/yjs-node-coverage.spike.test.ts` — full node coverage, concurrency,
  idempotency, stress.
- `src/spike/yjs-edge-cases.spike.test.ts` — adversarial edge cases.
- `src/spike/yjs-consistency.spike.test.ts` — randomized fuzz + convergence,
  ordering, diff sync, compaction, structural hazards, scale/churn.
- `src/spike/yjs-consistency-heavy.spike.test.ts` — large/harsh fuzz, adversarial
  delivery, 3-level convergence, partition/heal, hotspot, scale-5000.

All match the vitest include glob, so they run as part of `pnpm test` (fast, ~1.5s
combined, isolated via a `happy-dom` docblock). Useful as a regression guard once
real sync work starts — but deletable at any time, along with the `@lexical/yjs`
/ `@lexical/headless` / `yjs` / `happy-dom` devDeps if we don't want them carried
pre-alpha.
