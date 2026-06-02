# Should Lychee adopt Yjs for sync? — Research findings

Research question: adopt Yjs as the CRDT/merge foundation for cross-device and
(eventually) real-time sync in Lychee — a local-first Electron + React + Lexical
note app (Lexical 0.44, better-sqlite3, notes stored as serialized Lexical
EditorState JSON, custom decorator nodes for images/bookmarks/youtube/code-blocks,
debounced autosave, no existing backend/accounts).

Target architecture: Yjs Y.Doc as source of truth with a pluggable,
transport-agnostic sync layer — supporting (a) bring-your-own cloud folder
(iCloud/Dropbox/Syncthing), (b) object storage (S3/R2/MinIO, self-hostable),
(c) a self-hostable or company-hosted y-websocket-style relay server, with
end-to-end encryption when the server is a dumb relay. Start with async offline
multi-device sync (Tier 1: exchange Yjs updates as blobs), layer realtime
websocket collaboration later (Tier 2).

Method: fan-out web search across 5 angles, 24 sources fetched, 111 claims
extracted, 25 verified with 3-vote adversarial verification (need 2/3 refutes to
kill a claim). Result: 25 confirmed, 0 killed (24 passed 3-0, one passed 2-1).

---

## Bottom line

**Yes — raw Yjs is the right foundation bet.** Every verified claim points the
same way: `@lexical/yjs` is first-party and maintained, the CRDT math gives the
offline-merge guarantee we want, the transport genuinely is swappable, and there
is concrete prior art for our exact shape (local-first, single-user-multi-device,
Yjs-as-merge-engine, self-hostable). No finding contradicted the plan. The risks
that surfaced are specific and known, not architectural dealbreakers.

---

## 1. @lexical/yjs + custom nodes (highest-risk area — mostly checks out)

Verified:
- `@lexical/yjs` is the **official** package providing the binding;
  `CollaborationPlugin` uses it for **bidirectional** sync. Custom `DecoratorNode`s
  bind as `CollabDecoratorNode`.
- Custom decorator nodes **can** participate in collaboration, and the modern path
  is Lexical's **`NodeState`** mechanism, which *bypasses the manual binding work* —
  custom properties sync automatically instead of being hand-wired. Optional
  property syntax (`__foo?: string`) is supported.
- The binding supports an **`excludedProperties`** option to keep specific fields
  out of sync.

The one 2-1 claim (the real gotcha): the Yjs binding can **throw when a custom
node's properties aren't handled** the way the binding expects. Translation for
us: our custom nodes (image, bookmark, youtube, code-block) must either use
`NodeState` or be explicitly registered/excluded — a node that mutates `this.__foo`
directly outside that system is the failure mode. This is exactly the async
bookmark hydration concern, now confirmed as a genuine sharp edge. The fix is
known (NodeState or `excludedProperties` + gate hydration to one writer), but this
is the thing the spike must prove.

Sources: lexical.dev/docs/packages/lexical-yjs (primary),
lexical.dev/docs/collaboration/react (primary),
lexical.dev/docs/concepts/nodes (primary),
github.com/facebook/lexical/blob/main/packages/lexical-yjs/src/SyncEditorStates.ts
(primary source code), github.com/facebook/lexical/issues/4350,
github.com/facebook/lexical/discussions/5880.

## 2. Migration (JSON blob -> Y.Doc)

Verified CRDT properties make the derived-cache plan sound: Yjs updates are
**commutative, associative, and idempotent**, so re-applying or reordering during
a one-time bootstrap can't corrupt state. The JSON `toJSON()` can remain a
**derived read cache** safely.

Sources: docs.yjs.dev/api/document-updates (primary).

## 3. Undo (replacing HistoryPlugin)

Verified: `Y.UndoManager` supports **per-origin tracking** — it can undo only this
device's changes and leave remote edits alone. But by default it **tracks all
local changes**, so it must be explicitly scoped by origin or it will behave wrong
in a multi-device doc. Confirms the HistoryPlugin -> UndoManager swap is required,
not optional.

Sources: docs.yjs.dev/api/undo-manager (primary).

## 4. Persistence (Yjs state in SQLite)

Verified: the canonical pattern is an **append-only update log + periodic
compaction into a snapshot** (merge many updates into one via state vectors).
Multiple updates **merge into a single update** losslessly — that's the compaction
primitive. Storing Yjs binary blobs in local SQLite is the recommended
custom-persistence route over y-indexeddb for a desktop app.

Sources: discuss.yjs.dev/t/guidance-on-persistence-storage-and-working-with-databases/994,
metaduck.com/notebook-compaction-crdts/, jackson.dev/post/crdts_as_database/.

## 5. Transport without a realtime server (Tier 1)

Verified: two peers sync by **exchanging only their differences** via state
vectors (`encodeStateVector` -> `encodeStateAsUpdate(diff)`) — efficient async
sync, no live connection.

Strong skeptical finding — **do NOT put the SQLite DB itself in a cloud folder.**
SQLite **relies on the filesystem for locking**, and Dropbox/iCloud/Google Drive
break that, leading to **documented corruption**. The proven workaround: keep
SQLite **local**, and sync **append-only immutable update files** (named
`<deviceId>-<seq>.bin`, never rewritten) through the folder. Append-only-per-device
is how you survive cloud folder engines.

Sources: docs.yjs.dev/api/document-updates (primary),
sqlite.org/howtocorrupt.html (primary), tonsky.me/blog/crdt-filesync/,
github.com/nodejs/node/issues/1058 (partial writes),
news.ycombinator.com/item?id=47359712.

## 6. End-to-end encryption with a dumb relay (confirmed feasible)

