import * as Y from "yjs";
import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { connectBridge, type BridgeClient } from "../sync/bridge";
import { createNoteDoc, flushEditor, reseedBindingFromEditor, type NoteDocHandle } from "../sync/note-doc";

/**
 * MCP-side Yjs peer.
 *
 * When the Lychee app is running and Yjs mode is on, the standalone MCP server
 * can join a note's live Y.Doc over the local bridge socket instead of editing
 * markdown. Edits made here are applied through the headless Lexical binding and
 * published as Yjs updates, so they appear in the user's open editor immediately.
 *
 * The peer also advertises presence (name + color) and a cursor position, so the
 * app renders the agent's caret/selection in the note. The binding must be given
 * the *real* awareness object (not the stub) or `@lexical/yjs` has nowhere to
 * publish the cursor from.
 *
 * Sessions are cached and kept alive briefly between tool calls: a cursor that
 * vanished the instant a tool returned would be invisible in practice. Each
 * cached session heartbeats its awareness (so the app does not expire it) and
 * closes after an idle period or when the process exits.
 */

const REMOTE_AWARENESS = "lychee-peer-remote";
const AWARENESS_HEARTBEAT_MS = 10_000;
const DEFAULT_IDLE_MS = 30_000;
/**
 * How long the agent's caret lingers after its last edit before its presence is
 * withdrawn. Removing the local awareness state is what makes the app destroy
 * the caret (`focusing: false` only freezes it).
 */
const CURSOR_IDLE_MS = 8_000;

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
  /**
   * Publish the current state so the app sees the edit, and move the agent
   * cursor to the end of the note so it is visible while the agent works.
   */
  publish(): void;
  /** Repair editor/doc divergence before an edit (see `reseedBindingFromEditor`). */
  reseed(): void;
  close(): void;
}

