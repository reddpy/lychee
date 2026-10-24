import fs from 'fs';
import path from 'path';
import { test, expect, getDocumentFromDb } from './electron-app';
import {
  createNote,
  frontmatterNote,
  listAssets,
  listMarkdown,
  noteItem,
  readRaw,
  waitForContent,
  writeNote,
} from './vault-helpers';

/**
 * Cross-device ASSETS.
 *
 * A second device puts a note plus its binary into the shared vault. The running
 * app must import the bytes into its local image store, rewrite the link to a
 * local token, keep the content-addressed vault path, and never corrupt
 * unsupported media (video/PDF/ZIP) or a link whose binary has not arrived yet.
 */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PNG_B = Buffer.concat([PNG, Buffer.from('second image')]);

const ASSET_ID = 'a9000000-0000-4000-8000-000000000001';
const UPPER_ID = 'a9000000-0000-4000-8000-000000000003';
const MISSING_ID = 'a9000000-0000-4000-8000-000000000004';
const MEDIA_ID = 'a9000000-0000-4000-8000-000000000005';
const MIXED_ID = 'a9000000-0000-4000-8000-000000000006';
const PAIR_ID = 'a9000000-0000-4000-8000-000000000007';
const SHARED_A_ID = 'a9000000-0000-4000-8000-000000000008';
const SHARED_B_ID = 'a9000000-0000-4000-8000-000000000009';

const canonicalAssets = (vaultDir: string): string[] =>
  listAssets(vaultDir).filter((name) => /^[a-f0-9]{64}\./.test(name));

function tokenId(content: string): string | null {
  return content.match(/lychee-asset:\/\/([A-Za-z0-9._-]+)/)?.[1] ?? null;
}

async function waitForToken(
  window: Parameters<typeof getDocumentFromDb>[0],
  id: string,
): Promise<{ content: string; token: string }> {
  let content = '';
  await expect
    .poll(async () => {
      content = (await getDocumentFromDb(window, id))?.content ?? '';
      return tokenId(content);
    }, { timeout: 15_000 })
    .not.toBeNull();
  return { content, token: tokenId(content)! };
}

async function localImageFile(
  window: Parameters<typeof getDocumentFromDb>[0],
  testDir: string,
  token: string,
): Promise<string> {
  const filePath = await window.evaluate(
    async (id) => (await (window as any).lychee.invoke('images.getPath', { id })).filePath,
    token,
  );
  return path.join(testDir, 'userdata', 'images', filePath);
}

test.describe('cross-device assets — a remote note materializes its binary', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'assets/pic.png': PNG,
      'Remote Asset.md': frontmatterNote({ id: ASSET_ID, title: 'Remote Asset' }, '![Pic](assets/pic.png)'),
    },
  });

  test('imports the bytes locally and renders the image', async ({ window, vaultDir, testDir }) => {
    const { token } = await waitForToken(window, ASSET_ID);

    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
    const assetFile = canonicalAssets(vaultDir)[0];
    expect(assetFile).toMatch(/\.png$/);
    expect(fs.readFileSync(path.join(vaultDir, 'assets', assetFile))).toEqual(PNG);

    const local = await localImageFile(window, testDir, token);
    expect(fs.existsSync(local)).toBe(true);
    expect(fs.readFileSync(local)).toEqual(PNG);

    await noteItem(window, 'Remote Asset').click();
    await expect(window.locator('main:visible .editor-image')).toHaveCount(1, { timeout: 10_000 });
    await waitForContent(vaultDir, 'Remote Asset.md', `assets/${assetFile}`);
  });
});

test.describe('cross-device assets — one binary, two notes', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'assets/shared.png': PNG,
      'Shared A.md': frontmatterNote({ id: SHARED_A_ID, title: 'Shared A' }, '![A](assets/shared.png)'),
      'Shared B.md': frontmatterNote({ id: SHARED_B_ID, title: 'Shared B' }, '![B](assets/shared.png)'),
    },
  });

  test('both notes resolve to one local image and one vault asset', async ({ window, vaultDir }) => {
    const first = await waitForToken(window, SHARED_A_ID);
    const second = await waitForToken(window, SHARED_B_ID);

    expect(first.token).toBe(second.token);
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
    const hash = canonicalAssets(vaultDir)[0];
    expect(readRaw(vaultDir, 'Shared A.md')).toContain(`assets/${hash}`);
    expect(readRaw(vaultDir, 'Shared B.md')).toContain(`assets/${hash}`);
  });
});

