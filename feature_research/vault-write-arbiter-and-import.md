# Vault write arbiter, duplicate IDs, and import

Design that closes the "Consistency / truth" gaps from
[vault-source-of-truth-plan.md](./vault-source-of-truth-plan.md#how-to-close) that
block the watcher/import. Read with
[markdown-encoding-spec.md](./markdown-encoding-spec.md) (the file format) and the
Phase 1 export implementation.

## Why this gate exists

Export is safe to build first: it only reads SQLite and writes files, so a bug
cannot destroy a note. **Import inverts that risk.** Once files can write back
into SQLite, three questions must have defined answers or we re-introduce the
#286 failure class through the filesystem:

1. **Identity** — what happens when two files claim the same note?
2. **Arbitration** — who wins when the editor, git, Dropbox, and an agent all
   touch the same note?
3. **Loss** — what guarantees that a conflicted or unknown file is never silently
   overwritten?

This document answers all three. The implemented primitives are conservative:
import is **additive** (never overwrites an existing note), and any write that
would clobber a changed file becomes a conflict copy.

## 1. Identity & duplicate IDs

The frontmatter `id` (UUID) is the only identity; filenames are display-only.
Duplicates arise from copying a file, restoring a backup/cloud copy, or an agent
duplicating a note. Two files, one id.

**Policy:**

- Identity is **per-vault-scan, not per-file**. When a scan sees N files with the
  same `id`, exactly one is canonical.
- Canonical winner = newest frontmatter `updated` (ISO-8601 lexicographic), with
  a stable `relativePath` tiebreak so the choice is deterministic.
- Every non-canonical duplicate becomes a **new note** (fresh UUID) rather than
  being dropped or overwriting the canonical one. No content is lost; the UI can
  later surface "this looks like a duplicate".
- A note whose file lacks an `id` is imported as a new note (fresh UUID).

This is deliberately loss-preserving. A smarter merge (field-level reconcile) is
future work.

## 2. Write arbitration

There is no cross-process lock that git/Dropbox honor, so arbitration is
**optimistic**: every write declares the revision it expects to overwrite.

- `contentRevision(contents)` = SHA-256 of the exact bytes.
- **Guarded write**: if the target file's current revision differs from the
  expected revision, do **not** overwrite. Write the incoming content to a
  sibling **conflict copy** instead:
  `Note (conflict 2026-09-12 10-00-00).md`.
- Within the app, writes for the same note id are serialized through a per-id
  promise chain (in-process lock) so editor autosave, export, and a future MCP
  writer cannot interleave.
- Writes remain atomic per file (temp → fsync → rename → fsync dir) from Phase 1.

The conflict copy preserves both sides and makes the loss visible. The plan's
"last-writer-wins hides the loss" criticism is avoided: a conflict is a new file,
not a silent overwrite.

## 3. Import flow (additive)

Import is a pipeline; the renderer owns markdown→Lexical conversion, main owns
the DB:

1. Main `vault.scanDirectory` recursively reads `.md` files and parses
   frontmatter + body (`{ relativePath, id?, title?, ..., body }`).
2. Shared `planVaultImport(entries)` (pure):
   - resolves duplicate IDs per §1,
   - maps hierarchy: `A/B.md`'s parent is the note at `A.md` (the folder-per-note
     layout means the parent's body file is the folder's sibling); a missing
     parent file → root,
   - fills `order` from frontmatter, falling back to sibling index.
3. Renderer converts each `body` to Lexical JSON via `$importDocumentMarkdown`
   (title ownership + all `lychee-*` encodings) and sends the plan to main.
4. Main `vault.importDocuments` applies it **additively**: a document whose id
   already exists is skipped (counted), never updated. New ids are inserted with
   their frontmatter metadata.

Consequences:

- Re-importing the same folder is idempotent (all ids now exist → all skipped).
- Import into a fresh install restores the vault exactly (still lossless).
- Import can never overwrite or delete local notes.

Bidirectional sync (file edits reflecting back into existing notes) is **not**
this. That requires the guarded write (§2) wired to the watcher so an external
edit is applied only when the DB revision matches what the file was derived from;
otherwise a conflict copy. That is the next step and depends on these primitives.

## 4. Deletes / tombstones (shipped)

A delete cannot be represented by file absence — absence also means "not yet
exported" or "not present on this device". So deletes are explicit records in an
**append-only, per-device log**:

```
<vault>/.lychee/tombstones/<deviceId>.jsonl
```

