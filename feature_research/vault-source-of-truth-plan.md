# Notes storage & sync — architecture plan

A first-principles plan for where notes live, how they sync, and how an LLM reads
them. Not anchored to any prior research; the existing docs in this folder are
treated as inputs to challenge, not constraints.

## Requirements

1. **Reliability / consistency / durability** — a note must never be silently
   lost or truncated.
2. **Sync** — multi-device, ideally via iCloud/Dropbox/Syncthing/git, with an own
   server as a later option.
3. **LLM access** — an agent can read and write notes with little or no custom
   integration.

## Design space

| Model | Durability | Sync | LLM | Notes |
|---|---|---|---|---|
| A. SQLite file as truth | Strong (ACID, WAL, backups) | Poor via cloud folders (WAL, locks, whole-file conflicts); needs own server for deltas | Opaque without a tool layer | Everything lives in one opaque binary; one corruption = all notes |
| B. One file per note as truth + SQLite index | Strong *if* atomic-write discipline; blast radius is one note | Excellent with cloud/git; per-note conflict granularity | Native — plain text | Index is disposable; files outlive the app |
| C. Yjs CRDT as truth | Strong, append-only | Best conflict story, but needs the update-exchange transport | Opaque binary; needs a projection | Most complex; real conflict-free merging |

## Decision

**Model B: one file per note as the durable source of truth, with SQLite as a
disposable, rebuilt index.** Model C is adopted later *only* as a merge layer, not
as the durable record, and only if no-conflict concurrent editing is actually
required.

Why B over A: a note is a single document, so the only transactional guarantee we
need is per-note atomicity — not cross-row ACID. That removes SQLite's main
advantage over files while its main disadvantages (opaque binary, hostile to cloud
sync, single point of failure) remain. Files also satisfy requirement 3 for free.

Why B over C: a CRDT is a merge algorithm, not a durability story we can inspect,
diff, back up, or hand to an LLM. Start with the simplest thing that meets all
three requirements; add CRDT conflict resolution when same-note concurrent editing
justifies the complexity.

## 1. The vault

A user-visible directory. Default under `app.getPath("userData")`, or a
user-chosen path such as `~/Documents/Lychee`. **Never the install/bundle dir**
(signed/read-only on macOS, `Program Files` on Windows). Expose the path in
Settings with Reveal/Change. The vault location is the sync boundary.

### Layout

Folder-per-node, with the parent's own body as a normal `.md` beside its child
folder, so the file tree maps 1:1 onto the note tree:

```
<vault>/
  Parent Note.md            # parent body + frontmatter
  Parent Note/              # children of Parent Note
    Child A.md
    Child B/
      Grandchild.md
```

A childless note is just `Note.md`; the folder appears on first child and is pruned
when the last child leaves. Directory location determines hierarchy, so
re-parenting in Finder is a legitimate edit the watcher reconciles.

### Frontmatter

```yaml
---
id: 6f1c...              # stable UUID — the only identity
title: Parent Note
emoji: "📄"              # app metadata, kept in frontmatter (not body prose)
bookmarked: 2026-09-12T...  # optional note-level bookmark
created: 2026-09-12T...
updated: 2026-09-12T...
content_schema_version: 1
order: 1.5               # fractional index within siblings
---
```

All durable per-note metadata lives in **frontmatter** (identity, title, emoji,
bookmark, dates, order, schema version); hierarchy is the folder layout. This
keeps each note self-contained and makes the SQLite index fully rebuildable. The
alternative — app metadata in per-note sidecars — is sync-safe but doubles file
count and makes a lone `.md` incomplete, so frontmatter is the default.

Filenames are display-only: sanitized, NFC-normalized, de-duplicated
(`Meeting Notes (2)`), length-capped. Links and backlinks resolve by `id`, so
rename/reparent can never silently break them.

### Body and rich nodes

Markdown is the body. Every construct markdown can't express gets a documented,
reversible encoding — a fenced block, not a sidecar:

- references / images / bookmarks → link lines and `![alt](asset)` refs, plus a
  ```` ```lychee-reference ```` block for fields markdown can't carry
  (displayMode, favicon, width/height/alignment, hydration state).
- anything unrecognized (newer app version, agent-generated, future node) → a
  ```` ```lychee-unknown ```` block preserving the original serialized JSON
  **verbatim**. Never dropped.

Round-trip losslessness is a hard gate, proven per node type by tests. If a node
can't round-trip, it uses a raw block — the container stays markdown and stays
LLM-legible; we never ship lossy conversion.

### Writes

- Edit/create = write temp → `fsync` file → `rename` → `fsync` dir.
- Reparent/move subtree = `fs.rename` of the directory (atomic on one volume);
  cross-volume falls back to copy + fsync + delete with an intent marker.