test.describe('cross-device assets — missing binary', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'Missing Asset.md': frontmatterNote(
        { id: MISSING_ID, title: 'Missing Asset' },
        '![Missing](assets/missing.png)',
      ),
    },
  });

  test('preserves the relative link and still imports the note', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, MISSING_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('assets/missing.png');
    expect((await getDocumentFromDb(window, MISSING_ID))!.content).not.toContain('lychee-asset://');
    await expect(noteItem(window, 'Missing Asset')).toBeVisible();
    expect(canonicalAssets(vaultDir)).toEqual([]);
    await waitForContent(vaultDir, 'Missing Asset.md', 'assets/missing.png');
  });
});

test.describe('cross-device assets — unsupported media', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'assets/clip.mp4': Buffer.from('video payload'),
      'assets/paper.pdf': Buffer.from('pdf payload'),
      'assets/bundle.zip': Buffer.from('zip payload'),
      'Media Note.md': frontmatterNote(
        { id: MEDIA_ID, title: 'Media Note' },
        [
          '![Clip](assets/clip.mp4)',
          '',
          '![Paper](assets/paper.pdf)',
          '',
          '![Bundle](assets/bundle.zip)',
        ].join('\n'),
      ),
    },
  });

  test('keeps video/PDF/ZIP links as paths instead of corrupting them', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, MEDIA_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('assets/clip.mp4');
    const content = (await getDocumentFromDb(window, MEDIA_ID))!.content;
    expect(content).toContain('assets/paper.pdf');
    expect(content).toContain('assets/bundle.zip');
    expect(content).not.toContain('lychee-asset://');
    expect(canonicalAssets(vaultDir)).toEqual([]);
    expect(fs.existsSync(path.join(vaultDir, 'assets', 'clip.mp4'))).toBe(true);
  });
});

test.describe('cross-device assets — mixed image and video', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'assets/pic.png': PNG,
      'assets/clip.mp4': Buffer.from('video payload'),
      'Mixed Note.md': frontmatterNote(
        { id: MIXED_ID, title: 'Mixed Note' },
        '![Pic](assets/pic.png)\n\n![Clip](assets/clip.mp4)',
      ),
    },
  });

  test('imports the image and leaves the video path alone', async ({ window, vaultDir }) => {
    const { content } = await waitForToken(window, MIXED_ID);
    expect(content).toContain('![Clip](assets/clip.mp4)');
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
  });
});

test.describe('cross-device assets — uppercase extension', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'assets/PIC.PNG': PNG,
      'Upper.md': frontmatterNote({ id: UPPER_ID, title: 'Upper' }, '![Pic](assets/PIC.PNG)'),
    },
  });

  test('imports it as a PNG and stores a lowercase canonical name', async ({ window, vaultDir }) => {
    await waitForToken(window, UPPER_ID);
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
    expect(canonicalAssets(vaultDir)[0]).toMatch(/\.png$/);
  });
});

test.describe('cross-device assets — two distinct images', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: {
      'assets/a.png': PNG,
      'assets/b.png': PNG_B,
      'Pair.md': frontmatterNote(
        { id: PAIR_ID, title: 'Pair' },
        '![A](assets/a.png)\n\n![B](assets/b.png)',
      ),
    },
  });

  test('materializes both and keeps two content-addressed files', async ({ window, vaultDir }) => {
    await waitForToken(window, PAIR_ID);
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(2);
  });
});

test.describe('cross-device assets — arriving while the app runs', () => {
  test.use({ vaultSeed: 'vault' });

  test('an open note picks up a remote asset and renders it', async ({ window, vaultDir }) => {
    const title = 'Live Open Asset';
    await createNote(window, title);
    const id = await noteItem(window, title).getAttribute('data-note-id');
    if (!id) throw new Error('note has no id');

    fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, 'assets', 'live-open.png'), PNG);
    writeNote(vaultDir, `${title}.md`, { id, title }, '![Live](assets/live-open.png)');

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await expect(window.locator('main:visible .editor-image')).toHaveCount(1, { timeout: 15_000 });
  });

  test('a note and its binary written after launch are imported live', async ({
    window,
    vaultDir,
  }) => {
    const id = 'a9000000-0000-4000-8000-000000000010';
    fs.mkdirSync(path.join(vaultDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, 'assets', 'live.png'), PNG);
    writeNote(
      vaultDir,
      'Live Asset.md',
      { id, title: 'Live Asset' },
      '![Live](assets/live.png)',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('lychee-asset://');
    await expect.poll(() => canonicalAssets(vaultDir).length, { timeout: 10_000 }).toBe(1);
    await expect(noteItem(window, 'Live Asset')).toBeVisible();
    expect(listMarkdown(vaultDir)).toContain('Live Asset.md');
  });
});
