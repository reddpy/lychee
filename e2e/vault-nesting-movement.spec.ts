import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
} from './electron-app';
import {
  frontmatterNote,
  createNote,
  moveViaIpc,
  moveViaStore,
  moveViaIpcExpectError,
  renameVaultPath,
  noteItem,
  readNote,
  trashViaMenu,
  waitForFile,
  waitForFileGone,
} from './vault-helpers';

/**
 * Nesting and movement. The folder layout encodes hierarchy, so moving a file
 * (or a folder full of files) in the OS must reparent the note and carry its
 * subtree; the app moving a note must move the files the same way.
 */

const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
const BETA_ID = '44444444-4444-4444-8444-444444444444';
const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';
const WORK_ID = 'e0000000-0000-4000-8000-0000000000f1';

const DEEP1 = 'f1000000-0000-4000-8000-000000000001';
const DEEP2 = 'f1000000-0000-4000-8000-000000000002';
const DEEP3 = 'f1000000-0000-4000-8000-000000000003';
const DEEP4 = 'f1000000-0000-4000-8000-000000000004';

test.describe('Deep nesting', () => {
  test.use({
    vaultExtra: {
      'Deep.md': frontmatterNote({ id: DEEP1, title: 'Deep' }),
      'Deep/Two.md': frontmatterNote({ id: DEEP2, title: 'Two' }),
      'Deep/Two/Three.md': frontmatterNote({ id: DEEP3, title: 'Three' }),
      'Deep/Two/Three/Four.md': frontmatterNote({ id: DEEP4, title: 'Four' }),
    },
  });

  test('a four-level chain imports with the full parent chain', async ({ window }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, DEEP4))?.parentId, { timeout: 15_000 })
      .toBe(DEEP3);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DEEP3))?.parentId)
      .toBe(DEEP2);
    await expect
      .poll(async () => (await getDocumentFromDb(window, DEEP2))?.parentId)
      .toBe(DEEP1);
    expect((await getDocumentFromDb(window, DEEP1))!.parentId).toBeNull();
  });
});

test.describe('Missing parent file', () => {
  test.use({
    vaultExtra: {
      'NoParent/Orphan.md': frontmatterNote({ id: 'f2000000-0000-4000-8000-000000000001', title: 'Orphan' }),
    },
  });

  test('a note whose parent file is missing sits at the root, then links when the parent appears', async ({
    window,
    vaultDir,
  }) => {
    const orphanId = 'f2000000-0000-4000-8000-000000000001';
    const parentId = 'f2000000-0000-4000-8000-000000000002';

    await expect
      .poll(async () => (await getDocumentFromDb(window, orphanId))?.parentId, { timeout: 15_000 })
      .toBeNull();
    await expect(noteItem(window, 'Orphan')).toBeVisible();

    fs.writeFileSync(
      path.join(vaultDir, 'NoParent.md'),
      frontmatterNote({ id: parentId, title: 'NoParent' }),
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, orphanId))?.parentId, { timeout: 15_000 })
      .toBe(parentId);
  });
});

test.describe('OS movement', () => {
  test.use({
    vaultSeed: 'vault',
    vaultExtra: { 'Work.md': frontmatterNote({ id: WORK_ID, title: 'Work' }) },
  });

  test('moving a child out to the root clears its parent', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    renameVaultPath(vaultDir, 'Projects/Alpha.md', 'Alpha.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBeNull();
    await waitForFile(path.join(vaultDir, 'Alpha.md'));
  });

  test('moving a child into another folder reparents it', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    renameVaultPath(vaultDir, 'Projects/Alpha.md', 'Work/Alpha.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(WORK_ID);
    expect((await getDocumentFromDb(window, ALPHA_ID))!.title).toBe('Alpha');
    await waitForFile(path.join(vaultDir, 'Work/Alpha.md'));
  });

  test('moving a parent folder carries its whole subtree into another folder', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    fs.mkdirSync(path.join(vaultDir, 'Work'), { recursive: true });
    fs.renameSync(path.join(vaultDir, 'Projects.md'), path.join(vaultDir, 'Work/Projects.md'));
    fs.renameSync(path.join(vaultDir, 'Projects'), path.join(vaultDir, 'Work/Projects'));

    await expect
      .poll(async () => (await getDocumentFromDb(window, PROJECTS_ID))?.parentId, { timeout: 15_000 })
      .toBe(WORK_ID);
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId)
      .toBe(PROJECTS_ID);
    await expect
      .poll(async () => (await getDocumentFromDb(window, BETA_ID))?.parentId)
      .toBe(PROJECTS_ID);
    await waitForFile(path.join(vaultDir, 'Work/Projects/Alpha.md'));
  });

  test('rapid successive OS moves settle to the final location', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');

    renameVaultPath(vaultDir, 'Bookmarked.md', 'Projects/Bookmarked.md');
    renameVaultPath(vaultDir, 'Projects/Bookmarked.md', 'Bookmarked.md');
    renameVaultPath(vaultDir, 'Bookmarked.md', 'Work/Bookmarked.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.parentId, {
        timeout: 15_000,
      })
      .toBe(WORK_ID);
    await waitForFile(path.join(vaultDir, 'Work/Bookmarked.md'));
  });
});

