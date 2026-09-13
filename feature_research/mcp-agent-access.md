# Agent access (MCP)

Turns the vault into a source an LLM client can read and edit with no custom
integration — the "chat with your notes" goal. Companion to
[vault-source-of-truth-plan.md](./vault-source-of-truth-plan.md) (§4 LLM access)
and [markdown-encoding-spec.md](./markdown-encoding-spec.md).

## Architecture

A **standalone Node process** over a vault directory, speaking MCP over stdio.
It deliberately does **not** load Electron or the database, so it works whether
or not the Lychee app is running and reads straight from the markdown files.

```
src/mcp/vault-tools.ts   fs-only query/write core (unit-tested)
src/mcp/server.ts        McpServer + tool registration (importable)
src/mcp/cli.ts           stdio entry point
scripts/build-mcp.mjs    esbuild bundle -> out/mcp/lychee-mcp.mjs
```

The bundle ships under `resources/mcp/` (Forge `extraResource`) and is rebuilt in
the `prePackage` hook.

## Tools

| Tool | Kind | Notes |
|---|---|---|
| `list_notes` | read | id, title, vault-relative path |
| `search_notes` | read | case-insensitive over titles + bodies |
| `get_note` | read | full markdown (frontmatter + body) + revision |
| `backlinks` | read | notes linking to an id via the internal note URL |
| `update_note` | write | replace the body, **preserving frontmatter**; refuses to add/remove `lychee-*` blocks unless `allowFenceChanges: true` |
| `replace_in_note` | write | replace an exact substring; preserves everything else — preferred for small edits |
| `append_to_note` | write | append markdown to the body |

All reads exclude tombstoned notes, so deletes made on another device are
respected.

## Safe writes

Three invariants keep agents from destroying data:

1. **Frontmatter is preserved.** `update_note` only replaces the body; the note's
   `id` (identity), `title`, dates, and schema version stay stable. An agent
   cannot accidentally re-identify or re-title a note.
2. **Optimistic revision check.** `get_note` returns a `revision`; passing it to
   a write makes it fail with `revision_mismatch` if the file changed underneath
   (the agent re-reads and retries). This is the same `revisionOf` hash the app
   and watcher use.
3. **Fence guard.** A whole-body rewrite that would add/remove a `lychee-*`
   encoded block is refused (`fence_conflict`) unless `allowFenceChanges: true` —
   the classic way an agent silently drops references, bookmarks, or unknown
   nodes. `replace_in_note` is the preferred targeted edit and does not trip the
   guard.

When the app is running, its watcher sees the file change and reconciles it
through the normal path — apply when the DB is unchanged since export, otherwise
a **conflict copy**. So an agent edit can never silently clobber a concurrent
editor change.

## Running it

Build once (also happens automatically before packaging):

```bash
pnpm build:mcp
```

Then point an MCP client at it:

```json
{
  "mcpServers": {
    "lychee": {
      "command": "/path/to/Lychee",
      "args": ["/path/to/lychee-mcp.mjs", "--vault", "/path/to/your/vault"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

The command is the running Lychee binary with `ELECTRON_RUN_AS_NODE=1`, so no
separate Node install is needed. The app's **Settings → AI** section presents it
two ways, without trying to auto-detect or configure specific apps:

- **Paste these into your AI app** — each value on its own row with a copy
  button (`Name`, `Type`, `Command`, each `Arguments` entry, `Environment`,
  `Working directory`). This matches apps whose "custom MCP server" form asks for
  the fields one at a time (ChatGPT, Zed).
- **Copy the JSON config** — a ready `mcpServers` snippet for apps that read an
  MCP JSON file (Claude Desktop, Cursor, VS Code, …).

Copying goes through the main process (`clipboard.writeText`) rather than
`navigator.clipboard`, which is reliable in the Electron renderer. There is no
per-app detection: it produced false "Detected" badges and cannot reflect what a
user has installed.

The vault path is remembered when the user exports or watches a folder
(`vaultLocation`), and is what fills the `--vault` argument, the `Vault path`
field, and `Working directory`. If the user has never chosen a folder, the AI
section offers a one-click **Use default** (`~/Documents/Lychee`) or **Choose…**.

If a user picks a shared folder (e.g. `~/Downloads`), Lychee uses a dedicated
`Lychee/` subfolder inside it, so note files never mix with unrelated files and
the watcher only ever watches Lychee's own folder. The export is **progressive**
(yields every 20 notes with a progress count) and files are written in **batches
of 100**, so a large vault never freezes the UI.

## Validation

`src/mcp/__tests__/vault-tools.test.ts` covers list/get/search/backlinks,
tombstone exclusion, frontmatter preservation, the stale-revision refusal,
the fence guard, `replace_in_note`, and append. `src/main/__tests__/mcp-config.test.ts`
covers the server config, the paste-fields values, and the JSON snippet. The
bundled server is smoke-tested over stdio (initialize → tools/list → tools/call).

## Still open

- **Node-level structured edits** — `replace_in_note` is the current safety
  valve; a future tool could edit a single reference/bookmark without anyone
  touching markdown fences.
- **Semantic / FTS retrieval** — today search is a linear filename+body scan;
  move to the SQLite FTS index (or a sidecar) as vaults grow.
- **Remote transport** — a hosted MCP (HTTP + auth) is what ChatGPT/Grok
  connectors require; it depends on the E2E/server-fork decision.
