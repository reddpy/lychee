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
  replaceTitle,
  setBody,
  moveViaStore,
  renameVaultPath,
  writeNote,
  noteItem,
  trashViaMenu,
  openTrashBin,
  restoreFirstFromTrash,
  waitForFile,
  waitForFileGone,
  waitForContent,
  sidebarTitles,
  listMarkdown,
} from './vault-helpers';

/**
 * Back-and-forth: edit inside Lychee, edit the markdown on disk, edit inside
 * Lychee again — the note must converge with stable identity and exactly one
 * file at every step. This is the core sync loop a real user lives in.
 */

test.describe('Round-trip — app ↔ OS', () => {
  test('rename ping-pong keeps identity and a single file', async ({ window, vaultDir }) => {
    await createNote(window, 'Ping 0');
    await waitForFile(path.join(vaultDir, 'Ping 0.md'));
    const id = (await listDocumentsFromDb(window)).find((doc) => doc.title === 'Ping 0')!.id;

    for (let i = 1; i <= 3; i += 1) {
      // Lychee rename.
      await replaceTitle(window, `Ping ${i}`);
      await waitForFile(path.join(vaultDir, `Ping ${i}.md`));

      // OS rename.
      renameVaultPath(vaultDir, `Ping ${i}.md`, `Ping OS ${i}.md`);
      await expect
        .poll(async () => (await getDocumentFromDb(window, id))?.title, { timeout: 15_000 })
        .toBe(`Ping OS ${i}`);

      expect((await getDocumentFromDb(window, id))!.id).toBe(id);
      const files = listMarkdown(vaultDir).filter((rel) => rel.startsWith('Ping'));
      expect(files.length).toBe(1);
    }
  });

  test('content alternates app → OS → app without loss', async ({ window, vaultDir }) => {
    await createNote(window, 'Chat');
    await waitForFile(path.join(vaultDir, 'Chat.md'));
    const id = (await listDocumentsFromDb(window)).find((doc) => doc.title === 'Chat')!.id;

    await setBody(window, 'app one');
    await waitForContent(vaultDir, 'Chat.md', 'app one');

    writeNote(vaultDir, 'Chat.md', { id, title: 'Chat' }, 'os two');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('os two');

    await setBody(window, 'app three');
    await waitForContent(vaultDir, 'Chat.md', 'app three');

    writeNote(vaultDir, 'Chat.md', { id, title: 'Chat' }, 'os four');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('os four');
    await waitForContent(vaultDir, 'Chat.md', 'os four');
    expect((await getDocumentFromDb(window, id))!.id).toBe(id);
  });

  test('reorder ping-pong: app → OS → app', async ({ window, vaultDir }) => {
    for (const title of ['Ro1', 'Ro2', 'Ro3']) await createNote(window, title);
    const docs = await listDocumentsFromDb(window);
    const idOf = (title: string) => docs.find((doc) => doc.title === title)!.id;

    // App: Ro3 to the front.
    await moveViaStore(window, idOf('Ro3'), null, 0);
    await expect
      .poll(async () => (await sidebarTitles(window)).indexOf('Ro3'), { timeout: 10_000 })
      .toBe(0);

    // OS: Ro3 to the end.
    writeNote(vaultDir, 'Ro3.md', { id: idOf('Ro3'), title: 'Ro3', order: 9 }, 'x');
    await expect
      .poll(async () => (await sidebarTitles(window)).indexOf('Ro3'), { timeout: 15_000 })
      .toBe(2);

    // App: Ro1 to the front again.
    await moveViaStore(window, idOf('Ro1'), null, 0);
    await expect
      .poll(async () => (await sidebarTitles(window)).indexOf('Ro1'), { timeout: 10_000 })
      .toBe(0);
    await expect.poll(async () => (await sidebarTitles(window)).indexOf('Ro3')).toBe(2);
  });

  test('trash → OS edit → restore keeps working', async ({ window, vaultDir }) => {
    await createNote(window, 'Cycle');
    await waitForFile(path.join(vaultDir, 'Cycle.md'));
    const id = (await listDocumentsFromDb(window)).find((doc) => doc.title === 'Cycle')!.id;

    await trashViaMenu(window, 'Cycle');
    await waitForFile(path.join(vaultDir, '.trash', 'Cycle.md'));

    await openTrashBin(window);
    await restoreFirstFromTrash(window);
    await waitForFile(path.join(vaultDir, 'Cycle.md'));

    writeNote(vaultDir, 'Cycle.md', { id, title: 'Cycle' }, 'edited after restore');
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('edited after restore');

    await trashViaMenu(window, 'Cycle');
    await waitForFile(path.join(vaultDir, '.trash', 'Cycle.md'));
    await waitForFileGone(path.join(vaultDir, 'Cycle.md'));
    expect((await getDocumentFromDb(window, id))!.deletedAt).not.toBeNull();
  });

  test('app → close → OS → relaunch → app → close → OS → relaunch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');

    // Phase 1: create in the app.
    let app = await launchLychee({ userDataDir, vaultDir });
    let window = await firstWindowReady(app);
    await createNote(window, 'Journey');
    await waitForFile(path.join(vaultDir, 'Journey.md'));
    const id = (await listDocumentsFromDb(window)).find((doc) => doc.title === 'Journey')!.id;
    await app.close();

    // Phase 2: edit on disk while closed, then relaunch.
    writeNote(vaultDir, 'Journey.md', { id, title: 'Journey' }, 'os while closed');
    app = await launchLychee({ userDataDir, vaultDir });
    window = await firstWindowReady(app);
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('os while closed');

    // Phase 3: edit in the app and rename, then close.
    await noteItem(window, 'Journey').click();
    await setBody(window, 'app after relaunch');
    await replaceTitle(window, 'Journey Renamed');
    await waitForFile(path.join(vaultDir, 'Journey Renamed.md'));
    await app.close();

    // Phase 4: edit the renamed file on disk, relaunch, assert.
    writeNote(vaultDir, 'Journey Renamed.md', { id, title: 'Journey Renamed' }, 'final os edit');
    app = await launchLychee({ userDataDir, vaultDir });
    window = await firstWindowReady(app);
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.content ?? '', { timeout: 15_000 })
      .toContain('final os edit');
    expect((await getDocumentFromDb(window, id))!.title).toBe('Journey Renamed');
    expect(listMarkdown(vaultDir).filter((rel) => rel.startsWith('Journey'))).toEqual([
      'Journey Renamed.md',
    ]);
    await app.close();
  });
});
