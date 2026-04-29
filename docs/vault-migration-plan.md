# Vault Migration Plan: SQLite-JSON → Markdown-on-Disk + SQLite-as-Cache

## Context

Lychee currently stores every note as a Lexical-state JSON blob in `documents.content` (TEXT column in SQLite at `userData/lychee.sqlite3`). This is the same lock-in pattern as Notion: data is held inside an opaque app-owned database. Goal: compete head-to-head with Obsidian (files-on-disk portability) while keeping the Notion-class polish of Lexical-based editing.

The migration: each note becomes a `.md` file in a user-owned **vault folder**. SQLite is rewritten to be a **rebuildable cache and index** — never the source of truth for content. Folder structure on disk *is* the note hierarchy. App-feel state (sortOrder, emoji, starred, oEmbed cache, tabs, search index) stays in SQLite, per-machine, regenerable.

**No users beyond the developer.** This collapses the original 6-phase plan into 4 phases. No migration wizard, no pre-flight roundtrip checks per existing note, no rollback paths, no legacy mode toggle, no 14-day backup retention, no weeks-long shadow validation gate. A bad migration just means re-running a script.

**Stack stays Electron + Node.** Tauri/Rust was considered and rejected — the closest analogous migration (rich-text editor on Tauri) went back to Electron, WebKitGTK has documented contenteditable bugs (Tauri #9088) that Lexical's CI doesn't cover, and the productionization gaps (Mac universal binaries, code signing edge cases) aren't worth fighting for the bundle-size win.

Why this is worth doing:
- **Portability**: vault is plain markdown, syncable via Dropbox/iCloud/git, openable in Obsidian/iA Writer/vim.
- **Scale**: today's search is a renderer-side O(n) scan with a hard 500-doc limit (`src/main/repos/documents.ts:28`). Replacement is FTS5 with sub-50ms search at 100k notes.
- **Longevity**: data outlives the app.
- **Mobile/collab enabled later**: architecture doesn't preclude either.

Why this is hard:
- Lexical custom nodes (`BookmarkNode`, `YouTubeNode`, `ImageNode` width/alignment, `CodeBlockNode`) need markdown serializers that don't exist yet, or are buggy.
- Six renderer sites parse `JSON.parse(content)` directly. They all change.
- A latent bug exists today: `code-block-markdown-transformer.ts` is defined but **not registered** in `plugins.tsx:58-79` (uses standard `CODE` instead → produces `CodeNode`, not our custom `CodeBlockNode`). Notes you've created today are in inconsistent state. Fix the registration in Phase 1; normalize via `sanitizeSerializedState`.

---

## Architectural Decisions

1. **Filesystem = tree of truth.** Folder = parent. No `parentId` column after migration. Watcher reflects FS changes into SQLite index.
2. **One `.md` file per note.** YAML frontmatter carries `id` (UUID) and `createdAt`. Body is markdown.
3. **Filenames are slugs**, not UUIDs (`shopping-list.md`). Collisions resolved with `-2`, `-3` suffix. Frontmatter UUID is the join key, so renames in Finder are robust.
4. **Title is body-first H1** (Obsidian-style). The first line of the body after frontmatter is `# Note Title`. The `documents.title` SQL column becomes a denormalized cache; the `.md` is canonical.
5. **Image syntax: Obsidian-style** `![alt|width|alignment](path)`. Images move from `userData/images/` to `vault/.attachments/`.
6. **Bookmark/embed cards** = bare URL on its own line in markdown. App detects at render time → renders card. oEmbed metadata lives in SQLite `oembed_cache` table, never in the .md.
7. **YouTube** = bare YouTube URL. Width/alignment in an optional fenced extension only when non-default.
8. **App state in SQLite (per-machine, rebuildable):** `sortOrder`, `emoji`, `bookmarkedAt`, oEmbed cache, FTS5 index, tabs, settings.
9. **Soft delete** = move to `vault/.trash/` folder. No DB flag.
10. **Optional `.lychee` metadata bundle** for cross-machine state transfer. Nice-to-have, ship in Phase 3 with FTS5 work or punt to later.

---

## Phased Implementation

### Phase 1 — Markdown Transformers + CodeBlockNode Fix

**Goal:** Lexical state survives `serialize → parse → serialize` for every node we use. Roundtrip test suite passes. CodeBlockNode registration bug is fixed and existing notes are normalized via `sanitizeSerializedState`.

**No shadow validation in production saves** — the original plan had this to gather weeks of confidence-building telemetry from real users. Without users, fixture-based unit tests + dogfooding cover the same risk.

**New files:**
- `src/components/editor/markdown/serialize.ts` — `editorStateToMarkdown(state) → string` wrapping `@lexical/markdown`'s `$convertToMarkdownString` with the full TRANSFORMERS array.
- `src/components/editor/markdown/parse.ts` — `markdownToEditorState(md) → SerializedEditorState`. Splits frontmatter; uses `$convertFromMarkdownString`.
- `src/components/editor/markdown/frontmatter.ts` — minimal YAML for our 2-3 keys (`id`, `createdAt`, future `tags`). Don't add `js-yaml`; hand-roll.
- `src/components/editor/plugins/bookmark-markdown-transformer.ts` — bare URL on its own line → `BookmarkNode` (post-pass after AutoLinkPlugin).
- `src/components/editor/plugins/youtube-markdown-transformer.ts` — YouTube URL detector; runs *before* the bookmark transformer (order in TRANSFORMERS matters).
- `src/main/__tests__/markdown/roundtrip.test.ts` + `fixtures/*.json|*.md` — 12-15 hand-built fixture pairs.

**Modify:**
- `src/components/editor/plugins/image-markdown-transformer.ts` — extend regex to parse `|width|alignment` from alt text; extend export to compose suffix.
- `src/components/editor/plugins.tsx:58-79` — replace `TRANSFORMERS`. **Critical fix:** drop `CODE` from `@lexical/markdown`, register the local `CODE_BLOCK` (multiline) transformer.
- `src/components/editor/editor.tsx:80-141` `sanitizeSerializedState` — extend `migrateChildren` to rewrite legacy `code` nodes to `code-block` shape on import.

**Custom node markdown specs:**

| Node | Export form | Import detection | Notes |
|---|---|---|---|
| `TitleNode` | `# {text}\n` (first H1) | First H1 in body becomes TitleNode; rest become HeadingNode | Title lives in body; frontmatter doesn't carry it. |
| `ImageNode` | `![alt\|width\|align](path)` | Regex extends current `IMAGE` transformer | width/align optional. |
| `BookmarkNode` | bare URL on own line | Post-AutoLink scan: paragraph with single AutoLinkNode → BookmarkNode | Cache (title/desc/imageUrl/faviconUrl) in `oembed_cache` table, render-time lookup. |
| `YouTubeNode` | bare YT URL on own line; `{youtube width=600 align=center}\nURL\n` for non-default | URL pattern detector runs *before* bookmark | `videoId` derivable from URL. |
| `CodeBlockNode` | ` ```lang\ncode\n``` ` | Local `CODE_BLOCK` transformer (now registered) | Fixes latent bug. |
| `LoadingPlaceholderNode` | not serialized | n/a | Already filtered (`lexical-editor.tsx:319-321`). |

**Verifiable:** `pnpm test` passes the roundtrip suite for all fixtures.

---

### Phase 2 — Vault + Watcher + Cutover (one combined phase)

**Goal:** Vault is on disk and authoritative for content. SQLite content column is gone. The watcher syncs external changes. The 6 renderer JSON-parse sites are rewritten to markdown.

**Add dependency:** `pnpm add chokidar`.

**New files:**
- `src/main/vault/paths.ts` — `getVaultRoot()`, `getAttachmentsDir()`, `getTrashDir()`.
- `src/main/vault/slug.ts` — `titleToSlug()`, collision resolver.
- `src/main/vault/atomic-write.ts` — `writeFileAtomic(filePath, contents)`: write-temp + fsync + rename. **Required**; never use direct `writeFileSync`.
- `src/main/vault/notes.ts` — `writeNote`, `readNote`, `deleteToTrash`, `listAllNotes`.
- `src/main/vault/watcher.ts` — chokidar setup with `awaitWriteFinish`.
- `src/main/vault/recently-written.ts` — TTL Map echo suppression on self-writes.
- `src/main/vault/sync.ts` — reflection logic with rename pairing.
- `src/main/ipc/vault.ts` — handlers for `vault.getRoot`, `vault.setRoot`, `vault.writeNote`, `vault.readNote`, `vault.revealInFinder`.
- `src/main/migration/dev-converter.ts` — **dev-only one-shot script**. No UI. Reads SQLite, converts each note via `editorStateToMarkdown`, writes vault, moves images.
- `src/renderer/vault-events.ts` — zustand bridge subscribing to `vault:file-changed`, tracks `dirtyTabs`.
- `src/components/external-change-dialog.tsx` — modal: Reload / Keep mine / Open in new tab.

**Modify:**
- `src/main/db.ts` — **migration v10**: add `documents.vaultPath TEXT NULL UNIQUE`, drop `parentId` and `deletedAt`.
- `src/main/__tests__/helpers.ts` — mirror v10.
- `src/shared/ipc-types.ts:21-128` — add vault channels; populate `IpcEvents` (`vault:file-changed`, `vault:file-renamed`, `vault:file-removed`, `vault:indexing-progress`).
- `src/main/ipc.ts:60-66` `documents.update` — write to vault via atomic-write.
- `src/main/repos/documents.ts` — replace parentId queries with `vaultPath`-prefix queries.
- `src/main/ipc.ts:85-89` `documents.move` — `fs.rename` in vault; emit `vault:file-renamed`.
- `src/index.ts:73-78` — `lychee-image://` resolves attachments dir.
- `src/index.ts` — start watcher after `initDatabase()`.

**The 6 renderer JSON-parse sites — all rewritten:**
- `src/main/ipc.ts:28-42` `validateContentJson` → `validateMarkdown`.
- `src/components/lexical-editor.tsx:16-27` `getSerializedState` → `markdownToEditorState`.
- `src/shared/search-preview.ts:63-73` `extractPlainText` → markdown stripper.
- `src/shared/search-preview-state.ts:36-68` — works unchanged (still walks `SerializedEditorState`).
- `src/components/editor/read-only-note-preview.tsx:27-37` `parseSerializedState` → `markdownToEditorState`.
- `src/components/tab-strip.tsx:54-66` empty detection → markdown-emptiness check.

**Conflict resolution policy:** clean tab silent reload + toast; dirty tab blocking modal default Reload; network drives opt-in to `usePolling`.

---

### Phase 3 — FTS5 + Per-Machine State Tables

**Goal:** Search becomes instant at any scale. Per-machine app state lives in stable tables keyed by note `id`.

**Migration v11:**
- `note_state(id PK, sortOrder, emoji, bookmarkedAt, lastViewedAt, metadata)`. Backfill from `documents`. Drop `documents.emoji`, `documents.sortOrder`, `documents.metadata`.
- `oembed_cache(url PK, title, description, imageUrl, faviconUrl, fetchedAt, expiresAt)`.
- `notes_fts` FTS5 virtual table with title+body, prefix indexes for typeahead. AFTER triggers on `documents` keep it in sync.
- Search query uses `bm25(notes_fts, 10.0, 1.0)` (title 10x body) + `snippet()` for previews.

**New files:**
- `src/main/repos/search.ts`, `note-state.ts`, `oembed-cache.ts`, `indexer.ts` (progressive cold-start indexing).
- `src/main/ipc/export.ts` — optional `.lychee` metadata bundle export/import.

**Modify:**
- `BookmarkNode` shrinks to `{ type, url, version: 2 }`; metadata fetched at render from `oembed_cache`.
- `YouTubeNode` — `videoId` from URL; non-default width/align via fenced extension.
- Renderer search UIs → call `search.notes` IPC.

---

### Phase 4 — Polish

**Goal:** Title-rename = file-rename. Drop `documents.content` column.

**Modify:**
- `src/components/editor/plugins/title-plugin.tsx` — debounced `vault.renameNote` on title change. Reslug + `fs.rename`. Suppresses watcher echo.
- `src/main/db.ts` — **migration v12**: drop `documents.content`.

**Stretch:** `#tag` extraction → indexed FTS5 column; recent-notes boost; "show diff" option in external-change dialog.

---

## Critical Files Summary

| File | Role |
|---|---|
| `src/main/db.ts` | Migrations v10 (Phase 2), v11 (Phase 3), v12 (Phase 4) |
| `src/main/ipc.ts` + `src/shared/ipc-types.ts` | IPC surface; populate `IpcEvents` |
| `src/components/lexical-editor.tsx` | Save flow (310-337); content parse (16-27) |
| `src/components/editor/plugins.tsx:58-79` | TRANSFORMERS array; CodeBlockNode registration fix |
| `src/components/editor/plugins/*-markdown-transformer.ts` | All custom node transformers |
| `src/main/repos/documents.ts` | parentId → vaultPath rewrite |
| `src/components/editor/editor.tsx:80-141` | sanitizeSerializedState; extend for legacy code→code-block |

## Existing Code to Reuse

- Migration framework in `src/main/db.ts:9-219` with `meta.schema_version` tracking — pattern for v10–v12.
- `handle<C>()` IPC wrapper in `src/main/ipc.ts:24-26` — same pattern for vault channels.
- `createTestDb()` in `src/main/__tests__/helpers.ts` — for unit tests of new repos.
- Playwright `electronApp` fixture in `e2e/electron-app.ts` — covers temp `userData` isolation.
- `sanitizeSerializedState` in `src/components/editor/editor.tsx:124-141` — content-shape evolution entry point; extend for the CodeBlockNode bug.
- `@lexical/markdown` `$convertToMarkdownString` / `$convertFromMarkdownString` — already in deps.

## Risk Register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Markdown roundtrip silently lossy | High | Fixture-based roundtrip tests in Phase 1. `sourceUrl`/`imageId` stored in `note_state.metadata` keyed by image path — out-of-band. Dogfooding catches what fixtures miss. |
| 2 | Watcher echo storm or rename misdetection | High | 1500ms TTL echo suppression; 500ms rename-pairing grace. Network drives opt-in to polling. Never auto-trash on `unlink`. |
| 3 | Slug collision or path-length on Windows | Medium | Collision suffix resolver. UUID frontmatter as join key. Slug capped at 80 chars. |
| 4 | FTS5 progressive indexing UX at 100k notes | Medium | Recently-modified first. "Indexing X / Y" pill. FTS5 persists across launches. |
| 5 | External edit + local edit + Reload-default = data loss | Low | Modal not silent. Auto-save on tab/window blur. "Show diff" stretch in Phase 4. |

## Why Not Tauri / Rust

Considered seriously, rejected. Tauri 2 is production-ready for many use cases but has a documented rich-text-editor failure mode: WebKitGTK contenteditable bugs (Tauri #9088 — spans don't activate without right-click; reproduces in TipTap, almost certainly affects Lexical) and Lexical's CI doesn't cover WebKitGTK at all. The closest analogous migration story (rich-text editor on Tauri) reverted to Electron citing webview fragmentation. Bundle/memory wins (~95% smaller, ~50% less idle RAM) are real but don't outweigh the risk of "Linux users can't type in their editor without right-clicking first." Mac universal binaries and Microsoft Store distribution also have open Tauri gaps. Reconsider when Tauri's CEF/Chromium webview backend lands (no ETA).

## Out of Scope (explicitly)

- **Real-time collaboration.** Requires CRDT-on-markdown. Future v3.
- **Mobile.** Vault format is mobile-compatible; no code in this plan.
- **Plugin system.** Out of scope. Files-on-disk does enable it later (Obsidian-style).
- **Three-way merge for conflicts.** Phase 4 stretch only.
- **Migration safety theater.** No wizard, no pre-flight, no rollback. Re-runnable dev converter only. Reintroduce when there are real users to protect.
