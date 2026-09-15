import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import { startBridgeServer, type BridgeServer } from '../../sync/bridge';
import { createNoteDoc, flushEditor, projectDocMarkdown } from '../../sync/note-doc';
import { serializeFrontmatter } from '../../shared/frontmatter';
import { editNoteLive } from '../live-edit';

const cleanups: Array<() => void> = [];
afterEach(() => {
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
});
