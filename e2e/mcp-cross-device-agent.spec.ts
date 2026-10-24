import path from 'path';
import { test, expect, firstWindowReady, getDocumentFromDb, launchLychee } from './electron-app';
import {
  appendLive,
  openLiveNote,
  syncSocketPath,
  waitForSyncSocket,
} from './mcp-live-helpers';
import {
  renameVaultPath,
  typeInBody,
  waitForContent,
  waitForFile,
  waitForFileGone,
  writeNote,
} from './vault-helpers';
import { FolderAdapter } from '../src/sync/folder-adapter';
import { connectDoc } from '../src/sync/memory-hub';
import { CRDT_SYNC_DIRECTORY, listUpdateFiles } from '../src/sync/folder-store';
import {
  appendMarkdown,
  createNoteDoc,
  flushEditor,
  projectMarkdown,
  type NoteDocHandle,
} from '../src/sync/note-doc';

/**
 * Agent ↔ device interplay.
 *
 * The MCP agent edits a live note; the edit must also reach the shared folder so
 * other devices converge, and it must survive concurrent watcher changes
 * (external body writes, renames). A third device is a headless Y.Doc bound to
 * the same `.lychee/sync` folder.
 */

test.use({ yjsFlag: true });

interface ThirdDevice {
  adapter: FolderAdapter;
  remote: NoteDocHandle;
  off: () => void;
  markdown(): string;
}

function joinThird(vaultDir: string, docId: string, id = 'third-device'): ThirdDevice {
  const root = path.join(vaultDir, CRDT_SYNC_DIRECTORY);
  const adapter = new FolderAdapter(root, id, { pollMs: 80 });
  const remote = createNoteDoc(docId, {});
  const off = connectDoc(adapter, docId, remote.doc);
  return {
    adapter,
    remote,
    off,
    markdown() {
      flushEditor(remote.editor);
      return projectMarkdown(remote.editor);
    },
  };
}

function closeThird(device: ThirdDevice): void {
  device.off();
  device.adapter.close();
  device.remote.dispose();
}

async function waitForAppUpload(vaultDir: string, docId: string): Promise<void> {
  const root = path.join(vaultDir, CRDT_SYNC_DIRECTORY);
  await expect.poll(() => listUpdateFiles(root, docId).length, { timeout: 10_000 }).toBeGreaterThan(0);
}

test.describe('agent + device — folder persistence', () => {
  test('a late third device receives the agent edit from the folder', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Agent To Late Device');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'BASE-FOR-THIRD');
    await waitForAppUpload(vaultDir, docId);

    expect(await appendLive(vaultDir, socket, docId, 'AGENT-TO-THIRD')).not.toBeNull();
    await expect(body).toContainText('AGENT-TO-THIRD');
    await waitForContent(vaultDir, 'Agent To Late Device.md', 'AGENT-TO-THIRD');

    // A device opened only after the edit still catches up from the folder.
    const third = joinThird(vaultDir, docId);
    try {
      await expect.poll(() => third.markdown(), { timeout: 10_000 }).toContain('AGENT-TO-THIRD');
      expect(third.markdown()).toContain('BASE-FOR-THIRD');
    } finally {
      closeThird(third);
    }
  });

  test('a third device joined before the edit sees it live', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Agent Live Third');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'BASE-LIVE');
    await waitForAppUpload(vaultDir, docId);

    const third = joinThird(vaultDir, docId);
    try {
      await expect.poll(() => third.markdown(), { timeout: 10_000 }).toContain('BASE-LIVE');

      expect(await appendLive(vaultDir, socket, docId, 'AGENT-LIVE-EDIT')).not.toBeNull();
      await expect.poll(() => third.markdown(), { timeout: 10_000 }).toContain('AGENT-LIVE-EDIT');
      await expect(body).toContainText('AGENT-LIVE-EDIT');
      await waitForContent(vaultDir, 'Agent Live Third.md', 'AGENT-LIVE-EDIT');
    } finally {
      closeThird(third);
    }
  });
});

test.describe('agent + device — concurrent edits', () => {
  test('a third-device edit and an agent edit both survive and converge', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Agent And Third');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'CONCURRENT-BASE');
    await waitForAppUpload(vaultDir, docId);

    const third = joinThird(vaultDir, docId);
    try {
      await expect.poll(() => third.markdown(), { timeout: 10_000 }).toContain('CONCURRENT-BASE');

      appendMarkdown(third.remote.editor, 'THIRD-DEVICE-EDIT');
      expect(await appendLive(vaultDir, socket, docId, 'AGENT-CONCURRENT-EDIT')).not.toBeNull();

      await expect(body).toContainText('THIRD-DEVICE-EDIT', { timeout: 10_000 });
      await expect(body).toContainText('AGENT-CONCURRENT-EDIT');
      await expect.poll(() => third.markdown(), { timeout: 10_000 }).toContain('AGENT-CONCURRENT-EDIT');
      expect(third.markdown()).toContain('THIRD-DEVICE-EDIT');
      await waitForContent(vaultDir, 'Agent And Third.md', 'THIRD-DEVICE-EDIT');
      await waitForContent(vaultDir, 'Agent And Third.md', 'AGENT-CONCURRENT-EDIT');

      // A fourth device reading only the folder agrees with the third.
      const fourth = joinThird(vaultDir, docId, 'fourth-device');
      try {
        await expect.poll(() => fourth.markdown(), { timeout: 10_000 }).toContain('AGENT-CONCURRENT-EDIT');
        expect(fourth.markdown()).toContain('THIRD-DEVICE-EDIT');
      } finally {
        closeThird(fourth);
      }
    } finally {
      closeThird(third);
    }
  });
});

