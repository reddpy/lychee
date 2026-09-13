import { test, expect, listDocumentsFromDb, getDocumentFromDb, launchLychee, firstWindowReady } from './electron-app';
import {
  createNote,
  moveViaStore,
  moveViaIpc,
  moveViaIpcExpectError,
  readNote,
  sidebarTitles,
  noteItem,
  waitForFile,
  writeNote,
  renameVaultPath,
} from './vault-helpers';

/**
 * Reorder hardening. Order is a dense `0..n-1` sequence per parent and a move
 * shifts the siblings in between; out-of-range and fractional requests must
 * clamp, not corrupt the sequence. These cover clamping, no-ops, cross-parent
 * moves, external order edits, and durability through rename/relaunch.
 */

async function ids(page: Parameters<typeof listDocumentsFromDb>[0]) {
  return new Map((await listDocumentsFromDb(page)).map((doc) => [doc.title, doc.id]));
}

test.describe('Reorder — clamping and no-ops', () => {
  test('an out-of-range index clamps to the last position', async ({ window, vaultDir }) => {
    for (const title of ['A', 'B', 'C']) await createNote(window, title);
    const map = await ids(window);
    await moveViaStore(window, map.get('C')!, null, 99);
    await expect.poll(async () => (await sidebarTitles(window)).indexOf('C'), { timeout: 10_000 }).toBe(2);
    expect(Number(readNote(vaultDir, 'C.md').data.order)).toBe(2);
  });

  test('moving to the current index changes nothing', async ({ window, vaultDir }) => {
    for (const title of ['A', 'B', 'C']) await createNote(window, title);
    const map = await ids(window);
    const before = (await getDocumentFromDb(window, map.get('B')!))!.sortOrder;
    await moveViaStore(window, map.get('B')!, null, before);
    const after = (await getDocumentFromDb(window, map.get('B')!))!.sortOrder;
    expect(after).toBe(before);
    expect(Number(readNote(vaultDir, 'B.md').data.order)).toBe(before);
  });

  test('a negative sortOrder is rejected over IPC', async ({ window }) => {
    await createNote(window, 'Neg A');
    await createNote(window, 'Neg B');
    const map = await ids(window);
    const error = await moveViaIpcExpectError(window, map.get('Neg A')!, null, -1);
    expect(error).toContain('sortOrder must be non-negative');
  });

  test('a fractional sortOrder is rejected over IPC', async ({ window }) => {
    await createNote(window, 'Frac A');
    await createNote(window, 'Frac B');
    const map = await ids(window);
    const error = await moveViaIpcExpectError(window, map.get('Frac A')!, null, 0.5);
    expect(error).toContain('sortOrder must be an integer');
  });
});

