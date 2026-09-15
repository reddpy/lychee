import * as Y from "yjs";
import type { LexicalEditor } from "lexical";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { connectBridge, type BridgeClient } from "../sync/bridge";
import { createNoteDoc, flushEditor, type NoteDocHandle } from "../sync/note-doc";

/**
 * MCP-side Yjs peer.
 *
 * When the Lychee app is running and Yjs mode is on, the standalone MCP server
 * can join a note's live Y.Doc over the local bridge socket instead of editing
 * markdown. Edits made here are applied through the headless Lexical binding and
 * published as Yjs updates, so they appear in the user's open editor immediately.
 *
 * If the socket is unavailable (app closed), callers fall back to the
 * markdown-file tools.
 */

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export interface PeerSession {
  docId: string;
  /** Headless editor bound to the shared doc; edit inside `editor.update`. */
  editor: LexicalEditor;
  /** The live Y.Doc (for advanced callers). */
  doc: Y.Doc;
  /**
   * True when the app published state after we joined — i.e. the note is open
   * and bound to a live doc. False means the app is closed or the note isn't
   * open, so callers should fall back to the file tools.
   */
  live: boolean;
  /** Publish the current state so the app sees the edit. */
  publish(): void;
  close(): void;
}

/** Connect to the app's bridge and join a note's live doc. */
export async function joinNoteAsPeer(
  socketPath: string,
  docId: string,
  options: { settleMs?: number; name?: string; color?: string } = {},
): Promise<PeerSession | null> {
  let client: BridgeClient;
  try {
    client = await connectBridge(socketPath);
  } catch {
    return null;
  }

  const handle: NoteDocHandle = createNoteDoc(docId);
  let live = false;

  client.join(
    docId,
    (update) => {
      // Any update from the host means the note is open and bound.
      live = true;
      Y.applyUpdate(handle.doc, Buffer.from(update, "base64"));
      flushEditor(handle.editor);
    },
    () => client.publish(docId, b64(Y.encodeStateAsUpdate(handle.doc))),
  );

  // Presence: publish this peer's name/color so the app shows the agent.
  const awareness = new Awareness(handle.doc);
  const REMOTE = "lychee-peer-remote";
  awareness.setLocalState({
    name: options.name ?? "Lychee Agent",
    color: options.color ?? "#7c3aed",
    focusing: true,
  });
  awareness.on("update", (_changes: unknown, origin: unknown) => {
    if (origin === REMOTE) return;
    client.publishAwareness(docId, b64(encodeAwarenessUpdate(awareness, [awareness.clientID])));
  });
  client.subscribeAwareness(docId, (update) => {
    applyAwarenessUpdate(awareness, Buffer.from(update, "base64"), REMOTE);
  });
  client.publishAwareness(docId, b64(encodeAwarenessUpdate(awareness, [awareness.clientID])));

  // Give the app a moment to publish its current state after seeing the join.
  await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 150));

  return {
    docId,
    editor: handle.editor,
    doc: handle.doc,
    get live() {
      return live;
    },
    publish() {
      client.publish(docId, b64(Y.encodeStateAsUpdate(handle.doc)));
    },
    close() {
      awareness.destroy();
      client.close();
      handle.dispose();
    },
  };
}
