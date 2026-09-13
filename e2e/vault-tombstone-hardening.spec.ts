import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  listTrashedFromDb,
  getDocumentFromDb,
} from './electron-app';
import {
  writeNote,
  writeTombstone,
  appendTombstone,
  listMarkdown,
  noteItem,
} from './vault-helpers';

/**
 * Tombstone merge/ordering hardening. The effective delete state per note is
 * the latest record across all device logs by a total order `(at, device)`, so
 * replicas converge deterministically. These exercise ties, flips, unsafe
 * device names, malformed logs, and subtree/cascade behavior.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
const BETA_ID = '44444444-4444-4444-8444-444444444444';
const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';
const LEGACY_ID = '77777777-7777-4777-8777-777777777777';

const TIE = '2099-06-01T00:00:00.000Z';
const LATE = '2099-12-01T00:00:00.000Z';

test.use({
  vaultSeed: 'vault',
  vaultExtra: { '.lychee/tombstones/seed.jsonl': '' },
});

async function wantTrashed(
  window: Parameters<typeof getDocumentFromDb>[0],
  id: string,
): Promise<void> {
  await expect
    .poll(async () => (await listTrashedFromDb(window)).some((doc) => doc.id === id), {
      timeout: 15_000,
    })
    .toBe(true);
}

async function wantActive(
  window: Parameters<typeof getDocumentFromDb>[0],
  id: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await listDocumentsFromDb(window)).some((doc) => doc.id === id) &&
        (await getDocumentFromDb(window, id))?.deletedAt === null,
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe('Tombstone ordering', () => {
  test('a same-timestamp tie goes to the higher device id (trash)', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    writeTombstone(vaultDir, 'aaa-device', [{ id: ROADMAP_ID, action: 'restore', at: TIE }]);
    writeTombstone(vaultDir, 'zzz-device', [{ id: ROADMAP_ID, action: 'trash', at: TIE }]);

    await wantTrashed(window, ROADMAP_ID);
  });

  test('a same-timestamp tie can also resolve to a restore', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    appendTombstone(vaultDir, 'seed-device', [
      { id: ROADMAP_ID, action: 'trash', at: '2099-01-01T00:00:00.000Z' },
    ]);
    await wantTrashed(window, ROADMAP_ID);

    appendTombstone(vaultDir, 'aaa-device', [{ id: ROADMAP_ID, action: 'trash', at: TIE }]);
    appendTombstone(vaultDir, 'zzz-device', [{ id: ROADMAP_ID, action: 'restore', at: TIE }]);

    await wantActive(window, ROADMAP_ID);
    await expect
      .poll(() => listMarkdown(vaultDir).includes('Roadmap.md'), { timeout: 10_000 })
      .toBe(true);
  });

  test('a purge followed by a newer restore brings the note back', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');
    appendTombstone(vaultDir, 'device-a', [{ id: LEGACY_ID, action: 'purge', at: '2099-01-01T00:00:00.000Z' }]);
    await wantTrashed(window, LEGACY_ID);

    appendTombstone(vaultDir, 'device-a', [{ id: LEGACY_ID, action: 'restore', at: LATE }]);

    await wantActive(window, LEGACY_ID);
    await expect
      .poll(() => listMarkdown(vaultDir).includes('Legacy.md'), { timeout: 10_000 })
      .toBe(true);
  });

  test('a restore followed by a newer purge wins for the purge', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    appendTombstone(vaultDir, 'device-a', [{ id: ROADMAP_ID, action: 'restore', at: '2099-01-01T00:00:00.000Z' }]);
    appendTombstone(vaultDir, 'device-a', [{ id: ROADMAP_ID, action: 'trash', at: LATE }]);

    await wantTrashed(window, ROADMAP_ID);
    await expect
      .poll(() => listMarkdown(vaultDir, { trash: true }).includes('Roadmap.md'), {
        timeout: 10_000,
      })
      .toBe(true);
  });

  test('a purge then trash then restore settles on the restore', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');

    // Exercise each transition: purge trashes, a later trash keeps it trashed,
    // a later restore brings it back.
    appendTombstone(vaultDir, 'device-a', [
      { id: LEGACY_ID, action: 'purge', at: '2099-01-01T00:00:00.000Z' },
    ]);
    await wantTrashed(window, LEGACY_ID);

    appendTombstone(vaultDir, 'device-a', [
      { id: LEGACY_ID, action: 'trash', at: '2099-03-01T00:00:00.000Z' },
    ]);
    await window.waitForTimeout(800);
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === LEGACY_ID)).toBe(false);

    appendTombstone(vaultDir, 'device-a', [{ id: LEGACY_ID, action: 'restore', at: LATE }]);
    await wantActive(window, LEGACY_ID);
    await expect
      .poll(() => listMarkdown(vaultDir).includes('Legacy.md'), { timeout: 10_000 })
      .toBe(true);
  });

  test('a tombstone exactly at the note timestamp supersedes it', async ({ window, vaultDir }) => {
    // The seed's Roadmap has updated=2024-01-02T00:00:00.000Z.
    writeTombstone(vaultDir, 'device-a', [
      { id: ROADMAP_ID, action: 'trash', at: '2024-01-02T00:00:00.000Z' },
    ]);
    await wantTrashed(window, ROADMAP_ID);
  });

  test('a tombstone before the note timestamp loses', async ({ window, vaultDir }) => {
    writeTombstone(vaultDir, 'device-a', [
      { id: ROADMAP_ID, action: 'trash', at: '2020-01-01T00:00:00.000Z' },
    ]);
    await window.waitForTimeout(1500);
    expect((await getDocumentFromDb(window, ROADMAP_ID))?.deletedAt).toBeNull();
  });
});

test.describe('Tombstone log robustness', () => {
  test('a record with no device field still applies', async ({ window, vaultDir }) => {
    const logPath = path.join(vaultDir, '.lychee', 'tombstones', 'nodevice.jsonl');
    fs.writeFileSync(logPath, `${JSON.stringify({ id: LEGACY_ID, action: 'trash', at: TIE })}\n`);
    await wantTrashed(window, LEGACY_ID);
  });

  test('a log with an unusual filename is still read', async ({ window, vaultDir }) => {
    const dir = path.join(vaultDir, '.lychee', 'tombstones');
    fs.writeFileSync(
      path.join(dir, 'device with spaces!.jsonl'),
      `${JSON.stringify({ id: LEGACY_ID, action: 'trash', at: TIE, device: 'spaced' })}\n`,
    );
    await wantTrashed(window, LEGACY_ID);
  });

  test('logs from multiple devices are union-merged', async ({ window, vaultDir }) => {
    writeTombstone(vaultDir, 'device-a', [{ id: LEGACY_ID, action: 'trash', at: TIE }]);
    writeTombstone(vaultDir, 'device-b', [{ id: BOOKMARKED_ID, action: 'trash', at: TIE }]);
    await wantTrashed(window, LEGACY_ID);
    await wantTrashed(window, BOOKMARKED_ID);
  });

  test('appending a newer record flips an earlier action', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');
    appendTombstone(vaultDir, 'device-a', [
      { id: LEGACY_ID, action: 'restore', at: '2099-01-01T00:00:00.000Z' },
    ]);
    await window.waitForTimeout(800);
    expect(await getDocumentFromDb(window, LEGACY_ID)).not.toBeNull();

    appendTombstone(vaultDir, 'device-a', [{ id: LEGACY_ID, action: 'trash', at: LATE }]);
    await wantTrashed(window, LEGACY_ID);
  });

  test('CRLF and trailing whitespace in the log still parses', async ({ window, vaultDir }) => {
    const dir = path.join(vaultDir, '.lychee', 'tombstones');
    const lines = [
      `  ${JSON.stringify({ id: LEGACY_ID, action: 'trash', at: TIE, device: 'crlf' })}  `,
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(dir, 'crlf.jsonl'), lines);
    await wantTrashed(window, LEGACY_ID);
  });

  test('unknown extra JSON fields on a record are ignored', async ({ window, vaultDir }) => {
    const dir = path.join(vaultDir, '.lychee', 'tombstones');
    fs.writeFileSync(
      path.join(dir, 'extra.jsonl'),
      `${JSON.stringify({
        id: LEGACY_ID,
        action: 'trash',
        at: TIE,
        device: 'extra',
        futureField: { nested: true },
      })}\n`,
    );
    await wantTrashed(window, LEGACY_ID);
  });

  test('a malformed log alone does not trash anything', async ({ window, vaultDir }) => {
    const dir = path.join(vaultDir, '.lychee', 'tombstones');
    fs.writeFileSync(path.join(dir, 'garbage.jsonl'), ':: not json ::\n{"id":5}\n\n');
    await window.waitForTimeout(1200);
    expect((await listDocumentsFromDb(window)).length).toBe(7);
  });

  test('an unsafe-device tombstone with an unknown id is a no-op', async ({ window, vaultDir }) => {
    writeTombstone(vaultDir, 'nobody', [
      { id: '00000000-0000-4000-8000-000000000000', action: 'trash', at: TIE },
    ]);
    await window.waitForTimeout(1200);
    expect((await listDocumentsFromDb(window)).length).toBe(7);
  });
});

test.describe('Tombstone cascade and scope', () => {
  test('a parent trash tombstone moves the whole subtree to .trash', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);
    writeTombstone(vaultDir, 'device-a', [{ id: PROJECTS_ID, action: 'trash', at: TIE }]);

    await wantTrashed(window, PROJECTS_ID);
    await wantTrashed(window, ALPHA_ID);
    await wantTrashed(window, BETA_ID);
    await expect
      .poll(
        () =>
          listMarkdown(vaultDir, { trash: true }).includes('Projects/Alpha.md') &&
          listMarkdown(vaultDir, { trash: true }).includes('Projects/Beta.md'),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test('a nested-child purge trashes only that child', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.title, { timeout: 15_000 })
      .toBe('Alpha');
    writeTombstone(vaultDir, 'device-a', [{ id: ALPHA_ID, action: 'purge', at: TIE }]);

    await wantTrashed(window, ALPHA_ID);
    // The parent and sibling are untouched.
    expect((await getDocumentFromDb(window, PROJECTS_ID))?.deletedAt).toBeNull();
    expect((await getDocumentFromDb(window, BETA_ID))?.deletedAt).toBeNull();
  });

  test('a future purge blocks a later re-import of the same id', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');
    writeTombstone(vaultDir, 'device-a', [{ id: LEGACY_ID, action: 'purge', at: TIE }]);
    await wantTrashed(window, LEGACY_ID);

    writeNote(
      vaultDir,
      'Legacy.md',
      { id: LEGACY_ID, title: 'Legacy', updated: '2024-01-02T00:00:00.000Z' },
      'zombie',
    );
    await window.waitForTimeout(1500);
    expect((await listDocumentsFromDb(window)).some((doc) => doc.id === LEGACY_ID)).toBe(false);
    expect(listMarkdown(vaultDir)).toContain('Legacy.md');
  });

  test('a restore tombstone for a live note is inert', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    writeTombstone(vaultDir, 'device-a', [{ id: ROADMAP_ID, action: 'restore', at: LATE }]);
    await window.waitForTimeout(1200);
    expect((await getDocumentFromDb(window, ROADMAP_ID))?.deletedAt).toBeNull();
    expect(listMarkdown(vaultDir)).toContain('Roadmap.md');
  });

  test('a tombstone closes the open tab live and removes the sidebar row', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    await noteItem(window, 'Roadmap').click();
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Roadmap' })).toHaveCount(1);

    writeTombstone(vaultDir, 'device-a', [{ id: ROADMAP_ID, action: 'trash', at: TIE }]);

    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Roadmap' })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Roadmap' })).toHaveCount(0);
  });

  test('a tombstone for a trashed note is idempotent', async ({ window, vaultDir }) => {
    writeTombstone(vaultDir, 'device-a', [{ id: LEGACY_ID, action: 'trash', at: TIE }]);
    await wantTrashed(window, LEGACY_ID);
    appendTombstone(vaultDir, 'device-b', [{ id: LEGACY_ID, action: 'trash', at: TIE }]);
    await window.waitForTimeout(1200);
    const trashed = (await listTrashedFromDb(window)).filter((doc) => doc.id === LEGACY_ID);
    expect(trashed.length).toBe(1);
  });
});