Each device only appends to its own file, so a cloud-sync engine can never
produce a conflicting rewrite and there is no central bottleneck. Reads are a
**union merge** (`shared/tombstone.ts`): the effective state of a note is the
latest record by `(at, device)`, a total order that makes every replica agree.

- Actions: `trash` (soft delete), `restore` (undo), `purge` (permanent; must not
  be re-imported).
- The app writes a tombstone from the `documents.trash` / `documents.restore` /
  `documents.permanentDelete` handlers when a vault is watched (including all
  cascaded descendant ids).
- The watcher also watches `.lychee/tombstones` and reconciles into the DB:
  `trash`/`purge` local soft-delete, `restore` un-deletes.
- **Delete vs edit**: a tombstone only overrides a note whose `updatedAt` is not
  newer; an edit made on a device that had not yet seen the delete wins, so the
  edit is never silently dropped (`tombstoneSupersedes`).
- A file whose id has a pending delete is not imported (suppression), so a
  delete synced before the file — or a stale file left in the vault — cannot
  resurrect a note. Manual "Import from Markdown" applies the same rule.
- Tombstone logs live under a dot-directory, ignored by the markdown scanner and
  watcher; only the dedicated tombstone watcher reads them.

Still open: physically removing stale note files after a delete (they are inert
now — suppressed by the tombstone), and asset-binary tombstones.


## 4b. Watcher (shipped)

`main/vault-watcher.ts` (chokidar) + `main/vault-sync.ts` (orchestration), with
`renderer/vault-watch.ts` doing the markdown ⇄ Lexical conversion (the only part
that must run in the renderer). All DB and file writes stay in main.

- **Reliability** — `awaitWriteFinish` (never read a half-written file), `atomic`,
  per-path debounce, one serialized processing queue, and a suppression set for
  our own writes. `ignoreInitial: false` reconciles changes made while the app was
  closed.
- **Consistency** — a per-path in-flight guard; a change arriving mid-apply is
  re-read after the apply, so no external edit is dropped. An external edit is
  applied only when the DB is unchanged since export; otherwise it becomes a
  conflict copy and the canonical file is restored from the DB. A missing file
  never deletes a note.
- **Scope** — the watcher only auto-ingests real Lychee notes (markdown with a
  frontmatter `id`); unrelated `.md` files are ignored. A user-chosen shared
  folder is nested to `<folder>/Lychee`, so the watcher only ever sees Lychee's
  own directory.
- **First enable** — the Settings flow exports the vault first so every note has
  a write baseline; a note with no baseline is `adopt`ed rather than conflicted.
- **Scalability** — the path map used for parent resolution is cached (1s TTL) so
  an import burst stays O(N); only conversion round-trips to the renderer.

Enable via Settings → Data → **Watch folder for changes**. State persists in the
`settings` table and resumes on launch (`getVaultSync().startIfEnabled()`).

## 5. The single-writer arbiter, summarized

| Writer | Mechanism |
|---|---|
| Editor autosave | per-id lock; writes SQLite; on file export uses guarded write |
| Vault export | guarded write (expected revision = what it just read) |
| External edit (git/Dropbox) | watcher reads file; applies only if DB revision matches; else conflict copy |
| Agent / MCP | must go through the same `documents.update` + revision check |
| Import | additive only; duplicate ids become new notes |

## Implementation map

- `shared/vault-import.ts` — `planVaultImport`, `parentMarkdownPath`, duplicate
  resolution (pure).
- `shared/vault-watch.ts` — `classifyVaultChange` (pure), temp/dot ignore rules,
  conflict-copy detection.
- `shared/hash.ts` — `revisionOf` (the one revision function used everywhere).
- `shared/tombstone.ts` — JSONL parse/merge, supersede rule.
- `main/tombstones.ts` — device id, append (fsync), union read.
- `shared/vault-path.ts` — `conflictCopyPath`.
- `main/vault.ts` — `contentRevision`, `scanVaultDirectory`, guarded write.
- `main/vault-watcher.ts` — the chokidar service.
- `main/vault-sync.ts` — classification → DB/file orchestration + renderer events.
- `repos/documents.ts` — `importDocument` (additive; explicit id),
  `setDocumentMetadata` (no `updatedAt` bump), `listDocumentTree`.
- `renderer/vault-import.ts` / `renderer/vault-watch.ts` — markdown → Lexical.
- IPC `vault.scanDirectory` / `vault.importDocuments` / `vault.watchStart` /
  `vault.watchStop` / `vault.watchStatus` / `vault.resolveExternalChange`, event
  `vault:file-changed`; surfaced in Settings → Data.
