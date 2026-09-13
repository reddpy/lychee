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
  listMarkdown,
  writeNote,
  deleteVaultPath,
  renameVaultPath,
  noteItem,
  visibleTitle,
} from './vault-helpers';

/**
 * Vault CRUD from the OS.
 *
 * These run against the hermetic fixture vault (`e2e/fixtures/vault`, copied into
 * a temp dir per test) and never touch the user's real ~/Documents/Lychee. They
 * cover both directions:
 *   - startup import of a pre-populated vault (regression: main started the
 *     watcher before the renderer bridge existed, so files were never imported),
 *   - live OS → Lychee mutations (create/edit/rename/move/delete),
 *   - app → OS writes are covered in stage4-file-operations.spec.ts.
 */

test.use({ vaultSeed: 'vault' });

// Ids fixed in e2e/fixtures/vault.
const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
const BETA_ID = '44444444-4444-4444-8444-444444444444';
const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';
const UNTITLED_ID = '66666666-6666-4666-8666-666666666666';
const LEGACY_ID = '77777777-7777-4777-8777-777777777777';
const CONFLICT_ID = '99999999-9999-4999-8999-999999999999';

const SEEDED_IDS = [
  ROADMAP_ID,
  PROJECTS_ID,
  ALPHA_ID,
  BETA_ID,
  BOOKMARKED_ID,
  UNTITLED_ID,
  LEGACY_ID,
];

async function waitForDocument(
  window: Parameters<typeof getDocumentFromDb>[0],
  id: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getDocumentFromDb>>>> {
  await expect
    .poll(async () => (await getDocumentFromDb(window, id)) != null, { timeout: 15_000 })
    .toBe(true);
  return (await getDocumentFromDb(window, id))!;
}

test.describe('Vault startup import (seeded fixture)', () => {
  test('imports every valid note on launch', async ({ window }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(SEEDED_IDS.length);

    const ids = new Set((await listDocumentsFromDb(window)).map((doc) => doc.id));
    for (const id of SEEDED_IDS) expect(ids.has(id)).toBe(true);

    for (const title of ['Roadmap', 'Projects', 'Bookmarked', 'Legacy']) {
      await expect(noteItem(window, title)).toBeVisible();
    }
    // Nested notes live under a collapsible folder node.
    await noteItem(window, 'Projects').locator('[aria-label="Expand"]').click();
    await expect(noteItem(window, 'Alpha')).toBeVisible();
    await expect(noteItem(window, 'Beta')).toBeVisible();
    // The untitled note displays the canonical fallback label.
    await expect(noteItem(window, 'New Note')).toBeVisible();
  });

  test('imports files added while the app was closed on the next launch', async ({
    testDir,
    vaultDir,
  }) => {
    // The second launch is the regression case: `vaultWatchEnabled` is already
    // true, so main starts the watcher before the renderer bridge exists. Those
    // early import events must not be lost.
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await listDocumentsFromDb(firstWindow)).length, { timeout: 15_000 })
      .toBe(SEEDED_IDS.length);
    await first.close();

    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    writeNote(vaultDir, 'Offline Add.md', { id, title: 'Offline Add' }, 'added while closed');

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, id))?.title, { timeout: 15_000 })
      .toBe('Offline Add');
    await second.close();
  });

  test('ignores plain markdown without an id and conflict copies', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(SEEDED_IDS.length);

    const docs = await listDocumentsFromDb(window);
    expect(docs.some((doc) => doc.id === CONFLICT_ID)).toBe(false);
    expect(docs.some((doc) => doc.title === 'plain')).toBe(false);
    // The app must not delete an unrelated file it chose to ignore.
    expect(listMarkdown(vaultDir)).toContain('plain.md');
    expect(listMarkdown(vaultDir)).toContain('Roadmap (conflict 2024-01-01 00-00-00).md');
  });

  test('parents folder children to their folder note regardless of scan order', async ({
    window,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    await expect
      .poll(async () => (await getDocumentFromDb(window, BETA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    expect((await getDocumentFromDb(window, ROADMAP_ID))!.parentId).toBeNull();
  });

  test('keeps a blank note blank and shows the New Note placeholder', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, UNTITLED_ID))?.title, { timeout: 15_000 })
      .toBe('');

    await noteItem(window, 'New Note').click();
    await expect(visibleTitle(window)).toHaveAttribute('data-placeholder', 'New Note');
  });

  test('strips a legacy body title instead of importing it as content', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('Body text after');

    const doc = await getDocumentFromDb(window, LEGACY_ID);
    expect(doc!.title).toBe('Legacy');
    expect(doc!.content).not.toContain('# Legacy');
  });

  test('adopts frontmatter metadata (emoji, bookmark, order)', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.emoji, { timeout: 15_000 })
      .toBe('🗺️');
    await expect
      .poll(
        async () =>
          (await getDocumentFromDb(window, BOOKMARKED_ID))?.metadata?.bookmarkedAt ?? null,
        { timeout: 15_000 },
      )
      .toBe('2024-02-01T00:00:00.000Z');
    expect((await getDocumentFromDb(window, PROJECTS_ID))!.sortOrder).toBe(1);
  });
});

