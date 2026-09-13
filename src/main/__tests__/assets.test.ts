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

  it('preserves an optional link title', () => {
    const { id } = saveImageBuffer(PNG, 'image/png');
    const hash = contentHashOf(PNG);
    const markdown = exportAssetsToVault(vault, `![Pic](lychee-asset://${id} "My title")`);
    expect(markdown).toBe(`![Pic](assets/${hash}.png "My title")`);
  });
});
