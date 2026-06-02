# Born sync-ready: continuously-updated shadow Y.Doc — approach, sizing, and spike

Companion to [yjs-sync-research.md](./yjs-sync-research.md) (the feasibility
verdict) and [pre-sync-data-hygiene-checklist.md](./pre-sync-data-hygiene-checklist.md)
(do-during-alpha hygiene).

## Decision

Make Lychee's note data **born sync-ready before alpha** by maintaining one
**persistent, continuously-updated Y.Doc per document** that accumulates
incremental changes — so when sync ships there is no scary one-shot migration and
the CRDT data model is locked while the cost of changing it is near-zero.

We achieve this with a **shadow headless editor**, NOT by running
CollaborationPlugin in the live editor.

### Why "continuously-updated" and not "regenerate from JSON"

A Y.Doc is a *history*, not just a *format*. CRDT merge works because two Y.Docs
share a common lineage (client IDs + state vectors tracing to a common ancestor).

- Regenerating a fresh Y.Doc from JSON on each save produces a NEW doc with no
  shared lineage every time. Two devices doing this independently will NOT merge
  cleanly (different client IDs, no common ancestor -> duplication/conflict). That
  ships the format but gives **false safety** — merge still breaks the day sync
  turns on. Do not do this.
- A single persistent Y.Doc that accumulates incremental updates has real lineage
  and merges correctly. This is what we build.

### Why the shadow approach (not live CollaborationPlugin) — for now

Running the binding in the live editor before alpha would pull the whole
integration (HistoryPlugin -> UndoManager swap, editorState:null semantics, custom
node work, save-flow rewrite) onto the critical path and **destabilize the core
editing experience right when we want stable alpha feedback**. The shadow approach
avoids all of that:

