import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  getDocumentFromDb,
  listDocumentsFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import { frontmatterNote, listAssets, readRaw, noteItem, waitForFile } from './vault-helpers';

/**
 * Asset/binary files at the OS level. Vault assets are content-addressed
 * (`assets/<sha256>.<ext>`), so the reference is stable and independent of the
 * local image id. If a file is deleted or renamed outside Lychee, the next
 * write-through must re-materialize it.
 */

// Minimal valid 1x1 PNG (correct magic bytes for the image store).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
// Same signature, different bytes → a distinct content hash.
const PNG_B = Buffer.concat([PNG, Buffer.from('second')]);

const canonicalAssets = (vaultDir: string) =>
  listAssets(vaultDir).filter((name) => /^[a-f0-9]{64}\./.test(name));

/** Force a vault write-through without changing content (emoji is a field change). */
async function writeThrough(page: Page, id: string): Promise<void> {
  await page.evaluate(
    async (docId) => {
      await (window as any).lychee.invoke('documents.update', { id: docId, emoji: '📎' });
    },
    id,
  );
  await page.waitForTimeout(500);
}

function seedNoteWithAsset(vaultDir: string, id: string, title: string): void {
  fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'assets', 'pic.png'), PNG);
  fs.writeFileSync(
    path.join(vaultDir, `${title}.md`),
    frontmatterNote({ id, title }, '![alt](assets/pic.png)'),
  );
}

