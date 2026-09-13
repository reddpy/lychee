import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from './electron-app';
import { createNoteViaIpc, filePathForId, listMarkdown, readNote } from './vault-helpers';

/**
 * Filename derivation hardening. The title is data (frontmatter); the filename
 * is only a display-safe projection of it. A hostile or merely awkward title
 * must never create illegal/dotfile paths, escape the vault, collide silently,
 * or truncate the stored title.
 */

async function createAndPath(page: Page, vaultDir: string, title: string) {
  const doc = await createNoteViaIpc(page, title);
  await expect.poll(() => filePathForId(vaultDir, doc.id) != null, { timeout: 10_000 }).toBe(true);
  return { doc, relativePath: filePathForId(vaultDir, doc.id)! };
}

test.describe('Filename sanitization', () => {
  test('replaces a forward slash with a dash', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'Team/Notes');
    expect(relativePath).toBe('Team-Notes.md');
  });

  test('replaces a backslash with a dash', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'Team\\Notes');
    expect(relativePath).toBe('Team-Notes.md');
  });

  test('replaces a colon with a dash', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'Ratio 3:1');
    expect(relativePath).toBe('Ratio 3-1.md');
  });

  test('replaces glob characters with dashes', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'a*b?c');
    expect(relativePath).toBe('a-b-c.md');
  });

  test('replaces quotes and angles with dashes', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, '<a>"b"');
    expect(relativePath).toBe('-a--b-.md');
  });

  test('replaces a pipe with a dash', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'left|right');
    expect(relativePath).toBe('left-right.md');
  });

  test('preserves the original title in frontmatter', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'a/b:c*d');
    expect(readNote(vaultDir, relativePath).data.title).toBe('a/b:c*d');
  });

  test('prefixes a reserved Windows device name', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'CON');
    expect(relativePath).toBe('_CON.md');
  });

  test('prefixes a reserved device name case-insensitively', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'com1');
    expect(relativePath).toBe('_com1.md');
  });

  test('strips a leading dot so no dotfile is created', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, '.secret notes');
    expect(relativePath).toBe('secret notes.md');
  });

  test('strips trailing dots', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'Report...');
    expect(relativePath).toBe('Report.md');
  });

  test('trims trailing spaces from the title and the stem', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'Spaced   ');
    expect(relativePath).toBe('Spaced.md');
  });

  test('falls back to Untitled for a dots-only title', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, '...');
    expect(relativePath).toBe('Untitled.md');
  });

  test('creates a blank note for a whitespace-only title', async ({ window, vaultDir }) => {
    const { doc, relativePath } = await createAndPath(window, vaultDir, '   ');
    expect(doc.title).toBe('');
    expect(relativePath).toBe('Untitled.md');
  });

  test('strips control characters from the stem', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'a\u0007b\u001fc');
    expect(relativePath).toBe('abc.md');
  });

  test('strips internal newlines and tabs from the stem', async ({ window, vaultDir }) => {
    // Tabs/newlines are control characters, removed before whitespace collapsing.
    const { relativePath } = await createAndPath(window, vaultDir, 'line one\n\tline two');
    expect(relativePath).toBe('line oneline two.md');
  });

  test('replaces a run of mixed illegal characters', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'a/b\\c:d*e?f');
    expect(relativePath).toBe('a-b-c-d-e-f.md');
  });

  test('keeps an emoji-only title', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, '🎉🎊');
    expect(relativePath).toBe('🎉🎊.md');
  });

  test('normalizes a decomposed unicode title to NFC for the filename', async ({
    window,
    vaultDir,
  }) => {
    // "Cafe" + combining acute accent.
    const { relativePath } = await createAndPath(window, vaultDir, 'Cafe\u0301');
    expect(relativePath).toBe('Café.md');
  });

  test('byte-caps a very long title without exhausting the filename limit', async ({
    window,
    vaultDir,
  }) => {
    const { relativePath } = await createAndPath(window, vaultDir, 'x'.repeat(400));
    const stem = relativePath.replace(/\.md$/, '');
    expect(Buffer.byteLength(stem, 'utf8')).toBeLessThanOrEqual(200);
    expect(relativePath.endsWith('.md')).toBe(true);
  });

  test('byte-caps an emoji-heavy title on a code-point boundary', async ({ window, vaultDir }) => {
    const { relativePath } = await createAndPath(window, vaultDir, '🎈'.repeat(120));
    const stem = relativePath.replace(/\.md$/, '');
    expect(Buffer.byteLength(stem, 'utf8')).toBeLessThanOrEqual(200);
    // No replacement characters from splitting a surrogate pair.
    expect(stem).not.toContain('\uFFFD');
  });

  test('does not create a path outside the vault for a traversal title', async ({
    window,
    vaultDir,
  }) => {
    const { relativePath } = await createAndPath(window, vaultDir, '../escape');
    expect(relativePath).not.toContain('..');
    expect(relativePath).not.toContain('/');
    expect(fs.existsSync(path.join(vaultDir, relativePath))).toBe(true);
    // Nothing landed beside the vault.
    expect(fs.existsSync(path.join(path.dirname(vaultDir), 'escape.md'))).toBe(false);
  });

  test('maps the Untitled sentinel to a genuinely blank note', async ({ window, vaultDir }) => {
    const { doc, relativePath } = await createAndPath(window, vaultDir, 'Untitled');
    expect(doc.title).toBe('');
    expect(relativePath).toBe('Untitled.md');
  });

  test('rejects a second note with an identical title', async ({ window, vaultDir }) => {
    await createAndPath(window, vaultDir, 'Only One');
    const error = await window.evaluate(async () => {
      try {
        await (window as any).lychee.invoke('documents.create', { title: 'Only One' });
        return null;
      } catch (caught) {
        return String((caught as Error)?.message ?? caught);
      }
    });
    expect(error).toContain('Duplicate title');
    expect(listMarkdown(vaultDir).filter((rel) => rel === 'Only One.md').length).toBe(1);
  });
});
