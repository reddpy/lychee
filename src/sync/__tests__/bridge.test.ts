import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode } from 'lexical';
import { connectBridge, startBridgeServer, type BridgeServer } from '../bridge';
import { createNoteDoc, flushEditor, projectDocMarkdown } from '../note-doc';
import { joinNoteAsPeer } from '../../mcp/bridge-peer';

const cleanups: Array<() => void> = [];
function track<T extends { close(): void }>(resource: T): T {
  cleanups.push(() => resource.close());
  return resource;
}
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function socketPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-bridge-')), 'sync.sock');
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('bridge relay', () => {
  it('relays a peer update to the host callback and other peers', async () => {
    const sock = socketPath();
    const hostReceived: Array<{ docId: string; update: string }> = [];
    let hostPeerJoined = 0;
    const server = startBridgeServer(
      sock,
      (docId, update) => hostReceived.push({ docId, update }),
      () => {
        hostPeerJoined += 1;
      },
    );
    track(server);

    const a = await connectBridge(sock);
    track(a);
    const b = await connectBridge(sock);
    track(b);

    const receivedByB: string[] = [];
    a.join('note', () => {});
    b.join('note', (update) => receivedByB.push(update));
    await delay(50);

    a.publish('note', b64(new Uint8Array([1, 2, 3])));
    await delay(50);

    // The host saw the peer update, and B received the relayed update.
    expect(hostReceived).toEqual([{ docId: 'note', update: b64(new Uint8Array([1, 2, 3])) }]);
    expect(receivedByB).toEqual([b64(new Uint8Array([1, 2, 3]))]);
    // The host was told a peer joined so it can publish its state.
    expect(hostPeerJoined).toBeGreaterThanOrEqual(1);
  });

  it('propagates the host update to a joined peer', async () => {
    const sock = socketPath();
    const server: BridgeServer = startBridgeServer(sock, () => {});
    track(server);

    const peer = await connectBridge(sock);
    track(peer);
    const received: string[] = [];
    peer.join('note', (update) => received.push(update));
    await delay(50);

    server.publish('note', b64(new Uint8Array([9, 9])));
    await delay(50);
    expect(received).toEqual([b64(new Uint8Array([9, 9]))]);
  });
});

describe('bridge + note-doc — two peers converge', () => {
  it('merges divergent edits exchanged over the socket', async () => {
    const sock = socketPath();
    const server = startBridgeServer(sock, () => {});
    track(server);

    const a = createNoteDoc('note', { markdown: 'Shared base\n' });
    const b = createNoteDoc('note');
    cleanups.push(() => {
      a.dispose();
      b.dispose();
    });

    const clientA = await connectBridge(sock);
    track(clientA);
    const clientB = await connectBridge(sock);
    track(clientB);

    const publish = (client: typeof clientA, doc: Y.Doc): void => {
      client.publish('note', b64(Y.encodeStateAsUpdate(doc)));
    };

    clientA.join(
      'note',
      (update) => {
        Y.applyUpdate(a.doc, Buffer.from(update, 'base64'));
        flushEditor(a.editor);
      },
      () => publish(clientA, a.doc),
    );
    clientB.join(
      'note',
      (update) => {
        Y.applyUpdate(b.doc, Buffer.from(update, 'base64'));
        flushEditor(b.editor);
      },
      () => publish(clientB, b.doc),
    );

    // Initial catch-up both ways.
    publish(clientA, a.doc);
    publish(clientB, b.doc);
    await delay(50);
    flushEditor(a.editor);
    flushEditor(b.editor);

    // Divergent edits.
    a.editor.update(
      () => {
        const last = $getRoot().getLastChild();
        if (last && $isElementNode(last)) last.append($createTextNode(' A-EDIT'));
      },
      { discrete: true },
    );
    b.editor.update(
      () => {
        const last = $getRoot().getLastChild();
        if (last && $isElementNode(last)) last.append($createTextNode(' B-EDIT'));
        else $getRoot().append($createParagraphNode().append($createTextNode(' B-EDIT')));
      },
      { discrete: true },
    );

    publish(clientA, a.doc);
    publish(clientB, b.doc);
    await delay(50);
    flushEditor(a.editor);
    flushEditor(b.editor);

    const projectionA = projectDocMarkdown(a.doc);
    const projectionB = projectDocMarkdown(b.doc);
    expect(projectionA).toBe(projectionB);
    expect(projectionA).toContain('A-EDIT');
    expect(projectionA).toContain('B-EDIT');
    expect(projectionA).toContain('Shared base');
  });
});

describe('MCP peer (joinNoteAsPeer)', () => {
  it('joins the live doc, edits, and the host observes it', async () => {
    const sock = socketPath();
    const host = createNoteDoc('note', { markdown: 'Host base\n' });
    cleanups.push(() => host.dispose());

    const server = startBridgeServer(
      sock,
      (docId, update) => {
        Y.applyUpdate(host.doc, Buffer.from(update, 'base64'));
        flushEditor(host.editor);
      },
      (docId) => server.publish(docId, b64(Y.encodeStateAsUpdate(host.doc))),
    );
    track(server);

    const peer = await joinNoteAsPeer(sock, 'note');
    expect(peer).not.toBeNull();
    if (!peer) return;
    track(peer);

    // The peer caught up from the host.
    expect(projectDocMarkdown(peer.doc)).toContain('Host base');

    peer.editor.update(
      () => {
        const last = $getRoot().getLastChild();
        if (last && $isElementNode(last)) last.append($createTextNode(' PEER-EDIT'));
      },
      { discrete: true },
    );
    peer.publish();
    await delay(50);
    flushEditor(host.editor);

    expect(projectDocMarkdown(host.doc)).toContain('PEER-EDIT');
    expect(projectDocMarkdown(host.doc)).toContain('Host base');
  });
});

describe('bridge awareness (presence)', () => {
  it('relays peer awareness to the host and other peers', async () => {
    const sock = socketPath();
    const hostAwareness: Array<{ docId: string; update: string }> = [];
    const server = startBridgeServer(
      sock,
      () => {},
      undefined,
      (docId, update) => hostAwareness.push({ docId, update }),
    );
    track(server);

    const a = await connectBridge(sock);
    track(a);
    const b = await connectBridge(sock);
    track(b);

    const receivedByB: string[] = [];
    a.join('note', () => {});
    b.join('note', () => {});
    a.subscribeAwareness('note', (update) => receivedByB.push(update));
    await delay(50);

    a.publishAwareness('note', b64(new Uint8Array([7, 7, 7])));
    await delay(50);

    expect(hostAwareness).toEqual([{ docId: 'note', update: b64(new Uint8Array([7, 7, 7])) }]);
  });

  it('an MCP peer publishes its presence on join', async () => {
    const sock = socketPath();
    const hostAwareness: string[] = [];
    const host = createNoteDoc('note', { markdown: 'Host\n' });
    cleanups.push(() => host.dispose());
    const server = startBridgeServer(
      sock,
      (docId, update) => {
        Y.applyUpdate(host.doc, Buffer.from(update, 'base64'));
        flushEditor(host.editor);
      },
      (docId) => server.publish(docId, b64(Y.encodeStateAsUpdate(host.doc))),
      (_docId, update) => hostAwareness.push(update),
    );
    track(server);

    const peer = await joinNoteAsPeer(sock, 'note', { name: 'Lychee Agent', settleMs: 150 });
    expect(peer).not.toBeNull();
    if (peer) track(peer);

    // The peer's presence reached the host.
    expect(hostAwareness.length).toBeGreaterThan(0);
  });
});