Verified: **secsync (serenity-kit)** is a real protocol that does exactly this —
E2E encryption **at the CRDT message layer**, encrypting **each update and
snapshot individually**, with the server as a dumb relay. Confirmed tradeoff: this
**forecloses server-side features** (server-side full-text search, headless
bootstrap/merge) because the server never sees plaintext. So the hosted tier is
either "dumb encrypted relay" OR "smart plaintext server" — decide per tier, can't
have both on the same data.

Sources: github.com/serenity-kit/secsync (primary).

## 7. Image/binary blobs

Confirmed direction: binaries don't belong in the Y.Doc; **content-addressed
storage** (hash-keyed) synced through the same blob transport is the pattern.
(Lighter source coverage — treat as well-supported convention rather than
hard-verified.)

## 8. Prior art & alternatives (most reassuring part)

- **obsidian-local-sync** uses Yjs as the CRDT and is **explicitly designed for
  single-user multi-device** — our exact use case, shipping.
- **Colanode**, a local-first collaboration app, **chose Yjs** for its sync engine.
- Lexical's own **collaboration FAQ** + Jake Lazaroff's local-first case study
  corroborate the Yjs + rich-text path.
- On alternatives (Automerge, ElectricSQL, Liveblocks, PartyKit, Y-Sweet):
  ElectricSQL/Liveblocks/PartyKit are **server-centric** (wrong fit for
  offline-first + self-host). **Automerge is the only serious CRDT rival** — but it
  lacks Lexical's first-party binding, which is decisive. Raw Yjs wins for this app.

Sources: github.com/elcomtik/obsidian-local-sync (primary),
hakanshehu.com/posts/building-the-colanode-sync-engine/ (primary),
jakelazaroff.com/words/a-local-first-case-study/, lexical.dev/docs/collaboration/faq,
news.ycombinator.com/item?id=41012895,
pkgpulse.com/guides/liveblocks-vs-partykit-vs-hocuspocus-realtime-2026,
electric-sql.com/docs/reference/alternatives.

---

## Top concrete risks for Lychee (ranked)

1. **Async-hydrating bookmark node under the binding** — the confirmed sharp edge
   (sec 1). Must use `NodeState`/`excludedProperties` and gate hydration to one
   writer. Spike this first.
2. **Never sync the SQLite file via a cloud folder** (sec 5) — corruption is
   documented. Local DB + append-only update files only.
3. **Undo must be re-scoped per-origin** (sec 3) — default tracking is wrong for
   multi-device.
4. **E2E vs. server-side features is a fork** (sec 6) — pick per tier now; it
   constrains what the hosted service can ever offer.
5. **Image binaries are a separate subsystem** (sec 7) — don't let them ride the
   text CRDT.

## Most-proven Tier-1 approach

**Local SQLite (state stays local) storing a Yjs snapshot + append-only update
log, with compaction.** Sync via **append-only per-device update files** over the
chosen transport. This configuration has the most corroboration across the
persistence, reliability, and prior-art sources — and obsidian-local-sync is
essentially a working reference implementation of it. Add **secsync** if/when the
encrypted-relay tier is built.

---

## Architecture recap (context for the above)

One data model, two sync tiers, swappable adapters:

```
        Lexical editor (per docId)
                 |
         Y.Doc  (CRDT — the new source of truth)
                 |
   +-------------+--------------+
   |                            |
  persist locally          SyncAdapter (interface)
  (sqlite: Yjs state)      |- FolderAdapter   (iCloud/Dropbox/Syncthing)
                           |- ObjectStoreAdapter (S3/R2/MinIO — self-host or hosted)
                           |- RelayServerAdapter (hosted service)
                           +- WebsocketProvider  (realtime — later)
```

- Tier 1 (ship first): async update exchange. Adapter contract `put(blob)`,
  `list()`, `get(key)`. Folder, object-store, and hosted blob API all implement the
  same interface — self-host vs BYO-cloud vs SaaS is config, not a code path.
- Tier 2 (later): live `Provider` (y-websocket) for realtime co-editing, writing to
  the same Y.Doc. Hosted and user-run speak the identical protocol.

The Yjs commitment is narrow: (1) Y.Doc becomes the truth, JSON `toJSON()` becomes
a derived cache; (2) one-time bootstrap of existing notes into Y.Docs; (3) undo
moves to Yjs `UndoManager`. Everything else (transport, hosting, encryption,
realtime) sits behind that and stays swappable.

---

## Full source list (24)

Primary / source code:
- lexical.dev/docs/concepts/nodes
- lexical.dev/docs/packages/lexical-yjs
- lexical.dev/docs/collaboration/react
- lexical.dev/docs/collaboration/faq
- github.com/facebook/lexical/blob/main/packages/lexical-yjs/src/SyncEditorStates.ts
- github.com/facebook/lexical/issues/4350
- docs.yjs.dev/api/document-updates
- docs.yjs.dev/api/undo-manager
- github.com/serenity-kit/secsync
- github.com/elcomtik/obsidian-local-sync
- hakanshehu.com/posts/building-the-colanode-sync-engine/
- sqlite.org/howtocorrupt.html
- github.com/nodejs/node/issues/1058
- electric-sql.com/docs/reference/alternatives

Forum / blog / secondary:
- github.com/facebook/lexical/discussions/5880
- discuss.yjs.dev/t/guidance-on-persistence-storage-and-working-with-databases/994
- github.com/yjs/yjs/issues/273
- metaduck.com/notebook-compaction-crdts/
- tonsky.me/blog/crdt-filesync/
- jackson.dev/post/crdts_as_database/
- jakelazaroff.com/words/a-local-first-case-study/
- news.ycombinator.com/item?id=41012895
- news.ycombinator.com/item?id=47359712
- pkgpulse.com/guides/liveblocks-vs-partykit-vs-hocuspocus-realtime-2026
