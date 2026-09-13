import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import {
  createNote,
  moveViaStore,
  moveViaIpc,
  readNote,
  waitForFile,
  waitForContent,
  sidebarTitles,
  expandFolder,
  noteItem,
} from './vault-helpers';

/**
 * Deep reorder. Order is a dense 0..n-1 sequence per parent; a move shifts the
 * siblings between old and new positions. These assert the exact resulting
 * sequence, nested isolation, and durability.
 */

function idsByTitle(docs: Array<{ id: string; title: string }>) {
  return new Map(docs.map((doc) => [doc.title, doc.id]));
}

test.describe('Reorder — deep', () => {
  test('a shuffle lands each note at the requested index', async ({ window, vaultDir }) => {
    const titles = ['R1', 'R2', 'R3', 'R4', 'R5'];
    for (const title of titles) await createNote(window, title);
    const ids = idsByTitle(await listDocumentsFromDb(window));

    const moves: Array<[string, number]> = [
      ['R5', 0],
      ['R3', 0],
      ['R1', 3],
      ['R4', 1],
      ['R2', 4],
    ];
    for (const [title, index] of moves) {
      await moveViaStore(window, ids.get(title)!, null, index);
      await expect
        .poll(async () => (await sidebarTitles(window)).indexOf(title), { timeout: 10_000 })
        .toBe(index);
    }

    const orders = titles
      .map((title) => Number(readNote(vaultDir, `${title}.md`).data.order))
      .sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3, 4]);
  });

  test('an external IPC move reorders the sidebar live', async ({ window, vaultDir }) => {
    for (const title of ['X1', 'X2', 'X3']) await createNote(window, title);
    const ids = idsByTitle(await listDocumentsFromDb(window));

    // Raw IPC, as an agent/MCP/script would call it (bypasses the store action).
    await moveViaIpc(window, ids.get('X3')!, null, 0);

    await expect
      .poll(async () => (await sidebarTitles(window)).indexOf('X3'), { timeout: 10_000 })
      .toBe(0);
  });

  test('moving the same note up and down repeatedly stays consistent', async ({
    window,
    vaultDir,
  }) => {
    for (const title of ['A', 'B', 'C', 'D']) await createNote(window, title);
    const id = idsByTitle(await listDocumentsFromDb(window)).get('B')!;

    for (const index of [0, 3, 1, 2, 0]) {
      await moveViaStore(window, id, null, index);
      await expect
        .poll(async () => (await sidebarTitles(window)).indexOf('B'), { timeout: 10_000 })
        .toBe(index);
      const orders = ['A', 'B', 'C', 'D']
        .map((t) => Number(readNote(vaultDir, `${t}.md`).data.order))
        .sort((a, b) => a - b);
      expect(orders).toEqual([0, 1, 2, 3]);
    }
  });

  test('reordering root notes leaves nested children untouched', async ({ window, vaultDir }) => {
    await createNote(window, 'Packet');
    await createNote(window, 'Kid One');
    await createNote(window, 'Kid Two');
    await createNote(window, 'Root X');
    await createNote(window, 'Root Y');
    await createNote(window, 'Root Z');
    const ids = idsByTitle(await listDocumentsFromDb(window));
    await moveViaStore(window, ids.get('Kid One')!, ids.get('Packet')!, 0);
    await moveViaStore(window, ids.get('Kid Two')!, ids.get('Packet')!, 1);
    await waitForFile(path.join(vaultDir, 'Packet/Kid One.md'));
    const kidOrderBefore = ['Kid One', 'Kid Two'].map(
      (t) => Number(readNote(vaultDir, `Packet/${t}.md`).data.order),
    );

    await moveViaStore(window, ids.get('Root Z')!, null, 0);
    await moveViaStore(window, ids.get('Root X')!, null, 1);

    await expandFolder(window, 'Packet');
    expect((await getDocumentFromDb(window, ids.get('Kid One')!))!.parentId).toBe(
      ids.get('Packet'),
    );
    const kidOrderAfter = ['Kid One', 'Kid Two'].map(
      (t) => Number(readNote(vaultDir, `Packet/${t}.md`).data.order),
    );
    expect(kidOrderAfter).toEqual(kidOrderBefore);
  });

  test('renaming a reordered note preserves its position', async ({ window, vaultDir }) => {
    for (const title of ['N1', 'N2', 'N3']) await createNote(window, title);
    const ids = idsByTitle(await listDocumentsFromDb(window));
    await moveViaStore(window, ids.get('N3')!, null, 0);
    await expect.poll(async () => (await sidebarTitles(window)).indexOf('N3')).toBe(0);

    await noteItem(window, 'N3').click();
    await waitForFile(path.join(vaultDir, 'N3.md'));
    // Rename via the title API path (commit).
    await window.locator('main:visible h1.editor-title').click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${mod}+A`);
    await window.keyboard.type('N3 Renamed');
    await window.keyboard.press('Enter');
    await waitForFile(path.join(vaultDir, 'N3 Renamed.md'));

    expect(Number(readNote(vaultDir, 'N3 Renamed.md').data.order)).toBe(0);
    await expect.poll(async () => (await sidebarTitles(window)).indexOf('N3 Renamed')).toBe(0);
  });

  test('order survives two relaunches', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');

    let app = await launchLychee({ userDataDir, vaultDir });
    let window = await firstWindowReady(app);
    for (const title of ['P1', 'P2', 'P3']) await createNote(window, title);
    const id = idsByTitle(await listDocumentsFromDb(window)).get('P2')!;
    await moveViaStore(window, id, null, 0);
    await waitForContent(vaultDir, 'P2.md', 'order: 0');
    await app.close();

    for (let round = 0; round < 2; round += 1) {
      app = await launchLychee({ userDataDir, vaultDir });
      window = await firstWindowReady(app);
      await expect
        .poll(async () => (await getDocumentFromDb(window, id))?.sortOrder, { timeout: 15_000 })
        .toBe(0);
      await expect.poll(async () => (await sidebarTitles(window)).indexOf('P2')).toBe(0);
      await app.close();
    }
  });
});