test.describe('Reorder — dense sequences', () => {
  test('ten siblings shuffle to a dense 0..9 sequence', async ({ window, vaultDir }) => {
    const titles = Array.from({ length: 10 }, (_, i) => `S${i}`);
    for (const title of titles) await createNote(window, title);
    const map = await ids(window);

    await moveViaStore(window, map.get('S9')!, null, 0);
    await moveViaStore(window, map.get('S4')!, null, 7);

    await expect.poll(async () => (await sidebarTitles(window)).indexOf('S9'), { timeout: 10_000 }).toBe(0);
    const orders = titles
      .map((title) => Number(readNote(vaultDir, `${title}.md`).data.order))
      .sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('trashing a middle note leaves a dense sequence', async ({ window, vaultDir }) => {
    for (const title of ['D0', 'D1', 'D2', 'D3']) await createNote(window, title);
    const map = await ids(window);
    await window.evaluate(
      async (id) => {
        await (window as any).lychee.invoke('documents.trash', { id });
      },
      map.get('D1')!,
    );
    await window.waitForTimeout(500);

    const remaining = ['D0', 'D2', 'D3'].map((title) => map.get(title)!);
    const dbOrders = (await Promise.all(remaining.map((id) => getDocumentFromDb(window, id))))
      .map((doc) => doc!.sortOrder)
      .sort((a, b) => a - b);
    expect(dbOrders).toEqual([0, 1, 2]);
    // The database is the source of truth, but reconcile adopts the files on the
    // next launch, so the files must agree with the database now.
    const fileOrders = ['D0', 'D2', 'D3']
      .map((title) => Number(readNote(vaultDir, `${title}.md`).data.order))
      .sort((a, b) => a - b);
    expect(fileOrders).toEqual([0, 1, 2]);
  });

  test('creating notes rewrites existing siblings so the files stay dense', async ({
    window,
    vaultDir,
  }) => {
    for (const title of ['K0', 'K1', 'K2']) await createNote(window, title);
    const fileOrders = ['K0', 'K1', 'K2']
      .map((title) => Number(readNote(vaultDir, `${title}.md`).data.order))
      .sort((a, b) => a - b);
    expect(fileOrders).toEqual([0, 1, 2]);
  });

  test('restoring a note rewrites the sibling files to match the database', async ({
    window,
    vaultDir,
  }) => {
    for (const title of ['G0', 'G1', 'G2']) await createNote(window, title);
    const map = await ids(window);
    await window.evaluate(
      async (id) => {
        await (window as any).lychee.invoke('documents.trash', { id });
      },
      map.get('G1')!,
    );
    await window.waitForTimeout(400);
    await window.evaluate(
      async (id) => {
        await (window as any).lychee.invoke('documents.restore', { id });
      },
      map.get('G1')!,
    );
    await window.waitForTimeout(400);

    const dbOrders = (
      await Promise.all(['G0', 'G1', 'G2'].map((t) => getDocumentFromDb(window, map.get(t)!)))
    )
      .map((doc) => doc!.sortOrder)
      .sort((a, b) => a - b);
    const fileOrders = ['G0', 'G1', 'G2']
      .map((title) => Number(readNote(vaultDir, `${title}.md`).data.order))
      .sort((a, b) => a - b);
    expect(fileOrders).toEqual(dbOrders);
  });

  test('reordering after a trash keeps the remaining notes dense', async ({ window, vaultDir }) => {
    for (const title of ['E0', 'E1', 'E2']) await createNote(window, title);
    const map = await ids(window);
    await window.evaluate(
      async (id) => {
        await (window as any).lychee.invoke('documents.trash', { id });
      },
      map.get('E1')!,
    );
    await window.waitForTimeout(500);
    await moveViaStore(window, map.get('E2')!, null, 0);

    const orders = ['E0', 'E2']
      .map((title) => Number(readNote(vaultDir, `${title}.md`).data.order))
      .sort((a, b) => a - b);
    expect(orders).toEqual([0, 1]);
  });
});

test.describe('Reorder — cross parent', () => {
  test('moving a root note under a folder uses order 0 there', async ({ window, vaultDir }) => {
    await createNote(window, 'Pkg');
    await createNote(window, 'Root A');
    await createNote(window, 'Root B');
    const map = await ids(window);
    await moveViaStore(window, map.get('Root B')!, map.get('Pkg')!, 0);
    await waitForFile(`${vaultDir}/Pkg/Root B.md`);

    const moved = (await getDocumentFromDb(window, map.get('Root B')!))!;
    expect(moved.parentId).toBe(map.get('Pkg'));
    expect(moved.sortOrder).toBe(0);
    expect(Number(readNote(vaultDir, 'Pkg/Root B.md').data.order)).toBe(0);
  });

  test('reordering one parent’s children leaves another parent’s children alone', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'P1');
    await createNote(window, 'P2');
    await createNote(window, 'C1');
    await createNote(window, 'C2');
    const map = await ids(window);
    await moveViaStore(window, map.get('C1')!, map.get('P1')!, 0);
    await moveViaStore(window, map.get('C2')!, map.get('P1')!, 1);
    await waitForFile(`${vaultDir}/P1/C1.md`);

    const p2Before = (await getDocumentFromDb(window, map.get('P2')!))!;
    await moveViaStore(window, map.get('C2')!, map.get('P1')!, 0);

    expect(Number(readNote(vaultDir, 'P1/C2.md').data.order)).toBe(0);
    expect(Number(readNote(vaultDir, 'P1/C1.md').data.order)).toBe(1);
    // The other root note is untouched by the sibling reorder.
    const p2After = (await getDocumentFromDb(window, map.get('P2')!))!;
    expect(p2After.sortOrder).toBe(p2Before.sortOrder);
    expect(p2After.parentId).toBe(p2Before.parentId);
    expect(p2After.updatedAt).toBe(p2Before.updatedAt);
  });
});

