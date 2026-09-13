import { test, expect, listDocumentsFromDb, listTrashedFromDb, getDocumentFromDb } from './electron-app';
import {
  writeNote,
  deleteVaultPath,
  renameVaultPath,
  listMarkdown,
  readNote,
  waitForContent,
} from './vault-helpers';

/**
 * Race and churn handling. The watcher debounces + serializes, so a burst of
 * writes must settle to the *last* state rather than interleave, drop an edit,
 * or leave two files claiming one id. These drive rapid, overlapping file
 * mutations the way an editor autosave or a sync client would.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const LEGACY_ID = '77777777-7777-4777-8777-777777777777';

test.use({ vaultSeed: 'vault' });

async function ready(window: Parameters<typeof getDocumentFromDb>[0], id: string) {
  await expect
    .poll(async () => (await getDocumentFromDb(window, id)) != null, { timeout: 15_000 })
    .toBe(true);
}

test.describe('Watcher races', () => {
  test('eight rapid external edits settle to the last body', async ({ window, vaultDir }) => {
    await ready(window, ROADMAP_ID);
    for (let i = 0; i < 8; i += 1) {
      writeNote(
        vaultDir,
        'Roadmap.md',
        { id: ROADMAP_ID, title: 'Roadmap' },
        `rapid body ${i}`,
      );
    }
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('rapid body 7');
  });

  test('rapid successive renames settle to the final title', async ({ window, vaultDir }) => {
    await ready(window, LEGACY_ID);
    renameVaultPath(vaultDir, 'Legacy.md', 'Legacy A.md');
    renameVaultPath(vaultDir, 'Legacy A.md', 'Legacy B.md');
    renameVaultPath(vaultDir, 'Legacy B.md', 'Legacy Final.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy Final');
    expect(listMarkdown(vaultDir)).toContain('Legacy Final.md');
  });

  test('a create immediately overwritten imports the newest content', async ({
    window,
    vaultDir,
  }) => {
    const id = 'f2000000-0000-4000-8000-000000000001';
    writeNote(vaultDir, 'Burst Note.md', { id, title: 'Burst Note' }, 'first take');
    writeNote(vaultDir, 'Burst Note.md', { id, title: 'Burst Note' }, 'second take');

    await ready(window, id);
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('second take');
  });

  test('a rename immediately followed by an edit retitles and applies', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, LEGACY_ID);
    renameVaultPath(vaultDir, 'Legacy.md', 'Legacy Renamed.md');
    writeNote(
      vaultDir,
      'Legacy Renamed.md',
      { id: LEGACY_ID, title: 'Legacy Renamed' },
      'post rename edit',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy Renamed');
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('post rename edit');
  });

  test('an external delete followed by an older recreate stays trashed', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, ROADMAP_ID);
    deleteVaultPath(vaultDir, 'Roadmap.md');
    // Wait for the delete to be reconciled (and its tombstone recorded) first.
    await expect
      .poll(async () => (await listTrashedFromDb(window)).some((doc) => doc.id === ROADMAP_ID), {
        timeout: 15_000,
      })
      .toBe(true);

    // Re-create at a new path with a stale timestamp: the delete must win.
    writeNote(
      vaultDir,
      'Roadmap Recreated.md',
      { id: ROADMAP_ID, title: 'Roadmap', updated: '2024-01-02T00:00:00.000Z' },
      'zombie body',
    );

    await window.waitForTimeout(1500);
    const active = await listDocumentsFromDb(window);
    expect(active.some((doc) => doc.id === ROADMAP_ID)).toBe(false);
  });

  test('two files claiming a fresh id in one tick leave one note', async ({ window, vaultDir }) => {
    const id = 'f2000000-0000-4000-8000-000000000002';
    writeNote(vaultDir, 'Claim A.md', { id, title: 'Claim A' }, 'a');
    writeNote(vaultDir, 'Claim B.md', { id, title: 'Claim B' }, 'b');

    await ready(window, id);
    await expect
      .poll(
        async () => (await listDocumentsFromDb(window)).filter((doc) => doc.id === id).length,
        { timeout: 15_000 },
      )
      .toBe(1);
  });

  test('a content edit plus an order change in one write both apply', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, ROADMAP_ID);
    writeNote(
      vaultDir,
      'Roadmap.md',
      { id: ROADMAP_ID, title: 'Roadmap', order: 2 },
      'ordered body',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(2);
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('ordered body');
  });

  test('a burst of twelve new files all import', async ({ window, vaultDir }) => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const id = `f2100000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
      ids.push(id);
      writeNote(vaultDir, `Burst ${i}.md`, { id, title: `Burst ${i}` }, `body ${i}`);
    }
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 20_000 })
      .toBe(19);
    for (const id of ids) {
      await expect
        .poll(async () => (await getDocumentFromDb(window, id)) != null, { timeout: 10_000 })
        .toBe(true);
    }
  });

  test('writing then deleting a new file in one tick leaves no active note', async ({
    window,
    vaultDir,
  }) => {
    const id = 'f2000000-0000-4000-8000-000000000003';
    writeNote(vaultDir, 'Flash.md', { id, title: 'Flash' }, 'here then gone');
    deleteVaultPath(vaultDir, 'Flash.md');

    await window.waitForTimeout(2000);
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === id)).toBe(false);
    expect(listMarkdown(vaultDir)).not.toContain('Flash.md');
  });

  test('rapid emoji toggles settle to the last value', async ({ window, vaultDir }) => {
    await ready(window, ROADMAP_ID);
    for (const emoji of ['🅰️', '🅱️', '🅾️']) {
      writeNote(vaultDir, 'Roadmap.md', { id: ROADMAP_ID, title: 'Roadmap', emoji }, 'body');
    }
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.emoji, { timeout: 15_000 })
      .toBe('🅾️');
  });

  test('rapid order edits settle to the last order', async ({ window, vaultDir }) => {
    await ready(window, LEGACY_ID);
    for (const order of [0, 5, 1]) {
      writeNote(vaultDir, 'Legacy.md', { id: LEGACY_ID, title: 'Legacy', order }, 'body');
    }
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(1);
  });

  test('simultaneous edits to two notes keep their own content', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, ROADMAP_ID);
    await ready(window, PROJECTS_ID);
    writeNote(vaultDir, 'Roadmap.md', { id: ROADMAP_ID, title: 'Roadmap' }, 'roadmap marker');
    writeNote(vaultDir, 'Projects.md', { id: PROJECTS_ID, title: 'Projects' }, 'projects marker');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('roadmap marker');
    await expect
      .poll(async () => (await getDocumentFromDb(window, PROJECTS_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('projects marker');
    expect((await getDocumentFromDb(window, ROADMAP_ID))!.content).not.toContain('projects marker');
  });

  test('an edit that lands during a title rewrite is not lost', async ({ window, vaultDir }) => {
    await ready(window, LEGACY_ID);
    renameVaultPath(vaultDir, 'Legacy.md', 'Legacy Live.md');
    // Write the same tick, then a second edit shortly after (inside the debounce).
    writeNote(vaultDir, 'Legacy Live.md', { id: LEGACY_ID, title: 'Legacy Live' }, 'edit one');
    writeNote(vaultDir, 'Legacy Live.md', { id: LEGACY_ID, title: 'Legacy Live' }, 'edit two');
    await waitForContent(vaultDir, 'Legacy Live.md', 'edit two');
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('edit two');
    expect(readNote(vaultDir, 'Legacy Live.md').data.id).toBe(LEGACY_ID);
  });
});
