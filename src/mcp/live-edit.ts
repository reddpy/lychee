import { findEntry } from "../main/vault-store";
import {
  appendMarkdown,
  bootstrapFromMarkdown,
  projectDocMarkdown,
  projectMarkdown,
} from "../sync/note-doc";
import { getNotePeerSession } from "./bridge-peer";

/**
 * Apply a content edit to a note through the live Yjs channel when the app is
 * running and the note is open, so the change appears in the user's editor
 * immediately. Returns null when the note isn't live (app closed / note not
 * open) or the edit would change `lychee-*` blocks without permission, so the
 * caller can fall back to the markdown-file tool.
 */

/** Sorted `lychee-*` fence languages in a body (the encoded-node guard). */
function fenceKey(body: string): string {
  const found: string[] = [];
  for (const match of body.matchAll(/```+\s*(lychee-[a-z-]+)/gi)) {
    found.push(match[1].toLowerCase());
  }
  return found.sort().join(",");
}

export interface LiveEditResult {
  relativePath: string;
}

export async function editNoteLive(args: {
  vault: string;
  socket: string;
  idOrPath: string;
  /**
   * Given the note's current markdown, return the next markdown, or null to
   * decline (fall back to the file tool).
   */
  transform: (currentMarkdown: string) => string | null;
  /** Permit changes to `lychee-*` encoded blocks (default: refuse → fallback). */
  allowFenceChanges?: boolean;
  settleMs?: number;
}): Promise<LiveEditResult | null> {
  const entry = findEntry(args.vault, args.idOrPath);
  if (!entry || !entry.id) return null;

  // A cached, kept-alive peer session: the agent's cursor stays visible across
  // a burst of tool calls instead of closing the moment one returns.
  const session = await getNotePeerSession(args.socket, entry.id, { settleMs: args.settleMs });
  if (!session) return null;
  if (!session.live) return null;

  const current = projectMarkdown(session.editor);
  const next = args.transform(current);
  if (next === null) return null;
  if (!args.allowFenceChanges && fenceKey(current) !== fenceKey(next)) return null;

  // Repair editor/doc divergence before editing. An emptied note can leave the
  // peer's editor with a default paragraph the doc never received (Lexical
  // normalizes an empty root inside a collab-tagged remote apply, which is not
  // synced back), which makes the replacement below throw "could not find collab
  // element node".
  const docRoot = session.doc.get("root") as { length?: number } | undefined;
  if (docRoot && (docRoot.length ?? 0) === 0) session.reseed();

  // Apply as a doc update via the headless binding; the app reflects it live.
  // The binding can fail silently (spike findings part 5: a non-fatal throw
  // leaves the shared doc unchanged), so confirm the doc actually took the edit
  // and report failure otherwise — a tool that says "success" while the note is
  // unchanged is worse than falling back to the file writer.
  const before = safeProjection(session.doc);
  // Pure appends apply incrementally. A full clear+reimport replaces every
  // block, which duplicated/dropped/reordered decorator nodes (images, media)
  // across repeated edits.
  const base = current.replace(/\s+$/, "");
  if (next.startsWith(base) && next.length > base.length) {
    appendMarkdown(session.editor, next.slice(base.length).replace(/^\n+/, ""));
  } else {
    bootstrapFromMarkdown(session.editor, next);
  }
  const after = safeProjection(session.doc);
  if (after === before && next.trim() !== before.trim()) {
    console.error("[mcp] live edit did not reach the shared doc; falling back");
    return null;
  }

  session.publish();
  // Let the socket flush before returning.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { relativePath: entry.relativePath };
}

/** Project a doc to markdown without throwing on a malformed doc. */
function safeProjection(doc: Parameters<typeof projectDocMarkdown>[0]): string {
  try {
    return projectDocMarkdown(doc).trim();
  } catch (error) {
    console.error("[mcp] doc projection failed:", error);
    return "\u0000unavailable";
  }
}