test.describe('OS → Lychee (live watcher)', () => {
  test('imports a note created outside Lychee while running', async ({ window, vaultDir }) => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    writeNote(vaultDir, 'From Finder.md', { id, title: 'From Finder' }, 'Created outside Lychee.');

    const doc = await waitForDocument(window, id);
    expect(doc.title).toBe('From Finder');
    await expect(noteItem(window, 'From Finder')).toBeVisible();
  });

  test('applies an external edit and shows the changed-on-disk toast', async ({
    window,
    vaultDir,
  }) => {
    await noteItem(window, 'Roadmap').click();
    await expect(visibleTitle(window)).toHaveText('Roadmap');

    writeNote(
      vaultDir,
      'Roadmap.md',
      { id: ROADMAP_ID, title: 'Roadmap', emoji: '🗺️', order: 0 },
      'externally changed body',
    );

    await expect(window.getByTestId('toast').first()).toContainText('Changed on disk', {
      timeout: 15_000,
    });
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('externally changed body');
    await expect(window.locator('main:visible .ContentEditable__root')).toContainText(
      'externally changed body',
    );
  });

  test('adopts an external rename as a retitle and keeps identity', async ({ window, vaultDir }) => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    writeNote(vaultDir, 'Renamable.md', { id, title: 'Renamable' }, 'body');
    await waitForDocument(window, id);

    renameVaultPath(vaultDir, 'Renamable.md', 'Renamed.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
      .toBe('Renamed');
    await expect(noteItem(window, 'Renamed')).toBeVisible();
  });

  test('reparents a note moved into a folder outside Lychee', async ({ window, vaultDir }) => {
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    writeNote(vaultDir, 'Movable.md', { id, title: 'Movable' }, 'body');
    await waitForDocument(window, id);

    renameVaultPath(vaultDir, 'Movable.md', 'Projects/Movable.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
  });

  test('an external delete trashes the note and closes its tab', async ({ window, vaultDir }) => {
    await noteItem(window, 'Bookmarked').click();
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Bookmarked' })).toHaveCount(1);

    deleteVaultPath(vaultDir, 'Bookmarked.md');

    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).some((doc) => doc.id === BOOKMARKED_ID))
      .toBe(false);
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Bookmarked' })).toHaveCount(0);
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Bookmarked' })).toHaveCount(0);
  });

  test('deleting a parent note and its folder trashes the subtree', async ({ window, vaultDir }) => {
    await waitForDocument(window, ALPHA_ID);
    deleteVaultPath(vaultDir, 'Projects.md');
    deleteVaultPath(vaultDir, 'Projects');

    await expect
      .poll(
        async () => {
          const ids = new Set((await listTrashedFromDb(window)).map((doc) => doc.id));
          return ids.has(PROJECTS_ID) && ids.has(ALPHA_ID) && ids.has(BETA_ID);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).some((doc) => doc.id === PROJECTS_ID))
      .toBe(false);
  });

  test('does not crash on a malformed markdown file', async ({ window, vaultDir }) => {
    // Unterminated frontmatter: no parseable id, so it is ignored, not a note.
    fs.writeFileSync(
      path.join(vaultDir, 'Broken.md'),
      '---\nid: "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz"\n\nno closing delimiter',
    );

    // The app keeps running and its existing notes are untouched.
    await expect(noteItem(window, 'Roadmap')).toBeVisible();
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(SEEDED_IDS.length);
  });
});
