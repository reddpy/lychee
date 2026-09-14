import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import {
  listMarkdown,
  readNote,
  writeNote,
  writeTombstone,
  noteItem,
} from './vault-helpers';

/**
 * Recovery and durability. The vault on disk is the durable source of truth, so
 * losing the SQLite index, losing the vault, or having unrelated files mixed in
 * must all converge without data loss. Also covers the watch opt-out.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const LEGACY_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_DEVICE = 'device-other-0001';

// Artifacts an editor / OS leaves behind; none may become a note.
const IGNORED_FILES: Record<string, string> = {
  'draft.md.tmp': 'partial write',
  'backup.md~': 'editor backup',
  'notes.swp': 'swap file',
  '.hidden.md': '---\nid: "deadbeef-dead-4ead-8ead-deadbeefdead"\n---\nhidden note',
  'stray.txt': 'just text',
  'diagram.png': 'not really a png',
};

test.describe('Recovery from index loss', () => {
  test.use({ vaultSeed: 'vault' });

  test('deleting the SQLite database rebuilds every note from the vault', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await listDocumentsFromDb(firstWindow)).length, { timeout: 15_000 })
      .toBe(7);
    await first.close();

    for (const name of ['lychee.sqlite3', 'lychee.sqlite3-wal', 'lychee.sqlite3-shm']) {
      fs.rmSync(path.join(userDataDir, name), { force: true });
    }

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await listDocumentsFromDb(secondWindow)).length, { timeout: 20_000 })
      .toBe(7);
    const roadmap = await getDocumentFromDb(secondWindow, ROADMAP_ID);
    expect(roadmap?.title).toBe('Roadmap');
    // Bodies (not just metadata) must be rebuilt from the files.
    expect(roadmap?.content).toContain('Q1 goals');
    expect(roadmap?.content).toContain('Round-trip');
    await expect(noteItem(secondWindow, 'Roadmap')).toBeVisible();
    await second.close();
  });

  test('deleting the entire vault re-exports every note from the database', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await listDocumentsFromDb(firstWindow)).length, { timeout: 15_000 })
      .toBe(7);
    await first.close();

    fs.rmSync(vaultDir, { recursive: true, force: true });

    const second = await launchLychee({ userDataDir, vaultDir });
    await firstWindowReady(second);
    await expect
      .poll(() => listMarkdown(vaultDir).length, { timeout: 20_000 })
      .toBe(7);
    expect(listMarkdown(vaultDir)).toEqual([
      'Bookmarked.md',
      'Legacy.md',
      'Projects.md',
      'Projects/Alpha.md',
      'Projects/Beta.md',
      'Roadmap.md',
      'Untitled.md',
    ]);
    expect(readNote(vaultDir, 'Roadmap.md').data.id).toBe(ROADMAP_ID);
    await second.close();
  });

  test('a purge tombstone still blocks re-import after the database is rebuilt', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await listDocumentsFromDb(firstWindow)).length, { timeout: 15_000 })
      .toBe(7);
    await first.close();

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: LEGACY_ID, action: 'purge', at: '2099-01-01T00:00:00.000Z' },
    ]);
    for (const name of ['lychee.sqlite3', 'lychee.sqlite3-wal', 'lychee.sqlite3-shm']) {
      fs.rmSync(path.join(userDataDir, name), { force: true });
    }

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await listDocumentsFromDb(secondWindow)).length, { timeout: 20_000 })
      .toBe(6);
    expect((await listDocumentsFromDb(secondWindow)).some((doc) => doc.id === LEGACY_ID)).toBe(
      false,
    );
    await second.close();
  });

  test('metadata edited while the app was closed is adopted on the next launch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await getDocumentFromDb(firstWindow, ROADMAP_ID))?.title, {
        timeout: 15_000,
      })
      .toBe('Roadmap');
    await first.close();

    writeNote(
      vaultDir,
      'Roadmap.md',
      {
        id: ROADMAP_ID,
        title: 'Roadmap',
        emoji: '🧭',
        bookmarked: '2024-04-04T00:00:00.000Z',
        order: 2,
      },
      'offline body',
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, ROADMAP_ID))?.emoji, {
        timeout: 15_000,
      })
      .toBe('🧭');
    expect((await getDocumentFromDb(secondWindow, ROADMAP_ID))!.metadata.bookmarkedAt).toBe(
      '2024-04-04T00:00:00.000Z',
    );
    expect((await getDocumentFromDb(secondWindow, ROADMAP_ID))!.sortOrder).toBe(2);
    await second.close();
  });

  test('rebuild index imports files even while watching is off', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);

    await window.evaluate(async () => {
      await (window as any).lychee.invoke('vault.watchStop', {});
    });
    const id = 'abcdef00-0000-4000-8000-0000000000aa';
    writeNote(vaultDir, 'Reindexed.md', { id, title: 'Reindexed' }, 'rebuilt body');
    await window.waitForTimeout(1200);
    // Watching is off: the file is not ingested automatically.
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === id)).toBe(false);

    // An explicit rebuild ingests it and reports what it did.
    const result = await window.evaluate(async () =>
      (window as any).lychee.invoke('vault.rebuildIndex', {}),
    );
    expect(result.imported).toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('rebuilt body');
  });
});

test.describe('Ignored artifacts', () => {
  test.use({ vaultSeed: 'vault', vaultExtra: IGNORED_FILES });

  test('editor temp/backup files never become notes and are preserved', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);
    await window.waitForTimeout(1000);

    expect((await listDocumentsFromDb(window)).length).toBe(7);
    for (const name of Object.keys(IGNORED_FILES)) {
      expect(fs.existsSync(path.join(vaultDir, name))).toBe(true);
    }
    expect(listMarkdown(vaultDir)).not.toContain('.hidden.md');
  });

  test('a swap file beside a real note does not affect the note', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    expect((await getDocumentFromDb(window, ROADMAP_ID))!.content).toContain('Q1 goals');
  });

  test('the note count is stable with unrelated files present', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);
    // A new stray file mid-session is ignored too.
    fs.writeFileSync(path.join(vaultDir, 'later.tmp'), 'mid-session junk');
    await window.waitForTimeout(1000);
    expect((await listDocumentsFromDb(window)).length).toBe(7);
  });
});

test.describe('Watch opt-out', () => {
  test.use({ vaultSeed: 'vault' });

  test('with watching disabled the app still writes files but ignores external edits', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await listDocumentsFromDb(firstWindow)).length, { timeout: 15_000 })
      .toBe(7);

    // Opt out, then make an app edit: the file write-through must still happen.
    await firstWindow.evaluate(async () => {
      await (window as any).lychee.invoke('vault.watchStop', {});
    });
    await firstWindow.evaluate(async (payload) => {
      await (window as any).lychee.invoke('documents.update', payload);
    }, { id: ROADMAP_ID, content: 'edited with watch off' });
    await expect
      .poll(() => listMarkdown(vaultDir).includes('Roadmap.md'), { timeout: 10_000 })
      .toBe(true);

    // An external edit must NOT be imported while watching is off.
    const externalId = 'f5000000-0000-4000-8000-000000000001';
    writeNote(vaultDir, 'External Off.md', { id: externalId, title: 'External Off' }, 'x');
    await firstWindow.waitForTimeout(1500);
    expect((await listDocumentsFromDb(firstWindow)).some((doc) => doc.id === externalId)).toBe(
      false,
    );
    await first.close();

    // The opt-out persists: external files still are not imported on relaunch.
    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await listDocumentsFromDb(secondWindow)).length, { timeout: 15_000 })
      .toBe(7);
    expect((await listDocumentsFromDb(secondWindow)).some((doc) => doc.id === externalId)).toBe(
      false,
    );
    await second.close();
  });
});
