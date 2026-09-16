import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate } from 'y-protocols/awareness';
import { startBridgeServer, type BridgeServer } from '../../sync/bridge';
import { createNoteDoc, flushEditor } from '../../sync/note-doc';
import { closeAllPeerSessions, joinNoteAsPeer } from '../bridge-peer';

/**
 * The agent's cursor only renders in the app if the peer publishes an awareness
 * state carrying `anchorPos`/`focusPos` (not just a name). This proves the peer
 * wiring: binding → `@lexical/yjs` → awareness → bridge.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  closeAllPeerSessions();
  for (const fn of cleanups.splice(0)) fn();
});

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** A bridge server whose "app" collects peer awareness into a host Awareness. */
function hostServer(socketPath: string) {
  const host = createNoteDoc('note-1', { markdown: 'Hello world\n' });
  const hostAwareness = new Awareness(host.doc);
  const server: BridgeServer = startBridgeServer(
    socketPath,
    (docId, update) => {
      Y.applyUpdate(host.doc, Buffer.from(update, 'base64'));
      flushEditor(host.editor);
    },
    (docId) => server.publish(docId, b64(Y.encodeStateAsUpdate(host.doc))),
    (_docId, update) => {
      applyAwarenessUpdate(hostAwareness, Buffer.from(update, 'base64'), 'lychee-test-remote');
    },
  );
  cleanups.push(() => {
    server.close();
    host.dispose();
  });
  return { host, hostAwareness };
}

function agentState(hostAwareness: Awareness): Record<string, unknown> | undefined {
  return [...hostAwareness.getStates().values()].find(
    (state) => (state as { name?: string }).name === 'Test Agent',
  ) as Record<string, unknown> | undefined;
}

describe('bridge-peer presence', () => {
  it('publishes name + color and a real cursor position', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-peer-cursor-'));
    const socket = path.join(dir, 'sync.sock');
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { hostAwareness } = hostServer(socket);

    const peer = await joinNoteAsPeer(socket, 'note-1', {
      settleMs: 150,
      name: 'Test Agent',
      color: '#7c3aed',
    });
    expect(peer).not.toBeNull();
    if (!peer) return;

    // Place the agent's cursor, as `publish()` does after an edit.
    peer.publish();

    await new Promise((resolve) => setTimeout(resolve, 100));
    const state = agentState(hostAwareness);
    expect(state).toBeDefined();
    expect(state?.focusing).toBe(true);
    expect(state?.color).toBe('#7c3aed');
    // The cursor position is what makes a caret render (null until placed).
    expect(state?.anchorPos).toBeTruthy();
    expect(state?.focusPos).toBeTruthy();

    peer.close();
  });
});
