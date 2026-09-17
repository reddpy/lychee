import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import { FolderAdapter } from '../folder-adapter';
import { connectDoc } from '../memory-hub';
import {
  appendNoteUpdate,
  listUpdateFiles,
  readNoteUpdates,
  removeNoteUpdates,
} from '../folder-store';
import {
  appendMarkdown,
  createNoteDoc,
  encodeNoteUpdate,
  noteStateVector,
  projectDocMarkdown,
  projectMarkdown,
} from '../note-doc';

/**
 * Cross-device TRANSPORT mechanics over the shared folder. These are the
 * properties a cloud/git folder must not break: per-device immutable files, no
 * cross-device overwrites, convergence with many devices, order/duplicate
 * tolerance, safe compaction, and per-note isolation.
 */

const cleanups: Array<() => void> = [];
const roots: string[] = [];

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-xdevice-'));
  roots.push(root);
  return root;
}

function tracked<T>(value: T, cleanup: () => void): T {
  cleanups.push(cleanup);
  return value;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('cross-device transport — file immutability', () => {
  it('each update file is unique and prefixed with its device id', () => {
    const root = tmpRoot();
    const a = new FolderAdapter(root, 'dev-a');
    a.publish('doc', new Uint8Array([1]));
    a.publish('doc', new Uint8Array([2, 2]));

    const files = listUpdateFiles(root, 'doc');
    expect(files).toHaveLength(2);
    expect(new Set(files).size).toBe(2); // never the same path twice
    expect(files.every((file) => file.startsWith('dev-a-'))).toBe(true);
  });

  it('two devices never touch each other\u2019s files', () => {
    const root = tmpRoot();
    const a = new FolderAdapter(root, 'dev-a');
    const b = new FolderAdapter(root, 'dev-b');
    a.publish('doc', new Uint8Array([1]));
    b.publish('doc', new Uint8Array([2]));

    expect(listUpdateFiles(root, 'doc').filter((f) => f.startsWith('dev-a-'))).toHaveLength(1);
    expect(listUpdateFiles(root, 'doc').filter((f) => f.startsWith('dev-b-'))).toHaveLength(1);
  });
});

describe('cross-device transport — convergence at scale', () => {
  it('five devices editing one note all converge', async () => {
    const root = tmpRoot();
    const devices = ['dev-1', 'dev-2', 'dev-3', 'dev-4', 'dev-5'].map((id) => {
      const adapter = new FolderAdapter(root, id, { pollMs: 20 });
      const handle = createNoteDoc('doc');
      const off = connectDoc(adapter, 'doc', handle.doc);
      cleanups.push(() => {
        off();
        adapter.close();
        handle.dispose();
      });
      return { id, handle };
    });

    // Device 1 bootstraps; everyone else adopts it.
    appendMarkdown(devices[0].handle.editor, 'base\n');
    await waitFor(() => devices.every((d) => projectMarkdown(d.handle.editor).includes('base')));

    for (const device of devices) appendMarkdown(device.handle.editor, `FROM-${device.id}\n`);

    await waitFor(
      () =>
        devices.every((device) =>
          devices.every((other) => projectMarkdown(device.handle.editor).includes(`FROM-${other.id}`)),
        ),
      5000,
    );

    const vectors = devices.map((d) => Array.from(noteStateVector(d.handle.doc)));
    for (const vector of vectors) expect(vector).toEqual(vectors[0]);
  });
});

describe('cross-device transport — order and duplicates', () => {
  it('out-of-order file arrival still converges', async () => {
    const root = tmpRoot();
    const src = tracked(createNoteDoc('doc', { markdown: 'base\n' }), () => src.dispose());
    const before = encodeNoteUpdate(src.doc);
    appendMarkdown(src.editor, 'LATER-EDIT\n');
    const after = encodeNoteUpdate(src.doc);

    // Lexical filename order puts 'aaa' before 'zzz', so the newer state is read
    // first and the older one arrives "late". Yjs must still converge.
    appendNoteUpdate(root, 'doc', 'aaa', after);
    appendNoteUpdate(root, 'doc', 'zzz', before);

    const reader = tracked(new FolderAdapter(root, 'reader', { pollMs: 20 }), () => reader.close());
    const doc = tracked(new Y.Doc(), () => doc.destroy());
    reader.subscribe('doc', (update) => Y.applyUpdate(doc, update));

    await waitFor(() => projectDocMarkdown(doc).includes('LATER-EDIT'));
    expect(projectDocMarkdown(doc)).toContain('base');
  });

  it('duplicate delivery is idempotent', async () => {
    const root = tmpRoot();
    const src = tracked(createNoteDoc('doc', { markdown: 'base\n' }), () => src.dispose());
    const update = encodeNoteUpdate(src.doc);
    appendNoteUpdate(root, 'doc', 'dev-a', update);
    appendNoteUpdate(root, 'doc', 'dev-b', update); // same bytes, another device

    const doc = tracked(new Y.Doc(), () => doc.destroy());
    const reader = tracked(new FolderAdapter(root, 'reader', { pollMs: 20 }), () => reader.close());
    reader.subscribe('doc', (u) => Y.applyUpdate(doc, u));
    await waitFor(() => Y.encodeStateVector(doc).byteLength > 0);

    const once = new Y.Doc();
    Y.applyUpdate(once, update);
    Y.applyUpdate(once, update);
    expect(Array.from(Y.encodeStateVector(doc))).toEqual(Array.from(Y.encodeStateVector(once)));
  });
});

describe('cross-device transport — compaction and isolation', () => {
  it('owner compaction does not strand a peer that has not synced yet', async () => {
    const root = tmpRoot();
    const src = tracked(createNoteDoc('doc', { markdown: 'base\n' }), () => src.dispose());
    const owner = tracked(new FolderAdapter(root, 'owner', { pollMs: 1_000_000 }), () => owner.close());
    owner.publish('doc', encodeNoteUpdate(src.doc));
    appendMarkdown(src.editor, 'AFTER-COMPACT\n');
    owner.publish('doc', encodeNoteUpdate(src.doc));
    expect(listUpdateFiles(root, 'doc')).toHaveLength(2);

    // Compact BEFORE the peer has read anything.
    expect(owner.compact('doc')).toBe(true);
    expect(listUpdateFiles(root, 'doc')).toHaveLength(1);

    const peer = tracked(new FolderAdapter(root, 'peer', { pollMs: 20 }), () => peer.close());
    const peerDoc = tracked(new Y.Doc(), () => peerDoc.destroy());
    peer.subscribe('doc', (update) => Y.applyUpdate(peerDoc, update));
    await waitFor(() => projectDocMarkdown(peerDoc).includes('AFTER-COMPACT'));
    expect(projectDocMarkdown(peerDoc)).toContain('base');
  });

  it('removing one note\u2019s files leaves other notes intact', () => {
    const root = tmpRoot();
    const src = tracked(createNoteDoc('doc', { markdown: 'base\n' }), () => src.dispose());
    const update = encodeNoteUpdate(src.doc);
    appendNoteUpdate(root, 'note-1', 'dev-a', update);
    appendNoteUpdate(root, 'note-2', 'dev-a', update);

    removeNoteUpdates(root, 'note-1');
    expect(readNoteUpdates(root, 'note-1')).toEqual([]);
    expect(readNoteUpdates(root, 'note-2')).toHaveLength(1);
  });
});
