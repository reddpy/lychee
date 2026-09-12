# Spike: markdown round-trip fidelity (go/no-go)

Gates [vault-source-of-truth-plan.md](./vault-source-of-truth-plan.md). The vault
plan makes a markdown file the durable source of truth; if serialized editor state
cannot survive JSON → markdown → JSON losslessly for every node we ship, that plan
is unsound and we fall back to a structured container (or keep JSON canonical).

Timebox: **2-4 days.** Throwaway harness, no changes to the live editor.

## Question

For every node in `src/components/editor/nodes.ts`, does
`EditorState(JSON) → markdown → EditorState(JSON)` preserve all semantic content?

If yes for all node types (or for all after adding the listed transformers), the
vault plan proceeds. If any node is irreducibly lossy, we choose the fallback
encoding strategy before committing.

## Current state (what already exists)

`src/components/editor/markdown-transformers.ts` wires:

| Node (`type`) | Transformer | Import? | Notes |
|---|---|---|---|
| Title (`title`) | `TITLE_EXPORT` | No | export-only; `regExp` never matches |
| Reference (`reference`) | `REFERENCE_EXPORT` + `REFERENCE_IMAGE` | image only | card import falls through to Link; metadata dropped |
| Table | `TABLE_EXPORT` + `TABLE` | Yes | cells flattened via `getCellText` |
| Heading/Quote/List/Code/Formatting/Link | `@lexical/markdown` built-ins | Yes | standard |
| Horizontal rule | — | — | **no transformer: lost** |
| Note bookmark (`note-bookmark`) | — | — | **no transformer: lost** |
| AutoLink (`autolink`) | — | — | imports as plain `LinkNode` |
| Unknown / future | — | — | **no preservation: the #286 class** |

So three classes of risk: nodes with **no** representation (HR, note-bookmark),
nodes with **partial** representation (reference, table, title), and **unknown**
nodes (which the vault plan promises to preserve verbatim).

## Go/no-go criteria

Pass requires all of:

1. **Per-node lossless round-trip.** JSON → MD → JSON is semantically equal for
   every registered node, where "semantic" excludes a documented ignore-list
   (node keys, `__src` runtime cache, `direction`, and hydration fields we declare
   derived — see `pre-sync-data-hygiene-checklist.md` for the existing concern).
2. **Import idempotence.** MD → JSON → MD returns the same markdown, so an
   LLM/agent writing markdown does not cause churn.
3. **Unknown preservation.** An unregistered node type survives a round-trip
   verbatim and can be re-emitted once the type is known. This is the #286 guard
   made testable.
4. **Real-note corpus.** The above holds on a sanitized sample of real notes, not
   just synthetic fixtures.

Fail on any node that cannot be made lossless with a bounded custom transformer.

## Method

Headless editors, vitest, mirroring the existing pattern in
`src/components/editor/plugins/__tests__/reference-markdown-transformer.test.ts`
(mock the React decorator component, `createEditor` with the full node list).

1. Build a `roundTrip(json)` / `exportMarkdown(editor)` / `importMarkdown(md)`
   harness registering **all** nodes from `src/components/editor/nodes.ts` and the
   full `MARKDOWN_TRANSFORMERS` list.
2. Per-node fixtures: at least one canonical instance per node, plus the awkward
   cases (see matrix).
3. Corpus: sanitized real notes exported from a dev DB, plus randomized
   combinations of adjacent block/inline nodes (fuzz the ordering).
4. Compare normalized `exportJSON()` trees (normalize keys/undefined) rather than
   strings; report the first differing path.
5. For anything that fails, prototype the smallest fix and re-run: a new
   transformer, or a fenced raw block.

### Fenced-block gotcha

The built-in `CODE` transformer claims ```` ```lang ```` fences. Any custom
block encoding (`lychee-reference`, `lychee-unknown`) must be matched by a
transformer ordered **before** `CODE`, and must not be produced for content that
`CODE` would otherwise own. Verify fence nesting/escaping explicitly.

## Node matrix to prove

| Node | Awkward case to include | Expected outcome |
|---|---|---|
| Title | empty vs non-empty title; title containing `#` | import path needed, else title lives only in frontmatter |
| Heading/Quote/List | deeply nested lists; mixed ordered/check; formatting inside | built-ins should pass; verify nesting |
| Code | multi-line, unknown language, backticks inside | built-ins; verify fence escaping |
| Link / AutoLink | `target`/`rel`, autolinked URL vs explicit link | define equivalence (AutoLink→Link?) |
| Table | rich text in cells; multiple paragraphs; alignment divider; empty cells | current import flattens — decide upgrade vs accept |
| Horizontal rule | adjacency to other blocks | **new transformer required** |
| Reference (card) | title/description/favicon/hydration flags | needs lossless encoding beyond `[t](url)` |
| Reference (image) | remote URL; local `imageId`/`lychee-image://`; width/height/alignment | **asset-reference decision required** |
| Note bookmark | inline placement between blocks; adjacent text | **new inline transformer required** |
| Unknown `{"type":"future-x"}` | nested, with children | raw `lychee-unknown` block preserves payload |
| Inline formatting | nested/combined bold+italic+highlight+code | verify combinations |

## Decisions the spike must force

- **Asset references.** How a local image (currently `imageId` in the `images`
  table + `lychee-image://` src) is represented on disk so it renders on another
  device and to an LLM. Likely `assets/<hash>` + relative path in markdown; the
  spike only needs to prove the reference survives round-trip.
- **Raw-block strategy.** Whether unknown nodes are embedded as fenced JSON in the
  body, or the whole document keeps a hidden lossless JSON block as a safety net.
  Measure how much of real content actually needs embedding.
- **Markdown vs. structured fallback.** If the matrix cannot be made lossless in
  budget, the vault body becomes a structured container with markdown as an
  export target, and the plan's "markdown is the body" claim is amended.

## Deliverables

1. A findings doc alongside `spike-findings.md`: pass/fail per node, with the
   first-differing path for failures.
2. The concrete list of new/upgraded transformers required and rough size.
3. A working raw/unknown-block encoder+decoder prototype.
4. A go/no-go verdict and a revised estimate for the vault migration.

## Out of scope

Sync transport, the write arbiter/conflict protocol, the file watcher, and MCP.
Those are tracked separately in the vault plan's "Known gaps / unresolved".
