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
import { frontmatterNote, fileIdsOnDisk } from './vault-helpers';

/**
 * "Newest wins" for a duplicate id is decided by the file's frontmatter
 * `updated` timestamp — NOT by filesystem mtime and NOT by write order. This is
 * the "files are truth" rule, and it must hold even when a device writes a
 * stale timestamp.
 *
 * Two-phase per test: seed one copy, launch to create the note, add the rival
 * while closed, relaunch, then assert which file survived.
 */

const NEWEST = 'fc000000-0000-4000-8000-000000000001';

async function launchAndWait(userDataDir: string, vaultDir: string, id: string) {
  const app = await launchLychee({ userDataDir, vaultDir });
  const window = await firstWindowReady(app);
  await expect
    .poll(async () => (await getDocumentFromDb(window, id)) != null, { timeout: 15_000 })
    .toBe(true);
  return { app, window };
}

test.describe('Duplicates — newest wins by frontmatter updated', () => {
  test('the copy with the newer updated timestamp wins', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    fs.writeFileSync(
      path.join(vaultDir, 'older.md'),
      frontmatterNote(
        { id: NEWEST, title: 'Older', updated: '2024-03-01T00:00:00.000Z' },
        'older',
      ),
    );
    const first = await launchAndWait(userDataDir, vaultDir, NEWEST);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'newer.md'),
      frontmatterNote(
        { id: NEWEST, title: 'Newer', updated: '2024-09-01T00:00:00.000Z' },
        'newer',
      ),
    );

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, NEWEST))?.title, { timeout: 15_000 })
      .toBe('Newer');
    await expect
      .poll(async () => (await getDocumentFromDb(window, NEWEST))?.updatedAt)
      .toBe('2024-09-01T00:00:00.000Z');
    await expect
      .poll(() => fileIdsOnDisk(vaultDir).filter((id) => id === NEWEST).length, { timeout: 10_000 })
      .toBe(1);
    await expect
      .poll(() => fileIdsOnDisk(vaultDir, { trash: true }).filter((id) => id === NEWEST).length, {
        timeout: 10_000,
      })
      .toBe(1);
    await second.close();
  });

  test('a later-written file with a stale updated loses to an earlier file with a newer updated', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const canonical = path.join(vaultDir, 'canonical.md');
    fs.writeFileSync(
      canonical,
      frontmatterNote(
        { id: NEWEST, title: 'Canonical', updated: '2024-09-01T00:00:00.000Z' },
        'canonical',
      ),
    );
    const first = await launchAndWait(userDataDir, vaultDir, NEWEST);
    await first.app.close();

    // Written *now* (newer filesystem mtime) but with an older `updated`.
    const stale = path.join(vaultDir, 'stale.md');
    fs.writeFileSync(
      stale,
      frontmatterNote(
        { id: NEWEST, title: 'Stale', updated: '2024-03-01T00:00:00.000Z' },
        'stale',
      ),
    );
    expect(fs.statSync(stale).mtimeMs).toBeGreaterThanOrEqual(fs.statSync(canonical).mtimeMs);

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(window, NEWEST))?.title, { timeout: 15_000 })
      .toBe('Canonical');
    expect((await getDocumentFromDb(window, NEWEST))!.updatedAt).toBe('2024-09-01T00:00:00.000Z');
    expect(
      (await listDocumentsFromDb(window)).filter((doc) => doc.id === NEWEST).length,
    ).toBe(1);
    await second.close();
  });
});
