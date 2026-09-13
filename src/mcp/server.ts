import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  appendToNote,
  findBacklinks,
  getNote,
  listNotes,
  moveNote,
  renameNote,
  replaceInNote,
  restoreNote,
  searchNotes,
  trashNote,
  updateNote,
} from "./vault-tools";

/**
 * Lychee MCP server over a vault directory.
 *
 * Runs as a plain Node process (no Electron, no database), so an agent can read
 * and edit the vault whether or not the app is open. Reads come straight from
 * the markdown files. Writes preserve frontmatter and are optimistic: pass the
 * `revision` you last read and the write is refused if the file changed. When
 * the app is running, its watcher reconciles the change through the same
 * conflict-safe path as any external edit.
 *
 * The CLI entry (`cli.ts`) wires this to a stdio transport; stdout is reserved
 * for the JSON-RPC transport, so logs go to stderr.
 */

function asText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function createServer(vault: string): McpServer {
  const server = new McpServer({ name: "lychee", version: "1.0.0" });

  // The SDK's zod-typed overloads blow up TypeScript's instantiation depth with
  // these schemas, so register through a looser signature. Runtime validation is
  // unchanged — the SDK still validates against the zod shape.
  type LooseTool = (
    name: string,
    description: string,
    schema: Record<string, unknown>,
    cb: (args: Record<string, any>) => Promise<unknown>,
  ) => unknown;
  const registerTool = server.tool.bind(server) as unknown as LooseTool;

  server.tool("list_notes", "List the notes in the Lychee vault (id, title, path).", async () =>
    asText(listNotes(vault)),
  );

  registerTool(
    "search_notes",
    "Case-insensitive full-text search across note titles and bodies.",
    {
      query: z.string().describe("Text to search for"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
    },
    async ({ query, limit }) => asText(searchNotes(vault, query, limit ?? 20)),
  );

  registerTool(
    "get_note",
    "Return a note's full markdown (frontmatter + body) by id or vault-relative path.",
    { id: z.string().describe("Note id (frontmatter id) or vault-relative path") },
    async ({ id }) => {
      const note = getNote(vault, id);
      return note ? asText(note.markdown) : asText(`Note not found: ${id}`);
    },
  );

  registerTool(
    "backlinks",
    "List notes that link to the given note id.",
    { id: z.string().describe("Target note id") },
    async ({ id }) => asText(findBacklinks(vault, id)),
  );

  registerTool(
    "update_note",
    "Replace a note's markdown body, preserving its frontmatter. Pass expectedRevision (from get_note) to avoid overwriting a concurrent edit. Refuses to add/remove lychee-* blocks unless allowFenceChanges is true.",
    {
      id: z.string().describe("Note id or vault-relative path"),
      markdown: z.string().describe("New markdown body (without frontmatter)"),
      expectedRevision: z
        .string()
        .optional()
        .describe("Revision returned by get_note; the write fails if the file changed"),
      allowFenceChanges: z
        .boolean()
        .optional()
        .describe("Set true to intentionally add/remove lychee-* encoded blocks"),
    },
    async ({ id, markdown, expectedRevision, allowFenceChanges }) =>
      asText(updateNote(vault, id, markdown, expectedRevision, allowFenceChanges ?? false)),
  );

  registerTool(
    "replace_in_note",
    "Replace an exact substring in a note body, leaving the rest (including lychee-* blocks) untouched. Preferred over update_note for small edits.",
    {
      id: z.string().describe("Note id or vault-relative path"),
      find: z.string().describe("Exact text to find"),
      replace: z.string().describe("Replacement text"),
      expectedRevision: z.string().optional().describe("Revision returned by get_note"),
    },
    async ({ id, find, replace, expectedRevision }) =>
      asText(replaceInNote(vault, id, find, replace, expectedRevision)),
  );

  registerTool(
    "append_to_note",
    "Append markdown to the end of a note. Pass expectedRevision (from get_note) to avoid overwriting a concurrent edit.",
    {
      id: z.string().describe("Note id or vault-relative path"),
      text: z.string().describe("Markdown to append"),
      expectedRevision: z.string().optional().describe("Revision returned by get_note"),
    },
    async ({ id, text, expectedRevision }) =>
      asText(appendToNote(vault, id, text, expectedRevision)),
  );

  registerTool(
    "rename_note",
    "Rename a note by setting its title. The filename IS the title (Obsidian model), so this moves the file (and its child folder) without changing contents. Collisions get a numeric suffix.",
    {
      id: z.string().describe("Note id or vault-relative path"),
      title: z.string().describe("New title (becomes the filename)"),
      expectedRevision: z
        .string()
        .optional()
        .describe("Revision returned by get_note; the rename fails if the file changed"),
    },
    async ({ id, title, expectedRevision }) =>
      asText(renameNote(vault, id, title, expectedRevision)),
  );

  registerTool(
    "move_note",
    "Move a note under a new parent (or the vault root). Hierarchy is the folder layout, so this moves the file and its child folder. Pass parentId = null for the root.",
    {
      id: z.string().describe("Note id or vault-relative path"),
      parentId: z
        .string()
        .nullable()
        .describe("Parent note id or vault-relative path, or null for the vault root"),
      expectedRevision: z.string().optional().describe("Revision returned by get_note"),
    },
    async ({ id, parentId, expectedRevision }) =>
      asText(moveNote(vault, id, parentId ?? null, expectedRevision)),
  );

  registerTool(
    "trash_note",
    "Move a note to the vault trash and record a deletion tombstone so other devices converge. Recoverable with restore_note.",
    {
      id: z.string().describe("Note id or vault-relative path"),
      expectedRevision: z.string().optional().describe("Revision returned by get_note"),
    },
    async ({ id, expectedRevision }) => asText(trashNote(vault, id, expectedRevision)),
  );

  registerTool(
    "restore_note",
    "Restore a trashed note to its original path and record a restore tombstone.",
    {
      id: z.string().describe("Note id or its path inside the trash"),
      expectedRevision: z.string().optional().describe("Revision of the trashed file"),
    },
    async ({ id, expectedRevision }) => asText(restoreNote(vault, id, expectedRevision)),
  );

  return server;
}
