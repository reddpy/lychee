import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  listTrashedFromDb,
  getDocumentFromDb,
} from './electron-app';
import { writeNote, deleteVaultPath, renameVaultPath, noteItem } from './vault-helpers';

/**
 * OS → Lychee, live. Every mutation below is performed on the hermetic vault
 * while the app is running; the watcher must reconcile it. Never touches the
 * real vault.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
const BETA_ID = '44444444-4444-4444-8444-444444444444';
const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';
const LEGACY_ID = '77777777-7777-4777-8777-777777777777';

test.describe('OS → Lychee — live external mutations (empty vault)', () => {
  test('creates a nested note and parents it', async ({ window, vaultDir }) => {
    const parentId = 'f0000000-0000-4000-8000-000000000001';
    const childId = 'f0000000-0000-4000-8000-000000000002';
    writeNote(vaultDir, 'External Parent.md', { id: parentId, title: 'External Parent' }, 'p');
    writeNote(vaultDir, 'External Parent/External Child.md', { id: childId, title: 'External Child' }, 'c');

    await expect
      .poll(async () => (await getDocumentFromDb(window, childId))?.parentId, { timeout: 15_000 })
      .toBe(parentId);
    await noteItem(window, 'External Parent').locator('[aria-label="Expand"]').click();
    await expect(noteItem(window, 'External Child')).toBeVisible();
  });

  test('imports several files created at once', async ({ window, vaultDir }) => {
    for (let i = 0; i < 5; i += 1) {
      writeNote(
        vaultDir,
        `Burst ${i}.md`,
        { id: `f1000000-0000-4000-8000-00000000000${i}`, title: `Burst ${i}` },
        `body ${i}`,
      );
    }
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(5);
  });

  test('applies frontmatter metadata on create (emoji, bookmark, order)', async ({
    window,
    vaultDir,
  }) => {
    const id = 'f2000000-0000-4000-8000-000000000001';
    writeNote(
      vaultDir,
      'Meta Note.md',
      { id, title: 'Meta Note', emoji: '📌', bookmarked: '2024-04-01T00:00:00.000Z', order: 3 },
      'meta body',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.emoji, { timeout: 15_000 })
      .toBe('📌');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.sortOrder, { timeout: 15_000 })
      .toBe(3);
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.metadata?.bookmarkedAt ?? null, {
        timeout: 15_000,
      })
      .toBe('2024-04-01T00:00:00.000Z');
  });

  test('ignores a new file with no id and one with only a title', async ({ window, vaultDir }) => {
    // Empty id → not a note.
    writeNote(vaultDir, 'plain-extra.md', { id: '', title: 'plain-extra' }, 'no id');
    // Title but no id → not a note.
    fs.writeFileSync(
      path.join(vaultDir, 'only-title-extra.md'),
      '---\ntitle: "Only Title"\n---\n\nbody',
    );

    await window.waitForTimeout(1500);
    const docs = await listDocumentsFromDb(window);
    expect(docs.some((doc) => doc.title === 'Only Title')).toBe(false);
    expect(docs.some((doc) => doc.title === 'plain-extra')).toBe(false);
  });
});

test.describe('OS → Lychee — live external mutations (seeded)', () => {
  test.use({ vaultSeed: 'vault' });

  test('updates emoji and bookmark from frontmatter', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');

    writeNote(
      vaultDir,
      'Roadmap.md',
      { id: ROADMAP_ID, title: 'Roadmap', emoji: '📌', bookmarked: '2024-05-01T00:00:00.000Z' },
      'body',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.emoji, { timeout: 15_000 })
      .toBe('📌');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.metadata?.bookmarkedAt ?? null, {
        timeout: 15_000,
      })
      .toBe('2024-05-01T00:00:00.000Z');
  });

  test('an external edit adopts the file timestamp instead of stamping now', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');

    writeNote(
      vaultDir,
      'Legacy.md',
      { id: LEGACY_ID, title: 'Legacy', updated: '2024-04-15T00:00:00.000Z' },
      'stamped body',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('stamped body');
    expect((await getDocumentFromDb(window, LEGACY_ID))!.updatedAt).toBe(
      '2024-04-15T00:00:00.000Z',
    );
  });

  test('emptying a file body clears the note content', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');

    writeNote(vaultDir, 'Legacy.md', { id: LEGACY_ID, title: 'Legacy' }, '');

    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.content ?? 'x', {
        timeout: 15_000,
      })
      .toBe('');
  });

  test('external rename with Unicode characters retitles', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');
    renameVaultPath(vaultDir, 'Bookmarked.md', 'Bóókmarked ✨.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bóókmarked ✨');
    await expect(noteItem(window, 'Bóókmarked')).toBeVisible();
  });

  test('external rename into a folder reparents and keeps the title', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');
    renameVaultPath(vaultDir, 'Bookmarked.md', 'Projects/Bookmarked.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.parentId, {
        timeout: 15_000,
      })
      .toBe(PROJECTS_ID);
    expect((await getDocumentFromDb(window, BOOKMARKED_ID))!.title).toBe('Bookmarked');
  });

  test('external delete of a nested child trashes only that child', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.title, { timeout: 15_000 })
      .toBe('Alpha');
    deleteVaultPath(vaultDir, 'Projects/Alpha.md');
    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === ALPHA_ID),
        { timeout: 15_000 },
      )
      .toBe(true);
    expect((await getDocumentFromDb(window, PROJECTS_ID))!.deletedAt).toBeNull();
    expect((await getDocumentFromDb(window, BETA_ID))!.deletedAt).toBeNull();
  });

  test('rapid successive external edits settle to the last content', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');

    writeNote(vaultDir, 'Legacy.md', { id: LEGACY_ID, title: 'Legacy' }, 'first');
    writeNote(vaultDir, 'Legacy.md', { id: LEGACY_ID, title: 'Legacy' }, 'second');
    writeNote(vaultDir, 'Legacy.md', { id: LEGACY_ID, title: 'Legacy' }, 'third');

    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('third');
  });

  test('an external edit to a closed note updates the database', async ({ window, vaultDir }) => {
    // Roadmap is not opened in a tab here.
    writeNote(vaultDir, 'Roadmap.md', { id: ROADMAP_ID, title: 'Roadmap', emoji: '🗺️', order: 0 }, 'closed edit body');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('closed edit body');
  });
});
