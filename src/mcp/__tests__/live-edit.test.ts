import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import { startBridgeServer, type BridgeServer } from '../../sync/bridge';
import {
  appendMarkdown,
  createNoteDoc,
  flushEditor,
  noteStateVector,
  projectDocMarkdown,
} from '../../sync/note-doc';
import { FolderAdapter } from '../../sync/folder-adapter';
import { connectDoc } from '../../sync/memory-hub';
import { serializeFrontmatter } from '../../shared/frontmatter';
import { editNoteLive } from '../live-edit';
import { closeAllPeerSessions } from '../bridge-peer';
import { getNote } from '../vault-tools';

const cleanups: Array<() => void> = [];
afterEach(() => {
  closeAllPeerSessions();
  for (const fn of cleanups.splice(0)) fn();
});

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** A vault dir with one note file (`note-1`, body `Original body`). */
function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-live-edit-'));
  const frontmatter = serializeFrontmatter({
    id: 'note-1',
    title: 'Live',
    created: '2024-01-01T00:00:00.000Z',
    updated: '2024-01-02T00:00:00.000Z',
    contentSchemaVersion: 1,
  });
  fs.writeFileSync(path.join(dir, 'Live.md'), `${frontmatter}\nOriginal body\n`);
  return dir;
}

/** A bridge server + a host doc acting as the running app. */
function hostServer(socketPath: string) {
  const host = createNoteDoc('note-1', { markdown: 'Original body\n' });
  const server: BridgeServer = startBridgeServer(
    socketPath,
    (docId, update) => {
      Y.applyUpdate(host.doc, Buffer.from(update, 'base64'));
      flushEditor(host.editor);
    },
    (docId) => server.publish(docId, b64(Y.encodeStateAsUpdate(host.doc))),
  );
  cleanups.push(() => {
    server.close();
    host.dispose();
  });
  return { host, server };
}

describe('editNoteLive', () => {
  it('applies the edit to the live host doc and returns the path', async () => {
    const vault = makeVault();
    const socket = path.join(vault, 'sync.sock');
    const { host } = hostServer(socket);

    const result = await editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: (current) => `${current.replace(/\s+$/, '')}\n\nADDED\n`,
    });

    expect(result).toEqual({ relativePath: 'Live.md' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    flushEditor(host.editor);
    const projection = projectDocMarkdown(host.doc);
    expect(projection).toContain('Original body');
    expect(projection).toContain('ADDED');
  });

  it('returns null when no live host is bound (app closed / note not open)', async () => {
    const vault = makeVault();
    const socket = path.join(vault, 'sync.sock');
    const server = startBridgeServer(socket, () => {});
    cleanups.push(() => server.close());

    const result = await editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: (current) => `${current}X`,
    });
    expect(result).toBeNull();
  });

  it('declines an edit that would change lychee-* blocks (fence guard)', async () => {
    const vault = makeVault();
    const socket = path.join(vault, 'sync.sock');
    hostServer(socket);

    const result = await editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: () => 'text\n\n```lychee-reference\n{"id":"x"}\n```\n',
    });
    expect(result).toBeNull();
  });

  it('returns null for an unknown note id', async () => {
    const vault = makeVault();
    const socket = path.join(vault, 'sync.sock');
    hostServer(socket);
    const result = await editNoteLive({
      vault,
      socket,
      idOrPath: 'missing',
      transform: (current) => current,
    });
    expect(result).toBeNull();
  });

  it('strips a leading heading that duplicates the note title', async () => {
    const vault = makeVault();
    const socket = path.join(vault, 'sync.sock');
    const { host } = hostServer(socket);

    const result = await editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: () => '# Live\n\nbrand new body\n',
    });
    expect(result).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    flushEditor(host.editor);
    const projection = projectDocMarkdown(host.doc);
    expect(projection).toContain('brand new body');
    expect(projection).not.toMatch(/# Live/);
  });

  it('declines a stale expectedRevision and accepts the current one', async () => {
    const vault = makeVault();
    const socket = path.join(vault, 'sync.sock');
    hostServer(socket);

    const stale = await editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: () => 'changed body\n',
      expectedRevision: 'not-the-current-revision',
    });
    expect(stale).toBeNull();

    const current = getNote(vault, 'Live.md')!.revision;
    const accepted = await editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: () => 'changed body\n',
      expectedRevision: current,
    });
    expect(accepted).not.toBeNull();
  });
});

