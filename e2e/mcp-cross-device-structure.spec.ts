import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  firstWindowReady,
  getDocumentFromDb,
  launchLychee,
  listDocumentsFromDb,
  listTrashedFromDb,
} from './electron-app';
import {
  appendTombstone,
  expandFolder,
  frontmatterNote,
  listMarkdown,
  noteItem,
  readRaw,
  renameVaultPath,
  replaceTitle,
  waitForFile,
  waitForFileGone,
  writeTombstone,
} from './vault-helpers';

/**
 * Cross-device STRUCTURE in the running app.
 *
 * A "second device" writes to the shared vault: it renames a note file, moves a
 * note into another folder, retitles the same note concurrently, or appends a
 * delete tombstone. The running app must follow the new layout without losing
 * identity, content, or descendants.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
const BETA_ID = '44444444-4444-4444-8444-444444444444';
const WORK_ID = '88888888-8888-4888-8888-888888888888';
const DEEP_ID = '99999999-1111-4999-8999-999999999999';

test.use({ vaultSeed: 'vault' });

async function waitForTitle(
  window: Parameters<typeof getDocumentFromDb>[0],
  id: string,
  title: string,
): Promise<void> {
  await expect
    .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
    .toBe(title);
}

test.describe('cross-device structure — live propagation', () => {
  test('a rename from another device retitles the note and keeps its identity', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, ROADMAP_ID, 'Roadmap');

    renameVaultPath(vaultDir, 'Roadmap.md', 'Product Roadmap.md');

    await waitForTitle(window, ROADMAP_ID, 'Product Roadmap');
    expect((await getDocumentFromDb(window, ROADMAP_ID))!.id).toBe(ROADMAP_ID);
    expect(listMarkdown(vaultDir)).toContain('Product Roadmap.md');
    expect(listMarkdown(vaultDir)).not.toContain('Roadmap.md');
    await expect(noteItem(window, 'Product Roadmap')).toBeVisible();
  });

  test('renaming a parent folder on another device carries its whole subtree', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, PROJECTS_ID, 'Projects');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    fs.renameSync(path.join(vaultDir, 'Projects.md'), path.join(vaultDir, 'Archive.md'));
    fs.renameSync(path.join(vaultDir, 'Projects'), path.join(vaultDir, 'Archive'));

    await waitForTitle(window, PROJECTS_ID, 'Archive');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    await expect
      .poll(async () => (await getDocumentFromDb(window, BETA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    await waitForFile(path.join(vaultDir, 'Archive/Alpha.md'));
    await waitForFile(path.join(vaultDir, 'Archive/Beta.md'));
    await waitForFileGone(path.join(vaultDir, 'Projects.md'));
  });

  test('renaming a nested child keeps its parent link', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    renameVaultPath(vaultDir, 'Projects/Alpha.md', 'Projects/Alpha Renamed.md');

    await waitForTitle(window, ALPHA_ID, 'Alpha Renamed');
    expect((await getDocumentFromDb(window, ALPHA_ID))!.parentId).toBe(PROJECTS_ID);
    expect(listMarkdown(vaultDir)).toContain('Projects/Alpha Renamed.md');
  });

  test('a unicode retitle updates the tab and file name', async ({ window, vaultDir }) => {
    await waitForTitle(window, ROADMAP_ID, 'Roadmap');
    await noteItem(window, 'Roadmap').click();

    renameVaultPath(vaultDir, 'Roadmap.md', 'Café 日本 (draft).md');

    await waitForTitle(window, ROADMAP_ID, 'Café 日本 (draft)');
    await expect(
      window.locator('[data-tab-id]').filter({ hasText: 'Café 日本 (draft)' }),
    ).toHaveCount(1);
    await waitForFile(path.join(vaultDir, 'Café 日本 (draft).md'));
    await waitForFileGone(path.join(vaultDir, 'Roadmap.md'));
  });

  test('moving a note out to the root clears its parent', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    renameVaultPath(vaultDir, 'Projects/Alpha.md', 'Alpha.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBeNull();
    await waitForFile(path.join(vaultDir, 'Alpha.md'));
    await waitForFileGone(path.join(vaultDir, 'Projects/Alpha.md'));
  });
});

test.describe('cross-device structure — remote move target', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'Work.md': frontmatterNote({ id: WORK_ID, title: 'Work' }),
    },
  });

  test('a moved note lands under the new parent and leaves the old folder', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, WORK_ID, 'Work');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    renameVaultPath(vaultDir, 'Projects/Alpha.md', 'Work/Alpha.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(WORK_ID);
    await waitForFileGone(path.join(vaultDir, 'Projects/Alpha.md'));
    await waitForFile(path.join(vaultDir, 'Work/Alpha.md'));
    await expandFolder(window, 'Work');
    await expect(noteItem(window, 'Alpha')).toBeVisible();
  });

  test('moving a parent folder carries its whole subtree under the new parent', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, WORK_ID, 'Work');
    await expect
      .poll(async () => (await getDocumentFromDb(window, PROJECTS_ID))?.parentId, { timeout: 15_000 })
      .toBeNull();

    fs.mkdirSync(path.join(vaultDir, 'Work'), { recursive: true });
    fs.renameSync(path.join(vaultDir, 'Projects.md'), path.join(vaultDir, 'Work/Projects.md'));
    fs.renameSync(path.join(vaultDir, 'Projects'), path.join(vaultDir, 'Work/Projects'));

    await expect
      .poll(async () => (await getDocumentFromDb(window, PROJECTS_ID))?.parentId, { timeout: 15_000 })
      .toBe(WORK_ID);
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    await expect
      .poll(async () => (await getDocumentFromDb(window, BETA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    await waitForFile(path.join(vaultDir, 'Work/Projects/Alpha.md'));
    await waitForFile(path.join(vaultDir, 'Work/Projects/Beta.md'));
  });
});

test.describe('cross-device structure — concurrent renames', () => {
  test('the newest retitle wins and the losing duplicate is trashed on relaunch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    try {
      await waitForTitle(firstWindow, ROADMAP_ID, 'Roadmap');

      // This device retitles the note.
      await noteItem(firstWindow, 'Roadmap').click();
      await replaceTitle(firstWindow, 'App Rename');
      await waitForFile(path.join(vaultDir, 'App Rename.md'));

      // The other device's concurrent retitle arrives afterwards, newer.
      fs.writeFileSync(
        path.join(vaultDir, 'Device Rename.md'),
        frontmatterNote(
          {
            id: ROADMAP_ID,
            title: 'Device Rename',
            updated: '2030-01-01T00:00:00.000Z',
          },
          'body from device B',
        ),
      );

      await waitForTitle(firstWindow, ROADMAP_ID, 'Device Rename');
      // The live apply dedupes immediately: the losing retitle is trashed.
      expect(listMarkdown(vaultDir)).toContain('Device Rename.md');
      expect(listMarkdown(vaultDir)).not.toContain('App Rename.md');
      expect(listMarkdown(vaultDir, { trash: true })).toContain('App Rename.md');
    } finally {
      await first.close();
    }

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    try {
      await waitForTitle(secondWindow, ROADMAP_ID, 'Device Rename');
      expect(listMarkdown(vaultDir)).toContain('Device Rename.md');
      expect(listMarkdown(vaultDir)).not.toContain('App Rename.md');
      expect(listMarkdown(vaultDir, { trash: true })).toContain('App Rename.md');
      expect(
        (await listDocumentsFromDb(secondWindow)).filter((doc) => doc.id === ROADMAP_ID),
      ).toHaveLength(1);
      expect(readRaw(vaultDir, 'Device Rename.md')).toContain('body from device B');
    } finally {
      await second.close();
    }
  });
});

test.describe('cross-device structure — stale duplicate retitle', () => {
  test('an older retitle arriving late does not override a newer local rename', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, ROADMAP_ID, 'Roadmap');
    await noteItem(window, 'Roadmap').click();
    await replaceTitle(window, 'App Rename');
    await waitForFile(path.join(vaultDir, 'App Rename.md'));

    // Device B's older rename arrives late; the app's rename is newer.
    fs.writeFileSync(
      path.join(vaultDir, 'Stale Rename.md'),
      frontmatterNote(
        { id: ROADMAP_ID, title: 'Stale Rename', updated: '2020-01-01T00:00:00.000Z' },
        'stale body',
      ),
    );

    await window.waitForTimeout(2000);
    expect((await getDocumentFromDb(window, ROADMAP_ID))!.title).toBe('App Rename');
    expect(listMarkdown(vaultDir)).toContain('App Rename.md');
    expect(listMarkdown(vaultDir)).not.toContain('Stale Rename.md');
    expect(listMarkdown(vaultDir, { trash: true })).toContain('Stale Rename.md');
  });
});

test.describe('cross-device structure — subtree delete', () => {
  test('trashing a parent on another device trashes the whole subtree', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, PROJECTS_ID, 'Projects');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    // Device B trashed only the parent; its descendants are implied by the tree.
    writeTombstone(vaultDir, 'device-b', [
      { id: PROJECTS_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).map((doc) => doc.id).sort(),
        { timeout: 15_000 },
      )
      .toEqual([PROJECTS_ID, ALPHA_ID, BETA_ID].sort());
    await expect(noteItem(window, 'Projects')).toHaveCount(0);
    await expect(noteItem(window, 'Alpha')).toHaveCount(0);

    await waitForFile(path.join(vaultDir, '.trash', 'Projects.md'));
    await waitForFile(path.join(vaultDir, '.trash', 'Projects/Alpha.md'));
    await waitForFile(path.join(vaultDir, '.trash', 'Projects/Beta.md'));
    await waitForFileGone(path.join(vaultDir, 'Projects.md'));
  });

  test('restoring the parent on another device restores its subtree', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, PROJECTS_ID, 'Projects');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    writeTombstone(vaultDir, 'device-b', [
      { id: PROJECTS_ID, action: 'trash', at: new Date().toISOString() },
    ]);
    await waitForFile(path.join(vaultDir, '.trash', 'Projects/Alpha.md'));

    appendTombstone(vaultDir, 'device-b', [
      { id: PROJECTS_ID, action: 'restore', at: new Date(Date.now() + 1000).toISOString() },
    ]);

    await expect
      .poll(async () => (await listTrashedFromDb(window)).length, { timeout: 15_000 })
      .toBe(0);
    await waitForFile(path.join(vaultDir, 'Projects.md'));
    await waitForFile(path.join(vaultDir, 'Projects/Alpha.md'));
    await waitForFile(path.join(vaultDir, 'Projects/Beta.md'));
    await expect(noteItem(window, 'Projects')).toBeVisible();
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    await expect
      .poll(async () => (await getDocumentFromDb(window, BETA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
  });

  test('a child-only tombstone trashes the child but leaves the parent and sibling', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, PROJECTS_ID, 'Projects');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    writeTombstone(vaultDir, 'device-b', [
      { id: ALPHA_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect
      .poll(async () => (await listTrashedFromDb(window)).map((doc) => doc.id), { timeout: 15_000 })
      .toEqual([ALPHA_ID]);
    expect((await getDocumentFromDb(window, PROJECTS_ID))?.deletedAt).toBeNull();
    expect((await getDocumentFromDb(window, BETA_ID))?.deletedAt).toBeNull();
    await waitForFile(path.join(vaultDir, '.trash', 'Projects/Alpha.md'));
    await waitForFile(path.join(vaultDir, 'Projects.md'));
    await waitForFile(path.join(vaultDir, 'Projects/Beta.md'));
  });

  test('trashing the same parent on two devices is idempotent', async ({ window, vaultDir }) => {
    await waitForTitle(window, PROJECTS_ID, 'Projects');
    const at = new Date().toISOString();
    writeTombstone(vaultDir, 'device-b', [{ id: PROJECTS_ID, action: 'trash', at }]);
    await expect
      .poll(async () => (await listTrashedFromDb(window)).length, { timeout: 15_000 })
      .toBe(3);

    appendTombstone(vaultDir, 'device-c', [
      { id: PROJECTS_ID, action: 'trash', at: new Date(Date.now() + 1000).toISOString() },
    ]);
    await window.waitForTimeout(1500);

    expect((await listTrashedFromDb(window)).map((doc) => doc.id).sort()).toEqual(
      [PROJECTS_ID, ALPHA_ID, BETA_ID].sort(),
    );
    await waitForFile(path.join(vaultDir, '.trash', 'Projects.md'));
  });

  test('a parent edit newer than an unseen delete survives the tombstone', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, PROJECTS_ID, 'Projects');

    // Projects was last updated in 2024; this delete predates it. Roadmap gets a
    // current delete as a control proving the reconcile loop actually ran.
    writeTombstone(vaultDir, 'device-b', [
      { id: PROJECTS_ID, action: 'trash', at: '2020-01-01T00:00:00.000Z' },
      { id: ROADMAP_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect
      .poll(async () => (await listTrashedFromDb(window)).map((doc) => doc.id), { timeout: 15_000 })
      .toEqual([ROADMAP_ID]);
    expect((await getDocumentFromDb(window, PROJECTS_ID))?.deletedAt).toBeNull();
    expect((await getDocumentFromDb(window, ALPHA_ID))?.deletedAt).toBeNull();
    await waitForFile(path.join(vaultDir, 'Projects.md'));
  });
});

test.describe('cross-device structure — deep subtree', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'Projects/Alpha/Deep.md': frontmatterNote(
        { id: DEEP_ID, title: 'Deep' },
        'deep body',
      ),
    },
  });

  test('a tombstone for the top parent trashes and restores a three-level subtree', async ({
    window,
    vaultDir,
  }) => {
    await waitForTitle(window, PROJECTS_ID, 'Projects');
    await expect
      .poll(async () => (await getDocumentFromDb(window, DEEP_ID))?.parentId, { timeout: 15_000 })
      .toBe(ALPHA_ID);

    writeTombstone(vaultDir, 'device-b', [
      { id: PROJECTS_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect
      .poll(async () => (await listTrashedFromDb(window)).map((doc) => doc.id).sort(), {
        timeout: 15_000,
      })
      .toEqual([PROJECTS_ID, ALPHA_ID, BETA_ID, DEEP_ID].sort());
    await waitForFile(path.join(vaultDir, '.trash', 'Projects/Alpha/Deep.md'));

    appendTombstone(vaultDir, 'device-b', [
      { id: PROJECTS_ID, action: 'restore', at: new Date(Date.now() + 1000).toISOString() },
    ]);

    await expect
      .poll(async () => (await listTrashedFromDb(window)).length, { timeout: 15_000 })
      .toBe(0);
    await waitForFile(path.join(vaultDir, 'Projects/Alpha/Deep.md'));
  });
});
