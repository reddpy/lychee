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
  frontmatterNote,
  fileIdsOnDisk,
  listMarkdown,
  noteItem,
  replaceTitle,
  waitForFile,
} from './vault-helpers';

/**
 * Deep duplicate resolution: many copies, many folders, ties, blank winners,
 * repeated convergence, and post-convergence app edits. Convergence happens at
 * boot (`reconcileIndexFromVault`), so each test seeds one copy, launches to
 * create the note, adds rivals while closed, then relaunches.
 */

const DUP = 'f6000000-0000-4000-8000-000000000001';

async function launchAndWait(userDataDir: string, vaultDir: string, id: string) {
  const app = await launchLychee({ userDataDir, vaultDir });
  const window = await firstWindowReady(app);
  await expect
    .poll(async () => (await getDocumentFromDb(window, id)) != null, { timeout: 15_000 })
    .toBe(true);
  return { app, window };
}

function folderNote(id: string, title: string) {
  return frontmatterNote({ id, title }, 'folder');
}

test.describe('Duplicates — three folders', () => {
  test.use({
    vaultExtra: {
      'FA.md': folderNote('f7000000-0000-4000-8000-000000000001', 'FA'),
      'FB.md': folderNote('f7000000-0000-4000-8000-000000000002', 'FB'),
      'FC.md': folderNote('f7000000-0000-4000-8000-000000000003', 'FC'),
      'FA/copy.md': frontmatterNote(
        { id: DUP, title: 'Copy A', updated: '2024-01-01T00:00:00.000Z' },
        'a',
      ),
    },
  });

  test('a duplicate id across three folders keeps one and trashes two', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.mkdirSync(path.join(vaultDir, 'FB'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'FC'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'FB', 'copy.md'),
      frontmatterNote({ id: DUP, title: 'Copy B', updated: '2024-05-01T00:00:00.000Z' }, 'b'),
    );
    fs.writeFileSync(
      path.join(vaultDir, 'FC', 'copy.md'),
      frontmatterNote({ id: DUP, title: 'Copy C', updated: '2024-09-01T00:00:00.000Z' }, 'c'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUP))?.title, { timeout: 15_000 })
      .toBe('Copy C');
    expect((await listDocumentsFromDb(secondWindow)).filter((doc) => doc.id === DUP).length).toBe(1);
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === DUP).length).toBe(1);
    expect(fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === DUP).length).toBe(2);
    await second.close();
  });
});

test.describe('Duplicates — repeated convergence', () => {
  test.use({
    vaultExtra: {
      'repeat.md': frontmatterNote(
        { id: 'f8000000-0000-4000-8000-000000000001', title: 'Repeat', updated: '2024-01-01T00:00:00.000Z' },
        'v0',
      ),
    },
  });

  test('introducing a new rival each launch always converges to one note', async ({
    testDir,
    vaultDir,
  }) => {
    const id = 'f8000000-0000-4000-8000-000000000001';
    const userDataDir = path.join(testDir, 'userdata');
    const app = await launchAndWait(userDataDir, vaultDir, id);
    await app.app.close();

    for (let round = 1; round <= 2; round += 1) {
      fs.writeFileSync(
        path.join(vaultDir, `repeat-rival-${round}.md`),
        frontmatterNote(
          { id, title: `Repeat ${round}`, updated: `2024-0${round + 1}-01T00:00:00.000Z` },
          `v${round}`,
        ),
      );
      const relaunched = await launchLychee({ userDataDir, vaultDir });
      const w = await firstWindowReady(relaunched);
      await expect
        .poll(
          async () =>
            (await listDocumentsFromDb(w)).filter((doc) => doc.id === id).length,
          { timeout: 15_000 },
        )
        .toBe(1);
      await expect
        .poll(() => fileIdsOnDisk(vaultDir).filter((fid) => fid === id).length)
        .toBe(1);
      await relaunched.close();
    }
  });
});

test.describe('Duplicates — ties and blanks', () => {
  test.use({
    vaultExtra: {
      'tie-a.md': frontmatterNote(
        { id: 'f9000000-0000-4000-8000-000000000001', title: 'Tie A', updated: '2024-05-05T00:00:00.000Z' },
        'a',
      ),
    },
  });

  test('a duplicate id with identical timestamps still leaves one note', async ({
    testDir,
    vaultDir,
  }) => {
    const id = 'f9000000-0000-4000-8000-000000000001';
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, id);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'tie-b.md'),
      frontmatterNote({ id, title: 'Tie B', updated: '2024-05-05T00:00:00.000Z' }, 'b'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const w = await firstWindowReady(second);
    await expect
      .poll(async () => (await listDocumentsFromDb(w)).filter((doc) => doc.id === id).length, {
        timeout: 15_000,
      })
      .toBe(1);
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((fid) => fid === id).length).toBe(1);
    await second.close();
  });
});

test.describe('Duplicates — blank winner', () => {
  test.use({
    vaultExtra: {
      'Titled.md': frontmatterNote(
        { id: 'fa000000-0000-4000-8000-000000000001', title: 'Titled', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('a newer untitled copy wins and stays blank', async ({ testDir, vaultDir }) => {
    const id = 'fa000000-0000-4000-8000-000000000001';
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, id);
    await first.app.close();

    // The newer copy is the blank sentinel (no title).
    fs.writeFileSync(
      path.join(vaultDir, 'Untitled.md'),
      frontmatterNote({ id, updated: '2024-08-01T00:00:00.000Z' }, 'new'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const w = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(w, id))?.title, { timeout: 15_000 })
      .toBe('');
    await second.close();
  });
});

test.describe('Duplicates — app edit after convergence', () => {
  test.use({
    vaultExtra: {
      'Edit Dup.md': frontmatterNote(
        { id: 'fb000000-0000-4000-8000-000000000001', title: 'Edit Dup', updated: '2024-01-01T00:00:00.000Z' },
        'v1',
      ),
    },
  });

  test('renaming after convergence keeps exactly one file', async ({ window, vaultDir }) => {
    const id = 'fb000000-0000-4000-8000-000000000001';
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
      .toBe('Edit Dup');

    await noteItem(window, 'Edit Dup').click();
    await replaceTitle(window, 'Edit Renamed');
    await waitForFile(path.join(vaultDir, 'Edit Renamed.md'));

    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((fid) => fid === id).length).toBe(1);
    expect(listMarkdown(vaultDir).filter((rel) => rel.startsWith('Edit'))).toEqual([
      'Edit Renamed.md',
    ]);
  });
});
