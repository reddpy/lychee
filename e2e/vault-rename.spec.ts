import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
} from './electron-app';
import {
  renameVaultPath,
  readNote,
  listMarkdown,
  noteItem,
  visibleTitle,
  createNote,
  replaceTitle,
  moveViaIpc,
  waitForFile,
  waitForFileGone,
  frontmatterNote,
} from './vault-helpers';

/**
 * Rename — the single most common OS interaction. Real users rename files in
 * Finder and folders full of notes. Identity (frontmatter id) must survive, and
 * Lychee must follow the rename in both directions.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
const BETA_ID = '44444444-4444-4444-8444-444444444444';
const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';

test.use({ vaultSeed: 'vault' });

test.describe('Rename', () => {
  test('an OS rename retitles in place and keeps identity', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');

    renameVaultPath(vaultDir, 'Roadmap.md', 'Product Roadmap.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Product Roadmap');
    expect(listMarkdown(vaultDir)).toContain('Product Roadmap.md');
    expect(listMarkdown(vaultDir)).not.toContain('Roadmap.md');
    expect((await getDocumentFromDb(window, ROADMAP_ID))!.id).toBe(ROADMAP_ID);
    await expect(noteItem(window, 'Product Roadmap')).toBeVisible();
  });

  test('renaming a nested child keeps its parent link', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.title, { timeout: 15_000 })
      .toBe('Alpha');

    renameVaultPath(vaultDir, 'Projects/Alpha.md', 'Projects/Alpha Renamed.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.title, { timeout: 15_000 })
      .toBe('Alpha Renamed');
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId)
      .toBe(PROJECTS_ID);
    expect(listMarkdown(vaultDir)).toContain('Projects/Alpha Renamed.md');
  });

  test('renaming a parent note and its folder carries the subtree', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, PROJECTS_ID))?.title, { timeout: 15_000 })
      .toBe('Projects');

    fs.renameSync(path.join(vaultDir, 'Projects.md'), path.join(vaultDir, 'Work.md'));
    fs.renameSync(path.join(vaultDir, 'Projects'), path.join(vaultDir, 'Work'));

    await expect
      .poll(async () => (await getDocumentFromDb(window, PROJECTS_ID))?.title, { timeout: 15_000 })
      .toBe('Work');
    // Children were carried with the folder and keep their parent + identity.
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId)
      .toBe(PROJECTS_ID);
    await expect
      .poll(async () => (await getDocumentFromDb(window, BETA_ID))?.parentId)
      .toBe(PROJECTS_ID);
    await waitForFile(path.join(vaultDir, 'Work/Alpha.md'));
    await waitForFileGone(path.join(vaultDir, 'Projects.md'));
  });

  test('renaming a file to the blank sentinel clears the title', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    renameVaultPath(vaultDir, 'Bookmarked.md', 'Untitled.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('');
  });

  test('two externally-authored notes with the same title dedupe their filenames', async ({
    window,
    vaultDir,
  }) => {
    const a = 'a1000000-0000-4000-8000-000000000001';
    const b = 'a1000000-0000-4000-8000-000000000002';
    const twin = (id: string, body: string) =>
      `---\nid: "${id}"\ntitle: "Twin"\ncreated: "2024-01-01T00:00:00.000Z"\nupdated: "2024-01-02T00:00:00.000Z"\ncontent_schema_version: 1\n---\n\n${body}`;
    fs.writeFileSync(path.join(vaultDir, 'twin-a.md'), twin(a, 'first'));
    fs.writeFileSync(path.join(vaultDir, 'twin-b.md'), twin(b, 'second'));

    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(window)).filter((doc) => doc.title === 'Twin').length,
        { timeout: 15_000 },
      )
      .toBe(2);

    // Both notes keep their identity and their own file; neither clobbers the
    // other even though they share a title.
    const twins = (await listDocumentsFromDb(window)).filter((doc) => doc.title === 'Twin');
    expect(new Set(twins.map((doc) => doc.id))).toEqual(new Set([a, b]));
    const fileIds = listMarkdown(vaultDir).map((rel) => readNote(vaultDir, rel).data.id);
    expect(fileIds).toContain(a);
    expect(fileIds).toContain(b);
  });

  test('an app rename of a parent renames the folder and moves its children', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Folder');
    await createNote(window, 'Kiddo');
    const docs = await listDocumentsFromDb(window);
    const parent = docs.find((doc) => doc.title === 'Folder')!;
    const child = docs.find((doc) => doc.title === 'Kiddo')!;
    await moveViaIpc(window, child.id, parent.id, 0);
    await waitForFile(path.join(vaultDir, 'Folder/Kiddo.md'));

    await noteItem(window, 'Folder').click();
    await replaceTitle(window, 'Folder Renamed');

    await waitForFile(path.join(vaultDir, 'Folder Renamed.md'));
    await waitForFile(path.join(vaultDir, 'Folder Renamed/Kiddo.md'));
    await waitForFileGone(path.join(vaultDir, 'Folder.md'));
    await expect(noteItem(window, 'Folder Renamed')).toBeVisible();
    expect(readNote(vaultDir, 'Folder Renamed.md').data.id).toBe(parent.id);
  });

  test('an app rename updates the open tab label', async ({ window, vaultDir }) => {
    await createNote(window, 'Tab Title');
    await waitForFile(path.join(vaultDir, 'Tab Title.md'));

    await replaceTitle(window, 'Tab Renamed');

    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Tab Renamed' })).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').filter({ hasText: 'Tab Title' })).toHaveCount(0);
    await expect(visibleTitle(window)).toHaveText('Tab Renamed');
  });

  test('renaming to a title that only differs by case is rejected as a duplicate', async ({
    window,
  }) => {
    await createNote(window, 'Case Note');
    await createNote(window, 'Other Note');
    const otherId = (await listDocumentsFromDb(window)).find(
      (doc) => doc.title === 'Other Note',
    )!.id;

    await noteItem(window, 'Other Note').click();
    await replaceTitle(window, 'case note');

    await expect(
      window.locator('main:visible').getByText('A note with this title already exists.'),
    ).toBeVisible({ timeout: 5000 });
    // The original titles are untouched.
    expect((await getDocumentFromDb(window, otherId))!.title).toBe('Other Note');
    expect(
      (await listDocumentsFromDb(window)).some((doc) => doc.title === 'Case Note'),
    ).toBe(true);
  });

  test('renaming a title back to its original keeps one file', async ({ window, vaultDir }) => {
    await createNote(window, 'Orig');
    await waitForFile(path.join(vaultDir, 'Orig.md'));

    await replaceTitle(window, 'Temp Name');
    await waitForFile(path.join(vaultDir, 'Temp Name.md'));

    await replaceTitle(window, 'Orig');
    await waitForFile(path.join(vaultDir, 'Orig.md'));
    await waitForFileGone(path.join(vaultDir, 'Temp Name.md'));
    expect(readNote(vaultDir, 'Orig.md').data.title).toBe('Orig');
  });

  test('renaming to a title with parentheses works and renames the file', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Plain');
    await waitForFile(path.join(vaultDir, 'Plain.md'));

    await replaceTitle(window, 'Plan (v2)');
    await waitForFile(path.join(vaultDir, 'Plan (v2).md'));
    expect(readNote(vaultDir, 'Plan (v2).md').data.title).toBe('Plan (v2)');
  });

  test('an OS rename to an uppercase .MD name retitles', async ({ window, vaultDir }) => {
    await createNote(window, 'Caps');
    await waitForFile(path.join(vaultDir, 'Caps.md'));
    const id = (await listDocumentsFromDb(window)).find((doc) => doc.title === 'Caps')!.id;

    fs.renameSync(path.join(vaultDir, 'Caps.md'), path.join(vaultDir, 'Caps Upper.MD'));

    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
      .toBe('Caps Upper');
  });
});

test.describe('Rename — deep nesting', () => {
  test.use({
    vaultExtra: {
      'Deep.md': frontmatterNote({ id: 'aa000000-0000-4000-8000-000000000001', title: 'Deep' }),
      'Deep/Two.md': frontmatterNote({ id: 'aa000000-0000-4000-8000-000000000002', title: 'Two' }),
      'Deep/Two/Three.md': frontmatterNote({
        id: 'aa000000-0000-4000-8000-000000000003',
        title: 'Three',
      }),
    },
  });

  test('renaming a third-level child preserves the whole parent chain', async ({
    window,
    vaultDir,
  }) => {
    const D1 = 'aa000000-0000-4000-8000-000000000001';
    const D2 = 'aa000000-0000-4000-8000-000000000002';
    const D3 = 'aa000000-0000-4000-8000-000000000003';
    await expect
      .poll(async () => (await getDocumentFromDb(window, D3))?.parentId, { timeout: 15_000 })
      .toBe(D2);

    renameVaultPath(vaultDir, 'Deep/Two/Three.md', 'Deep/Two/Three Renamed.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, D3))?.title, { timeout: 15_000 })
      .toBe('Three Renamed');
    expect((await getDocumentFromDb(window, D3))!.parentId).toBe(D2);
    expect((await getDocumentFromDb(window, D2))!.parentId).toBe(D1);
    await waitForFile(path.join(vaultDir, 'Deep/Two/Three Renamed.md'));
  });
});
