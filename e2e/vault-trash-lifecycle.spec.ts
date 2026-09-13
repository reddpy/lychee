import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  listTrashedFromDb,
  getDocumentFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import {
  createNote,
  noteItem,
  trashViaMenu,
  openTrashBin,
  restoreFirstFromTrash,
  permanentlyDeleteFirstFromTrash,
  listMarkdown,
  waitForFile,
  waitForFileGone,
} from './vault-helpers';

/**
 * Trash lifecycle: trash → file to `.trash` + tombstone; restore → file back;
 * permanent delete → purged. Includes the "my file vanished" recovery path.
 */

const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
const BETA_ID = '44444444-4444-4444-8444-444444444444';
const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';

function tombstoneText(vaultDir: string): string {
  const dir = path.join(vaultDir, '.lychee', 'tombstones');
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');
}

test.describe('Trash lifecycle (seeded)', () => {
  test.use({ vaultSeed: 'vault' });

  test('trashing moves the file to .trash, records a tombstone, and hides the note', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    await trashViaMenu(window, 'Bookmarked');

    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID),
        { timeout: 15_000 },
      )
      .toBe(true);
    await waitForFile(path.join(vaultDir, '.trash', 'Bookmarked.md'));
    await waitForFileGone(path.join(vaultDir, 'Bookmarked.md'));
    expect(listMarkdown(vaultDir)).not.toContain('Bookmarked.md');
    expect(tombstoneText(vaultDir)).toContain(BOOKMARKED_ID);
    expect(tombstoneText(vaultDir)).toContain('"action":"trash"');
  });

  test('restoring returns the file to the vault and the note to the sidebar', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);
    await trashViaMenu(window, 'Bookmarked');
    await waitForFile(path.join(vaultDir, '.trash', 'Bookmarked.md'));

    await openTrashBin(window);
    await restoreFirstFromTrash(window);

    await waitForFile(path.join(vaultDir, 'Bookmarked.md'));
    await waitForFileGone(path.join(vaultDir, '.trash', 'Bookmarked.md'));
    await expect(noteItem(window, 'Bookmarked')).toBeVisible();
  });

  test('permanent delete removes the file from .trash', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);
    await trashViaMenu(window, 'Bookmarked');
    await waitForFile(path.join(vaultDir, '.trash', 'Bookmarked.md'));

    await openTrashBin(window);
    await permanentlyDeleteFirstFromTrash(window);

    await waitForFileGone(path.join(vaultDir, '.trash', 'Bookmarked.md'));
    expect(listMarkdown(vaultDir, { trash: true })).toEqual([]);
    expect((await listTrashedFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID)).toBe(false);
  });

  test('trashing a parent moves its whole subtree to .trash', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    await trashViaMenu(window, 'Projects');

    await waitForFile(path.join(vaultDir, '.trash', 'Projects.md'));
    await waitForFile(path.join(vaultDir, '.trash', 'Projects/Alpha.md'));
    await waitForFile(path.join(vaultDir, '.trash', 'Projects/Beta.md'));
    await waitForFileGone(path.join(vaultDir, 'Projects.md'));

    const trashed = new Set((await listTrashedFromDb(window)).map((doc) => doc.id));
    expect(trashed.has(PROJECTS_ID)).toBe(true);
    expect(trashed.has(ALPHA_ID)).toBe(true);
    expect(trashed.has(BETA_ID)).toBe(true);
  });

  test('restoring a parent brings its subtree back', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    await trashViaMenu(window, 'Projects');
    await waitForFile(path.join(vaultDir, '.trash', 'Projects/Alpha.md'));

    await openTrashBin(window);
    await restoreFirstFromTrash(window);

    await waitForFile(path.join(vaultDir, 'Projects.md'));
    await waitForFile(path.join(vaultDir, 'Projects/Alpha.md'));
    await waitForFile(path.join(vaultDir, 'Projects/Beta.md'));
    await expect(noteItem(window, 'Projects')).toBeVisible();
  });

  test('a trashed note stays trashed across relaunch', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await listDocumentsFromDb(firstWindow)).length, { timeout: 15_000 })
      .toBe(7);
    await trashViaMenu(firstWindow, 'Bookmarked');
    await waitForFile(path.join(vaultDir, '.trash', 'Bookmarked.md'));
    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(
        async () => (await listTrashedFromDb(secondWindow)).some((doc) => doc.id === BOOKMARKED_ID),
        { timeout: 15_000 },
      )
      .toBe(true);
    expect((await listDocumentsFromDb(secondWindow)).some((doc) => doc.id === BOOKMARKED_ID)).toBe(false);
    await second.close();
  });

  test('restoring a note whose file was deleted from .trash recreates the file', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Ghost Note');
    await waitForFile(path.join(vaultDir, 'Ghost Note.md'));
    const id = (await listDocumentsFromDb(window)).find((doc) => doc.title === 'Ghost Note')!.id;

    await trashViaMenu(window, 'Ghost Note');
    await waitForFile(path.join(vaultDir, '.trash', 'Ghost Note.md'));
    // Simulate the file being lost entirely.
    fs.rmSync(path.join(vaultDir, '.trash', 'Ghost Note.md'));

    await openTrashBin(window);
    await restoreFirstFromTrash(window);

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.deletedAt, { timeout: 15_000 })
      .toBeNull();
    // A live note must always have a file; the restore rewrites it.
    await waitForFile(path.join(vaultDir, 'Ghost Note.md'));
  });
});
