import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  listTrashedFromDb,
  getDocumentFromDb,
} from './electron-app';
import {
  frontmatterNote,
  writeTombstone,
  renameVaultPath,
  listMarkdown,
  waitForFile,
  waitForFileGone,
} from './vault-helpers';

/**
 * Cross-device tombstones × renames. A tombstone must win over a rename of the
 * same id, and applying a tombstone locally must move files exactly like the
 * local trash/restore does, so the DB and vault never disagree.
 */

const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';
const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DEVICE = 'device-other-0002';

test.use({
  vaultSeed: 'vault',
  vaultExtra: { '.lychee/tombstones/seed.jsonl': '' },
});

test.describe('Tombstones × renames', () => {
  test('a trash tombstone moves the file into .trash', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: BOOKMARKED_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID),
        { timeout: 15_000 },
      )
      .toBe(true);
    await waitForFile(path.join(vaultDir, '.trash', 'Bookmarked.md'));
    await waitForFileGone(path.join(vaultDir, 'Bookmarked.md'));
  });

  test('a re-added file with the same id does not resurrect a trashed note', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: BOOKMARKED_ID, action: 'trash', at: new Date().toISOString() },
    ]);
    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID),
        { timeout: 15_000 },
      )
      .toBe(true);

    // A stale copy reappears (e.g. a sync re-added it) — the tombstone wins.
    fs.writeFileSync(
      path.join(vaultDir, 'Bookmarked.md'),
      frontmatterNote(
        { id: BOOKMARKED_ID, title: 'Bookmarked', updated: '2024-01-02T00:00:00.000Z' },
        'stale',
      ),
    );
    await window.waitForTimeout(1500);
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID)).toBe(false);
    expect((await listTrashedFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID)).toBe(true);
  });

  test('a restore tombstone brings the note and its file back', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: BOOKMARKED_ID, action: 'trash', at: '2026-01-01T00:00:00.000Z' },
    ]);
    await waitForFile(path.join(vaultDir, '.trash', 'Bookmarked.md'));

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: BOOKMARKED_ID, action: 'trash', at: '2026-01-01T00:00:00.000Z' },
      { id: BOOKMARKED_ID, action: 'restore', at: '2099-01-01T00:00:00.000Z' },
    ]);

    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.deletedAt, {
        timeout: 15_000,
      })
      .toBeNull();
    await waitForFile(path.join(vaultDir, 'Bookmarked.md'));
    expect(listMarkdown(vaultDir, { trash: true })).not.toContain('Bookmarked.md');
  });

  test('an older trash tombstone does not override a newer edit or a rename', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: ROADMAP_ID, action: 'trash', at: '2020-01-01T00:00:00.000Z' },
    ]);
    await window.waitForTimeout(1200);
    expect((await getDocumentFromDb(window, ROADMAP_ID))?.deletedAt).toBeNull();

    renameVaultPath(vaultDir, 'Roadmap.md', 'Product Plan.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Product Plan');
    expect((await getDocumentFromDb(window, ROADMAP_ID))!.deletedAt).toBeNull();
  });

  test('a rename before a trash tombstone is respected (file goes to .trash under the new name)', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    renameVaultPath(vaultDir, 'Bookmarked.md', 'Journal.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Journal');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: BOOKMARKED_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await waitForFile(path.join(vaultDir, '.trash', 'Journal.md'));
    await waitForFileGone(path.join(vaultDir, 'Journal.md'));
  });

  test('restoring after the .trash file was renamed recreates the canonical file', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: BOOKMARKED_ID, action: 'trash', at: '2026-01-01T00:00:00.000Z' },
    ]);
    await waitForFile(path.join(vaultDir, '.trash', 'Bookmarked.md'));

    // The trashed file is renamed out from under us (e.g. a file manager).
    fs.renameSync(
      path.join(vaultDir, '.trash', 'Bookmarked.md'),
      path.join(vaultDir, '.trash', 'Journal.md'),
    );

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: BOOKMARKED_ID, action: 'trash', at: '2026-01-01T00:00:00.000Z' },
      { id: BOOKMARKED_ID, action: 'restore', at: '2099-01-01T00:00:00.000Z' },
    ]);

    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.deletedAt, {
        timeout: 15_000,
      })
      .toBeNull();
    // Restore rewrites the canonical file even though the trash copy is gone.
    await waitForFile(path.join(vaultDir, 'Bookmarked.md'));
  });

  test('a purge tombstone after a rename trashes the file under the new name', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    renameVaultPath(vaultDir, 'Bookmarked.md', 'Journal.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Journal');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: BOOKMARKED_ID, action: 'purge', at: new Date().toISOString() },
    ]);

    await waitForFile(path.join(vaultDir, '.trash', 'Journal.md'));
    await waitForFileGone(path.join(vaultDir, 'Journal.md'));
    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID),
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
