import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { Awareness, applyAwarenessUpdate } from 'y-protocols/awareness';
import { startBridgeServer, type BridgeServer } from '../../sync/bridge';
import { createNoteDoc, flushEditor, projectDocMarkdown, type NoteDocHandle } from '../../sync/note-doc';
import { closeAllPeerSessions, joinNoteAsPeer, type PeerSession } from '../bridge-peer';

/**
 * Multiple collaborators on the same live note (the "share a note with someone
 * else" primitive): two peers join one note's Y.Doc, both edit, everyone sees
 * both edits, and both are listed as present. Also verifies per-note isolation
 * when collaborators are on different notes.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  closeAllPeerSessions();
  for (const fn of cleanups.splice(0)) fn();
});

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

interface Host {
  docs: Map<string, NoteDocHandle>;
  awareness: Map<string, Awareness>;
  server: BridgeServer;
}

/** A bridge "app" hosting several note docs and collecting peer awareness. */
function host(socketPath: string, docs: Record<string, string>): Host {
  const handles = new Map<string, NoteDocHandle>();
  const awareness = new Map<string, Awareness>();
  for (const [docId, markdown] of Object.entries(docs)) {
    const handle = createNoteDoc(docId, { markdown });
    handles.set(docId, handle);
    awareness.set(docId, new Awareness(handle.doc));
  }
  const server: BridgeServer = startBridgeServer(
    socketPath,
    (docId, update) => {
      const handle = handles.get(docId);
      if (!handle) return;
      Y.applyUpdate(handle.doc, Buffer.from(update, 'base64'));
      flushEditor(handle.editor);
    },
    (docId) => {
      const handle = handles.get(docId);
      if (handle) server.publish(docId, b64(Y.encodeStateAsUpdate(handle.doc)));
    },
    (docId, update) => {
      const a = awareness.get(docId);
      if (a) applyAwarenessUpdate(a, Buffer.from(update, 'base64'), 'test-remote');
    },
  );
  cleanups.push(() => {
    server.close();
    for (const handle of handles.values()) handle.dispose();
  });
  return { docs: handles, awareness, server };
}

function peerAppend(peer: PeerSession, text: string): void {
  peer.editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode(text)));
    },
    { discrete: true },
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function hostMarkdown(h: Host, docId: string): string {
  const handle = h.docs.get(docId)!;
  flushEditor(handle.editor);
  return projectDocMarkdown(handle.doc);
}

describe('shared note — two collaborators', () => {
  it('both edits appear on the host and on each other', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-shared-note-'));
    const socket = path.join(dir, 'sync.sock');
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const h = host(socket, { note: 'shared base\n' });

    const one = await joinNoteAsPeer(socket, 'note', { name: 'Agent One', settleMs: 150 });
    const two = await joinNoteAsPeer(socket, 'note', { name: 'Agent Two', settleMs: 150 });
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    if (!one || !two) return;

    peerAppend(one, 'FROM-ONE');
    one.publish();
    await waitFor(() => hostMarkdown(h, 'note').includes('FROM-ONE'));

    peerAppend(two, 'FROM-TWO');
    two.publish();

    // Host sees both.
    await waitFor(() => hostMarkdown(h, 'note').includes('FROM-TWO') && hostMarkdown(h, 'note').includes('FROM-ONE'));
    // Each collaborator sees the other's edit (the relay forwards between peers).
    await waitFor(
      () =>
        projectDocMarkdown(two.doc).includes('FROM-ONE') &&
        projectDocMarkdown(one.doc).includes('FROM-TWO'),
    );

    // Both are listed as present on the shared note.
    const names = [...h.awareness.get('note')!.getStates().values()].map(
      (state) => (state as { name?: string }).name,
    );
    expect(names).toEqual(expect.arrayContaining(['Agent One', 'Agent Two']));

    one.close();
    two.close();
  });

  it('collaborators on different notes do not see each other', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-shared-notes-'));
    const socket = path.join(dir, 'sync.sock');
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const h = host(socket, { 'note-a': 'A base\n', 'note-b': 'B base\n' });

    const a = await joinNoteAsPeer(socket, 'note-a', { name: 'On A', settleMs: 150 });
    const b = await joinNoteAsPeer(socket, 'note-b', { name: 'On B', settleMs: 150 });
    if (!a || !b) throw new Error('peers failed to join');

    peerAppend(a, 'A-ONLY');
    a.publish();
    peerAppend(b, 'B-ONLY');
    b.publish();

    await waitFor(() => hostMarkdown(h, 'note-a').includes('A-ONLY') && hostMarkdown(h, 'note-b').includes('B-ONLY'));
    expect(hostMarkdown(h, 'note-a')).not.toContain('B-ONLY');
    expect(hostMarkdown(h, 'note-b')).not.toContain('A-ONLY');

    const aNames = [...h.awareness.get('note-a')!.getStates().values()].map(
      (s) => (s as { name?: string }).name,
    );
    const bNames = [...h.awareness.get('note-b')!.getStates().values()].map(
      (s) => (s as { name?: string }).name,
    );
    expect(aNames).toContain('On A');
    expect(aNames).not.toContain('On B');
    expect(bNames).toContain('On B');
    expect(bNames).not.toContain('On A');

    a.close();
    b.close();
  });
});
