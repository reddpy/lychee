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
  readTrashedNote,
  noteItem,
} from './vault-helpers';
import { serializeFrontmatter } from '../src/shared/frontmatter';

/**
 * Duplicate convergence hardening. Identity is the frontmatter id, and exactly
 * one live file per id must survive — deterministically, at boot and live, with
 * the newest content winning and the loser preserved in `.trash`. Each test
 * seeds one copy, launches to create the note, adds rivals while closed, then
 * relaunches (the boot reconcile chooses the winner).
 */

async function launchAndWait(userDataDir: string, vaultDir: string, id: string) {
  const app = await launchLychee({ userDataDir, vaultDir });
  const window = await firstWindowReady(app);
  await expect
    .poll(async () => (await getDocumentFromDb(window, id)) != null, { timeout: 15_000 })
    .toBe(true);
  return { app, window };
}

test.describe('Duplicates — many copies', () => {
  const DUP = 'f3000000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Many 0.md': frontmatterNote(
        { id: DUP, title: 'Many 0', updated: '2024-01-01T00:00:00.000Z' },
        'v0',
      ),
    },
  });

  test('five files with one id leave one live note and four trashed', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    for (let i = 1; i <= 4; i += 1) {
      fs.writeFileSync(
        path.join(vaultDir, `Many ${i}.md`),
        frontmatterNote(
          { id: DUP, title: `Many ${i}`, updated: `2024-0${i}-01T00:00:00.000Z` },
          `v${i}`,
        ),
      );
    }

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Many 4');
    expect((await listDocumentsFromDb(window)).filter((doc) => doc.id === DUP).length).toBe(1);
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === DUP).length).toBe(1);
    await expect
      .poll(() => fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === DUP).length, {
        timeout: 10_000,
      })
      .toBe(4);
    await second.close();
  });
});

test.describe('Duplicates — newer root beats older nested', () => {
  const FOLDER = 'f3100000-0000-4000-8000-000000000001';
  const DUP = 'f3100000-0000-4000-8000-000000000002';
  test.use({
    vaultExtra: {
      'Folder.md': frontmatterNote({ id: FOLDER, title: 'Folder' }, 'folder'),
      'Folder/Nested Old.md': frontmatterNote(
        { id: DUP, title: 'Nested Old', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('the newer root copy wins and detaches from the folder', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Root New.md'),
      frontmatterNote({ id: DUP, title: 'Root New', updated: '2024-09-01T00:00:00.000Z' }, 'new'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Root New');
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.parentId)
      .toBeNull();
    await second.close();
  });
});

test.describe('Duplicates — newest in its own folder', () => {
  const FOLDERA = 'f3200000-0000-4000-8000-000000000001';
  const FOLDB = 'f3200000-0000-4000-8000-000000000002';
  const DUP = 'f3200000-0000-4000-8000-000000000003';
  test.use({
    vaultExtra: {
      'FolderA.md': frontmatterNote({ id: FOLDERA, title: 'FolderA' }, 'a'),
      'FolderB.md': frontmatterNote({ id: FOLDB, title: 'FolderB' }, 'b'),
      'FolderA/A Copy.md': frontmatterNote(
        { id: DUP, title: 'A Copy', updated: '2024-02-01T00:00:00.000Z' },
        'a',
      ),
    },
  });

  test('the newest copy wins and stays in its folder', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.mkdirSync(path.join(vaultDir, 'FolderB'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'FolderB', 'B Copy.md'),
      frontmatterNote({ id: DUP, title: 'B Copy', updated: '2024-10-01T00:00:00.000Z' }, 'b'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('B Copy');
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.parentId)
      .toBe(FOLDB);
    await second.close();
  });
});

test.describe('Duplicates — timestamp edges', () => {
  const TIE = 'f3300000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Tie A.md': frontmatterNote(
        { id: TIE, title: 'Tie A', updated: '2024-05-05T00:00:00.000Z' },
        'a',
      ),
    },
  });

  test('a tie on `updated` still converges to one live and one trashed', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, TIE);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Tie B.md'),
      frontmatterNote({ id: TIE, title: 'Tie B', updated: '2024-05-05T00:00:00.000Z' }, 'b'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).filter((doc) => doc.id === TIE).length, {
        timeout: 15_000,
      })
      .toBe(1);
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === TIE).length).toBe(1);
    await expect
      .poll(() => fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === TIE).length, {
        timeout: 10_000,
      })
      .toBe(1);
    await second.close();
  });
});

test.describe('Duplicates — missing updated', () => {
  const DUP = 'f3400000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Stamped.md': frontmatterNote(
        { id: DUP, title: 'Stamped', updated: '2024-06-01T00:00:00.000Z' },
        'stamped',
      ),
    },
  });

  test('an unstamped copy loses to a stamped one', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    // No `updated`; the reconcile falls back to `created` (2024-01-01).
    fs.writeFileSync(
      path.join(vaultDir, 'Unstamped.md'),
      `${serializeFrontmatter({
        id: DUP,
        title: 'Unstamped',
        created: '2024-01-01T00:00:00.000Z',
        contentSchemaVersion: 1,
      })}\nunstamped`,
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Stamped');
    await second.close();
  });
});

