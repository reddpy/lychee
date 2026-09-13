import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import {
  createNote,
  replaceTitle,
  clearTitle,
  typeInBody,
  commitSaves,
  moveViaIpc,
  listMarkdown,
  readNote,
  waitForFile,
  waitForFileGone,
  waitForContent,
  noteItem,
} from './vault-helpers';

/**
 * Lychee → OS. App actions must be reflected on disk (frontmatter + filenames).
 * Runs against a hermetic empty vault.
 */

test.describe('Lychee → OS — app writes files', () => {
  test('creating a note writes a markdown file with stable frontmatter', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Written Note');
    await waitForFile(path.join(vaultDir, 'Written Note.md'));

    const { data } = readNote(vaultDir, 'Written Note.md');
    expect(data.id).toBeTruthy();
    expect(data.title).toBe('Written Note');
  });

  test('renaming to a Unicode title renames the file', async ({ window, vaultDir }) => {
    await createNote(window, 'Ascii Name');
    await waitForFile(path.join(vaultDir, 'Ascii Name.md'));

    await replaceTitle(window, 'Café 東京');
    await waitForFile(path.join(vaultDir, 'Café 東京.md'));
    await waitForFileGone(path.join(vaultDir, 'Ascii Name.md'));

    expect(readNote(vaultDir, 'Café 東京.md').data.title).toBe('Café 東京');
  });

  test('clearing the title names the file Untitled.md', async ({ window, vaultDir }) => {
    await createNote(window, 'Temporary Name');
    await waitForFile(path.join(vaultDir, 'Temporary Name.md'));

    await clearTitle(window);
    await waitForFile(path.join(vaultDir, 'Untitled.md'));
    await waitForFileGone(path.join(vaultDir, 'Temporary Name.md'));

    expect(readNote(vaultDir, 'Untitled.md').data.id).toBeTruthy();
  });

  test('bookmarking writes the bookmarked frontmatter', async ({ window, vaultDir }) => {
    await createNote(window, 'Bookmark Me');
    await waitForFile(path.join(vaultDir, 'Bookmark Me.md'));
    const id = (await listDocumentsFromDb(window)).find((doc) => doc.title === 'Bookmark Me')!.id;

    const button = window.locator('main:visible').getByRole('button', {
      name: 'Bookmark this note',
    });
    await expect(button).toBeVisible({ timeout: 5000 });
    await button.click();

    // Persisted first (source of truth)…
    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(window)).find((doc) => doc.id === id)?.metadata
            ?.bookmarkedAt ?? null,
        { timeout: 5000 },
      )
      .toBeTruthy();
    // …then reflected in the UI…
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Remove bookmark' }),
    ).toBeVisible({ timeout: 5000 });

    // …and on disk.
    await waitForContent(vaultDir, 'Bookmark Me.md', 'bookmarked:');
  });

  test('body edits are written to the markdown file', async ({ window, vaultDir }) => {
    await createNote(window, 'Body Note');
    await waitForFile(path.join(vaultDir, 'Body Note.md'));

    await typeInBody(window, 'hello markdown body');
    await commitSaves(window);
    await waitForContent(vaultDir, 'Body Note.md', 'hello markdown body');
  });

  test('reordering siblings writes order into frontmatter', async ({ window, vaultDir }) => {
    await createNote(window, 'Order One');
    await createNote(window, 'Order Two');
    await createNote(window, 'Order Three');
    await waitForFile(path.join(vaultDir, 'Order One.md'));
    await waitForFile(path.join(vaultDir, 'Order Two.md'));
    await waitForFile(path.join(vaultDir, 'Order Three.md'));

    const docs = await listDocumentsFromDb(window);
    const third = docs.find((doc) => doc.title === 'Order Three')!;
    await moveViaIpc(window, third.id, null, 0);

    await waitForContent(vaultDir, 'Order Three.md', 'order: 0');
    const orders = ['Order One.md', 'Order Two.md', 'Order Three.md']
      .map((name) => readNote(vaultDir, name).data.order)
      .sort();
    expect(orders).toEqual([0, 1, 2]);
  });

  test('notes persist across a relaunch', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await createNote(firstWindow, 'Persisted Note');
    await waitForFile(path.join(vaultDir, 'Persisted Note.md'));
    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect(noteItem(secondWindow, 'Persisted Note')).toBeVisible();
    await expect
      .poll(async () =>
        (await listDocumentsFromDb(secondWindow)).some((doc) => doc.title === 'Persisted Note'),
      )
      .toBe(true);
    expect(listMarkdown(vaultDir)).toContain('Persisted Note.md');
    await second.close();
  });
});