/** Connect to the app's bridge and join a note's live doc (low-level, no cache). */
export async function joinNoteAsPeer(
  socketPath: string,
  docId: string,
  options: { settleMs?: number; name?: string; color?: string; cursorIdleMs?: number } = {},
): Promise<PeerSession | null> {
  let client: BridgeClient;
  try {
    client = await connectBridge(socketPath);
  } catch {
    return null;
  }

  // Create the doc + awareness first, then hand the awareness to the binding so
  // `@lexical/yjs` publishes cursor positions through it.
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const handle: NoteDocHandle = createNoteDoc(docId, { doc, awareness });
  let live = false;
  let lastPublishAt = 0;

  /** Withdraw the cursor position (keep presence): used when the human edits. */
  const clearCursorPosition = (): void => {
    const current = awareness.getLocalState();
    if (current && (current.anchorPos || current.focusPos)) {
      awareness.setLocalState({ ...current, anchorPos: null, focusPos: null });
    }
  };

  client.join(
    docId,
    (update) => {
      // Any update from the host means the note is open and bound.
      live = true;
      Y.applyUpdate(handle.doc, Buffer.from(update, "base64"));
      flushEditor(handle.editor);
      // A host-originated change (not the immediate echo of our own publish)
      // means the user is editing — the agent's caret should not linger on a
      // position that has since been deleted, so hide it.
      if (Date.now() - lastPublishAt > 300) clearCursorPosition();
    },
    () => client.publish(docId, b64(Y.encodeStateAsUpdate(handle.doc))),
  );

  // Presence: publish this peer's name/color + a (initially empty) cursor so
  // `@lexical/yjs` can fill in anchorPos/focusPos once the editor has a selection.
  const presence: Record<string, unknown> = {
    name: options.name ?? "Lychee Agent",
    color: options.color ?? "#7c3aed",
    focusing: true,
    anchorPos: null,
    focusPos: null,
    awarenessData: {},
  };

  const broadcastAwareness = (): void => {
    // Also encodes the removal when the local state has been cleared.
    client.publishAwareness(docId, b64(encodeAwarenessUpdate(awareness, [awareness.clientID])));
  };
  awareness.on("update", (_changes: unknown, origin: unknown) => {
    if (origin === REMOTE_AWARENESS) return;
    broadcastAwareness();
  });
  client.subscribeAwareness(docId, (update) => {
    applyAwarenessUpdate(awareness, Buffer.from(update, "base64"), REMOTE_AWARENESS);
  });

  let cursorIdle: ReturnType<typeof setTimeout> | null = null;
  /** (Re)establish presence and restart the idle countdown. */
  const armCursorIdle = (): void => {
    if (cursorIdle) clearTimeout(cursorIdle);
    if (awareness.getLocalState() === null) awareness.setLocalState(presence);
    cursorIdle = setTimeout(() => {
      cursorIdle = null;
      // Drop the cursor position (not the presence): the app removes the caret
      // but keeps the agent listed, so an idle agent does not sit frozen in the
      // text. `@lexical/yjs` removes a caret whose position resolves to null.
      const current = awareness.getLocalState();
      if (current) awareness.setLocalState({ ...current, anchorPos: null, focusPos: null });
    }, options.cursorIdleMs ?? CURSOR_IDLE_MS);
    cursorIdle.unref?.();
  };

  awareness.setLocalState(presence);
  armCursorIdle();
  broadcastAwareness();
  const heartbeat = setInterval(() => {
    if (awareness.getLocalState() !== null) broadcastAwareness();
  }, AWARENESS_HEARTBEAT_MS);
  heartbeat.unref?.();

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
      // Re-establish presence (an idle peer withdraws it), then select the end
      // of the document so `@lexical/yjs` computes and publishes a cursor
      // position for the user to see.
      armCursorIdle();
      handle.editor.update(
        () => {
          $getRoot().selectEnd();
        },
        { discrete: true },
      );
      client.publish(docId, b64(Y.encodeStateAsUpdate(handle.doc)));
      lastPublishAt = Date.now();
    },
    reseed() {
      reseedBindingFromEditor(handle.editor, handle.binding);
    },
    close() {
      if (cursorIdle) clearTimeout(cursorIdle);
      clearInterval(heartbeat);
      awareness.destroy();
      client.close();
      handle.dispose();
      doc.destroy();
    },
  };
}

interface CachedSession {
  session: PeerSession;
  idle: ReturnType<typeof setTimeout> | null;
}

const cache = new Map<string, CachedSession>();

function cacheKey(socketPath: string, docId: string): string {
  return `${socketPath}\u0000${docId}`;
}

function armIdleClose(key: string, entry: CachedSession, idleMs: number): void {
  if (entry.idle) clearTimeout(entry.idle);
  entry.idle = setTimeout(() => {
    entry.session.close();
    cache.delete(key);
  }, idleMs);
  entry.idle.unref?.();
}

/**
 * Get a cached peer session for a note, joining on first use. The session stays
 * open for `idleMs` of inactivity so the agent's cursor remains visible across a
 * burst of tool calls.
 */
export async function getNotePeerSession(
  socketPath: string,
  docId: string,
  options: {
    settleMs?: number;
    name?: string;
    color?: string;
    idleMs?: number;
    cursorIdleMs?: number;
  } = {},
): Promise<PeerSession | null> {
  const key = cacheKey(socketPath, docId);
  const existing = cache.get(key);
  if (existing) {
    armIdleClose(key, existing, options.idleMs ?? DEFAULT_IDLE_MS);
    return existing.session;
  }
  const session = await joinNoteAsPeer(socketPath, docId, options);
  if (!session) return null;
  const entry: CachedSession = { session, idle: null };
  cache.set(key, entry);
  armIdleClose(key, entry, options.idleMs ?? DEFAULT_IDLE_MS);
  return session;
}

/** Close every cached peer session (process shutdown). */
export function closeAllPeerSessions(): void {
  for (const entry of cache.values()) {
    if (entry.idle) clearTimeout(entry.idle);
    entry.session.close();
  }
  cache.clear();
}
