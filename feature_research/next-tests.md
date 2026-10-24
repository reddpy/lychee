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

## 3. Assets across devices — done
- [x] CRDT sync preserves every media link form unchanged: remote URLs, `lychee-asset://<id>` tokens, vault-relative `assets/<hash>.<ext>` paths (including `./`), and data URIs (`cross-device-media` unit + e2e).
- [x] Device A's binary is materialized on device B through the shared vault: at startup, for notes/binary arriving live, and for an already-open note that picks up a remote asset. (`mcp-cross-device-assets`)
- [x] Same asset referenced by two notes resolves to one local image and one content-addressed vault file, across devices. (`mcp-cross-device-assets`)
- [x] Missing binaries preserve the relative link; video/PDF/ZIP and nested asset paths are left untouched; uppercase extensions import correctly; images mixed with video import only the image. (`assets.test`, `mcp-cross-device-assets`)
- Note: a pure CRDT-first token (an open note receiving only a remote Yjs update, before the markdown projection applies) still relies on the vault file projection to resolve bytes. File/watcher paths are covered end to end.

## Media matrix (done)
`src/sync/__tests__/cross-device-media.test.ts` + `e2e/mcp-cross-device-media.spec.ts` cover:
- images: remote URL, content-addressed token, vault-relative path, data URI, geometry/alignment, duplicates, 40-image note
- cards: bookmark metadata, video/audio/PDF links, mixed media ordering
- inline: note bookmarks, unknown future media nodes (`lychee-unknown`), malformed fences falling back to code
- concurrency: image + bookmark inserts, image + text, deletion while typing, metadata retarget + text, remove-all + add-more
- transport: duplicate delivery, out-of-order updates, compaction then late join, five devices, permanent delete, empty-note start


## 4. Agent + device interplay — done
- [x] Agent live edit is persisted to the folder and picked up by a "third device" (late joiner, already-joined peer, and after relaunch). Socket-sourced agent updates are now mirrored into the shared folder; folder-sourced updates are not rebroadcast (`origin-isolation` prevents echo loops). (`live-edit` unit, `mcp-cross-device-agent`)
- [x] Agent edit while the vault watcher applies an external change: external body applied first then agent builds on it; agent edit lands on the renamed path; agent edit survives relaunch. (`mcp-cross-device-agent`)
- [x] A third-device edit and an agent edit on the same note both survive; a fourth device reading only the folder agrees. (`mcp-cross-device-agent`)

## 5. Live-path edges
- Very large single line / 1000-paragraph note via live append.
- `expectedRevision` guard on `replace_in_note` (live), not just `update_note`.
- Fence guard: `update_note` adding a new `lychee-*` block refused without permission.

## Process / hygiene
- After every batch: **mutation-test** each new test (break the primitive, expect failure, revert, rebuild package).
- The `vault-store-hardening` 200-note stress test now has an explicit 15s timeout (it can exceed 5s under a full parallel run).

