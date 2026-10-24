import path from 'path';
import { test, expect } from './electron-app';
import { openLiveNote } from './mcp-live-helpers';
import { typeInBody, readRaw, waitForContent } from './vault-helpers';
import { FolderAdapter } from '../src/sync/folder-adapter';
import { connectDoc } from '../src/sync/memory-hub';
import { CRDT_SYNC_DIRECTORY, listUpdateFiles } from '../src/sync/folder-store';
import {
  appendMarkdown,
  createNoteDoc,
  flushEditor,
  noteStateVector,
  projectMarkdown,
} from '../src/sync/note-doc';

/**
 * Cross-device sync through the VAULT FOLDER — no socket. A "second device" is
 * a Y.Doc + FolderAdapter pointed at the app's `.lychee/sync`, exactly what a
 * second machine (or a collaborator on the same synced vault) runs.
 *
 * This is the end-to-end proof of the device-sync path: an update file written
 * by another device reaches the running app's editor and markdown file, and the
 * app's own edits land as update files other devices can read.
 */
test.use({ yjsFlag: true });

test.describe('cross-device vault folder sync', () => {
  test('a remote device\u2019s folder update reaches the app, and vice-versa', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Cross Device');
    await typeInBody(window, 'BASE-FROM-APP');

    const root = path.join(vaultDir, CRDT_SYNC_DIRECTORY);
    // The app publishes its state to the folder (renderer → main → folder).
    await expect.poll(() => listUpdateFiles(root, docId).length, { timeout: 10_000 }).toBeGreaterThan(0);

    // A second device adopts the note from the folder and then edits it.
    const adapter = new FolderAdapter(root, 'remote-device', { pollMs: 80 });
    const remote = createNoteDoc(docId, {});
    const off = connectDoc(adapter, docId, remote.doc);
    try {
      await expect
        .poll(() => projectMarkdown(remote.editor), { timeout: 10_000 })
        .toContain('BASE-FROM-APP');

      appendMarkdown(remote.editor, 'REMOTE-DEVICE-EDIT\n');

      // The app picks the remote update up from the folder and reflects it.
      await expect(body).toContainText('REMOTE-DEVICE-EDIT', { timeout: 10_000 });
      await waitForContent(vaultDir, 'Cross Device.md', 'REMOTE-DEVICE-EDIT');
      // ...without losing its own content.
      await expect(body).toContainText('BASE-FROM-APP');

      // And the app's own edits are readable back from the folder by devices.
      const files = listUpdateFiles(root, docId);
      expect(files.some((file) => file.startsWith('remote-device-'))).toBe(true);
      const adopted = createNoteDoc(docId, {});
      try {
        const reader = new FolderAdapter(root, 'third-device', { pollMs: 80 });
        const readerOff = connectDoc(reader, docId, adopted.doc);
        try {
          await expect
            .poll(() => projectMarkdown(adopted.editor), { timeout: 10_000 })
            .toContain('REMOTE-DEVICE-EDIT');
          expect(projectMarkdown(adopted.editor)).toContain('BASE-FROM-APP');
        } finally {
          readerOff();
          reader.close();
        }
      } finally {
        adopted.dispose();
      }
    } finally {
      off();
      adapter.close();
      remote.dispose();
    }
  });

  test('a device joining after the fact still receives the app\u2019s note', async ({
    window,
    vaultDir,
  }) => {
    const { docId } = await openLiveNote(window, 'Late Device');
    await typeInBody(window, 'APP-ONLY-STATE');

    const root = path.join(vaultDir, CRDT_SYNC_DIRECTORY);
    await expect.poll(() => listUpdateFiles(root, docId).length, { timeout: 10_000 }).toBeGreaterThan(0);

    // A brand-new device, opened only after the app already had content.
    const adapter = new FolderAdapter(root, 'late-device', { pollMs: 80 });
    const late = createNoteDoc(docId, {});
    const off = connectDoc(adapter, docId, late.doc);
    try {
      await expect
        .poll(() => projectMarkdown(late.editor), { timeout: 10_000 })
        .toContain('APP-ONLY-STATE');
    } finally {
      off();
      adapter.close();
      late.dispose();
    }
  });

  test('divergent edits on the same note converge with both edits intact', async ({
    window,
    vaultDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Divergent Same Note');
    await typeInBody(window, 'SHARED-BASE');

    const root = path.join(vaultDir, CRDT_SYNC_DIRECTORY);
    await expect.poll(() => listUpdateFiles(root, docId).length, { timeout: 10_000 }).toBeGreaterThan(0);

    const adapter = new FolderAdapter(root, 'remote-device', { pollMs: 80 });
    const remote = createNoteDoc(docId, {});
    const off = connectDoc(adapter, docId, remote.doc);
    try {
      await expect
        .poll(() => projectMarkdown(remote.editor), { timeout: 10_000 })
        .toContain('SHARED-BASE');

      // Both sides edit without having seen the other's change yet: the remote
      // writes while the app is still typing, and the app's folder update has
      // not reached the remote when it appends.
      const typing = body.click().then(() => window.keyboard.type('LOCAL-DIVERGENT'));
      setTimeout(() => appendMarkdown(remote.editor, 'REMOTE-DIVERGENT\n'), 100);
      await typing;
      await window.waitForTimeout(700);

      await expect(body).toContainText('REMOTE-DIVERGENT');
      await expect(body).toContainText('LOCAL-DIVERGENT');
      await waitForContent(vaultDir, 'Divergent Same Note.md', 'REMOTE-DIVERGENT');
      await waitForContent(vaultDir, 'Divergent Same Note.md', 'LOCAL-DIVERGENT');
      expect(readRaw(vaultDir, 'Divergent Same Note.md')).toContain('SHARED-BASE');

      await expect
        .poll(() => {
          flushEditor(remote.editor);
          return projectMarkdown(remote.editor);
        }, { timeout: 10_000 })
        .toContain('LOCAL-DIVERGENT');
      expect(projectMarkdown(remote.editor)).toContain('REMOTE-DIVERGENT');

      // A device that reads only the shared folder converges to the same state.
      const readerAdapter = new FolderAdapter(root, 'third-device', { pollMs: 80 });
      const third = createNoteDoc(docId, {});
      const readerOff = connectDoc(readerAdapter, docId, third.doc);
      try {
        await expect
          .poll(() => {
            flushEditor(third.editor);
            return projectMarkdown(third.editor);
          }, { timeout: 10_000 })
          .toContain('REMOTE-DIVERGENT');
        expect(projectMarkdown(third.editor)).toContain('LOCAL-DIVERGENT');
        expect(projectMarkdown(third.editor)).toContain('SHARED-BASE');

        await expect
          .poll(
            () =>
              Array.from(noteStateVector(third.doc)).join(',') ===
              Array.from(noteStateVector(remote.doc)).join(','),
            { timeout: 10_000 },
          )
          .toBe(true);
      } finally {
        readerOff();
        readerAdapter.close();
        third.dispose();
      }
    } finally {
      off();
      adapter.close();
      remote.dispose();
    }
  });

  test('a remote update landing mid-typing loses neither side', async ({ window, vaultDir }) => {
    const { docId, body } = await openLiveNote(window, 'Interleaved Typing');
    await typeInBody(window, 'INTERLEAVED-BASE');

    const root = path.join(vaultDir, CRDT_SYNC_DIRECTORY);
    await expect.poll(() => listUpdateFiles(root, docId).length, { timeout: 10_000 }).toBeGreaterThan(0);

    const adapter = new FolderAdapter(root, 'remote-device', { pollMs: 80 });
    const remote = createNoteDoc(docId, {});
    const off = connectDoc(adapter, docId, remote.doc);
    try {
      await expect
        .poll(() => projectMarkdown(remote.editor), { timeout: 10_000 })
        .toContain('INTERLEAVED-BASE');

      // Keep the local caret busy long enough for the folder poll to deliver the
      // remote edit in the middle of the local typing session.
      await body.click();
      const typing = window.keyboard.type('LOCAL-TYPED-THROUGH-THE-WHOLE-UPDATE', { delay: 60 });
      setTimeout(() => appendMarkdown(remote.editor, 'REMOTE-MID-TYPING\n'), 300);
      await typing;
      await window.waitForTimeout(700);

      await expect(body).toContainText('REMOTE-MID-TYPING');
      await expect(body).toContainText('LOCAL-TYPED-THROUGH-THE-WHOLE-UPDATE');
      await expect(body).toContainText('INTERLEAVED-BASE');
      await waitForContent(vaultDir, 'Interleaved Typing.md', 'REMOTE-MID-TYPING');
      await waitForContent(vaultDir, 'Interleaved Typing.md', 'LOCAL-TYPED-THROUGH-THE-WHOLE-UPDATE');

      await expect
        .poll(() => {
          flushEditor(remote.editor);
          return projectMarkdown(remote.editor);
        }, { timeout: 10_000 })
        .toContain('LOCAL-TYPED-THROUGH-THE-WHOLE-UPDATE');
    } finally {
      off();
      adapter.close();
      remote.dispose();
    }
  });
});