- The live editor is **untouched**. `HistoryPlugin`/undo stays exactly as-is — the
  UndoManager migration (research risk #3) is deferred entirely until we later flip
  the source of truth or go realtime.
- JSON stays the **source of truth**; the Y.Doc is a derived artifact. A bug in the
  shadow engine therefore **cannot corrupt user notes** — the Y.Doc is always
  rebuildable from JSON.

## How it works

There is exactly one place content is serialized and saved today:
`src/components/lexical-editor.tsx` ~line 317 — `saveContent` does
`JSON.stringify(editorState.toJSON())` -> `documents.update` IPC. That single
chokepoint is the entire integration surface.

- Keep one long-lived `createHeadlessEditor` + `@lexical/yjs` binding + `Y.Doc`
  **per open document** (maps cleanly onto the existing one-`LexicalComposer`-per-docId
  model — see `src/renderer/App.tsx` EditorArea).
- `OnChangePlugin` already provides the full `EditorState` on every change. At save
  time, feed that state into the shadow editor via `setEditorState`. The binding
  diffs prev->next and writes an **incremental** update to the Y.Doc. The shadow
  editor must persist between saves so the diff stays incremental (not full).
- Persist the Y.Doc state (snapshot + append-only update log) to SQLite; compact
  periodically.

Note: updates are **save-granularity (~600ms debounce), not keystroke-granularity**.
That is fine for this purpose — lineage is intact and merges work; updates are just
coarser than live collab would produce.

Run the shadow editor **in the renderer**, not the main process: the custom node
files import React (e.g. `bookmark-node.tsx` -> `BookmarkComponent`), which
complicates a Node/main bundle. Renderer-side sidesteps that; ship the resulting
Y.Doc updates to main over IPC for SQLite persistence.

## Sizing — ~3-4 weeks (16-26 working days) for a solid, tested version

| # | Work | Size | Notes |
|---|------|------|-------|
| 0 | **Spike / validation** | 2-4 d | Gates everything. See below. |
| 1 | Deps + version alignment | 0.5-3 d | Add `yjs`, `@lexical/yjs`. Risk: if NodeState is needed and lexical 0.44 is too old, a bump drags regression cost across all custom plugins. |
| 2 | Shadow sync engine | 4-6 d | Per-doc headless editor + binding + Y.Doc lifecycle (create on open, dispose on close), hooked into the single `saveContent` point. |
| 3 | Persistence (SQLite) | 3-5 d | New migration v2: `document_crdt` snapshot + append-only update log; repo fns; compaction; IPC to ship updates renderer->main. Additive — uses existing migration + VACUUM backup infra. |
| 4 | Bootstrap existing notes | 1-2 d | Generate initial Y.Doc from JSON for notes lacking CRDT state. Idempotent. Small pre-alpha. |
| 5 | Custom-node hardening | 2-4 d | `excludedProperties` for volatile fields (`__hydrationAttempted`, `__autoResolve`); confirm image/youtube/code-block bind. Bookmark is the one with teeth. |
| 6 | Tests | 3-4 d | Round-trip per node type, idempotency, **two-Y.Doc concurrent-merge sim** (proves the payoff), compaction, save-flow drift over many edits. Use `pnpm test` for DB/ABI tests, `pnpm run test:e2e:build` for e2e. |
| 7 | Glue / cleanup | 1-2 d | |

The spike front-loads the single biggest unknown; ~80% of uncertainty collapses
after it.

### Explicitly NOT in this phase (correctly deferred)

Transport/sync adapters, server, accounts, E2E encryption, realtime websocket,
image-binary sync, and the undo migration. This phase produces only a clean,
continuously-updated, mergeable Y.Doc in local SQLite — born alongside the data.
Everything else stays behind the swappable `SyncAdapter` interface.

### What could push it longer

1. A forced lexical version bump for NodeState (most likely expander — spike tells
   us immediately).
2. Custom nodes not binding cleanly — the bookmark's 7 properties incl.
   async-mutated ones (`__title/__description/__imageUrl/__faviconUrl` via
   `setMetadata` after IPC hydration). Spike output.
3. Running the shadow editor in the main process (React-import-in-Node packaging) —
   avoid by running renderer-side.

## The spike (do first — 2-4 days)

> **DONE — verdict GO.** See [spike-findings.md](./spike-findings.md). Real custom
> nodes round-trip + merge through `@lexical/yjs`; `NodeState` is in lexical 0.44
> (no version bump needed). New constraints surfaced: bootstrap via
> `editor.update` (not `setEditorState`), run the shadow editor renderer-side,
> `excludedProperties` for bookmark hydration fields.

Throwaway code, touches nothing in the real app. Go/no-go gate before committing.

Scope:
1. `createHeadlessEditor` registering ALL current nodes (`src/components/editor/nodes.ts`):
   title, image, bookmark, youtube, code-block + built-ins.
2. Attach `@lexical/yjs` binding to a fresh `Y.Doc`.
3. Take a REAL note's serialized EditorState that contains BOTH a bookmark and an
   image (the two awkward nodes), feed it through `setEditorState`.
4. Assert: no throw; `Y.Doc` -> EditorState round-trips back **equal** to input
   (modulo intentionally-excluded volatile fields).
5. Apply two divergent edits to two clones of the Y.Doc, merge both ways, assert
   convergence (proves lineage merge).
6. Record `@lexical/yjs` <-> `lexical` 0.44 version compatibility and whether
   `NodeState` (`$getState`/`createState`) is available at our version.

"Clean" = steps 4 and 5 pass with all current nodes registered, and the only
fields that fail round-trip are ones we intentionally exclude.

Outputs:
- Go / no-go on raw Yjs as the data model.
- List of nodes/properties needing `excludedProperties` or `NodeState`.
- Whether a lexical version bump is required (and rough blast radius).

## Safety properties (why this is OK to ship pre-alpha)

- JSON remains source of truth; Y.Doc derived and rebuildable -> no risk to user
  notes.
- SQLite stays local; never synced via a cloud folder (research risk #2).
- Schema change is additive, guarded by existing migration + VACUUM backup infra.
- Live editing experience (incl. undo) unchanged.