async function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A folder-syncing "app" host plus a third device on the same shared folder. */
function folderPeers(root: string, markdown = 'Original body\n') {
  const host = createNoteDoc('note-1', { markdown });
  const hostAdapter = new FolderAdapter(root, 'host-app', { pollMs: 20 });
  const hostOff = connectDoc(hostAdapter, 'note-1', host.doc);

  const third = createNoteDoc('note-1', {});
  const thirdAdapter = new FolderAdapter(root, 'third-device', { pollMs: 20 });
  const thirdOff = connectDoc(thirdAdapter, 'note-1', third.doc);

  cleanups.push(() => {
    hostOff();
    hostAdapter.close();
    host.dispose();
    thirdOff();
    thirdAdapter.close();
    third.dispose();
  });
  return { host, third };
}

function projection(handle: ReturnType<typeof createNoteDoc>): string {
  flushEditor(handle.editor);
  return projectDocMarkdown(handle.doc);
}

/** A folder-syncing host behind the bridge socket (the app side). */
function folderBridge(socket: string, root: string) {
  const { host, third } = folderPeers(root);
  const server = startBridgeServer(
    socket,
    (docId, update) => {
      Y.applyUpdate(host.doc, Buffer.from(update, 'base64'));
      flushEditor(host.editor);
    },
    (docId) => server.publish(docId, Buffer.from(Y.encodeStateAsUpdate(host.doc)).toString('base64')),
  );
  cleanups.push(() => server.close());
  return { host, third };
}

describe('editNoteLive — agent + device interplay through the folder', () => {
  it('an agent edit is persisted to the folder and read by a third device', async () => {
    const vault = makeVault();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-agent-device-'));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const socket = path.join(vault, 'sync.sock');
    const { host, third } = folderBridge(socket, root);

    await waitUntil(() => projection(third).includes('Original body'));

    const result = await editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: (current) => `${current.replace(/\s+$/, '')}\n\nAGENT-TO-FOLDER\n`,
    });
    expect(result).not.toBeNull();

    await waitUntil(() => projection(third).includes('AGENT-TO-FOLDER'));
    await waitUntil(() => fs.existsSync(path.join(root, 'note-1')));
    expect(projection(host)).toContain('AGENT-TO-FOLDER');
    expect(
      Array.from(noteStateVector(third.doc)).join(','),
    ).toBe(Array.from(noteStateVector(host.doc)).join(','));
  });

  it('a third device edit and an agent edit merge, both surviving', async () => {
    const vault = makeVault();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-agent-device-'));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const socket = path.join(vault, 'sync.sock');
    const { host, third } = folderBridge(socket, root);
    await waitUntil(() => projection(third).includes('Original body'));

    appendMarkdown(third.editor, 'THIRD-DEVICE-EDIT\n');
    const agent = editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: (current) => `${current.replace(/\s+$/, '')}\n\nAGENT-EDIT\n`,
    });

    expect(await agent).not.toBeNull();
    await waitUntil(
      () => projection(third).includes('AGENT-EDIT') && projection(host).includes('THIRD-DEVICE-EDIT'),
    );
    expect(projection(host)).toContain('AGENT-EDIT');
    expect(projection(third)).toContain('THIRD-DEVICE-EDIT');
  });

  it('an agent-appended image reaches a third device', async () => {
    const vault = makeVault();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-agent-device-'));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    const socket = path.join(vault, 'sync.sock');
    const { host, third } = folderBridge(socket, root);
    await waitUntil(() => projection(third).includes('Original body'));

    const result = await editNoteLive({
      vault,
      socket,
      idOrPath: 'note-1',
      transform: (current) =>
        `${current.replace(/\s+$/, '')}\n\n![pic](https://cdn.example.com/to-third.png)\n`,
    });
    expect(result).not.toBeNull();

    await waitUntil(() => projection(third).includes('to-third.png'));
    expect(projection(host)).toContain('to-third.png');
  });
});
