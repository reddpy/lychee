# Markdown consistency findings — the editor ⇄ markdown contract

Companion to [spike-markdown-roundtrip.md](./spike-markdown-roundtrip.md) (the
go/no-go spec for markdown-as-truth) and
[vault-source-of-truth-plan.md](./vault-source-of-truth-plan.md). This is the
empirical pre-work: what actually happens when every currently registered node
goes through Lexical markdown export/import.

Method: a headless editor registering **all** of `src/components/editor/nodes.ts`,
driven through `$convertToMarkdownString` / `$convertFromMarkdownString` with the
app's real `MARKDOWN_TRANSFORMERS`. Now codified as
`src/components/editor/__tests__/markdown-roundtrip.test.ts`.

## Headline: the contract was broken, not just incomplete

`MARKDOWN_TRANSFORMERS` only powers `MarkdownShortcutPlugin` today — there is no
document-level markdown export/import in the app yet. That made a severe latent
bug invisible:

- Every export-only transformer used `regExp: /(?:)/` with a comment claiming it
  "never matches". It does match: `/(?:)/` matches the **empty string in every
  line**.
- `@lexical/markdown`'s importer tests each transformer's `regExp`/`regExpStart`
  against every line. The multiline `TABLE_EXPORT` transformer matched line 0,
  found no closing pattern, consumed the **entire document** via its no-op
  `replace`, and reported success.
- Result: **any markdown import produced an empty document.** `$convertFromMarkdownString`
  round-tripped every fixture to `[]`. `TITLE_EXPORT` / `REFERENCE_EXPORT` had the
  same defect via `$importBlocks` and would have swallowed each line and preempted
  headings/lists/quotes even after the multiline bug was fixed.

This is the same class of silent-total-content-loss as #286, one layer up: a
"successful" operation that drops content because a node/transformer was not
accounted for.

### Fix

- `markdown-export-only.ts`: `NEVER_MATCH = /(?!)/`, documented, shared by all
  export-only transformers. `/(?!)/` genuinely never matches.
- `title-`, `reference-`, `table-markdown-transformer.ts`: use `NEVER_MATCH`.
- `horizontal-rule-markdown-transformer.ts`: added. `HorizontalRuleNode` shipped
  with **no** transformer in `@lexical/markdown`, so it exported to an empty
  string and was dropped. Now imports `---`/`***`/`___` (with an optional trailing
  space so the live shortcut fires) and exports the canonical `***` (frontmatter-
  and setext-safe), mirroring Lexical's own React `DEFAULT_TRANSFORMERS`.
- `MARKDOWN_TRANSFORMERS`: wired `HORIZONTAL_RULE` in.

After the fix, import produces the expected node tree and md → nodes → md is
idempotent for representable blocks.

## Per-node fidelity (post-fix)

| Node | Export | Import | Verdict |
|---|---|---|---|
| Title | `# …` | leading h1 → `title` | lossless (title ownership, see below) |
| Heading / Quote | yes | yes | lossless |
| Bullet / ordered / check list | yes | yes | lossless (4-space indent matters; 2-space nesting collapses) |
| Code (+ highlight) | yes | yes | lossless |
| Link | yes | yes | lossless |
| Inline formatting (bold/italic/code/…) | yes | yes | lossless |
| Horizontal rule | `***` | `---`/`***`/`___` | lossless (was dropped) |
| Reference (image) | `![alt](url)` + fence | yes → `reference` | **lossless** — geometry, `imageId`, alignment via fence |
| Reference (card) | `[title](url)` + fence | yes → `reference` | **lossless** — description/favicon/flags via fence |
| Table | pipe table | yes | structure lossless; export flattens cell text (no inline formatting); the `TABLE` transformer stores `**bold**` literally, while the table action menu parses it into formatting — two import paths, two results |
| AutoLink | plain URL text | plain text | **lossy** — not reconstructed as `AutoLinkNode` |
| Note bookmark | HTML comment | yes | **lossless** — label + createdAt preserved |
| Unknown / future node | `lychee-unknown` fence (block) / base64 comment (inline) | yes | **lossless** — payload preserved verbatim |

## What this means for the vault / sync / LLM plans

The vault plan makes markdown the durable body. The encoding layer now covers the
non-markdown constructs; the full contract lives in
[markdown-encoding-spec.md](./markdown-encoding-spec.md).

Done:

1. **Unknown block encoding.** `lychee-unknown` fences preserve the original JSON
   verbatim (and a base64 inline form for nested nodes). CODE-ordering gotcha
   handled; unparseable fences fall back to a code block, never dropped.
2. **Reference and note-bookmark encodings.** `lychee-reference` carries the
   fields markdown can't (visible link/image is authoritative for url/title/alt);
   `lychee-bookmark` carries label + createdAt as an inline comment.
3. **Title ownership.** Document-level import maps the leading h1 to `TitleNode`;
   export emits the title as `# Title`. Body `# Heading`s are not hijacked.

Still open:

4. **Single table import path.** Fold the table action menu's inline-markdown
   parsing into the `TABLE` transformer (or vice-versa) so pasted and imported
   tables are identical.
5. **AutoLink↔Link equivalence.** Decide whether the URL-only projection is
   acceptable or whether autolinks need a marker.
6. **Asset storage — done.** Binaries are content-addressed under
   `<vault>/assets/<sha256>.<ext>`; the editor's `lychee-asset://<id>` token is
   rewritten at the vault boundary. See `markdown-encoding-spec.md#asset-references`.

## Relationship to Phase 0

Phase 0 (autosave gate + unknown-node preservation + content schema version) is
the storage-layer defence for the same failure class and is **independent of
storage**. It shipped alongside this work:

- `content-load.ts` — pure load pipeline returning `empty | ready | error`.
  Unknown node types are wrapped in an `UnknownNode` envelope (payload preserved
  verbatim) instead of aborting the parse; recognized payloads are unwrapped on a
  later build. Invalid JSON / missing root becomes `error`.
- `unknown-node.tsx` — registered placeholder that `exportJSON`s the preserved
  payload; included in `KNOWN_NODE_TYPES` (`nodes.ts`).
- `lexical-editor.tsx` — when the load result is `error` or `schemaAhead`, the
  editor is **not mounted**, so autosave cannot run; a user-facing banner explains
  why. Saves include `metadata.contentSchemaVersion`.
- `documents.ts` (main) — refuses any `documents.update` that would overwrite
  content whose `metadata.contentSchemaVersion` is newer than
  `CONTENT_SCHEMA_VERSION`, as defense in depth for future agent/MCP writers.
- Tests: `content-load.test.ts` (10) reproduces the #286 scenario — an unknown
  node no longer truncates the note, and both surrounding blocks survive a
  load/save cycle.