test.describe('Reorder — external order edits', () => {
  test.use({ vaultSeed: 'vault' });

  test('an out-of-range external order clamps to the sibling count', async ({
    window,
    vaultDir,
  }) => {
    const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    writeNote(vaultDir, 'Roadmap.md', { id: ROADMAP_ID, title: 'Roadmap', order: 50 }, 'body');

    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(4);
  });

  test('a fractional external order floors', async ({ window, vaultDir }) => {
    const LEGACY_ID = '77777777-7777-4777-8777-777777777777';
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');
    writeNote(vaultDir, 'Legacy.md', { id: LEGACY_ID, title: 'Legacy', order: 1.5 }, 'body');

    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(1);
  });

  test('a nested external order edit shifts its sibling', async ({ window, vaultDir }) => {
    const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
    const BETA_ID = '44444444-4444-4444-8444-444444444444';
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.title, { timeout: 15_000 })
      .toBe('Alpha');
    writeNote(
      vaultDir,
      'Projects/Alpha.md',
      { id: ALPHA_ID, title: 'Alpha', order: 1 },
      'body',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(1);
    expect((await getDocumentFromDb(window, BETA_ID))!.sortOrder).toBe(0);
  });

  test('reordering an externally renamed note keeps its position', async ({
    window,
    vaultDir,
  }) => {
    const LEGACY_ID = '77777777-7777-4777-8777-777777777777';
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy');
    renameVaultPath(vaultDir, 'Legacy.md', 'Legacy Renamed.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.title, { timeout: 15_000 })
      .toBe('Legacy Renamed');

    await moveViaStore(window, LEGACY_ID, null, 0);
    await expect
      .poll(async () => (await getDocumentFromDb(window, LEGACY_ID))?.sortOrder, {
        timeout: 10_000,
      })
      .toBe(0);
    expect(Number(readNote(vaultDir, 'Legacy Renamed.md').data.order)).toBe(0);
  });
});

test.describe('Reorder — durability', () => {
  test('order survives a rename and a relaunch', async ({ testDir, vaultDir }) => {
    const userDataDir = `${testDir}/userdata`;
    let app = await launchLychee({ userDataDir, vaultDir });
    let window = await firstWindowReady(app);
    for (const title of ['R1', 'R2', 'R3']) await createNote(window, title);
    const map = await ids(window);
    await moveViaStore(window, map.get('R3')!, null, 0);
    await expect.poll(async () => (await sidebarTitles(window)).indexOf('R3')).toBe(0);

    await noteItem(window, 'R3').click();
    await waitForFile(`${vaultDir}/R3.md`);
    await window.locator('main:visible h1.editor-title').click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${mod}+A`);
    await window.keyboard.type('R3 Renamed');
    await window.keyboard.press('Enter');
    await waitForFile(`${vaultDir}/R3 Renamed.md`);
    await app.close();

    app = await launchLychee({ userDataDir, vaultDir });
    window = await firstWindowReady(app);
    await expect.poll(async () => (await sidebarTitles(window)).indexOf('R3 Renamed'), { timeout: 15_000 }).toBe(0);
    expect(Number(readNote(vaultDir, 'R3 Renamed.md').data.order)).toBe(0);
    await app.close();
  });

  test('trash + restore + relaunch preserves the order', async ({ testDir, vaultDir }) => {
    const userDataDir = `${testDir}/userdata`;
    let app = await launchLychee({ userDataDir, vaultDir });
    let window = await firstWindowReady(app);
    for (const title of ['Q0', 'Q1', 'Q2', 'Q3']) await createNote(window, title);
    const map = await ids(window);
    // Establish a non-trivial order (the moves rewrite the files canonically).
    await moveViaStore(window, map.get('Q3')!, null, 0);
    await moveViaStore(window, map.get('Q1')!, null, 3);
    const before = await sidebarTitles(window);

    await window.evaluate(
      async (id) => {
        await (window as any).lychee.invoke('documents.trash', { id });
      },
      map.get('Q2')!,
    );
    await window.waitForTimeout(400);
    await window.evaluate(
      async (id) => {
        await (window as any).lychee.invoke('documents.restore', { id });
      },
      map.get('Q2')!,
    );
    await expect.poll(async () => (await sidebarTitles(window)).length).toBe(4);
    const afterRestore = await sidebarTitles(window);
    // Trash + restore returns the note to its old slot, so the order is stable.
    expect(afterRestore).toEqual(before);
    await app.close();

    app = await launchLychee({ userDataDir, vaultDir });
    window = await firstWindowReady(app);
    await expect.poll(async () => (await sidebarTitles(window)).length, { timeout: 15_000 }).toBe(4);
    expect(await sidebarTitles(window)).toEqual(afterRestore);
    await app.close();
  });
});
