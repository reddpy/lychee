# Pre-sync data hygiene checklist (do during alpha)

Context: We plan to add Yjs-based cross-device sync *after* the alpha release
(see [yjs-sync-research.md](./yjs-sync-research.md)). Deferring the sync code is
safe and does not corner us structurally. The only cost of deferring is a
one-time migration that bootstraps existing users' notes (stored as serialized
Lexical EditorState JSON) into Y.Docs.

The difficulty of that future migration scales directly with how much our
saved-data format drifts during alpha. The items below are cheap insurance done
now, while we fully control the data, so the later bootstrap stays trivial and
existing users' local notes are never at risk.

Key safety principle for the eventual rollout (not an alpha task, but the reason
these items matter): the migration is **additive**. Yjs state gets stored
*alongside* the existing `content` JSON, never replacing it. JSON stays the source
of truth until Yjs is proven, then: keep JSON as truth -> dual-write Yjs ->
verify -> flip. A botched rollout can therefore never eat local notes.

---

## Checklist

- [ ] **Keep `sanitizeSerializedState()` disciplined.**
  Every legacy serialization variant we accumulate is another case the future
  Yjs bootstrap must handle. Keep the migration layer tight and consolidate
  legacy shapes rather than letting them sprawl.

- [ ] **Keep `version` fields accurate on all custom nodes.**
  (title, image, bookmark, youtube, code-block.) These are the migration hooks.
  A wrong/stale version number is a silent bootstrap landmine — bump it whenever
  a node's serialized shape changes.

- [ ] **Be careful what bookmark hydration writes into `content`.**
  Highest-leverage item. The bookmark node fetches OG metadata asynchronously and
  mutates itself after load. If that fetched metadata gets baked into the saved
  blob in a per-device-variable way, it becomes sync *churn* later (each device
  re-hydrates differently and fights over the field). It won't break data, but
  deciding now to treat fetched metadata as **derived / excludable** (rather than
  canonical content) saves the `excludedProperties` / NodeState cleanup later.
  This is risk #1 in the research doc.

- [ ] **Don't store anything sync-hostile in the `metadata` JSON column.**
  Keep it reserved-feeling so it can carry sync state (vector clocks, device id,
  etc.) later without colliding with existing keys.

---

## Not alpha tasks — deferred to sync work itself

For reference, these are the actual sync-time commitments (NOT to be done now):

1. Y.Doc becomes source of truth; JSON `toJSON()` becomes a derived read cache.
2. One-time bootstrap of existing notes into Y.Docs.
3. Undo moves from Lexical HistoryPlugin to Yjs `UndoManager` (scoped per-origin).
4. Image/binary blobs handled as a separate content-addressed subsystem
   (they don't ride the text CRDT).
5. Pick the E2E-encryption-vs-server-side-features fork per hosting tier.

See the research doc for the full risk list and Tier-1 recommendation.