- Delete = move to `<vault>/.trash/`, never `unlink`.
- Reorder = rewrite `order` only (fractional index avoids mass rewrites).
- Filename sanitizer handles case-insensitive collisions, reserved names (`CON`),
  trailing dots, illegal chars, and path-length limits.

## 2. The index

SQLite, rebuilt from the vault on launch and via a `chokidar` watcher. Powers FTS5,
backlinks, tags, fast startup, and the sidebar tree. **Disposable**: if it
corrupts, delete and rebuild. Keep an `id → path` map. The current `documents`
schema (`id`, `parentId`, `sortOrder`, `emoji`, `metadata`) fits the index role
almost unchanged.

This is the property that turns a storage incident from data loss into a
non-event: the durable copy is plain files, and the DB can always be regenerated.

## 3. Sync

- File-sync (iCloud/Dropbox/Syncthing) or git over the vault. Per-note granularity
  means edits to different notes converge with no conflict; same-note edits become
  conflict copies — recoverable, not corrupt.
- Default policy: per-note last-writer-wins with conflict copies.
- Never put a live `lychee.sqlite3` in a cloud folder.

## 4. LLM access

- Filesystem reads work day one with any agent; no MCP required.
- A standalone **MCP server** now ships over the vault (list/search/get/backlinks,
  plus frontmatter-preserving, revision-guarded writes). See
  [mcp-agent-access.md](./mcp-agent-access.md). It runs without Electron/DB, so it
  works whether or not the app is open; when the app is running the watcher
  reconciles agent edits through the conflict-safe path.
- Agent writes must pass the same schema / unknown-node validation as app writes;
  otherwise the model becomes the "newer build" that corrupts a note. Treat note
  bodies as untrusted input when agents auto-process them. (Structured node edits
  remain the next step for fully safe agent writes.)

## 5. Safety rails

Required before any of this ships:

- **Autosave gate** — never persist after a partial/failed parse; surface an error.
- **Unknown-node preservation** — the pre-parse pass rewrites unrecognized types
  into a node that re-emits the original payload verbatim.
- **Content schema version** — per-note; warn/refuse on save when newer than the
  running build. Distinct from the DB `schema_version`.
- Keep the existing pre-migration VACUUM backup behavior.

## 6. Phasing

- **Phase 0:** autosave gate + unknown-node preservation + content schema version.
  Independent of storage; fixes the truncation class of bug outright. **Done.**
- **Phase 1:** SQLite stays truth; add lossless markdown import/export. Ships LLM
  access immediately and proves the round-trip. **Export shipped** — see below.
- **Phase 2:** vault mode + watcher; export the vault on upgrade; SQLite becomes
  the index, DB lingers as a safety copy.
- **Phase 3:** files become truth; DB rebuildable at will.
- **Phase 4:** CRDT merge layer and/or MCP server as requirements appear.

### Phase 1 status (shipped)

- `shared/frontmatter.ts` — dependency-free frontmatter serialize/parse.
- `shared/vault-path.ts` — filename sanitizer + folder-per-note path planner
  (sibling dedupe, reserved names, NFC, orphan/cycle safety).
- `main/vault.ts` — atomic per-file writes (temp → fsync → rename → fsync dir),
  path-escape guard, reader.
- `renderer/vault-export.ts` — builds `frontmatter + body` for every note via the
  markdown encoders in [markdown-encoding-spec.md](./markdown-encoding-spec.md).
- IPC `vault.chooseDirectory` / `vault.writeEntries`; Settings → Data →
  **Export as Markdown…**.

Still to do for Phase 2: the **reader/watcher** (file → DB), frontmatter `id`
reconciliation (duplicate-ID policy), and the single-writer arbiter. Import is
deliberately not wired yet — the vault plan's open items (duplicate IDs, watcher
vs editor races) must be resolved first so import cannot lose data.

### Phase 2 status (partial)

The arbiter/import gate above is closed and the watcher is shipped:

- **Import** (`Settings → Data → Import from Markdown…`) is additive and safe:
  duplicate IDs resolve per policy, existing notes are never overwritten, and
  missing parents fall back to the root.
- **Watch folder** (`Settings → Data → Watch folder for changes`) uses chokidar
  with `awaitWriteFinish`/`atomic`, per-path debounce, a serialized queue, a
  per-path in-flight guard, and write baselines. External edits apply when the DB
  is unchanged since export, otherwise they become conflict copies; deletes are
  ignored. See `vault-write-arbiter-and-import.md#4b-watcher-shipped`.
- **Cross-device delete** uses append-only, per-device tombstone logs
  (`<vault>/.lychee/tombstones/<deviceId>.jsonl`) union-merged by `(at, device)`;
  trash/restore/purge propagate, and a newer edit beats an unseen delete.

### Phase 3 status (in progress)

- **Vault by default**: `~/Documents/Lychee`, auto-created; no setup step. Existing
  notes are exported progressively on first run.
