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
  renameVaultPath,
} from './vault-helpers';

/**
 * Duplicate resolution. Identity is the frontmatter id, so two files claiming
 * the same id must converge to exactly one note — deterministically, on disk
 * and in the DB. Duplicate *titles* (different ids) must coexist.
 *
 * The convergence happens at boot (`reconcileIndexFromVault`), so each test
 * seeds one copy, launches to create the note, adds rivals while closed, then
 * relaunches and asserts the winner.
 */

const DUP = 'd1000000-0000-4000-8000-000000000001';
const DUP2 = 'd1000000-0000-4000-8000-000000000002';
const DUP3 = 'd1000000-0000-4000-8000-000000000003';
const FOLDER = 'd2000000-0000-4000-8000-000000000001';
const LIVE = 'd4000000-0000-4000-8000-000000000001';

async function launchAndWait(userDataDir: string, vaultDir: string, id: string) {
  const app = await launchLychee({ userDataDir, vaultDir });
  const window = await firstWindowReady(app);
  await expect
    .poll(async () => (await getDocumentFromDb(window, id)) != null, { timeout: 15_000 })
    .toBe(true);
  return { app, window };
}

test.describe('Duplicate resolution', () => {
  test.use({
    vaultExtra: {
      'dup-old.md': frontmatterNote(
        { id: DUP, title: 'Dup Old', updated: '2024-05-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('two files sharing an id converge to the newest, stale file trashed', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'dup-new.md'),
      frontmatterNote({ id: DUP, title: 'Dup New', updated: '2024-06-01T00:00:00.000Z' }, 'new'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUP))?.title, { timeout: 15_000 })
      .toBe('Dup New');
    expect((await listDocumentsFromDb(secondWindow)).filter((doc) => doc.id === DUP).length).toBe(1);
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === DUP).length).toBe(1);
    await expect
      .poll(() => fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === DUP).length, {
        timeout: 10_000,
      })
      .toBe(1);
    await second.close();
  });
});

test.describe('Duplicate resolution — three copies', () => {
  test.use({
    vaultExtra: {
      'tri-a.md': frontmatterNote({ id: DUP2, title: 'Tri A', updated: '2024-03-01T00:00:00.000Z' }, 'a'),
    },
  });

  test('three files with one id leave a single live note', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP2);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'tri-b.md'),
      frontmatterNote({ id: DUP2, title: 'Tri B', updated: '2024-07-01T00:00:00.000Z' }, 'b'),
    );
    fs.writeFileSync(
      path.join(vaultDir, 'tri-c.md'),
      frontmatterNote({ id: DUP2, title: 'Tri C', updated: '2024-05-01T00:00:00.000Z' }, 'c'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUP2))?.title, { timeout: 15_000 })
      .toBe('Tri B');
    expect((await listDocumentsFromDb(secondWindow)).filter((doc) => doc.id === DUP2).length).toBe(1);
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === DUP2).length).toBe(1);
    await expect
      .poll(() => fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === DUP2).length, {
        timeout: 10_000,
      })
      .toBe(2);
    await second.close();
  });
});

test.describe('Duplicate resolution — nested wins', () => {
  test.use({
    vaultExtra: {
      'folder.md': frontmatterNote({ id: FOLDER, title: 'Folder' }, 'folder'),
      'root-copy.md': frontmatterNote(
        { id: DUP3, title: 'Root Copy', updated: '2024-04-01T00:00:00.000Z' },
        'root',
      ),
    },
  });

  test('a nested copy can win over a root copy and keeps its folder', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP3);
    await first.app.close();

    fs.mkdirSync(path.join(vaultDir, 'Folder'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'Folder', 'nested-copy.md'),
      frontmatterNote(
        { id: DUP3, title: 'Nested Copy', updated: '2024-08-01T00:00:00.000Z' },
        'nested',
      ),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUP3))?.title, { timeout: 15_000 })
      .toBe('Nested Copy');
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUP3))?.parentId)
      .toBe(FOLDER);
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === DUP3).length).toBe(1);
    await second.close();
  });
});

