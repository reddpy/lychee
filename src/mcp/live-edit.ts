import { findEntry } from "../main/vault-store";
import { bootstrapFromMarkdown, projectMarkdown } from "../sync/note-doc";
import { joinNoteAsPeer } from "./bridge-peer";

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

  const session = await joinNoteAsPeer(args.socket, entry.id, { settleMs: args.settleMs });
  if (!session) return null;
  try {
    if (!session.live) return null;

    const current = projectMarkdown(session.editor);
    const next = args.transform(current);
    if (next === null) return null;
    if (!args.allowFenceChanges && fenceKey(current) !== fenceKey(next)) return null;

    // Apply as a doc update via the headless binding; the app reflects it live.
    bootstrapFromMarkdown(session.editor, next);
    session.publish();
    // Let the socket flush before closing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { relativePath: entry.relativePath };
  } finally {
    session.close();
  }
}