test.describe('Duplicates — winner metadata', () => {
  const DUP = 'f3500000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Plain.md': frontmatterNote(
        { id: DUP, title: 'Plain', updated: '2024-01-01T00:00:00.000Z' },
        'plain',
      ),
    },
  });

  test('the winner’s emoji, bookmark, and order are adopted', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Fancy.md'),
      frontmatterNote(
        {
          id: DUP,
          title: 'Fancy',
          emoji: '🌈',
          bookmarked: '2024-11-11T00:00:00.000Z',
          order: 3,
          updated: '2024-11-01T00:00:00.000Z',
        },
        'fancy',
      ),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.emoji, { timeout: 15_000 })
      .toBe('🌈');
    expect((await getDocumentFromDb(window, DUP))!.metadata.bookmarkedAt).toBe(
      '2024-11-11T00:00:00.000Z',
    );
    expect((await getDocumentFromDb(window, DUP))!.sortOrder).toBe(3);
    await second.close();
  });
});

test.describe('Duplicates — blank vs titled', () => {
  const DUP = 'f3600000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Untitled.md': frontmatterNote(
        { id: DUP, updated: '2024-01-01T00:00:00.000Z' },
        'blank old',
      ),
    },
  });

  test('a newer titled copy beats an older untitled copy', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Now Titled.md'),
      frontmatterNote({ id: DUP, title: 'Now Titled', updated: '2024-12-01T00:00:00.000Z' }, 'new'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Now Titled');
    await second.close();
  });
});

test.describe('Duplicates — the loser is preserved', () => {
  const DUP = 'f3700000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Keep Old.md': frontmatterNote(
        { id: DUP, title: 'Keep Old', updated: '2024-01-01T00:00:00.000Z' },
        'old body',
      ),
    },
  });

  test('the losing file moves to .trash with its content intact', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Keep New.md'),
      frontmatterNote({ id: DUP, title: 'Keep New', updated: '2024-12-15T00:00:00.000Z' }, 'new body'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Keep New');

    await expect
      .poll(() => listMarkdown(vaultDir, { trash: true }).includes('Keep Old.md'), {
        timeout: 10_000,
      })
      .toBe(true);
    const trashed = listMarkdown(vaultDir, { trash: true }).filter(
      (rel) => readTrashedNote(vaultDir, rel).data.id === DUP,
    );
    expect(trashed).toContain('Keep Old.md');
    expect(readTrashedNote(vaultDir, 'Keep Old.md').body).toContain('old body');
    await second.close();
  });
});

test.describe('Duplicates — live rival', () => {
  const FOLDER = 'f3800000-0000-4000-8000-000000000001';
  const DUP = 'f3800000-0000-4000-8000-000000000002';
  test.use({
    vaultExtra: {
      'Pkg.md': frontmatterNote({ id: FOLDER, title: 'Pkg' }, 'pkg'),
      'Pkg/Child Old.md': frontmatterNote(
        { id: DUP, title: 'Child Old', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('a live rival at the root reparents and replaces the note', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.parentId, { timeout: 15_000 })
      .toBe(FOLDER);

    fs.writeFileSync(
      path.join(vaultDir, 'Child New.md'),
      frontmatterNote({ id: DUP, title: 'Child New', updated: '2099-01-01T00:00:00.000Z' }, 'new'),
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Child New');
    await expect.poll(async () => (await getDocumentFromDb(window, DUP))?.parentId).toBeNull();
    await expect.poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === DUP).length).toBe(1);
  });
});

test.describe('Duplicates — trash copies ignored', () => {
  const DUP = 'f3900000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Live Copy.md': frontmatterNote(
        { id: DUP, title: 'Live Copy', updated: '2024-01-01T00:00:00.000Z' },
        'live',
      ),
    },
  });

  test('a same-id file inside .trash is not considered a rival', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.mkdirSync(path.join(vaultDir, '.trash'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, '.trash', 'old.md'),
      frontmatterNote({ id: DUP, title: 'Trashed Rival', updated: '2024-12-01T00:00:00.000Z' }, 't'),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Live Copy');
    expect(listMarkdown(vaultDir)).toContain('Live Copy.md');
    expect(listMarkdown(vaultDir, { trash: true })).toContain('old.md');
    await second.close();
  });
});

test.describe('Duplicates — convergence durability', () => {
  const DUP = 'f3a00000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Dur Old.md': frontmatterNote(
        { id: DUP, title: 'Dur Old', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('the loser stays trashed after a second relaunch', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchAndWait(userDataDir, vaultDir, DUP);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Dur New.md'),
      frontmatterNote({ id: DUP, title: 'Dur New', updated: '2024-12-01T00:00:00.000Z' }, 'new'),
    );

    let app = await launchLychee({ userDataDir, vaultDir });
    let window = await firstWindowReady(app);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Dur New');
    await app.close();

    app = await launchLychee({ userDataDir, vaultDir });
    window = await firstWindowReady(app);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Dur New');
    expect(fileIdsOnDisk(vaultDir).filter((id) => id === DUP).length).toBe(1);
    expect(fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === DUP).length).toBe(1);
    await app.close();
  });
});

test.describe('Duplicates — tab consistency', () => {
  const DUP = 'f3b00000-0000-4000-8000-000000000001';
  test.use({
    vaultExtra: {
      'Tab Old.md': frontmatterNote(
        { id: DUP, title: 'Tab Old', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('an open tab shows the winner after live convergence', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Tab Old');
    await noteItem(window, 'Tab Old').click();
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Tab Old' })).toHaveCount(1);

    fs.writeFileSync(
      path.join(vaultDir, 'Tab New.md'),
      frontmatterNote({ id: DUP, title: 'Tab New', updated: '2099-01-01T00:00:00.000Z' }, 'new'),
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, DUP))?.title, { timeout: 15_000 })
      .toBe('Tab New');
    // Still exactly one tab or the old one closed — never two for one id.
    await expect
      .poll(async () => window.locator('[data-tab-id]').filter({ hasText: 'Tab New' }).count(), {
        timeout: 10_000,
      })
      .toBe(1);
  });
});
