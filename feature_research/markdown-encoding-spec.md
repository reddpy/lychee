# Lychee markdown encoding spec

The wire format for `EditorState(JSON) ⇄ markdown`. Markdown is the durable body;
everything markdown cannot express is carried in a documented, reversible
`lychee-*` encoding. This is the contract the vault, sync, and LLM layers depend
on. Implementation: `src/components/editor/plugins/*-markdown-transformer.ts`,
orchestrated by `markdown-transformers.ts` and `markdown-io.ts`.

## Guarantees

1. **Lossless** — every registered node round-trips its semantic fields.
2. **Idempotent** — `md → nodes → md` returns the same markdown, so agents
   re-writing a file do not cause churn.
3. **Never lossy silently** — an unparseable `lychee-*` payload falls back to a
   code block rather than being dropped.
4. **Forward compatible** — unknown node types are preserved verbatim and
   restored once a build registers them.

## Reference (`lychee-reference`)

A reference is two parts: a visible link/image line and a fence for the fields
markdown can't carry.

```markdown
[Example](https://example.com)

```lychee-reference
{"displayMode":"card","description":"A description","faviconUrl":"https://example.com/f.ico"}
```
```

- **Visible line is authoritative for `url`, `title` (card) and `altText`
  (image).** Edit the link and the reference changes — this keeps the markdown
  meaningful to humans and agents.
- **The fence carries the rest** and is the only place those fields live:
  `displayMode`, `description`, `imageUrl`, `faviconUrl`, `width`, `height`,
  `alignment`, `autoResolve`, `hydrationAttempted`.
- `displayMode` is always present (it distinguishes card from image; the syntax
  already does, but the fence is self-contained enough to stand alone).
- The fence never duplicates `url`/`title`/`altText`, so there is exactly one
  source of truth per field. A local asset's id is likewise not duplicated: it
  lives only in the visible line (see Asset references below).
- A standalone fence (no visible line) is accepted; `url`/`title` are then empty.
- `loading` (transient download state) is intentionally not persisted.

## Unknown nodes (`lychee-unknown`)

A node type the running build does not register. The payload is the original
serialized JSON, preserved verbatim.

Top-level / block form:

```markdown
```lychee-unknown
{"type":"future-video","url":"https://v.example/1","meta":{"autoplay":true}}
```
```

Nested / inline form (base64 keeps the payload free of `>` and `--`, which would
break an HTML comment, and of `}`, which would fool a non-greedy regex):

```markdown
before <!--lychee-unknown:b64 eyJ0eXBlIjoi...--> after
```

When a future build registers `future-video`, `content-load.ts` unwraps the
preserved envelope and the real node loads.

## Note bookmark (`lychee-bookmark`)

Note bookmarks are zero-width inline markers with no markdown representation.
They use an invisible HTML comment (base64 payload):

```markdown
<!--lychee-bookmark:b64 eyJsYWJlbCI6...-->bookmarked text
```

`NoteBookmarkNode.getTextContent()` stays empty, so word counts, search, and
previews are unaffected.

## Title ownership

- Export: the leading `TitleNode` renders as `# Title`.
- Import: a **leading** level-one heading becomes the `TitleNode`. If the document
  has no leading `#`, an empty `TitleNode` is prepended (the editor invariant is
  title-first). A `# Heading` elsewhere in the body stays a `HeadingNode`, so
  pasted markdown cannot hijack the note title.
- Frontmatter (vault mode) will own the title separately; the body heading is the
  in-body projection.

## Transformer ordering (critical)

`lychee-reference` and `lychee-unknown` **must precede `CODE`** in
`MARKDOWN_TRANSFORMERS`. `CODE`'s start regex (```` ^```\w* ````) matches a
```` ```lychee-reference ```` / ```` ```lychee-unknown ```` opener and would import
the fence as a code block otherwise.

## Fallback behavior

If a `lychee-*` fence body is not parseable (e.g. an agent corrupted it), the
transformer returns `false` and the built-in `CODE` transformer claims the block,
preserving it as a code block rather than dropping it.

## Asset references

Binaries (images, and later video/files) live in `<vault>/assets/` named by
content hash: `assets/<sha256>.<ext>`. The editor never sees a vault path — it
encodes the local asset as `lychee-asset://<localId>` and `main/assets.ts`
rewrites the boundary:

```markdown
![A picture](assets/9f2c....png)
```

- **Export**: `lychee-asset://<id>` → copy bytes to `assets/<sha256>.<ext>`, emit
  the relative path.
- **Import**: `assets/<sha256>.<ext>` → store/​reuse a local asset by content hash,
  emit `lychee-asset://<localId>`.
- Content-addressing makes assets **immutable and deduplicated** across notes and
  devices, so syncing the `assets/` directory is conflict-free.
- The local asset id is the only local detail, and it never leaves the app
  (frontmatter/fences do not carry it).
- Currently the `images` table is the first asset kind; the vault format and token
  are already media-agnostic, so video/file kinds plug into the same layer.

## Still open

- **Table cell fidelity** — export flattens cell text; the table action menu's
  inline parsing and the `TABLE` transformer disagree. Unify next.
- **AutoLink** — exports as a bare URL and imports as plain text, not
  `AutoLinkNode`. Decide whether to mark it.
- **Video / arbitrary files** — no node or storage kind yet; the asset layer and
  vault format are ready for them.
- **Frontmatter** — vault files carry `id`/`title`/`emoji`/`bookmarked`/`created`/
  `updated`/`content_schema_version`/`order`.
