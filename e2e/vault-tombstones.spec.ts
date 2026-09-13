import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  listTrashedFromDb,
  getDocumentFromDb,
} from './electron-app';
import { writeNote, writeTombstone, noteItem, listMarkdown } from './vault-helpers';

/**
 * Cross-device tombstones. A tombstone is a line in
 * `<vault>/.lychee/tombstones/<device>.jsonl`; the watcher reconciles them into
 * the local DB. The fixture pre-creates the tombstone directory so the watcher
 * subscribes to it from launch.
 */

const LEGACY_ID = '77777777-7777-4777-8777-777777777777';
const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DEVICE = 'device-other-0001';

test.use({
  vaultSeed: 'vault',
  vaultExtra: { '.lychee/tombstones/seed.jsonl': '' },
});

test.describe('Cross-device tombstones', () => {
  test('a trash tombstone from another device trashes the note', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: LEGACY_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === LEGACY_ID),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).some((doc) => doc.id === LEGACY_ID))
      .toBe(false);
  });

  test('a newer restore tombstone brings a trashed note back', async ({ window, vaultDir }) => {
    const t1 = '2026-01-01T00:00:00.000Z';
    writeTombstone(vaultDir, OTHER_DEVICE, [{ id: ROADMAP_ID, action: 'trash', at: t1 }]);
    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === ROADMAP_ID),
        { timeout: 15_000 },
      )
      .toBe(true);

    const t2 = '2099-01-01T00:00:00.000Z';
    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: ROADMAP_ID, action: 'trash', at: t1 },
      { id: ROADMAP_ID, action: 'restore', at: t2 },
    ]);

    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(window)).some((doc) => doc.id === ROADMAP_ID) &&
          (await getDocumentFromDb(window, ROADMAP_ID))?.deletedAt === null,
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test('an older trash tombstone does not override a newer edit', async ({ window, vaultDir }) => {
    // Roadmap was last edited 2024; a 2020 delete must lose.
    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: ROADMAP_ID, action: 'trash', at: '2020-01-01T00:00:00.000Z' },
    ]);

    await window.waitForTimeout(1500);
    expect((await getDocumentFromDb(window, ROADMAP_ID))?.deletedAt).toBeNull();
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === ROADMAP_ID)).toBe(true);
  });

  test('a purge tombstone trashes the note and blocks a stale re-import', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: LEGACY_ID, action: 'purge', at: new Date().toISOString() },
    ]);
    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === LEGACY_ID),
        { timeout: 15_000 },
      )
      .toBe(true);

    // Re-writing the file with an older timestamp must not resurrect the note.
    writeNote(
      vaultDir,
      'Legacy.md',
      { id: LEGACY_ID, title: 'Legacy', updated: '2024-01-02T00:00:00.000Z' },
      'stale body',
    );
    await window.waitForTimeout(1500);
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === LEGACY_ID)).toBe(false);
  });

  test('a purge tombstone also moves the file into .trash', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: LEGACY_ID, action: 'purge', at: new Date().toISOString() },
    ]);

    await expect
      .poll(() => listMarkdown(vaultDir, { trash: true }).includes('Legacy.md'), {
        timeout: 15_000,
      })
      .toBe(true);
    expect(listMarkdown(vaultDir)).not.toContain('Legacy.md');
  });

  test('a restore tombstone for a live note is a no-op', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: ROADMAP_ID, action: 'restore', at: '2099-01-01T00:00:00.000Z' },
    ]);
    await window.waitForTimeout(1200);

    expect((await getDocumentFromDb(window, ROADMAP_ID))?.deletedAt).toBeNull();
    expect(listMarkdown(vaultDir)).toContain('Roadmap.md');
  });

  test('a tombstone for an unknown id is ignored', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: 'nope-0000-0000-0000-000000000000', action: 'trash', at: new Date().toISOString() },
    ]);
    await window.waitForTimeout(1200);

    await expect.poll(async () => (await listDocumentsFromDb(window)).length).toBe(7);
  });

  test('malformed tombstone lines are ignored without breaking the valid ones', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');

    // Hand-write a log with garbage lines plus one valid record.
    const logPath = path.join(vaultDir, '.lychee', 'tombstones', `${OTHER_DEVICE}.jsonl`);
    fs.writeFileSync(
      logPath,
      [
        'not json at all',
        '{"id": 42, "action": "trash"}',
        JSON.stringify({ id: LEGACY_ID, action: 'trash', at: new Date().toISOString(), device: OTHER_DEVICE }),
      ].join('\n') + '\n',
    );

    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === LEGACY_ID),
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test('the sidebar and tabs update when a tombstone arrives while running', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    await noteItem(window, 'Roadmap').click();
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Roadmap' })).toHaveCount(1);

    writeTombstone(vaultDir, OTHER_DEVICE, [
      { id: ROADMAP_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect(window.locator('[data-note-id]').filter({ hasText: 'Roadmap' })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Roadmap' })).toHaveCount(0);
  });
});
