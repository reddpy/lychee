import path from 'path';
import { test, expect } from './electron-app';
import { openLiveNote } from './mcp-live-helpers';
import { typeInBody, waitForContent } from './vault-helpers';
import { FolderAdapter } from '../src/sync/folder-adapter';
import { connectDoc } from '../src/sync/memory-hub';
import { CRDT_SYNC_DIRECTORY, listUpdateFiles } from '../src/sync/folder-store';
import { appendMarkdown, createNoteDoc, projectMarkdown } from '../src/sync/note-doc';

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
});
