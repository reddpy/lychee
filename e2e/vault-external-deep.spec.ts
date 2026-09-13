import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
} from './electron-app';
import {
  writeNote,
  frontmatterNote,
  readNote,
  listMarkdown,
  noteItem,
  visibleTitle,
  waitForContent,
} from './vault-helpers';

/**
 * Deep OS → Lychee mutations: combined field changes, sequences, nesting, bulk,
 * unicode, frontmatter retitles, and live editor refresh.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';
const LEGACY_ID = '77777777-7777-4777-8777-777777777777';
const UNTITLED_ID = '66666666-6666-4666-8666-666666666666';

test.describe('OS → Lychee — deep (seeded)', () => {
  test.use({ vaultSeed: 'vault' });

  test('one external edit adopts title, content, emoji, bookmark, and order together', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');

    writeNote(
      vaultDir,
      'Roadmap.md',
      {
        id: ROADMAP_ID,
        title: 'Roadmap V2',
        emoji: '📌',
        bookmarked: '2024-06-01T00:00:00.000Z',
        order: 3,
      },
      'totally new body',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap V2');
    const doc = (await getDocumentFromDb(window, ROADMAP_ID))!;
    expect(doc.emoji).toBe('📌');
    expect(doc.sortOrder).toBe(3);
    expect(doc.metadata?.bookmarkedAt).toBe('2024-06-01T00:00:00.000Z');
    expect(doc.content).toContain('totally new body');
    await waitForContent(vaultDir, 'Roadmap V2.md', 'totally new body');
  });

  test('sequential external edits to different notes all apply', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);

    writeNote(vaultDir, 'Bookmarked.md', { id: BOOKMARKED_ID, title: 'Bookmarked' }, 'edit one');
    writeNote(vaultDir, 'Legacy.md', { id: LEGACY_ID, title: 'Legacy' }, 'edit two');
    writeNote(vaultDir, 'Untitled.md', { id: UNTITLED_ID }, 'edit three');

    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('edit one');
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.content ?? '')
      .toContain('edit two');
    await expect
      .poll(async () => (await getDocumentFromDb(window, UNTITLED_ID))?.content ?? '')
      .toContain('edit three');
  });

  test('an external edit to a nested child does not disturb its parent', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    writeNote(vaultDir, 'Projects/Alpha.md', { id: ALPHA_ID, title: 'Alpha' }, 'nested edit');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('nested edit');
    const parent = (await getDocumentFromDb(window, PROJECTS_ID))!;
    expect(parent.title).toBe('Projects');
    expect(parent.deletedAt).toBeNull();
  });

  test('a frontmatter title change retitles and renames the file', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');

    writeNote(vaultDir, 'Roadmap.md', { id: ROADMAP_ID, title: 'Frontmatter Renamed' }, 'body');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Frontmatter Renamed');
    await waitForContent(vaultDir, 'Frontmatter Renamed.md', 'body');
    expect(listMarkdown(vaultDir)).not.toContain('Roadmap.md');
  });

  test('an external edit to the open note refreshes the editor', async ({ window, vaultDir }) => {
    await noteItem(window, 'Roadmap').click();
    await expect(visibleTitle(window)).toHaveText('Roadmap');

    writeNote(
      vaultDir,
      'Roadmap.md',
      { id: ROADMAP_ID, title: 'Roadmap', emoji: '🗺️', order: 0 },
      'live refreshed body',
    );

    await expect(window.locator('main:visible .ContentEditable__root')).toContainText(
      'live refreshed body',
      { timeout: 15_000 },
    );
  });

  test('an external edit with unicode and CRLF survives a write-through', async ({
    window,
    vaultDir,
  }) => {
    const id = 'e1000000-0000-4000-8000-000000000001';
    fs.writeFileSync(
      path.join(vaultDir, 'Uni.md'),
      frontmatterNote({ id, title: 'Uni' }, 'Café 東京 🎉 roarrr'),
    );
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('Café 東京');

    // Force a rewrite through the app; the unicode body must survive.
    await window.evaluate(
      async (docId) => {
        await (window as any).lychee.invoke('documents.update', { id: docId, emoji: '📎' });
      },
      id,
    );
    await waitForContent(vaultDir, 'Uni.md', 'Café 東京');
  });
});

test.describe('OS → Lychee — deep (bulk)', () => {
  test('editing eight files at once applies all new bodies', async ({ window, vaultDir }) => {
    for (let i = 0; i < 8; i += 1) {
      writeNote(
        vaultDir,
        `Bulk Edit ${i}.md`,
        { id: `e2000000-0000-4000-8000-00000000000${i}`, title: `Bulk Edit ${i}` },
        `first ${i}`,
      );
    }
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 20_000 })
      .toBe(8);

    for (let i = 0; i < 8; i += 1) {
      writeNote(
        vaultDir,
        `Bulk Edit ${i}.md`,
        { id: `e2000000-0000-4000-8000-00000000000${i}`, title: `Bulk Edit ${i}` },
        `second ${i}`,
      );
    }

    await expect
      .poll(
        async () => {
          const docs = await listDocumentsFromDb(window);
          for (let i = 0; i < 8; i += 1) {
            const doc = docs.find((d) => d.id === `e2000000-0000-4000-8000-00000000000${i}`);
            if (!doc?.content.includes(`second ${i}`)) return false;
          }
          return true;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    expect(readNote(vaultDir, 'Bulk Edit 3.md').data.title).toBe('Bulk Edit 3');
  });
});
