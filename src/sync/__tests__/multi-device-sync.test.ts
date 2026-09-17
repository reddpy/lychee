import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import { FolderAdapter } from '../folder-adapter';
import { connectDoc } from '../memory-hub';
import {
  appendMarkdown,
  createNoteDoc,
  flushEditor,
  noteStateVector,
  projectMarkdown,
  type NoteDocHandle,
} from '../note-doc';

/**
 * Device-to-device sync through a shared folder (the BYO-cloud / iCloud /
 * Syncthing model), across MULTIPLE notes. Each "device" is a Y.Doc bound to a
 * headless editor plus a FolderAdapter writing to a shared root — exactly the
 * transport a second machine (or a collaborator) uses.
 *
 * These lock the invariants that matter once syncing/sharding ships: distinct
 * notes never cross-contaminate, the same note merges, late joiners catch up,
 * and every device converges.
 */

const cleanups: Array<() => void> = [];
const roots: string[] = [];

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-multi-device-'));
  roots.push(root);
  return root;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface Device {
  id: string;
  docs: Map<string, { doc: Y.Doc; handle: NoteDocHandle; off: () => void }>;
  open(docId: string, markdown?: string): { doc: Y.Doc; handle: NoteDocHandle };
  close(): void;
}

/** A syncing "device": one FolderAdapter over the shared root, N note docs. */
function makeDevice(root: string, id: string): Device {
  const adapter = new FolderAdapter(root, id, { pollMs: 20 });
  const docs = new Map<string, { doc: Y.Doc; handle: NoteDocHandle; off: () => void }>();
  cleanups.push(() => adapter.close());
  return {
    id,
    docs,
    open(docId, markdown) {
      const handle = createNoteDoc(docId, markdown === undefined ? {} : { markdown });
      const off = connectDoc(adapter, docId, handle.doc);
      const entry = { doc: handle.doc, handle, off };
      docs.set(docId, entry);
      cleanups.push(() => {
        off();
        handle.dispose();
      });
      return entry;
    },
    close() {
      adapter.close();
    },
  };
}

function body(device: Device, docId: string): string {
  const entry = device.docs.get(docId);
  if (!entry) throw new Error(`device ${device.id} has no doc ${docId}`);
  flushEditor(entry.handle.editor);
  return projectMarkdown(entry.handle.editor);
}

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('multi-device sync — different notes', () => {
  it('two devices editing different notes both converge to both edits', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    const b = makeDevice(root, 'dev-b');

    // A bootstraps both notes (fresh lineage) and publishes.
    a.open('note-1', 'note one base\n');
    a.open('note-2', 'note two base\n');
    await waitFor(() => fs.existsSync(path.join(root, 'note-1')) && fs.existsSync(path.join(root, 'note-2')));

    // B adopts the notes from the folder, then each device edits a different one.
    b.open('note-1');
    b.open('note-2');
    await waitFor(() => body(b, 'note-1').includes('note one base'));

    appendMarkdown(a.docs.get('note-1')!.handle.editor, 'A-EDIT-ONE\n');
    appendMarkdown(b.docs.get('note-2')!.handle.editor, 'B-EDIT-TWO\n');

    await waitFor(
      () => body(a, 'note-2').includes('B-EDIT-TWO') && body(b, 'note-1').includes('A-EDIT-ONE'),
    );

    // Each note carries only its own edit.
    expect(body(a, 'note-1')).toContain('A-EDIT-ONE');
    expect(body(a, 'note-1')).not.toContain('B-EDIT-TWO');
    expect(body(b, 'note-2')).toContain('B-EDIT-TWO');
    expect(body(b, 'note-2')).not.toContain('A-EDIT-ONE');
  });

  it('a late-joining device receives every note', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('alpha', 'alpha base\n');
    a.open('beta', 'beta base\n');
    appendMarkdown(a.docs.get('alpha')!.handle.editor, 'ALPHA-EDIT\n');
    appendMarkdown(a.docs.get('beta')!.handle.editor, 'BETA-EDIT\n');
    await waitFor(() => fs.existsSync(path.join(root, 'alpha')) && fs.existsSync(path.join(root, 'beta')));

    const late = makeDevice(root, 'dev-late');
    late.open('alpha');
    late.open('beta');

    await waitFor(() => body(late, 'alpha').includes('ALPHA-EDIT') && body(late, 'beta').includes('BETA-EDIT'));
    expect(body(late, 'alpha')).not.toContain('BETA-EDIT');
    expect(body(late, 'beta')).not.toContain('ALPHA-EDIT');
  });
});

describe('multi-device sync — same note', () => {
  it('two devices editing the same note merge (both edits survive)', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    const b = makeDevice(root, 'dev-b');

    a.open('shared', 'shared base\n');
    await waitFor(() => fs.existsSync(path.join(root, 'shared')));
    b.open('shared');
    await waitFor(() => body(b, 'shared').includes('shared base'));

    appendMarkdown(a.docs.get('shared')!.handle.editor, 'A-SIDE\n');
    appendMarkdown(b.docs.get('shared')!.handle.editor, 'B-SIDE\n');

    await waitFor(() => body(a, 'shared').includes('B-SIDE') && body(b, 'shared').includes('A-SIDE'));

    // The true CRDT guarantee: identical state vectors.
    expect(Array.from(noteStateVector(a.docs.get('shared')!.doc))).toEqual(
      Array.from(noteStateVector(b.docs.get('shared')!.doc)),
    );
    expect(body(a, 'shared')).toContain('shared base');
  });

  it('three devices editing one note converge', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('shared', 'base\n');
    await waitFor(() => fs.existsSync(path.join(root, 'shared')));

    const b = makeDevice(root, 'dev-b');
    const c = makeDevice(root, 'dev-c');
    b.open('shared');
    c.open('shared');
    await waitFor(() => body(b, 'shared').includes('base') && body(c, 'shared').includes('base'));

    appendMarkdown(a.docs.get('shared')!.handle.editor, 'FROM-A\n');
    appendMarkdown(b.docs.get('shared')!.handle.editor, 'FROM-B\n');
    appendMarkdown(c.docs.get('shared')!.handle.editor, 'FROM-C\n');

    await waitFor(
      () =>
        body(a, 'shared').includes('FROM-B') &&
        body(a, 'shared').includes('FROM-C') &&
        body(b, 'shared').includes('FROM-A') &&
        body(c, 'shared').includes('FROM-A'),
    );

    const vectors = [a, b, c].map((d) => Array.from(noteStateVector(d.docs.get('shared')!.doc)));
    expect(vectors[0]).toEqual(vectors[1]);
    expect(vectors[1]).toEqual(vectors[2]);
    const final = body(a, 'shared');
    expect(final).toContain('FROM-A');
    expect(final).toContain('FROM-B');
    expect(final).toContain('FROM-C');
  });
});
