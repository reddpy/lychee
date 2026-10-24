import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
}));
vi.mock('../db', async () => {
  const { getTestDb } = await import('./helpers');
  return { getDb: () => getTestDb() };
});

import { app } from 'electron';
import { createTestDb, closeTestDb } from './helpers';
import { contentHashOf, saveImageBuffer, getImage } from '../repos/images';
import { exportAssetsToVault, importAssetsFromVault } from '../assets';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('lychee-asset-test-payload'),
]);

let userData: string;
let vault: string;

beforeEach(() => {
  createTestDb();
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-assets-userdata-'));
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-assets-vault-'));
  (app.getPath as unknown as ReturnType<typeof vi.fn>).mockReturnValue(userData);
});

afterEach(() => {
  closeTestDb();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('asset vault boundary', () => {
  it('exports a local asset token to a content-addressed file', () => {
    const { id } = saveImageBuffer(PNG, 'image/png');
    const hash = contentHashOf(PNG);

    const markdown = exportAssetsToVault(vault, `![Pic](lychee-asset://${id})`);
    expect(markdown).toBe(`![Pic](assets/${hash}.png)`);

    const assetPath = path.join(vault, 'assets', `${hash}.png`);
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(fs.readFileSync(assetPath)).toEqual(PNG);
  });

  it('round-trips export -> import to the same local image (dedup by content)', () => {
    const { id } = saveImageBuffer(PNG, 'image/png');
    const exported = exportAssetsToVault(vault, `![Pic](lychee-asset://${id})`);

    const imported = importAssetsFromVault(vault, exported);
    expect(imported).toBe(`![Pic](lychee-asset://${id})`);
  });

  it('reuses one local image for identical content (content-addressed dedup)', () => {
    const first = saveImageBuffer(PNG, 'image/png');
    const second = saveImageBuffer(PNG, 'image/png');
    expect(second.id).not.toBe(first.id);

    // Both tokens export to the same asset...
    const a = exportAssetsToVault(vault, `![](lychee-asset://${first.id})`);
    const b = exportAssetsToVault(vault, `![](lychee-asset://${second.id})`);
    expect(a).toBe(b);

    // ...and importing resolves to a single local image by content hash.
    const imported = importAssetsFromVault(vault, a);
    expect(imported).toMatch(/^!\[\]\(lychee-asset:\/\//);
    const id = imported.match(/lychee-asset:\/\/([A-Za-z0-9._-]+)/)![1];
    expect(getImage(id)?.contentHash).toBe(contentHashOf(PNG));
  });

  it('leaves a token untouched when the local asset is missing', () => {
    const markdown = `![Pic](lychee-asset://does-not-exist)`;
    expect(exportAssetsToVault(vault, markdown)).toBe(markdown);
  });

  it('leaves a missing asset link untouched on import', () => {
    const markdown = `![Pic](assets/missing.png)`;
    expect(importAssetsFromVault(vault, markdown)).toBe(markdown);
  });

  it('does not rewrite `assets/` that is not a link target', () => {
    const markdown = 'See https://example.com/assets/logo.png for the logo.';
    expect(importAssetsFromVault(vault, markdown)).toBe(markdown);
  });

  it('imports an uppercase image extension and re-exports lowercase', () => {
    fs.mkdirSync(path.join(vault, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'assets', 'PIC.PNG'), PNG);

    const imported = importAssetsFromVault(vault, '![Pic](assets/PIC.PNG)');
    expect(imported).toMatch(/^!\[Pic\]\(lychee-asset:\/\//);
    const id = imported.match(/lychee-asset:\/\/([A-Za-z0-9._-]+)/)![1];
    expect(getImage(id)?.mimeType).toBe('image/png');

    const exported = exportAssetsToVault(vault, imported);
    expect(exported).toMatch(/^!\[Pic\]\(assets\/[a-f0-9]{64}\.png\)$/);
  });

  it('imports an asset referenced with a ./ prefix', () => {
    fs.mkdirSync(path.join(vault, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'assets', 'dot.png'), PNG);

    expect(importAssetsFromVault(vault, '![Pic](./assets/dot.png)')).toMatch(
      /^!\[Pic\]\(lychee-asset:\/\//,
    );
  });

  it('preserves a link title on import', () => {
    fs.mkdirSync(path.join(vault, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'assets', 'titled.png'), PNG);

    const imported = importAssetsFromVault(vault, '![Pic](assets/titled.png "A caption")');
    expect(imported).toContain('lychee-asset://');
    expect(imported).toContain('"A caption"');
  });

  it('leaves video, audio, and document assets as paths', () => {
    fs.mkdirSync(path.join(vault, 'assets'), { recursive: true });
    for (const extension of ['mp4', 'webm', 'mov', 'pdf', 'zip']) {
      fs.writeFileSync(path.join(vault, 'assets', `file.${extension}`), Buffer.from('payload'));
      const markdown = `![File](assets/file.${extension})`;
      expect(importAssetsFromVault(vault, markdown)).toBe(markdown);
    }
  });

  it('imports the image but preserves the video in a mixed note', () => {
    fs.mkdirSync(path.join(vault, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'assets', 'pic.png'), PNG);
    fs.writeFileSync(path.join(vault, 'assets', 'clip.mp4'), Buffer.from('video'));

    const imported = importAssetsFromVault(
      vault,
      '![Pic](assets/pic.png)\n\n![Clip](assets/clip.mp4)',
    );
    expect(imported).toMatch(/lychee-asset:\/\//);
    expect(imported).toContain('![Clip](assets/clip.mp4)');
  });

  it('dedups one vault asset across two notes on import', () => {
    fs.mkdirSync(path.join(vault, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'assets', 'shared.png'), PNG);

    const first = importAssetsFromVault(vault, '![A](assets/shared.png)');
    const second = importAssetsFromVault(vault, '![B](assets/shared.png)');
    const id = (markdown: string) =>
      markdown.match(/lychee-asset:\/\/([A-Za-z0-9._-]+)/)![1];
    expect(id(first)).toBe(id(second));
  });

  it('leaves a nested assets path untouched', () => {
    fs.mkdirSync(path.join(vault, 'assets', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'assets', 'sub', 'deep.png'), PNG);

    const markdown = '![Deep](assets/sub/deep.png)';
    expect(importAssetsFromVault(vault, markdown)).toBe(markdown);
  });

  it('exports two distinct images to two content-addressed files', () => {
    const other = Buffer.concat([PNG, Buffer.from('other')]);
    const first = saveImageBuffer(PNG, 'image/png');
    const second = saveImageBuffer(other, 'image/png');

    const markdown = exportAssetsToVault(
      vault,
      `![A](lychee-asset://${first.id})\n\n![B](lychee-asset://${second.id})`,
    );
    const paths = [...markdown.matchAll(/assets\/([a-f0-9]{64}\.png)/g)].map((match) => match[1]);
    expect(new Set(paths).size).toBe(2);
    for (const asset of paths) {
      expect(fs.existsSync(path.join(vault, 'assets', asset))).toBe(true);
    }
  });

  it('preserves an optional link title', () => {
    const { id } = saveImageBuffer(PNG, 'image/png');
    const hash = contentHashOf(PNG);
    const markdown = exportAssetsToVault(vault, `![Pic](lychee-asset://${id} "My title")`);
    expect(markdown).toBe(`![Pic](assets/${hash}.png "My title")`);
  });
});
