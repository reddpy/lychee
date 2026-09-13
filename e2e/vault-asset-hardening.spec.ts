import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { test, expect, getDocumentFromDb } from './electron-app';
import { frontmatterNote, listAssets, readRaw } from './vault-helpers';

/**
 * Asset boundary hardening. Only references under `assets/` with a supported
 * image extension are ported into local image ids; anything else (remote URLs,
 * odd paths, unsupported types, title strings) must be left byte-for-byte and
 * must never crash the import/export round-trip.
 */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PNG_B = Buffer.concat([PNG, Buffer.from('second')]);

const canonicalAssets = (vaultDir: string) =>
  listAssets(vaultDir).filter((name) => /^[a-f0-9]{64}\./.test(name));

async function writeThrough(page: Page, id: string): Promise<void> {
  await page.evaluate(async (docId) => {
    await (window as any).lychee.invoke('documents.update', { id: docId, emoji: '📎' });
  }, id);
  await page.waitForTimeout(500);
}

function seed(vaultDir: string, files: Record<string, Buffer | string>): void {
  fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const absolute = path.join(vaultDir, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }
}

test.describe('Vault asset hardening', () => {
  test('an asset inside a nested list is imported and re-exported', async ({
    window,
    vaultDir,
  }) => {
    const id = 'f6000000-0000-4000-8000-000000000001';
    seed(vaultDir, {
      'assets/pic.png': PNG,
      'Nested List.md': frontmatterNote(
        { id, title: 'Nested List' },
        'intro\n\n- item\n  ![p](assets/pic.png)',
      ),
    });

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await writeThrough(window, id);
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
  });

  test('an image title string survives the round-trip', async ({ window, vaultDir }) => {
    const id = 'f6000000-0000-4000-8000-000000000002';
    seed(vaultDir, {
      'assets/pic.png': PNG,
      'Titled.md': frontmatterNote({ id, title: 'Titled' }, '![p](assets/pic.png "A caption")'),
    });

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await writeThrough(window, id);
    await expect
      .poll(() => /assets\/[a-f0-9]{64}\.png "A caption"/.test(readRaw(vaultDir, 'Titled.md')), {
        timeout: 10_000,
      })
      .toBe(true);
  });

  test('an uppercase asset extension is imported', async ({ window, vaultDir }) => {
    const id = 'f6000000-0000-4000-8000-000000000003';
    seed(vaultDir, {
      'assets/PIC.PNG': PNG,
      'Upper Asset.md': frontmatterNote({ id, title: 'Upper Asset' }, '![p](assets/PIC.PNG)'),
    });

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
  });

  test('two references to one asset stay a single content-addressed file', async ({
    window,
    vaultDir,
  }) => {
    const id = 'f6000000-0000-4000-8000-000000000004';
    seed(vaultDir, {
      'assets/pic.png': PNG,
      'Twice.md': frontmatterNote(
        { id, title: 'Twice' },
        '![a](assets/pic.png)\n\n![b](assets/pic.png)',
      ),
    });

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await writeThrough(window, id);
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
  });

  test('two distinct assets export as two files', async ({ window, vaultDir }) => {
    const id = 'f6000000-0000-4000-8000-000000000005';
    seed(vaultDir, {
      'assets/a.png': PNG,
      'assets/b.png': PNG_B,
      'Distinct.md': frontmatterNote(
        { id, title: 'Distinct' },
        '![a](assets/a.png)\n\n![b](assets/b.png)',
      ),
    });

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await writeThrough(window, id);
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(2);
  });

  test('an unsupported asset extension is left as a plain path', async ({ window, vaultDir }) => {
    const id = 'f6000000-0000-4000-8000-000000000006';
    seed(vaultDir, {
      'assets/thing.bmp': PNG,
      'Unsupported.md': frontmatterNote({ id, title: 'Unsupported' }, '![p](assets/thing.bmp)'),
    });

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
      .toBe('Unsupported');
    // The unsupported path must remain the final stored content.
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 10_000 })
      .toContain('assets/thing.bmp');
    expect((await getDocumentFromDb(window, id))!.content).not.toContain('lychee-asset://');
  });

  test('a reference outside assets/ is left alone', async ({ window, vaultDir }) => {
    const id = 'f6000000-0000-4000-8000-000000000007';
    seed(vaultDir, {
      'images/pic.png': PNG,
      'Elsewhere.md': frontmatterNote({ id, title: 'Elsewhere' }, '![p](images/pic.png)'),
    });

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
      .toBe('Elsewhere');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 10_000 })
      .toContain('images/pic.png');
    expect((await getDocumentFromDb(window, id))!.content).not.toContain('lychee-asset://');
  });

  test('a remote image URL is never localised', async ({ window, vaultDir }) => {
    const id = 'f6000000-0000-4000-8000-000000000008';
    seed(vaultDir, {
      'Remote.md': frontmatterNote(
        { id, title: 'Remote' },
        '![p](https://example.com/pic.png)',
      ),
    });

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
      .toBe('Remote');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 10_000 })
      .toContain('https://example.com/pic.png');
    expect((await getDocumentFromDb(window, id))!.content).not.toContain('lychee-asset://');
  });
});