test.describe('agent + device — watcher interplay', () => {
  test('the watcher applies an external change, then an agent edit builds on it', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Agent Vs External');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'AGENT-EXTERNAL-BASE');
    await waitForAppUpload(vaultDir, docId);

    // The other device's write lands first and is applied by the watcher.
    writeNote(
      vaultDir,
      'Agent Vs External.md',
      {
        id: docId,
        title: 'Agent Vs External',
        updated: new Date(Date.now() + 1000).toISOString(),
      },
      'EXTERNAL-FIRST',
    );
    await expect
      .poll(async () => (await getDocumentFromDb(window, docId))?.content ?? '', { timeout: 15_000 })
      .toContain('EXTERNAL-FIRST');

    // The agent then edits the same live note; neither side is lost.
    expect(await appendLive(vaultDir, socket, docId, 'AGENT-AFTER-EXTERNAL')).not.toBeNull();
    await expect(body).toContainText('AGENT-AFTER-EXTERNAL', { timeout: 10_000 });
    await waitForContent(vaultDir, 'Agent Vs External.md', 'AGENT-AFTER-EXTERNAL');
    await waitForContent(vaultDir, 'Agent Vs External.md', 'EXTERNAL-FIRST');
  });

  test('an agent edit lands on the new path after a remote rename', async ({
    window,
    vaultDir,
    testDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Agent Rename');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);
    await typeInBody(window, 'RENAME-BASE');
    await waitForAppUpload(vaultDir, docId);
    await waitForContent(vaultDir, 'Agent Rename.md', 'RENAME-BASE');

    renameVaultPath(vaultDir, 'Agent Rename.md', 'Agent Renamed.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, docId))?.title, { timeout: 15_000 })
      .toBe('Agent Renamed');
    await waitForFile(path.join(vaultDir, 'Agent Renamed.md'));
    await waitForContent(vaultDir, 'Agent Renamed.md', 'RENAME-BASE');

    expect(await appendLive(vaultDir, socket, docId, 'AGENT-AFTER-RENAME')).not.toBeNull();
    await expect(body).toContainText('AGENT-AFTER-RENAME', { timeout: 10_000 });
    await waitForContent(vaultDir, 'Agent Renamed.md', 'AGENT-AFTER-RENAME');
    await waitForFileGone(path.join(vaultDir, 'Agent Rename.md'));
  });

  test('an agent edit survives relaunch and is readable by a fresh device', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataA = path.join(testDir, 'userdata-a');
    const first = await launchLychee({ userDataDir: userDataA, vaultDir, yjsFlag: true });
    const firstWindow = await firstWindowReady(first);
    let docId = '';
    try {
      const opened = await openLiveNote(firstWindow, 'Agent Relaunch');
      docId = opened.docId;
      const socket = path.join(userDataA, 'lychee-sync.sock');
      await waitForSyncSocket(socket);
      await typeInBody(firstWindow, 'RELAUNCH-BASE');
      await waitForContent(vaultDir, 'Agent Relaunch.md', 'RELAUNCH-BASE');

      expect(await appendLive(vaultDir, socket, docId, 'AGENT-BEFORE-RELAUNCH')).not.toBeNull();
      await expect(firstWindow.locator('main:visible .ContentEditable__root')).toContainText(
        'AGENT-BEFORE-RELAUNCH',
      );
      await waitForContent(vaultDir, 'Agent Relaunch.md', 'AGENT-BEFORE-RELAUNCH');
    } finally {
      await first.close();
    }

    // The folder transport also retained the edit for a device that never saw it.
    const third = joinThird(vaultDir, docId, 'late-after-relaunch');
    try {
      await expect.poll(() => third.markdown(), { timeout: 10_000 }).toContain(
        'AGENT-BEFORE-RELAUNCH',
      );
    } finally {
      closeThird(third);
    }

    const second = await launchLychee({
      userDataDir: path.join(testDir, 'userdata-b'),
      vaultDir,
      yjsFlag: true,
    });
    const secondWindow = await firstWindowReady(second);
    try {
      await expect
        .poll(async () => (await getDocumentFromDb(secondWindow, docId))?.content ?? '', {
          timeout: 15_000,
        })
        .toContain('AGENT-BEFORE-RELAUNCH');
      await waitForContent(vaultDir, 'Agent Relaunch.md', 'AGENT-BEFORE-RELAUNCH');
    } finally {
      await second.close();
    }
  });
});