test.describe('Duplicate resolution — two folders', () => {
  test.use({
    vaultExtra: {
      'FolderA.md': frontmatterNote(
        { id: 'd5000000-0000-4000-8000-000000000001', title: 'FolderA' },
        'a',
      ),
      'FolderB.md': frontmatterNote(
        { id: 'd5000000-0000-4000-8000-000000000002', title: 'FolderB' },
        'b',
      ),
      'FolderA/copy.md': frontmatterNote(
        {
          id: 'd6000000-0000-4000-8000-000000000001',
          title: 'Copy Old',
          updated: '2024-04-01T00:00:00.000Z',
        },
        'old',
      ),
    },
  });

  test('a duplicate id in two folders keeps the newest and its folder', async ({
    testDir,
    vaultDir,
  }) => {
    const FOLDB = 'd5000000-0000-4000-8000-000000000002';
    const DUPX = 'd6000000-0000-4000-8000-000000000001';
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUPX);
    await first.app.close();

    fs.mkdirSync(path.join(vaultDir, 'FolderB'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'FolderB', 'copy.md'),
      frontmatterNote({ id: DUPX, title: 'Copy New', updated: '2024-08-01T00:00:00.000Z' }, 'new'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUPX))?.title, { timeout: 15_000 })
      .toBe('Copy New');
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUPX))?.parentId)
      .toBe(FOLDB);
    expect((await listDocumentsFromDb(secondWindow)).filter((doc) => doc.id === DUPX).length).toBe(1);
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === DUPX).length).toBe(1);
    expect(fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === DUPX).length).toBe(1);
    await second.close();
  });
});

test.describe('Duplicate resolution — uppercase extension', () => {
  test.use({
    vaultExtra: {
      'Upper.MD': frontmatterNote(
        {
          id: 'd7000000-0000-4000-8000-000000000001',
          title: 'Upper Old',
          updated: '2024-03-01T00:00:00.000Z',
        },
        'old',
      ),
    },
  });

  test('a duplicate id with .MD files converges like .md', async ({ testDir, vaultDir }) => {
    const DUPY = 'd7000000-0000-4000-8000-000000000001';
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUPY);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Upper2.MD'),
      frontmatterNote({ id: DUPY, title: 'Upper New', updated: '2024-06-01T00:00:00.000Z' }, 'new'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, DUPY))?.title, { timeout: 15_000 })
      .toBe('Upper New');
    expect((await listDocumentsFromDb(secondWindow)).filter((doc) => doc.id === DUPY).length).toBe(1);
    await second.close();
  });
});

test.describe('Duplicate resolution — live', () => {
  test.use({
    vaultExtra: {
      'live-a.md': frontmatterNote(
        { id: LIVE, title: 'Live A', updated: '2024-05-01T00:00:00.000Z' },
        'a',
      ),
    },
  });

  test('a second file claiming an id added while running leaves one file', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LIVE))?.title, { timeout: 15_000 })
      .toBe('Live A');

    fs.writeFileSync(
      path.join(vaultDir, 'live-b.md'),
      frontmatterNote({ id: LIVE, title: 'Live B', updated: '2024-07-01T00:00:00.000Z' }, 'b'),
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, LIVE))?.title, { timeout: 15_000 })
      .toBe('Live B');
    // The file's timestamp is adopted, not stamped with "now".
    expect((await getDocumentFromDb(window, LIVE))!.updatedAt).toBe('2024-07-01T00:00:00.000Z');
    // Exactly one file remains live; the rival was moved to .trash.
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === LIVE).length).toBe(1);
    expect(fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === LIVE).length).toBe(1);
    expect((await listDocumentsFromDb(window)).filter((doc) => doc.id === LIVE).length).toBe(1);
  });
});

test.describe('Duplicate titles (distinct ids) coexist', () => {
  test.use({ vaultSeed: 'vault' });

  test('an external file with an existing id is a move, not a duplicate', async ({
    window,
    vaultDir,
  }) => {
    const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');

    // Same id, new filename/content → adopt as the same note.
    fs.writeFileSync(
      path.join(vaultDir, 'Roadmap Moved.md'),
      frontmatterNote({ id: ROADMAP_ID, title: 'Roadmap Moved' }, 'moved body'),
    );

    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(window)).filter((doc) => doc.id === ROADMAP_ID).length,
        { timeout: 15_000 },
      )
      .toBe(1);
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title)
      .toBe('Roadmap Moved');
  });

  test('renaming one of two same-titled notes retitles only that note', async ({
    window,
    vaultDir,
  }) => {
    const a = 'd3000000-0000-4000-8000-000000000001';
    const b = 'd3000000-0000-4000-8000-000000000002';
    fs.writeFileSync(path.join(vaultDir, 'same-a.md'), frontmatterNote({ id: a, title: 'Same' }, 'a'));
    fs.writeFileSync(path.join(vaultDir, 'same-b.md'), frontmatterNote({ id: b, title: 'Same' }, 'b'));

    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(window)).filter((doc) => doc.title === 'Same').length,
        { timeout: 15_000 },
      )
      .toBe(2);

    renameVaultPath(vaultDir, 'same-a.md', 'Same Renamed.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, a))?.title, { timeout: 15_000 })
      .toBe('Same Renamed');
    // The other note is untouched.
    expect((await getDocumentFromDb(window, b))!.title).toBe('Same');
    expect(listMarkdown(vaultDir).some((rel) => rel.includes('Same Renamed'))).toBe(true);
  });
});
