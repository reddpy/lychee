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
  frontmatterNote,
  moveViaIpc,
  readNote,
  waitForContent,
  waitForFile,
} from './vault-helpers';

/**
 * Stress and volume. Real vaults get bulk operations from sync clients, drag
 * batches, and scripts; these must not drop, duplicate, or mis-order notes.
 */

const bulkId = (i: number) => `51000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function bulkFiles(count: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) {
    files[`bulk-${i}.md`] = frontmatterNote(
      { id: bulkId(i), title: `Bulk ${i}`, order: i },
      `body ${i}`,
    );
  }
  return files;
}

test.describe('Stress — bulk import', () => {
  test.use({ vaultExtra: bulkFiles(25) });

  test('imports 25 files created at once', async ({ window }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 20_000 })
      .toBe(25);
    const ids = new Set((await listDocumentsFromDb(window)).map((doc) => doc.id));
    for (let i = 0; i < 25; i += 1) expect(ids.has(bulkId(i))).toBe(true);
  });
});

test.describe('Stress — bulk delete', () => {
  test.use({ vaultExtra: bulkFiles(25) });

  test('deleting 10 files at once trashes exactly those 10', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 20_000 })
      .toBe(25);

    for (let i = 0; i < 10; i += 1) {
      fs.rmSync(path.join(vaultDir, `bulk-${i}.md`));
    }

    await expect
      .poll(
        async () => {
          const trashed = new Set((await listTrashedFromDb(window)).map((doc) => doc.id));
          for (let i = 0; i < 10; i += 1) if (!trashed.has(bulkId(i))) return false;
          return true;
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    const live = await listDocumentsFromDb(window);
    expect(live.length).toBe(15);
    expect(live.some((doc) => doc.id === bulkId(0))).toBe(false);
    expect(live.some((doc) => doc.id === bulkId(11))).toBe(true);
  });
});

test.describe('Stress — bulk rename', () => {
  test.use({ vaultExtra: bulkFiles(25) });

  test('renaming 10 files at once retitles all of them', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 20_000 })
      .toBe(25);

    for (let i = 0; i < 10; i += 1) {
      fs.renameSync(
        path.join(vaultDir, `bulk-${i}.md`),
        path.join(vaultDir, `Renamed ${i}.md`),
      );
    }

    await expect
      .poll(
        async () => {
          const docs = await listDocumentsFromDb(window);
          for (let i = 0; i < 10; i += 1) {
            if (docs.find((doc) => doc.id === bulkId(i))?.title !== `Renamed ${i}`) return false;
          }
          return true;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });
});

test.describe('Stress — bulk reorder', () => {
  test.use({ vaultExtra: bulkFiles(8) });

  test('moving the last sibling to the front writes a complete new order', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 20_000 })
      .toBe(8);

    await moveViaIpc(window, bulkId(7), null, 0);

    // The move rewrites every sibling at its canonical (title-named) path.
    await waitForContent(vaultDir, 'Bulk 7.md', 'order: 0');
    const orders = Array.from({ length: 8 }, (_, i) =>
      Number(readNote(vaultDir, `Bulk ${i}.md`).data.order),
    ).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

test.describe('Stress — deep trees', () => {
  test.use({
    vaultExtra: (() => {
      const files: Record<string, string> = {};
      for (let chain = 0; chain < 2; chain += 1) {
        const id = (level: number) => `5200000${chain}-0000-4000-8000-${String(level).padStart(12, '0')}`;
        files[`Chain${chain}.md`] = frontmatterNote({ id: id(1), title: `Chain${chain}` });
        files[`Chain${chain}/L2.md`] = frontmatterNote({ id: id(2), title: 'L2' });
        files[`Chain${chain}/L2/L3.md`] = frontmatterNote({ id: id(3), title: 'L3' });
        files[`Chain${chain}/L2/L3/L4.md`] = frontmatterNote({ id: id(4), title: 'L4' });
        files[`Chain${chain}/L2/L3/L4/L5.md`] = frontmatterNote({ id: id(5), title: 'L5' });
      }
      return files;
    })(),
  });

  test('two 5-level chains import with correct parents', async ({ window }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 20_000 })
      .toBe(10);

    for (let chain = 0; chain < 2; chain += 1) {
      const id = (level: number) => `5200000${chain}-0000-4000-8000-${String(level).padStart(12, '0')}`;
      await expect
        .poll(async () => (await getDocumentFromDb(window, id(5)))?.parentId, { timeout: 20_000 })
        .toBe(id(4));
      await expect
        .poll(async () => (await getDocumentFromDb(window, id(4)))?.parentId)
        .toBe(id(3));
      await expect
        .poll(async () => (await getDocumentFromDb(window, id(2)))?.parentId)
        .toBe(id(1));
    }
  });
});

test.describe('Stress — churn', () => {
  test('a create → rename → delete cycle converges to a trashed note', async ({
    window,
    vaultDir,
  }) => {
    const id = '53000000-0000-4000-8000-000000000001';
    const file = path.join(vaultDir, 'churn.md');
    fs.writeFileSync(file, frontmatterNote({ id, title: 'Churn' }, 'v1'));
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
      .toBe('Churn');

    fs.writeFileSync(path.join(vaultDir, 'churn-renamed.md'), frontmatterNote({ id, title: 'Churn Renamed' }, 'v2'));
    fs.rmSync(file);

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
      .toBe('Churn Renamed');
    // The app rewrites at the canonical (title-named) path. Let chokidar's
    // awaitWriteFinish settle before deleting it.
    await waitForFile(path.join(vaultDir, 'Churn Renamed.md'));
    await window.waitForTimeout(700);
    fs.rmSync(path.join(vaultDir, 'Churn Renamed.md'));

    await expect
      .poll(
        async () => (await listTrashedFromDb(window)).some((doc) => doc.id === id),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.deletedAt != null)
      .toBe(true);
  });
});