- **Frontmatter carries all durable per-note metadata** (`id`, `title`, `emoji`,
  `bookmarked`, `created`, `updated`, `content_schema_version`, `order`).
- **Write-through**: a note's `.md` is rewritten on every content/title/emoji/
  bookmark change, so files stay current.
- **Index rebuilt from files** (`main/vault-index.ts`): at bootstrap, frontmatter
  supplies metadata and the folder layout supplies hierarchy; content is left to
  the watcher/content path. The index self-heals from the vault.

Still to do: content as markdown in the index (renderer conversion on load/save +
previews/search), create/delete/move/reorder as file operations, and dropping
SQLite as the working truth.

Still open: physically pruning stale note files after a delete, video/file
assets, and making the files the source of truth (Phase 3). The app-write path
still needs its own optimistic check wired to `writeVaultEntryGuarded` for the
future MCP writer.


## Known gaps / unresolved

This plan is the right default, not a complete design. The following are
deliberately unproven or undefined and must be closed before the vault becomes the
source of truth.

### Sync

- **Same-note concurrent edits are downgraded, not solved.** Per-note granularity
  merges cleanly *across* notes, but two devices editing the *same* note offline
  produce a conflict copy. Undefined: who detects it, how the app surfaces it, and
  how a user merges. LWW hides the loss rather than resolving it.
- **Assets — resolved for images.** Binaries are content-addressed under
  `<vault>/assets/<sha256>.<ext>` and referenced by relative path; the editor's
  `lychee-asset://<id>` token is rewritten at the vault boundary. Video/arbitrary
  files reuse the same layer once they have nodes. See
  `markdown-encoding-spec.md#asset-references`.
- **Delete/tombstones — resolved.** Append-only per-device logs under
  `.lychee/tombstones/` union-merge by `(at, device)`; trash/restore/purge
  propagate and a newer edit beats an unseen delete. Remaining: physically
  pruning the stale note file after a delete.
- **Cloud-folder realities are ignored.** iCloud "optimize storage" evicts files
  to placeholders that break reads/watchers; temp files must be kept outside the
  vault so agents and watchers never ingest them.
- **Own-server path has no protocol.** "Own server later" is stated but not
  designed (transport, update format, auth).

### Consistency / truth

- **Markdown round-trip losslessness is the load-bearing assumption and is
  unproven.** If a decorator node (reference/bookmark, with async hydration) fails
  to round-trip, the on-disk file — the source of truth — is already lossy. The
  "fall back to a raw block" mitigation assumes failed round-trips are detectable,
  which is itself non-trivial.
- **No single-writer arbiter.** Editor autosave, the file watcher, git checkout,
  and a future MCP server can all write the same note. Need per-note locking plus
  a stat/hash check before every write; otherwise last writer wins and data is
  silently lost.
- **Duplicate IDs.** Copying a file, restoring from cloud, or an agent duplicating
  a note yields two files claiming the same `id`. No reconciliation policy.
- **Downgrade still corrupts.** `content_schema_version` only works if the reading
  build implements it. The old build that lacks unknown-node handling — the exact
  #286 case — ignores the version and truncates. Files make version drift more
  frequent, and old builds cannot be retrofitted.
- **Multi-file operations are not fully atomic.** A title change plus a folder
  rename is two filesystem operations; a crash between them can leave frontmatter
  and path diverged. Atomic directory rename covers moves, not compound edits.
- **Fractional ordering can exhaust** and needs a renormalization policy.

### LLM access

- **Safe writes are unsolved.** An agent editing raw markdown can drop the
  `lychee-*` blocks and destroy data before validation ever runs. Safe agent writes
  must go through a structured MCP edit path against the model; raw markdown edits
  are best-effort/import only.
- **Editor-vs-agent write races** are unhandled (same arbiter gap as above).
- **Prompt injection** from note bodies is a real surface once agents
  auto-process notes.

### How to close

1. **Spike markdown round-trip across every current node type** (including async
   bookmark hydration) as a go/no-go before committing markdown-as-truth. Spec:
   [spike-markdown-roundtrip.md](./spike-markdown-roundtrip.md).
2. **Define the write arbiter + conflict protocol**: per-note lock, hash-before-
   write, conflict-copy detection/UX, duplicate-ID policy.
3. **Design asset/binary storage and cross-device delete/tombstones** explicitly.
4. **Route agent writes through structured MCP edits**, not raw files.

## Rejected / what would change the decision

- **SQLite-as-truth** if sync never happens and only local durability matters — it
  is strictly stronger and simpler than files for a single machine.
- **CRDT-as-truth** if simultaneous multi-user editing is core from day one — then
  move it to Phase 1, keeping the vault as the durable/LLM projection.
- **A desktop DB inside a cloud folder** is rejected outright as documented
  corruption territory.
