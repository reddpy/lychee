import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import type { LexicalEditor } from 'lexical';
import { $createParagraphNode, $createTextNode, $getRoot, $isParagraphNode } from 'lexical';
import {
  createNoteDoc,
  flushEditor,
  noteStateVector,
  projectDocMarkdown,
  type NoteDocHandle,
} from '../note-doc';
import { FolderAdapter } from '../folder-adapter';
import { connectDoc } from '../memory-hub';
import { listDeviceUpdateFiles, readNoteUpdates } from '../folder-store';

const cleanups: Array<() => void> = [];
const roots: string[] = [];

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-folder-adapter-'));
  roots.push(root);
  return root;
}

function track(handle: NoteDocHandle): NoteDocHandle {
  cleanups.push(() => handle.dispose());
  return handle;
}

function appendText(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const last = $getRoot().getLastChild();
      if ($isParagraphNode(last)) last.append($createTextNode(text));
      else $getRoot().append($createParagraphNode().append($createTextNode(text)));
    },
    { discrete: true },
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('folder-adapter — two devices over a shared folder', () => {
  it('converges divergent edits (both survive, state vectors match)', async () => {
    const root = tmpRoot();
    const a = track(createNoteDoc('doc', { markdown: 'Base\n' }));
    const b = track(createNoteDoc('doc'));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    flushEditor(b.editor);

    const adapterA = new FolderAdapter(root, 'dev-a', { pollMs: 20 });
    const adapterB = new FolderAdapter(root, 'dev-b', { pollMs: 20 });
    cleanups.push(() => adapterA.close(), () => adapterB.close());
    cleanups.push(connectDoc(adapterA, 'doc', a.doc), connectDoc(adapterB, 'doc', b.doc));

    appendText(a.editor, ' A-EDIT');
    appendText(b.editor, ' B-EDIT');

    await waitFor(
      () =>
        projectDocMarkdown(a.doc).includes('B-EDIT') &&
        projectDocMarkdown(b.doc).includes('A-EDIT'),
    );

    expect(projectDocMarkdown(a.doc)).toContain('Base');
    expect(Array.from(noteStateVector(a.doc))).toEqual(Array.from(noteStateVector(b.doc)));
  });

  it('replays the folder to a late joiner', async () => {
    const root = tmpRoot();
    const a = track(createNoteDoc('doc', { markdown: 'Base\n' }));
    const adapterA = new FolderAdapter(root, 'dev-a', { pollMs: 20 });
    cleanups.push(() => adapterA.close());
    cleanups.push(connectDoc(adapterA, 'doc', a.doc));
    appendText(a.editor, ' SHARED');

    // A brand-new device with no local state loads everything from the folder.
    const c = track(createNoteDoc('doc'));
    const adapterC = new FolderAdapter(root, 'dev-c', { pollMs: 20 });
    cleanups.push(() => adapterC.close());
    cleanups.push(connectDoc(adapterC, 'doc', c.doc));

    await waitFor(() => projectDocMarkdown(c.doc).includes('SHARED'));
    expect(projectDocMarkdown(c.doc)).toContain('Base');
  });
});

describe('folder-adapter — compaction', () => {
  it('folds a device\u2019s own files into one losslessly', () => {
    const root = tmpRoot();
    const a = track(createNoteDoc('doc', { markdown: 'Base\n' }));
    const adapter = new FolderAdapter(root, 'dev-a', { pollMs: 1_000_000 });
    cleanups.push(() => adapter.close());
    cleanups.push(connectDoc(adapter, 'doc', a.doc));

    appendText(a.editor, ' one');
    appendText(a.editor, ' two');
    expect(listDeviceUpdateFiles(root, 'doc', 'dev-a').length).toBeGreaterThan(1);

    expect(adapter.compact('doc')).toBe(true);
    expect(listDeviceUpdateFiles(root, 'doc', 'dev-a')).toHaveLength(1);
    expect(adapter.compact('doc')).toBe(false); // already single file

    // A reader applying the compacted folder still gets the full document.
    const b = track(createNoteDoc('doc'));
    for (const buffer of readNoteUpdates(root, 'doc')) {
      Y.applyUpdate(b.doc, new Uint8Array(buffer));
    }
    flushEditor(b.editor);
    const markdown = projectDocMarkdown(b.doc);
    expect(markdown).toContain('one');
    expect(markdown).toContain('two');
  });
});
