import path from 'path';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  launchLychee,
  firstWindowReady,
} from './electron-app';
import { listMarkdown, readNote, readRaw, waitForContent, writeNote } from './vault-helpers';

/**
 * Conflict copies. When a note changed locally (DB) *and* on disk, the external
 * edit must never be lost and the canonical file must be restored from the DB.
 *
 * The classification (apply vs conflict) is unit-tested; here we drive the
 * conflict write path end-to-end and assert both files on disk.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';

test.use({ vaultSeed: 'vault' });

/** The conflict copy created by this run (excludes the fixture's own copy). */
function newConflictFile(vaultDir: string, before: Set<string>): string | undefined {
  return listMarkdown(vaultDir).find(
    (rel) => !before.has(rel) && / \(conflict \d{4}-\d{2}-\d{2}/.test(rel),
  );
}

test.describe('Conflict copies', () => {
  test('preserves the external edit and restores the canonical file', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    const before = new Set(listMarkdown(vaultDir));

    await window.evaluate(
      async (payload) => {
        await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
      },
      {
        action: 'conflict',
        id: ROADMAP_ID,
        relativePath: 'Roadmap.md',
        conflictContents: 'external edit body',
        bodyMarkdown: 'canonical body',
      },
    );

    // The external edit is kept as a sibling conflict copy…
    await expect
      .poll(() => newConflictFile(vaultDir, before) != null, { timeout: 10_000 })
      .toBe(true);
    expect(readRaw(vaultDir, newConflictFile(vaultDir, before)!)).toContain('external edit body');

    // …and the canonical file is restored from the database.
    await waitForContent(vaultDir, 'Roadmap.md', 'canonical body');
    expect(readNote(vaultDir, 'Roadmap.md').data.id).toBe(ROADMAP_ID);
  });

  test('the conflict copy is never imported as a note', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);
    const before = new Set(listMarkdown(vaultDir));

    await window.evaluate(
      async (payload) => {
        await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
      },
      {
        action: 'conflict',
        id: ROADMAP_ID,
        relativePath: 'Roadmap.md',
        conflictContents: 'external edit body',
        bodyMarkdown: 'canonical body',
      },
    );
    await expect.poll(() => newConflictFile(vaultDir, before) != null, { timeout: 10_000 }).toBe(true);

    // Give the watcher time to (not) import it.
    await window.waitForTimeout(1500);
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length)
      .toBe(7);
    expect((await getDocumentFromDb(window, ROADMAP_ID))!.title).toBe('Roadmap');
  });

  test('two conflicts in the same second produce two distinct copies', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    const before = new Set(listMarkdown(vaultDir));

    const invoke = (contents: string) =>
      window.evaluate(
        async (payload) => {
          await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
        },
        {
          action: 'conflict',
          id: ROADMAP_ID,
          relativePath: 'Roadmap.md',
          conflictContents: contents,
          bodyMarkdown: 'canonical body',
        },
      );
    await invoke('first external edit');
    await invoke('second external edit');

    const created = listMarkdown(vaultDir).filter(
      (rel) => !before.has(rel) && / \(conflict /.test(rel),
    );
    expect(created.length).toBe(2);
    const bodies = created.map((rel) => readRaw(vaultDir, rel));
    expect(bodies.some((body) => body.includes('first external edit'))).toBe(true);
    expect(bodies.some((body) => body.includes('second external edit'))).toBe(true);
  });

  test('a nested conflict copy lands beside the note, not at the root', async ({
    window,
    vaultDir,
  }) => {
    const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.title, { timeout: 15_000 })
      .toBe('Alpha');
    const before = new Set(listMarkdown(vaultDir));

    await window.evaluate(
      async (payload) => {
        await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
      },
      {
        action: 'conflict',
        id: ALPHA_ID,
        relativePath: 'Projects/Alpha.md',
        conflictContents: 'external alpha edit',
        bodyMarkdown: 'canonical alpha',
      },
    );

    await expect
      .poll(() => newConflictFile(vaultDir, before) != null, { timeout: 10_000 })
      .toBe(true);
    expect(newConflictFile(vaultDir, before)!.startsWith('Projects/')).toBe(true);
  });

  test('a conflict copy of an untitled note is titled Note (conflict)', async ({
    window,
    vaultDir,
  }) => {
    const UNTITLED_ID = '66666666-6666-4666-8666-666666666666';
    await expect
      .poll(async () => (await getDocumentFromDb(window, UNTITLED_ID)) != null, { timeout: 15_000 })
      .toBe(true);
    const before = new Set(listMarkdown(vaultDir));

    await window.evaluate(
      async (payload) => {
        await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
      },
      {
        action: 'conflict',
        id: UNTITLED_ID,
        relativePath: 'Untitled.md',
        conflictContents: 'external untitled edit',
        bodyMarkdown: 'canonical untitled',
      },
    );

    await expect
      .poll(() => newConflictFile(vaultDir, before) != null, { timeout: 10_000 })
      .toBe(true);
    expect(readNote(vaultDir, newConflictFile(vaultDir, before)!).data.title).toBe(
      'Note (conflict)',
    );
  });

  test('restoring the canonical file does not change the stored content', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    const before = (await getDocumentFromDb(window, ROADMAP_ID))!.content;

    await window.evaluate(
      async (payload) => {
        await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
      },
      {
        action: 'conflict',
        id: ROADMAP_ID,
        relativePath: 'Roadmap.md',
        conflictContents: 'external edit body',
        bodyMarkdown: 'canonical body',
      },
    );
    await waitForContent(vaultDir, 'Roadmap.md', 'canonical body');

    expect((await getDocumentFromDb(window, ROADMAP_ID))!.content).toBe(before);
  });

  test('a conflict copy gets a fresh id and its own frontmatter', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    const before = new Set(listMarkdown(vaultDir));

    await window.evaluate(
      async (payload) => {
        await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
      },
      {
        action: 'conflict',
        id: ROADMAP_ID,
        relativePath: 'Roadmap.md',
        conflictContents: 'external edit body',
        bodyMarkdown: 'canonical body',
      },
    );
    await expect.poll(() => newConflictFile(vaultDir, before) != null, { timeout: 10_000 }).toBe(true);

    const { data } = readNote(vaultDir, newConflictFile(vaultDir, before)!);
    expect(data.id).toBeTruthy();
    expect(data.id).not.toBe(ROADMAP_ID);
    expect(data.title).toBe('Roadmap (conflict)');
    expect(data.updated).toBeTruthy();
  });

  test('a conflict copy survives a relaunch without being imported or trashed', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const before = new Set(listMarkdown(vaultDir));

    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await getDocumentFromDb(firstWindow, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    await firstWindow.evaluate(
      async (payload) => {
        await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
      },
      {
        action: 'conflict',
        id: ROADMAP_ID,
        relativePath: 'Roadmap.md',
        conflictContents: 'kept external edit',
        bodyMarkdown: 'canonical body',
      },
    );
    await expect.poll(() => newConflictFile(vaultDir, before) != null, { timeout: 10_000 }).toBe(true);
    const conflictPath = newConflictFile(vaultDir, before)!;
    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await listDocumentsFromDb(secondWindow)).length, { timeout: 15_000 })
      .toBe(7);
    expect(listMarkdown(vaultDir)).toContain(conflictPath);
    expect(listMarkdown(vaultDir, { trash: true })).not.toContain(conflictPath);
    await second.close();
  });

  test('an external edit after a conflict applies normally', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.title, { timeout: 15_000 })
      .toBe('Roadmap');
    await window.evaluate(
      async (payload) => {
        await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
      },
      {
        action: 'conflict',
        id: ROADMAP_ID,
        relativePath: 'Roadmap.md',
        conflictContents: 'external edit body',
        bodyMarkdown: 'canonical body',
      },
    );
    await waitForContent(vaultDir, 'Roadmap.md', 'canonical body');

    writeNote(
      vaultDir,
      'Roadmap.md',
      { id: ROADMAP_ID, title: 'Roadmap', updated: new Date().toISOString() },
      'post conflict edit',
    );
    await expect
      .poll(async () => (await getDocumentFromDb(window, ROADMAP_ID))?.content ?? '', {
        timeout: 15_000,
      })
      .toContain('post conflict edit');
  });

  test('conflicts on two different notes produce two copies', async ({ window, vaultDir }) => {
    const BOOKMARKED_ID = '55555555-5555-4555-8555-555555555555';
    await expect
      .poll(async () => (await getDocumentFromDb(window, BOOKMARKED_ID))?.title, { timeout: 15_000 })
      .toBe('Bookmarked');
    const before = new Set(listMarkdown(vaultDir));

    const invoke = (id: string, relativePath: string) =>
      window.evaluate(
        async (payload) => {
          await (window as any).lychee.invoke('vault.resolveExternalChange', payload);
        },
        {
          action: 'conflict',
          id,
          relativePath,
          conflictContents: `external ${relativePath}`,
          bodyMarkdown: `canonical ${relativePath}`,
        },
      );
    await invoke(ROADMAP_ID, 'Roadmap.md');
    await invoke(BOOKMARKED_ID, 'Bookmarked.md');

    const created = listMarkdown(vaultDir).filter(
      (rel) => !before.has(rel) && / \(conflict /.test(rel),
    );
    expect(created.length).toBe(2);
    expect(created.some((rel) => rel.includes('Roadmap'))).toBe(true);
    expect(created.some((rel) => rel.includes('Bookmarked'))).toBe(true);
  });
});
