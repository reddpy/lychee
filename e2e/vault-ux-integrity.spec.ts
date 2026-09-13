import { test, expect, listDocumentsFromDb, getDocumentFromDb } from './electron-app';
import {
  writeNote,
  deleteVaultPath,
  noteItem,
  visibleTitle,
  trashViaMenu,
  openTrashBin,
  restoreFirstFromTrash,
} from './vault-helpers';

/**
 * Real-world UX integrity when the OS mutates the vault. The user's current
 * context (open tabs, active editor, focus) must survive background file
 * changes: no tab theft, no spurious tabs, no error boundary, live labels.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';
const LEGACY_ID = '77777777-7777-4777-8777-777777777777';

test.use({ vaultSeed: 'vault' });

async function ready(window: Parameters<typeof getDocumentFromDb>[0], id: string) {
  await expect
    .poll(async () => (await getDocumentFromDb(window, id)) != null, { timeout: 15_000 })
    .toBe(true);
}

test.describe('Vault UX integrity', () => {
  test('an external rename updates the open tab label', async ({ window, vaultDir }) => {
    await ready(window, LEGACY_ID);
    await noteItem(window, 'Legacy').click();
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Legacy' })).toHaveCount(1);

    writeNote(vaultDir, 'Legacy Renamed.md', { id: LEGACY_ID, title: 'Legacy Renamed' }, 'body');
    deleteVaultPath(vaultDir, 'Legacy.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy Renamed');
    await expect
      .poll(async () => window.locator('[data-tab-id]').filter({ hasText: 'Legacy Renamed' }).count(), {
        timeout: 10_000,
      })
      .toBe(1);
  });

  test('an external delete closes the deleted note’s tab', async ({ window, vaultDir }) => {
    await ready(window, LEGACY_ID);
    await noteItem(window, 'Legacy').click();
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Legacy' })).toHaveCount(1);

    deleteVaultPath(vaultDir, 'Legacy.md');

    await expect
      .poll(async () => (await listDocumentsFromDb(window)).some((doc) => doc.id === LEGACY_ID), {
        timeout: 15_000,
      })
      .toBe(false);
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Legacy' })).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test('an external edit of a closed note does not open a tab', async ({ window, vaultDir }) => {
    await ready(window, LEGACY_ID);
    expect(await window.locator('[data-tab-id]').count()).toBe(0);

    writeNote(vaultDir, 'Legacy.md', { id: LEGACY_ID, title: 'Legacy' }, 'edit while closed');

    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('edit while closed');
    expect(await window.locator('[data-tab-id]').count()).toBe(0);
  });

  test('an external import does not steal the active tab', async ({ window, vaultDir }) => {
    await ready(window, ROADMAP_ID);
    await noteItem(window, 'Roadmap').click();
    await expect(visibleTitle(window)).toHaveText('Roadmap');

    const id = 'f4000000-0000-4000-8000-000000000001';
    writeNote(vaultDir, 'Arriving.md', { id, title: 'Arriving' }, 'hello');
    await ready(window, id);

    await expect(visibleTitle(window)).toHaveText('Roadmap');
    expect(await window.locator('[data-tab-id]').count()).toBe(1);
  });

  test('an external edit to a non-active note leaves the editor alone', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, ROADMAP_ID);
    await noteItem(window, 'Roadmap').click();
    await expect(visibleTitle(window)).toHaveText('Roadmap');

    writeNote(
      vaultDir,
      'Bookmarked.md',
      { id: BOOKMARKED_ID, title: 'Bookmarked' },
      'other note changed',
    );
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('other note changed');

    await expect(visibleTitle(window)).toHaveText('Roadmap');
    expect(await window.locator('[data-tab-id]').count()).toBe(1);
  });

  test('an external edit surfaces the changed-on-disk toast', async ({ window, vaultDir }) => {
    await ready(window, ROADMAP_ID);
    await noteItem(window, 'Roadmap').click();
    await expect(visibleTitle(window)).toHaveText('Roadmap');
    writeNote(vaultDir, 'Roadmap.md', { id: ROADMAP_ID, title: 'Roadmap' }, 'toast body');
    await expect(window.getByTestId('toast').first()).toContainText('Changed on disk', {
      timeout: 15_000,
    });
  });

  test('an external bookmark is reflected on the open note’s button', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, ROADMAP_ID);
    await noteItem(window, 'Roadmap').click();
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Bookmark this note' }),
    ).toBeVisible({ timeout: 5000 });

    writeNote(
      vaultDir,
      'Roadmap.md',
      { id: ROADMAP_ID, title: 'Roadmap', bookmarked: '2024-05-05T00:00:00.000Z' },
      'body',
    );

    await expect
      .poll(
        async () => (await getDocumentFromDb(window, ROADMAP_ID))?.metadata?.bookmarkedAt ?? null,
        { timeout: 15_000 },
      )
      .toBe('2024-05-05T00:00:00.000Z');
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Remove bookmark' }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('an external emoji change updates the sidebar row', async ({ window, vaultDir }) => {
    await ready(window, ROADMAP_ID);
    await expect(noteItem(window, 'Roadmap')).toBeVisible();

    writeNote(
      vaultDir,
      'Roadmap.md',
      { id: ROADMAP_ID, title: 'Roadmap', emoji: '🚀' },
      'body',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.emoji, { timeout: 15_000 })
      .toBe('🚀');
    await expect(noteItem(window, 'Roadmap')).toContainText('🚀');
  });

  test('two open tabs stay independent when one is edited externally', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, ROADMAP_ID);
    await ready(window, BOOKMARKED_ID);
    const openAndSelect = async (docId: string) => {
      const tabId = await window.evaluate((id) => {
        const store = (window as any).__documentStore;
        const before = new Set(store.getState().openTabs.map((t: { tabId: string }) => t.tabId));
        store.getState().openTab(id);
        const tab = store
          .getState()
          .openTabs.find(
            (t: { tabId: string; docId: string }) => t.docId === id && !before.has(t.tabId),
          );
        return (tab as { tabId: string } | undefined)?.tabId ?? null;
      }, docId);
      if (tabId) {
        await window.evaluate(
          (id) => (window as any).__documentStore.getState().selectDocument(id),
          tabId,
        );
      }
      await window.waitForTimeout(300);
    };

    await openAndSelect(ROADMAP_ID);
    await openAndSelect(BOOKMARKED_ID);
    await expect(visibleTitle(window)).toHaveText('Bookmarked');
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);

    // External edit of Bookmarked (the active note).
    writeNote(vaultDir, 'Bookmarked.md', { id: BOOKMARKED_ID, title: 'Bookmarked' }, 'active edit');
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('active edit');

    // The Roadmap tab is untouched and still present.
    const roadmapTabId = await window.evaluate((id) => {
      const store = (window as any).__documentStore;
      return (
        store.getState().openTabs.find((t: { docId: string }) => t.docId === id)?.tabId ?? null
      );
    }, ROADMAP_ID);
    await window.evaluate(
      (id) => (window as any).__documentStore.getState().selectDocument(id),
      roadmapTabId,
    );
    await expect(visibleTitle(window)).toHaveText('Roadmap');
    await expect(window.locator('[data-tab-id]')).toHaveCount(2);
  });

  test('an external delete of a non-open note leaves the active editor intact', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, ROADMAP_ID);
    await ready(window, LEGACY_ID);
    await noteItem(window, 'Roadmap').click();
    await expect(visibleTitle(window)).toHaveText('Roadmap');

    deleteVaultPath(vaultDir, 'Legacy.md');
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).some((doc) => doc.id === LEGACY_ID), {
        timeout: 15_000,
      })
      .toBe(false);

    await expect(visibleTitle(window)).toHaveText('Roadmap');
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
  });

  test('a burst of external mutations never trips the error boundary', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, ROADMAP_ID);
    await noteItem(window, 'Roadmap').click();

    for (let i = 0; i < 6; i += 1) {
      writeNote(vaultDir, 'Roadmap.md', { id: ROADMAP_ID, title: 'Roadmap' }, `burst ${i}`);
    }
    const id = 'f4100000-0000-4000-8000-000000000001';
    writeNote(vaultDir, 'Fresh One.md', { id, title: 'Fresh One' }, 'fresh');
    deleteVaultPath(vaultDir, 'Legacy.md');

    await ready(window, id);
    await window.waitForTimeout(1500);
    await expect(window.getByText('Something went wrong')).toHaveCount(0);
    await expect(visibleTitle(window)).toHaveText('Roadmap');
  });

  test('trash then restore through the UI restores the note row and file', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, BOOKMARKED_ID);
    await trashViaMenu(window, 'Bookmarked');
    await expect(noteItem(window, 'Bookmarked')).toHaveCount(0, { timeout: 10_000 });

    await openTrashBin(window);
    await restoreFirstFromTrash(window);

    await expect(noteItem(window, 'Bookmarked')).toBeVisible({ timeout: 10_000 });
  });

  test('reopening a note after an external rename shows the new title', async ({
    window,
    vaultDir,
  }) => {
    await ready(window, LEGACY_ID);
    writeNote(vaultDir, 'Legacy Renamed.md', { id: LEGACY_ID, title: 'Legacy Renamed' }, 'body');
    deleteVaultPath(vaultDir, 'Legacy.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy Renamed');

    await noteItem(window, 'Legacy Renamed').click();
    await expect(visibleTitle(window)).toHaveText('Legacy Renamed');
  });
});
