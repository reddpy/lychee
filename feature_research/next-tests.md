# Next tests to write

Remaining gap batches. Baseline before each: `pnpm test` green; `pnpm test:e2e:build` (package) then the 6 MCP/yjs specs.

## 1. Same-note concurrency across devices — done
- [x] Two live peers edit the same note divergently; merge through the **folder** transport; both edits survive, state vectors match. (`multi-device-sync`, plus app-level `mcp-cross-device` divergent test)
- [x] Same-note concurrent edit → vault path produces a **conflict copy** in the running app (watcher), canonical preserved. (`cross-device-reconcile`, `vault-conflicts`)
- [x] Interleaved: user edits locally while a remote device's folder update lands. (`mcp-cross-device` mid-typing test)

## 2. Structure propagation via tombstones / files — done
- [x] Cross-device `rename` (title changes → file rename) and `move` (reparent) reflected in the app. (`mcp-cross-device-structure`, `cross-device-structure`)
- [x] Conflict on a concurrent rename (both devices retitle): newest wins; live apply dedupes the loser into `.trash`, and a relaunch reconcile converges to one file. An **older** retitle arriving late no longer overrides a newer local rename (`vault-sync` stale-duplicate guard).
- [x] Parent trashed on device A → subtree trashed on device B (parent-only tombstone is enough), and restore brings the subtree back.
- [x] Edge cases: rename to blank sentinel, unicode/punctuation names, rename+body edit together, nested/deep moves, move to root, move parent with subtree, missing-parent folder, three duplicate-id files, conflict copies ignored, empty-body duplicate never wipes content, winner's parent wins, child-only tombstone, idempotent double-trash, older delete vs newer edit, three-level subtree, stale duplicate retitle.
- [x] Tombstones: `purge` is now absorbing (a later restore/trash cannot un-purge), including through log compaction.

## 3. Assets across devices — partial
- [x] CRDT sync preserves every media link form unchanged: remote URLs, `lychee-asset://<id>` tokens, vault-relative `assets/<hash>.<ext>` paths (including `./`), and data URIs (`cross-device-media` unit + e2e).
- [ ] Device A's binary asset is materialized on device B (needs the vault asset boundary on the live path, not just markdown load/export).
- [ ] Same asset referenced by two notes/dedup across devices (single-device dedup is covered by `vault-assets`).

## Media matrix (done)
`src/sync/__tests__/cross-device-media.test.ts` + `e2e/mcp-cross-device-media.spec.ts` cover:
- images: remote URL, content-addressed token, vault-relative path, data URI, geometry/alignment, duplicates, 40-image note
- cards: bookmark metadata, video/audio/PDF links, mixed media ordering
- inline: note bookmarks, unknown future media nodes (`lychee-unknown`), malformed fences falling back to code
- concurrency: image + bookmark inserts, image + text, deletion while typing, metadata retarget + text, remove-all + add-more
- transport: duplicate delivery, out-of-order updates, compaction then late join, five devices, permanent delete, empty-note start


## 4. Agent + device interplay
- Agent live edit is later persisted to the folder and picked up by a "third device".
- Agent edit while the vault watcher applies an external change (ordering/serialization).

## 5. Live-path edges
- Very large single line / 1000-paragraph note via live append.
- `expectedRevision` guard on `replace_in_note` (live), not just `update_note`.
- Fence guard: `update_note` adding a new `lychee-*` block refused without permission.

## Process / hygiene
- After every batch: **mutation-test** each new test (break the primitive, expect failure, revert, rebuild package).
- The `vault-store-hardening` 200-note stress test now has an explicit 15s timeout (it can exceed 5s under a full parallel run).