test.describe('App movement', () => {
  test('moving a parent note under another moves the whole subtree', async ({ window, vaultDir }) => {
    await createNote(window, 'Top');
    await createNote(window, 'Mid');
    await createNote(window, 'Leaf');
    const docs = await listDocumentsFromDb(window);
    const top = docs.find((doc) => doc.title === 'Top')!;
    const mid = docs.find((doc) => doc.title === 'Mid')!;
    const leaf = docs.find((doc) => doc.title === 'Leaf')!;

    await moveViaIpc(window, leaf.id, mid.id, 0);
    await waitForFile(path.join(vaultDir, 'Mid/Leaf.md'));

    await moveViaIpc(window, mid.id, top.id, 0);
    await waitForFile(path.join(vaultDir, 'Top/Mid.md'));
    await waitForFile(path.join(vaultDir, 'Top/Mid/Leaf.md'));

    expect((await getDocumentFromDb(window, mid.id))!.parentId).toBe(top.id);
    expect((await getDocumentFromDb(window, leaf.id))!.parentId).toBe(mid.id);
  });

  test('reparenting a mid-chain node carries its whole subtree', async ({ window, vaultDir }) => {
    await createNote(window, 'GTop');
    await createNote(window, 'GMid');
    await createNote(window, 'GLeaf');
    await createNote(window, 'GNewHome');
    const docs = await listDocumentsFromDb(window);
    const id = (title: string) => docs.find((doc) => doc.title === title)!.id;

    await moveViaStore(window, id('GLeaf'), id('GMid'), 0);
    await moveViaStore(window, id('GMid'), id('GTop'), 0);
    await waitForFile(path.join(vaultDir, 'GTop/GMid/GLeaf.md'));

    await moveViaStore(window, id('GMid'), id('GNewHome'), 0);

    await waitForFile(path.join(vaultDir, 'GNewHome/GMid.md'));
    await waitForFile(path.join(vaultDir, 'GNewHome/GMid/GLeaf.md'));
    expect((await getDocumentFromDb(window, id('GMid')))!.parentId).toBe(id('GNewHome'));
    expect((await getDocumentFromDb(window, id('GLeaf')))!.parentId).toBe(id('GMid'));
  });

  test('moving a parent back to the root pulls its children out', async ({ window, vaultDir }) => {
    await createNote(window, 'Home');
    await createNote(window, 'Child');
    const docs = await listDocumentsFromDb(window);
    const home = docs.find((doc) => doc.title === 'Home')!;
    const child = docs.find((doc) => doc.title === 'Child')!;
    await moveViaStore(window, child.id, home.id, 0);
    await waitForFile(path.join(vaultDir, 'Home/Child.md'));

    await moveViaStore(window, child.id, null, 0);

    await waitForFile(path.join(vaultDir, 'Child.md'));
    await waitForFileGone(path.join(vaultDir, 'Home/Child.md'));
    expect((await getDocumentFromDb(window, child.id))!.parentId).toBeNull();
  });

  test('moving a note into a deep folder parents it correctly', async ({ window, vaultDir }) => {
    await createNote(window, 'L1');
    await createNote(window, 'L2');
    await createNote(window, 'L3');
    await createNote(window, 'Rover');
    const docs = await listDocumentsFromDb(window);
    const id = (title: string) => docs.find((doc) => doc.title === title)!.id;
    await moveViaStore(window, id('L2'), id('L1'), 0);
    await moveViaStore(window, id('L3'), id('L2'), 0);

    await moveViaStore(window, id('Rover'), id('L3'), 0);

    await waitForFile(path.join(vaultDir, 'L1/L2/L3/Rover.md'));
    expect((await getDocumentFromDb(window, id('Rover')))!.parentId).toBe(id('L3'));
  });

  test('moving a note under its own descendant is rejected', async ({ window }) => {
    await createNote(window, 'Cycle A');
    await createNote(window, 'Cycle B');
    const docs = await listDocumentsFromDb(window);
    const a = docs.find((doc) => doc.title === 'Cycle A')!;
    const b = docs.find((doc) => doc.title === 'Cycle B')!;
    await moveViaIpc(window, b.id, a.id, 0);

    const error = await moveViaIpcExpectError(window, a.id, b.id, 0);
    expect(error).toBeTruthy();
    expect((await getDocumentFromDb(window, a.id))!.parentId).toBeNull();
  });

  test('moving a note under a trashed parent is rejected', async ({ window }) => {
    await createNote(window, 'Trashed Parent');
    await createNote(window, 'Orphan Movable');
    const docs = await listDocumentsFromDb(window);
    const parent = docs.find((doc) => doc.title === 'Trashed Parent')!;
    const movable = docs.find((doc) => doc.title === 'Orphan Movable')!;
    await trashViaMenu(window, 'Trashed Parent');

    const error = await moveViaIpcExpectError(window, movable.id, parent.id, 0);
    expect(error).toBeTruthy();
    expect((await getDocumentFromDb(window, movable.id))!.parentId).toBeNull();
  });

  test('moving a child out and back changes its position', async ({ window, vaultDir }) => {
    await createNote(window, 'Box');
    await createNote(window, 'K One');
    await createNote(window, 'K Two');
    const docs = await listDocumentsFromDb(window);
    const id = (title: string) => docs.find((doc) => doc.title === title)!.id;
    await moveViaStore(window, id('K One'), id('Box'), 0);
    await moveViaStore(window, id('K Two'), id('Box'), 1);
    await waitForFile(path.join(vaultDir, 'Box/K One.md'));

    await moveViaStore(window, id('K One'), null, 0);
    await moveViaStore(window, id('K One'), id('Box'), 1);

    expect(Number(readNote(vaultDir, 'Box/K One.md').data.order)).toBe(1);
    expect(Number(readNote(vaultDir, 'Box/K Two.md').data.order)).toBe(0);
  });
});
