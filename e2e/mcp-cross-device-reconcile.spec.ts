import { test, expect, listDocumentsFromDb, listTrashedFromDb } from './electron-app';
import { noteItem, writeNote, writeTombstone, appendTombstone } from './vault-helpers';

/**
 * Cross-device deletes reconciled in the RUNNING app.
 *
 * A second device never touches this machine's editor — it appends a tombstone
 * to the shared vault (`.lychee/tombstones/<device>.jsonl`). These tests drive
 * that path and assert the open app reacts: deletes propagate, a newer edit
 * beats an unseen delete, a restore brings a note back, and a delete that
 * arrives before the file it deletes still suppresses it.
 */
test.use({ vaultSeed: 'vault' });

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';

async function trashedIds(window: Parameters<typeof listTrashedFromDb>[0]): Promise<string[]> {
  return (await listTrashedFromDb(window)).map((doc) => doc.id);
}

async function allIds(window: Parameters<typeof listDocumentsFromDb>[0]): Promise<string[]> {
  return (await listDocumentsFromDb(window)).map((doc) => doc.id);
}

test.describe('cross-device reconcile — deletes in the live app', () => {
  test('a delete tombstone from another device trashes the note and closes its tab', async ({
    window,
    vaultDir,
  }) => {
    await noteItem(window, 'Roadmap').click();
    await expect(window.locator('main:visible .ContentEditable__root')).toBeVisible();

    writeTombstone(vaultDir, 'device-b', [
      { id: ROADMAP_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect.poll(() => trashedIds(window), { timeout: 15_000 }).toContain(ROADMAP_ID);
    // The trashed note is gone from the sidebar/tabs.
    await expect(noteItem(window, 'Roadmap')).toHaveCount(0);
  });

  test('a newer edit beats an older delete tombstone', async ({ window, vaultDir }) => {
    // The fixture's Roadmap was last updated 2024-01-02; this delete predates it.
    // Alpha gets a *current* delete as a control: it proves the reconcile path is
    // actually running, so "Roadmap survived" is meaningful and not a no-op.
    writeTombstone(vaultDir, 'device-b', [
      { id: ROADMAP_ID, action: 'trash', at: '2020-01-01T00:00:00.000Z' },
      { id: ALPHA_ID, action: 'trash', at: new Date().toISOString() },
    ]);

    await expect.poll(() => trashedIds(window), { timeout: 15_000 }).toContain(ALPHA_ID);
    // The old delete yields to the newer edit.
    expect(await trashedIds(window)).not.toContain(ROADMAP_ID);
    await expect(noteItem(window, 'Roadmap')).toHaveCount(1);
  });

  test('a restore tombstone from another device brings the note back', async ({
    window,
    vaultDir,
  }) => {
    writeTombstone(vaultDir, 'device-b', [
      { id: ROADMAP_ID, action: 'trash', at: new Date().toISOString() },
    ]);
    await expect.poll(() => trashedIds(window), { timeout: 15_000 }).toContain(ROADMAP_ID);

    // Another device restores it *after* the delete was applied here.
    appendTombstone(vaultDir, 'device-b', [
      { id: ROADMAP_ID, action: 'restore', at: new Date(Date.now() + 1000).toISOString() },
    ]);

    await expect.poll(() => trashedIds(window), { timeout: 15_000 }).not.toContain(ROADMAP_ID);
    await expect.poll(() => allIds(window), { timeout: 15_000 }).toContain(ROADMAP_ID);
  });

  test('a delete tombstone suppresses a file that arrives after the delete', async ({
    window,
    vaultDir,
  }) => {
    // The delete reaches this device BEFORE the (stale) file does.
    writeTombstone(vaultDir, 'device-b', [
      { id: 'stale-note', action: 'trash', at: new Date().toISOString() },
    ]);
    await window.waitForTimeout(500);
    writeNote(
      vaultDir,
      'Stale.md',
      { id: 'stale-note', title: 'Stale', updated: '2024-01-02T00:00:00.000Z' },
      'old body',
    );

    await window.waitForTimeout(4500);
    expect(await allIds(window)).not.toContain('stale-note');
    await expect(noteItem(window, 'Stale')).toHaveCount(0);
  });
});