test.describe('Vault assets (OS level)', () => {
  test('an external asset reference is imported and re-exported content-addressed', async ({
    window,
    vaultDir,
  }) => {
    const id = 'a5000000-0000-4000-8000-000000000001';
    seedNoteWithAsset(vaultDir, id, 'Pic Note');

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');

    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
    const body = readRaw(vaultDir, 'Pic Note.md');
    expect(body).toMatch(/assets\/[a-f0-9]{64}\.png/);
    await waitForFile(path.join(vaultDir, 'assets', canonicalAssets(vaultDir)[0]));
  });

  test('deleting the vault asset re-materializes it on the next write', async ({
    window,
    vaultDir,
  }) => {
    const id = 'a5000000-0000-4000-8000-000000000002';
    seedNoteWithAsset(vaultDir, id, 'Pic Note');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);

    for (const name of listAssets(vaultDir)) {
      fs.rmSync(path.join(vaultDir, 'assets', name));
    }
    expect(canonicalAssets(vaultDir).length).toBe(0);

    await writeThrough(window, id);

    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
  });

  test('renaming the vault asset at the OS level is healed on the next write', async ({
    window,
    vaultDir,
  }) => {
    const id = 'a5000000-0000-4000-8000-000000000003';
    seedNoteWithAsset(vaultDir, id, 'Pic Note');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
    const original = canonicalAssets(vaultDir)[0];

    fs.renameSync(
      path.join(vaultDir, 'assets', original),
      path.join(vaultDir, 'assets', 'moved.png'),
    );
    expect(canonicalAssets(vaultDir).length).toBe(0);

    await writeThrough(window, id);

    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
    expect(canonicalAssets(vaultDir)[0]).toBe(original);
  });

  test('two notes referencing the same asset share one content-addressed file', async ({
    window,
    vaultDir,
  }) => {
    fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, 'assets', 'shared.png'), PNG);
    const a = 'a5000000-0000-4000-8000-000000000004';
    const b = 'a5000000-0000-4000-8000-000000000005';
    fs.writeFileSync(
      path.join(vaultDir, 'Share A.md'),
      frontmatterNote({ id: a, title: 'Share A' }, '![x](assets/shared.png)'),
    );
    fs.writeFileSync(
      path.join(vaultDir, 'Share B.md'),
      frontmatterNote({ id: b, title: 'Share B' }, '![y](assets/shared.png)'),
    );

    await expect
      .poll(
        async () =>
          ((await getDocumentFromDb(window, a))?.content ?? '').includes('lychee-asset://') &&
          ((await getDocumentFromDb(window, b))?.content ?? '').includes('lychee-asset://'),
        { timeout: 15_000 },
      )
      .toBe(true);
    await writeThrough(window, a);
    await writeThrough(window, b);

    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
    const reference = canonicalAssets(vaultDir)[0].replace(/^.*?([a-f0-9]{64}\..*)$/, '$1');
    expect(readRaw(vaultDir, 'Share A.md')).toContain(reference);
    expect(readRaw(vaultDir, 'Share B.md')).toContain(reference);
  });

  test('an asset referenced by a nested note is still materialized', async ({
    window,
    vaultDir,
  }) => {
    const parent = 'a6000000-0000-4000-8000-000000000001';
    const child = 'a6000000-0000-4000-8000-000000000002';
    fs.writeFileSync(
      path.join(vaultDir, 'Album.md'),
      frontmatterNote({ id: parent, title: 'Album' }, 'album'),
    );
    fs.mkdirSync(path.join(vaultDir, 'Album'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, 'assets', 'nested.png'), PNG);
    fs.writeFileSync(
      path.join(vaultDir, 'Album', 'Photo.md'),
      frontmatterNote({ id: child, title: 'Photo' }, '![p](assets/nested.png)'),
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, child))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('lychee-asset://');
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
  });

  test('an asset referenced with a ./ prefix is imported', async ({ window, vaultDir }) => {
    const id = 'a6000000-0000-4000-8000-000000000003';
    fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, 'assets', 'dot.png'), PNG);
    fs.writeFileSync(
      path.join(vaultDir, 'Dot.md'),
      frontmatterNote({ id, title: 'Dot' }, '![d](./assets/dot.png)'),
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
  });

  test('two different assets in one note produce two files', async ({ window, vaultDir }) => {
    const id = 'a6000000-0000-4000-8000-000000000004';
    fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, 'assets', 'a.png'), PNG);
    fs.writeFileSync(path.join(vaultDir, 'assets', 'b.png'), PNG_B);
    fs.writeFileSync(
      path.join(vaultDir, 'Two.md'),
      frontmatterNote({ id, title: 'Two' }, '![a](assets/a.png)\n\n![b](assets/b.png)'),
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await writeThrough(window, id);
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(2);
  });

  test('a shared asset stays deduplicated across a relaunch', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, 'assets', 'shared.png'), PNG);
    const a = 'a6000000-0000-4000-8000-000000000005';
    const b = 'a6000000-0000-4000-8000-000000000006';
    fs.writeFileSync(
      path.join(vaultDir, 'RA.md'),
      frontmatterNote({ id: a, title: 'RA' }, '![x](assets/shared.png)'),
    );
    fs.writeFileSync(
      path.join(vaultDir, 'RB.md'),
      frontmatterNote({ id: b, title: 'RB' }, '![y](assets/shared.png)'),
    );

    const first = await launchLychee({ userDataDir, vaultDir });
    await firstWindowReady(first);
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 15_000 }).toBe(1);
    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir });
    const window = await firstWindowReady(second);
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(2);
    await expect.poll(() => canonicalAssets(vaultDir).length).toBe(1);
    await second.close();
  });

  test('deleting the asset does not break the open note', async ({ window, vaultDir }) => {
    const id = 'a6000000-0000-4000-8000-000000000007';
    seedNoteWithAsset(vaultDir, id, 'Open Asset');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');

    await noteItem(window, 'Open Asset').click();
    for (const name of listAssets(vaultDir)) fs.rmSync(path.join(vaultDir, 'assets', name));

    // The editor keeps working (the image is stored locally under its own id).
    await expect(window.locator('main:visible .ContentEditable__root')).toBeVisible();
    await expect(window.getByText('Something went wrong')).toHaveCount(0);
  });
});
