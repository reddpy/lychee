# Next tests to write

Remaining gap batches. Baseline before each: `pnpm test` green; `pnpm test:e2e:build` (package) then the 6 MCP/yjs specs.

## 1. Same-note concurrency across devices
- Two live peers edit the same note divergently; merge through the **folder** transport; both edits survive, state vectors match.
- Same-note concurrent edit → vault path produces a **conflict copy** in the running app (watcher), canonical preserved.
- Interleaved: user edits locally while a remote device's folder update lands.

## 2. Structure propagation via tombstones / files
- Cross-device `rename` (title changes → file rename) and `move` (reparent) reflected in the app.
- Conflict on a concurrent rename (both devices retitle).
- Parent trashed on device A → subtree trashed on device B.

## 3. Assets across devices
- Device A exports an image (`lychee-asset://<id>` → `assets/<hash>.<ext>`); device B imports the note and resolves it (or preserves the relative link if absent).
- Same asset referenced by two notes/dedup across devices.

## 4. Agent + device interplay
- Agent live edit is later persisted to the folder and picked up by a "third device".
- Agent edit while the vault watcher applies an external change (ordering/serialization).

## 5. Live-path edges
- Very large single line / 1000-paragraph note via live append.
- `expectedRevision` guard on `replace_in_note` (live), not just `update_note`.
- Fence guard: `update_note` adding a new `lychee-*` block refused without permission.

## Process / hygiene
- After every batch: **mutation-test** each new test (break the primitive, expect failure, revert, rebuild package).
- Watch for the known flake (1/73 observed once) — harden if reproducible.
