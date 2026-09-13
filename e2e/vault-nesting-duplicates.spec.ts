import fs from 'fs';
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
  frontmatterNote,
  listMarkdown,
  readNote,
  readTrashedNote,
  writeNote,
  renameVaultPath,
  filePathForId,
  waitForFile,
  waitForFileGone,
} from './vault-helpers';
import { isConflictCopyPath } from '../src/shared/vault-watch';

/**
 * Nesting × duplicates.
 *
 * The hard case is a user rearranging a real folder tree while two files claim
 * the same `id`: the folder layout encodes parentage and the id encodes
 * identity, so an OS move can simultaneously change *where* a note lives and
 * *which copy wins*. These assert the exact live file set per id, the exact
 * `.trash` paths of losers, the winner's resolved parent, and that filenames
 * stay deduped when titles collide — through OS moves, folder moves, relaunch,
 * and back-and-forth shuffles.
 */

// ── file accounting helpers ─────────────────────────────────────────

/** Real note files (frontmatter id), excluding conflict copies. */
function noteFiles(vaultDir: string, options: { trash?: boolean } = {}): string[] {
  const read = options.trash ? readTrashedNote : readNote;
  return listMarkdown(vaultDir, options).filter((rel) => {
    if (isConflictCopyPath(rel)) return false;
    try {
      return Boolean(read(vaultDir, rel).data.id);
    } catch {
      return false;
    }
  });
}

function livePathsForId(vaultDir: string, id: string): string[] {
  return noteFiles(vaultDir).filter((rel) => readNote(vaultDir, rel).data.id === id);
}

function trashedPathsForId(vaultDir: string, id: string): string[] {
  return noteFiles(vaultDir, { trash: true }).filter(
    (rel) => readTrashedNote(vaultDir, rel).data.id === id,
  );
}

/** Exactly one live file for the id; returns its path. */
function soleLive(vaultDir: string, id: string): string {
  const paths = livePathsForId(vaultDir, id);
  expect(paths, `expected exactly one live file for ${id}`).toHaveLength(1);
  return paths[0];
}

/** No live id may appear more than once — the core duplicate invariant. */
function expectNoDuplicateIds(vaultDir: string): void {
  const counts = new Map<string, number>();
  for (const rel of noteFiles(vaultDir)) {
    const id = readNote(vaultDir, rel).data.id!;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    expect(count, `id ${id} has ${count} live files`).toBe(1);
  }
}

async function boot(userDataDir: string, vaultDir: string) {
  const app = await launchLychee({ userDataDir, vaultDir });
  const window = await firstWindowReady(app);
  return { app, window };
}

// ── two nested copies across folders ────────────────────────────────

const FAQ = 'd1000000-0000-4000-8000-0000000000a1';
const FBQ = 'd1000000-0000-4000-8000-0000000000a2';
const DUP = 'd1000000-0000-4000-8000-0000000000a3';

test.describe('Nested duplicates — newest copy wins its folder', () => {
  test.use({
    vaultExtra: {
      'FolderA.md': frontmatterNote({ id: FAQ, title: 'FolderA' }),
      'FolderB.md': frontmatterNote({ id: FBQ, title: 'FolderB' }),
      'FolderA/Copy Old.md': frontmatterNote(
        { id: DUP, title: 'Copy Old', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('the newest nested copy wins and keeps its folder; the loser is trashed in place', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, DUP))?.title, { timeout: 30_000 })
      .toBe('Copy Old');
    await first.app.close();

    fs.mkdirSync(path.join(vaultDir, 'FolderB'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'FolderB/Copy New.md'),
      frontmatterNote({ id: DUP, title: 'Copy New', updated: '2024-09-01T00:00:00.000Z' }, 'new'),
    );

    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(second.window, DUP))?.title, { timeout: 30_000 })
      .toBe('Copy New');
    await expect.poll(() => livePathsForId(vaultDir, DUP)).toEqual(['FolderB/Copy New.md']);
    expect(trashedPathsForId(vaultDir, DUP)).toEqual(['FolderA/Copy Old.md']);
    expect((await getDocumentFromDb(second.window, DUP))!.parentId).toBe(FBQ);
    expectNoDuplicateIds(vaultDir);
    await second.app.close();
  });
});

test.describe('Nested duplicates — three folders', () => {
  const F1 = 'd2000000-0000-4000-8000-0000000000b1';
  const F2 = 'd2000000-0000-4000-8000-0000000000b2';
  const F3 = 'd2000000-0000-4000-8000-0000000000b3';
  const D = 'd2000000-0000-4000-8000-0000000000b4';
  test.use({
    vaultExtra: {
      'F1.md': frontmatterNote({ id: F1, title: 'F1' }),
      'F2.md': frontmatterNote({ id: F2, title: 'F2' }),
      'F3.md': frontmatterNote({ id: F3, title: 'F3' }),
      'F1/Dup.md': frontmatterNote(
        { id: D, title: 'Dup', updated: '2024-01-01T00:00:00.000Z' },
        'a',
      ),
    },
  });

  test('three copies across three folders leave one live file and two nested trash files', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.title, { timeout: 30_000 })
      .toBe('Dup');
    await first.app.close();

    fs.mkdirSync(path.join(vaultDir, 'F2'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'F3'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'F2/Dup.md'),
      frontmatterNote({ id: D, title: 'Dup', updated: '2024-05-01T00:00:00.000Z' }, 'b'),
    );
    fs.writeFileSync(
      path.join(vaultDir, 'F3/Dup.md'),
      frontmatterNote({ id: D, title: 'Dup', updated: '2024-09-01T00:00:00.000Z' }, 'c'),
    );

    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(second.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F3);
    await expect.poll(() => livePathsForId(vaultDir, D)).toEqual(['F3/Dup.md']);
    expect(trashedPathsForId(vaultDir, D).sort()).toEqual(['F1/Dup.md', 'F2/Dup.md']);
    expectNoDuplicateIds(vaultDir);
    await second.app.close();
  });
});

test.describe('Nested duplicates — tie and detachment', () => {
  const FA = 'd3000000-0000-4000-8000-0000000000c1';
  const FB = 'd3000000-0000-4000-8000-0000000000c2';
  const TIE = 'd3000000-0000-4000-8000-0000000000c3';
  test.use({
    vaultExtra: {
      'FolderA.md': frontmatterNote({ id: FA, title: 'FolderA' }),
      'FolderB.md': frontmatterNote({ id: FB, title: 'FolderB' }),
      'FolderA/Tie.md': frontmatterNote(
        { id: TIE, title: 'Tie', updated: '2024-05-05T00:00:00.000Z' },
        'a',
      ),
    },
  });

  test('a tie on `updated` resolves deterministically to the first path in scan order', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, TIE))?.parentId, { timeout: 30_000 })
      .toBe(FA);
    await first.app.close();

    fs.mkdirSync(path.join(vaultDir, 'FolderB'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'FolderB/Tie.md'),
      frontmatterNote({ id: TIE, title: 'Tie', updated: '2024-05-05T00:00:00.000Z' }, 'b'),
    );

    const second = await boot(userDataDir, vaultDir);
    // Equal timestamps: the first path in scan order (FolderA) wins.
    await expect.poll(() => livePathsForId(vaultDir, TIE)).toEqual(['FolderA/Tie.md']);
    expect(trashedPathsForId(vaultDir, TIE)).toEqual(['FolderB/Tie.md']);
    expect((await getDocumentFromDb(second.window, TIE))!.parentId).toBe(FA);
    await second.app.close();
  });
});

test.describe('Nested duplicates — root vs nested', () => {
  const FOLDER = 'd4000000-0000-4000-8000-0000000000d1';
  const D = 'd4000000-0000-4000-8000-0000000000d2';
  test.use({
    vaultExtra: {
      'Pkg.md': frontmatterNote({ id: FOLDER, title: 'Pkg' }),
      'Pkg/Dup Old.md': frontmatterNote(
        { id: D, title: 'Dup Old', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('a newer root copy detaches the note from its nested folder', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(FOLDER);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Dup New.md'),
      frontmatterNote({ id: D, title: 'Dup New', updated: '2024-11-01T00:00:00.000Z' }, 'new'),
    );

    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(second.window, D))?.parentId, { timeout: 30_000 })
      .toBeNull();
    expect(livePathsForId(vaultDir, D)).toEqual(['Dup New.md']);
    expect(trashedPathsForId(vaultDir, D)).toEqual(['Pkg/Dup Old.md']);
    await second.app.close();
  });

  test('trashing the loser keeps the surviving sibling order in its folder dense', async ({
    testDir,
    vaultDir,
  }) => {
    const OTHER = 'd4000000-0000-4000-8000-0000000000d3';
    // Add a sibling next to the loser after the first boot.
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, FOLDER)) != null, { timeout: 30_000 })
      .toBe(true);
    fs.writeFileSync(
      path.join(vaultDir, 'Pkg/Keep.md'),
      frontmatterNote({ id: OTHER, title: 'Keep', order: 0 }, 'keep'),
    );
    fs.writeFileSync(
      path.join(vaultDir, 'Dup New.md'),
      frontmatterNote({ id: D, title: 'Dup New', updated: '2024-11-01T00:00:00.000Z' }, 'new'),
    );
    await first.app.close();

    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 })
      .toEqual(['Dup New.md']);
    expect(livePathsForId(vaultDir, OTHER)).toEqual(['Pkg/Keep.md']);
    expect(Number(readNote(vaultDir, 'Pkg/Keep.md').data.order)).toBe(0);
    await second.app.close();
  });
});

test.describe('Nested duplicates — same folder', () => {
  const F = 'd5000000-0000-4000-8000-0000000000e1';
  const D = 'd5000000-0000-4000-8000-0000000000e2';
  test.use({
    vaultExtra: {
      'Box.md': frontmatterNote({ id: F, title: 'Box' }),
      'Box/Dup.md': frontmatterNote(
        { id: D, title: 'Dup', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('two copies inside one folder converge to one, same parent', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Box/Dup Newer.md'),
      frontmatterNote({ id: D, title: 'Dup Newer', updated: '2024-12-01T00:00:00.000Z' }, 'new'),
    );

    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 })
      .toEqual(['Box/Dup Newer.md']);
    expect(trashedPathsForId(vaultDir, D)).toEqual(['Box/Dup.md']);
    expect((await getDocumentFromDb(second.window, D))!.parentId).toBe(F);
    expectNoDuplicateIds(vaultDir);
    await second.app.close();
  });
});

// ── names / filename dedupe interleaved with nesting ────────────────

test.describe('Nested duplicates — names interleaved', () => {
  const F = 'd6000000-0000-4000-8000-0000000000f1';
  const A = 'd6000000-0000-4000-8000-0000000000f2';
  const B = 'd6000000-0000-4000-8000-0000000000f3';
  test.use({
    vaultExtra: {
      'Names.md': frontmatterNote({ id: F, title: 'Names' }),
      'Names/Same.md': frontmatterNote({ id: A, title: 'Same' }, 'a'),
      'Names/Same (2).md': frontmatterNote({ id: B, title: 'Same' }, 'b'),
    },
  });

  test('two distinct ids sharing a title nest side by side with deduped filenames', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, A))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await expect.poll(() => livePathsForId(vaultDir, A).length).toBe(1);
    expect(livePathsForId(vaultDir, B).length).toBe(1);

    const aPath = soleLive(vaultDir, A);
    const bPath = soleLive(vaultDir, B);
    expect(new Set([aPath, bPath])).toEqual(new Set(['Names/Same.md', 'Names/Same (2).md']));
    // Titles are preserved even though the filenames were deduped.
    expect(readNote(vaultDir, aPath).data.title).toBe('Same');
    expect(readNote(vaultDir, bPath).data.title).toBe('Same');
    expectNoDuplicateIds(vaultDir);
  });
});

test.describe('Nested duplicates — duplicate id beside a same-title note', () => {
  const F = 'd7000000-0000-4000-8000-000000000101';
  const D = 'd7000000-0000-4000-8000-000000000102';
  const OTHER = 'd7000000-0000-4000-8000-000000000103';
  test.use({
    vaultExtra: {
      'Mix.md': frontmatterNote({ id: F, title: 'Mix' }),
      'Mix/Dup.md': frontmatterNote(
        { id: D, title: 'Other', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
      'Mix/Other.md': frontmatterNote({ id: OTHER, title: 'Other' }, 'other'),
    },
  });

  test('deduping a duplicate id leaves the distinct same-title note alive', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await first.app.close();

    fs.writeFileSync(
      path.join(vaultDir, 'Mix/Dup New.md'),
      frontmatterNote({ id: D, title: 'Other', updated: '2024-10-01T00:00:00.000Z' }, 'new'),
    );

    const second = await boot(userDataDir, vaultDir);
    await expect.poll(() => livePathsForId(vaultDir, D).length, { timeout: 30_000 }).toBe(1);
    expect(livePathsForId(vaultDir, OTHER).length).toBe(1);
    const dPath = soleLive(vaultDir, D);
    const otherPath = soleLive(vaultDir, OTHER);
    expect(dPath).not.toBe(otherPath);
    expect(dPath.startsWith('Mix/')).toBe(true);
    expect(otherPath.startsWith('Mix/')).toBe(true);
    expectNoDuplicateIds(vaultDir);
    expect(second.window).toBeTruthy();
    await second.app.close();
  });
});

test.describe('Nested duplicates — sanitize collisions', () => {
  const F = 'd8000000-0000-4000-8000-000000000201';
  const SLASH = 'd8000000-0000-4000-8000-000000000202';
  const DASH = 'd8000000-0000-4000-8000-000000000203';
  test.use({
    vaultExtra: {
      'Collide.md': frontmatterNote({ id: F, title: 'Collide' }),
      'Collide/A-B.md': frontmatterNote({ id: SLASH, title: 'A/B' }, 'slash'),
      'Collide/A-B (2).md': frontmatterNote({ id: DASH, title: 'A-B' }, 'dash'),
    },
  });

  test('titles that sanitize to one stem still get distinct files', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, SLASH))?.parentId, { timeout: 30_000 })
      .toBe(F);
    const slashPath = soleLive(vaultDir, SLASH);
    const dashPath = soleLive(vaultDir, DASH);
    expect(new Set([slashPath, dashPath])).toEqual(
      new Set(['Collide/A-B.md', 'Collide/A-B (2).md']),
    );
    expect(readNote(vaultDir, slashPath).data.title).toBe('A/B');
    expect(readNote(vaultDir, dashPath).data.title).toBe('A-B');
    expectNoDuplicateIds(vaultDir);
  });
});

// ── OS moves: single note back and forth through folders ────────────

test.describe('Nested movement — OS ping-pong', () => {
  const F1 = 'd9000000-0000-4000-8000-000000000301';
  const F2 = 'd9000000-0000-4000-8000-000000000302';
  const N = 'd9000000-0000-4000-8000-000000000303';
  test.use({
    vaultExtra: {
      'F1.md': frontmatterNote({ id: F1, title: 'F1' }),
      'F2.md': frontmatterNote({ id: F2, title: 'F2' }),
      'N.md': frontmatterNote({ id: N, title: 'N' }, 'body'),
    },
  });

  test('a note moved in/out/into another folder at the OS level ends at the final folder', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, N))?.title, { timeout: 30_000 })
      .toBe('N');
    await expect
      .poll(async () => (await getDocumentFromDb(window, F1)) != null, { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(async () => (await getDocumentFromDb(window, F2)) != null, { timeout: 30_000 })
      .toBe(true);

    renameVaultPath(vaultDir, 'N.md', 'F1/N.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, N))?.parentId, { timeout: 30_000 })
      .toBe(F1);

    renameVaultPath(vaultDir, 'F1/N.md', 'N.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, N))?.parentId, { timeout: 30_000 })
      .toBeNull();

    renameVaultPath(vaultDir, 'N.md', 'F2/N.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, N))?.parentId, { timeout: 30_000 })
      .toBe(F2);

    await waitForFile(path.join(vaultDir, 'F2/N.md'));
    await waitForFileGone(path.join(vaultDir, 'F1/N.md'));
    expect(filePathForId(vaultDir, N)).toBe('F2/N.md');
  });

  test('moving a file into a folder with no parent note leaves it at the root', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, N))?.title, { timeout: 30_000 })
      .toBe('N');
    fs.mkdirSync(path.join(vaultDir, 'Loose'), { recursive: true });
    renameVaultPath(vaultDir, 'N.md', 'Loose/N.md');

    await window.waitForTimeout(1200);
    // No `Loose.md` exists, so there is no parent to attach to.
    expect((await getDocumentFromDb(window, N))!.parentId).toBeNull();
    expect(livePathsForId(vaultDir, N)).toHaveLength(1);
  });
});

// ── OS moves: duplicate ping-pong across folders over relaunches ─────

test.describe('Nested duplicates — OS move back and forth', () => {
  const FOLDERS = ['Ping A', 'Ping B', 'Ping C'];
  const IDS = [
    'da000000-0000-4000-8000-000000000401',
    'da000000-0000-4000-8000-000000000402',
    'da000000-0000-4000-8000-000000000403',
  ];
  const D = 'da000000-0000-4000-8000-000000000404';
  test.use({
    vaultExtra: {
      [`${FOLDERS[0]}.md`]: frontmatterNote({ id: IDS[0], title: FOLDERS[0] }),
      [`${FOLDERS[1]}.md`]: frontmatterNote({ id: IDS[1], title: FOLDERS[1] }),
      [`${FOLDERS[2]}.md`]: frontmatterNote({ id: IDS[2], title: FOLDERS[2] }),
      [`${FOLDERS[0]}/Dup.md`]: frontmatterNote(
        { id: D, title: 'Dup', updated: '2024-01-01T00:00:00.000Z' },
        'v0',
      ),
    },
  });

  test('repeated OS moves between folders always converge to one file at the final folder', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    let app = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(app.window, D))?.title, { timeout: 30_000 })
      .toBe('Dup');
    await app.app.close();

    for (let round = 1; round < FOLDERS.length; round += 1) {
      const folder = FOLDERS[round];
      const next = `${folder}/Dup.md`;
      // OS move (write at the new nested path, delete the old one) + edit.
      fs.mkdirSync(path.join(vaultDir, folder), { recursive: true });
      writeNote(
        vaultDir,
        next,
        { id: D, title: 'Dup', updated: `2024-0${round + 2}-01T00:00:00.000Z` },
        `v${round}`,
      );

      app = await boot(userDataDir, vaultDir);
      await expect
        .poll(async () => (await getDocumentFromDb(app.window, D))?.parentId, { timeout: 30_000 })
        .toBe(IDS[round]);
      await expect.poll(() => livePathsForId(vaultDir, D)).toEqual([next]);
      expect(trashedPathsForId(vaultDir, D).length).toBe(round);
      expectNoDuplicateIds(vaultDir);
      await app.app.close();
    }
  });
});

// ── OS moves: folders containing duplicates ─────────────────────────

test.describe('Nested duplicates — moving folders', () => {
  const G = 'db000000-0000-4000-8000-000000000501';
  const F = 'db000000-0000-4000-8000-000000000502';
  const D = 'db000000-0000-4000-8000-000000000503';
  const CHILD = 'db000000-0000-4000-8000-000000000504';
  test.use({
    vaultExtra: {
      'G.md': frontmatterNote({ id: G, title: 'G' }),
      'F.md': frontmatterNote({ id: F, title: 'F' }),
      'F/Child.md': frontmatterNote({ id: CHILD, title: 'Child' }, 'c'),
      'F/Dup.md': frontmatterNote(
        { id: D, title: 'Dup', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('an OS folder move reparents the subtree while the duplicate is resolved', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await first.app.close();

    // Introduce a newer root copy while closed, then converge.
    writeNote(
      vaultDir,
      'Dup.md',
      { id: D, title: 'Dup', updated: '2024-08-01T00:00:00.000Z' },
      'new',
    );
    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 })
      .toEqual(['Dup.md']);
    expect(trashedPathsForId(vaultDir, D)).toEqual(['F/Dup.md']);
    await second.app.close();

    // OS-move the F branch under G.
    const third = await boot(userDataDir, vaultDir);
    fs.mkdirSync(path.join(vaultDir, 'G'), { recursive: true });
    fs.renameSync(path.join(vaultDir, 'F.md'), path.join(vaultDir, 'G/F.md'));
    fs.renameSync(path.join(vaultDir, 'F'), path.join(vaultDir, 'G/F'));

    await expect
      .poll(async () => (await getDocumentFromDb(third.window, F))?.parentId, { timeout: 30_000 })
      .toBe(G);
    await waitForFile(path.join(vaultDir, 'G/F/Child.md'));
    expect(filePathForId(vaultDir, CHILD)).toBe('G/F/Child.md');
    // The duplicate accounting is untouched by the folder move.
    expect(livePathsForId(vaultDir, D)).toEqual(['Dup.md']);
    expectNoDuplicateIds(vaultDir);
    await third.app.close();
  });

  test('copies in the same folder and at the root converge to one file in the folder', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await first.app.close();

    // Two rival copies in F plus a stale root copy.
    writeNote(
      vaultDir,
      'F/Dup New.md',
      { id: D, title: 'Dup', updated: '2024-06-01T00:00:00.000Z' },
      'newest',
    );
    writeNote(
      vaultDir,
      'Dup.md',
      { id: D, title: 'Dup', updated: '2023-01-01T00:00:00.000Z' },
      'stale',
    );

    const second = await boot(userDataDir, vaultDir);
    await expect.poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 }).toEqual([
      'F/Dup New.md',
    ]);
    expect(trashedPathsForId(vaultDir, D).sort()).toEqual(['Dup.md', 'F/Dup.md']);
    expect((await getDocumentFromDb(second.window, D))!.parentId).toBe(F);
    expectNoDuplicateIds(vaultDir);
    await second.app.close();
  });
});

// ── live OS moves while the app is running ──────────────────────────

test.describe('Nested duplicates — live OS moves', () => {
  const F = 'dc000000-0000-4000-8000-000000000601';
  const D = 'dc000000-0000-4000-8000-000000000602';
  test.use({
    vaultExtra: {
      'Live.md': frontmatterNote({ id: F, title: 'Live' }),
      'Dup.md': frontmatterNote(
        { id: D, title: 'Dup', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('a duplicate introduced in a nested folder reparents and replaces the root copy', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.title, { timeout: 30_000 })
      .toBe('Dup');
    await expect
      .poll(async () => (await getDocumentFromDb(window, F)) != null, { timeout: 30_000 })
      .toBe(true);

    fs.mkdirSync(path.join(vaultDir, 'Live'), { recursive: true });
    writeNote(
      vaultDir,
      'Live/Dup.md',
      { id: D, title: 'Dup', updated: '2099-01-01T00:00:00.000Z' },
      'newer nested',
    );

    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await expect.poll(() => livePathsForId(vaultDir, D)).toEqual(['Live/Dup.md']);
    expect(trashedPathsForId(vaultDir, D)).toEqual(['Dup.md']);
    expectNoDuplicateIds(vaultDir);
  });

  test('moving a nested note out to the root while running clears its parent', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.title, { timeout: 30_000 })
      .toBe('Dup');
    await expect
      .poll(async () => (await getDocumentFromDb(window, F)) != null, { timeout: 30_000 })
      .toBe(true);
    renameVaultPath(vaultDir, 'Dup.md', 'Live/Dup.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);

    renameVaultPath(vaultDir, 'Live/Dup.md', 'Dup.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.parentId, { timeout: 30_000 })
      .toBeNull();
    expect(filePathForId(vaultDir, D)).toBe('Dup.md');
    expectNoDuplicateIds(vaultDir);
  });

  test('an OS rename of a nested note retitles it without orphaning the file', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.title, { timeout: 30_000 })
      .toBe('Dup');
    fs.mkdirSync(path.join(vaultDir, 'Live'), { recursive: true });
    renameVaultPath(vaultDir, 'Dup.md', 'Live/Renamed Dup.md');

    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.title, { timeout: 30_000 })
      .toBe('Renamed Dup');
    expect(filePathForId(vaultDir, D)).toBe('Live/Renamed Dup.md');
    await waitForFileGone(path.join(vaultDir, 'Dup.md'));
  });
});

// ── durability / DB rebuild ─────────────────────────────────────────

test.describe('Nested duplicates — durability', () => {
  const F = 'dd000000-0000-4000-8000-000000000701';
  const D = 'dd000000-0000-4000-8000-000000000702';
  test.use({
    vaultExtra: {
      'Durable.md': frontmatterNote({ id: F, title: 'Durable' }),
      'Durable/Dup.md': frontmatterNote(
        { id: D, title: 'Dup', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('a converged nested duplicate stays converged across two relaunches', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    let app = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(app.window, D))?.title, { timeout: 30_000 })
      .toBe('Dup');
    fs.mkdirSync(path.join(vaultDir, 'Durable'), { recursive: true });
    writeNote(
      vaultDir,
      'Durable/Dup Newer.md',
      { id: D, title: 'Dup Newer', updated: '2024-09-01T00:00:00.000Z' },
      'newer',
    );
    await app.app.close();

    for (let round = 0; round < 2; round += 1) {
      app = await boot(userDataDir, vaultDir);
      await expect
        .poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 })
        .toEqual(['Durable/Dup Newer.md']);
      expect(trashedPathsForId(vaultDir, D)).toEqual(['Durable/Dup.md']);
      expect((await getDocumentFromDb(app.window, D))!.parentId).toBe(F);
      await app.app.close();
    }
  });

  test('deleting the index rebuilds one note per id from the live files', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const app = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(app.window, D))?.title, { timeout: 30_000 })
      .toBe('Dup');
    writeNote(
      vaultDir,
      'Durable/Dup Newer.md',
      { id: D, title: 'Dup Newer', updated: '2024-09-01T00:00:00.000Z' },
      'newer',
    );
    await expect
      .poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 })
      .toEqual(['Durable/Dup Newer.md']);
    await app.app.close();

    for (const name of ['lychee.sqlite3', 'lychee.sqlite3-wal', 'lychee.sqlite3-shm']) {
      fs.rmSync(path.join(userDataDir, name), { force: true });
    }

    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(second.window, D))?.title, { timeout: 20_000 })
      .toBe('Dup Newer');
    await expect
      .poll(() => livePathsForId(vaultDir, D), { timeout: 10_000 })
      .toEqual(['Durable/Dup Newer.md']);
    expect((await listDocumentsFromDb(second.window)).filter((doc) => doc.id === D).length).toBe(1);
    expectNoDuplicateIds(vaultDir);
    await second.app.close();
  });

  test('the winning nested note keeps its children when it beats a duplicate', async ({
    testDir,
    vaultDir,
  }) => {
    const KID = 'dd000000-0000-4000-8000-000000000703';
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await first.app.close();

    // A newer copy of D at the root (no children) — but D actually has a child.
    fs.mkdirSync(path.join(vaultDir, 'Durable', 'Dup'), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'Durable', 'Dup', 'Kid.md'),
      frontmatterNote({ id: KID, title: 'Kid' }, 'kid'),
    );
    // Keep D nested but make a newer root copy lose by timestamp.
    fs.writeFileSync(
      path.join(vaultDir, 'Dup Root.md'),
      frontmatterNote({ id: D, title: 'Dup Root', updated: '2023-01-01T00:00:00.000Z' }, 'stale'),
    );

    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 })
      .toEqual(['Durable/Dup.md']);
    await waitForFile(path.join(vaultDir, 'Durable/Dup/Kid.md'));
    await expect
      .poll(async () => (await getDocumentFromDb(second.window, KID))?.parentId ?? null, {
        timeout: 15_000,
      })
      .toBe(D);
    expect(trashedPathsForId(vaultDir, D)).toEqual(['Dup Root.md']);
    await second.app.close();
  });
});

// ── OS shuffle challenges: many ids, folders, and back-and-forth ────

test.describe('Nested duplicates — two ids shuffled with folder moves', () => {
  const F1 = 'de000000-0000-4000-8000-000000000801';
  const F2 = 'de000000-0000-4000-8000-000000000802';
  const G = 'de000000-0000-4000-8000-000000000803';
  const A = 'de000000-0000-4000-8000-000000000804';
  const B = 'de000000-0000-4000-8000-000000000805';
  test.use({
    vaultExtra: {
      'F1.md': frontmatterNote({ id: F1, title: 'F1' }),
      'F2.md': frontmatterNote({ id: F2, title: 'F2' }),
      'G.md': frontmatterNote({ id: G, title: 'G' }),
      'F1/A.md': frontmatterNote(
        { id: A, title: 'A', updated: '2024-01-01T00:00:00.000Z' },
        'old a',
      ),
      'F2/B.md': frontmatterNote(
        { id: B, title: 'B', updated: '2024-01-01T00:00:00.000Z' },
        'old b',
      ),
    },
  });

  test('two duplicates converge, then their folders move together without resurfacing copies', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, A))?.parentId, { timeout: 30_000 })
      .toBe(F1);
    await first.app.close();

    writeNote(vaultDir, 'A.md', { id: A, title: 'A', updated: '2024-06-01T00:00:00.000Z' }, 'new a');
    writeNote(vaultDir, 'B.md', { id: B, title: 'B', updated: '2024-06-01T00:00:00.000Z' }, 'new b');

    const second = await boot(userDataDir, vaultDir);
    await expect.poll(() => livePathsForId(vaultDir, A), { timeout: 30_000 }).toEqual(['A.md']);
    await expect.poll(() => livePathsForId(vaultDir, B), { timeout: 30_000 }).toEqual(['B.md']);
    await second.app.close();

    const third = await boot(userDataDir, vaultDir);
    fs.mkdirSync(path.join(vaultDir, 'G'), { recursive: true });
    for (const folder of ['F1', 'F2']) {
      fs.renameSync(path.join(vaultDir, `${folder}.md`), path.join(vaultDir, `G/${folder}.md`));
      if (fs.existsSync(path.join(vaultDir, folder))) {
        fs.renameSync(path.join(vaultDir, folder), path.join(vaultDir, `G/${folder}`));
      }
    }

    await expect
      .poll(async () => (await getDocumentFromDb(third.window, F1))?.parentId, { timeout: 30_000 })
      .toBe(G);
    await expect
      .poll(async () => (await getDocumentFromDb(third.window, F2))?.parentId, { timeout: 30_000 })
      .toBe(G);
    expect(livePathsForId(vaultDir, A)).toEqual(['A.md']);
    expect(livePathsForId(vaultDir, B)).toEqual(['B.md']);
    expectNoDuplicateIds(vaultDir);
    await third.app.close();
  });
});

test.describe('Nested duplicates — moving a folder note after convergence', () => {
  const F = 'df000000-0000-4000-8000-000000000901';
  const KID = 'df000000-0000-4000-8000-000000000902';
  const D = 'df000000-0000-4000-8000-000000000903';
  test.use({
    vaultExtra: {
      'Folder.md': frontmatterNote({ id: F, title: 'Folder' }),
      'Folder/Kid.md': frontmatterNote({ id: KID, title: 'Kid' }, 'kid'),
      'Folder/Dup.md': frontmatterNote(
        { id: D, title: 'Dup', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('renaming the folder at the OS level keeps the child and the duplicate winner', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await first.app.close();

    writeNote(vaultDir, 'Dup.md', { id: D, title: 'Dup', updated: '2024-07-01T00:00:00.000Z' }, 'new');
    const second = await boot(userDataDir, vaultDir);
    await expect
      .poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 })
      .toEqual(['Dup.md']);
    expect(trashedPathsForId(vaultDir, D)).toEqual(['Folder/Dup.md']);
    await second.app.close();

    const third = await boot(userDataDir, vaultDir);
    fs.renameSync(path.join(vaultDir, 'Folder.md'), path.join(vaultDir, 'Folder Renamed.md'));
    fs.renameSync(path.join(vaultDir, 'Folder'), path.join(vaultDir, 'Folder Renamed'));

    await expect
      .poll(async () => (await getDocumentFromDb(third.window, F))?.title, { timeout: 30_000 })
      .toBe('Folder Renamed');
    await waitForFile(path.join(vaultDir, 'Folder Renamed/Kid.md'));
    expect(filePathForId(vaultDir, KID)).toBe('Folder Renamed/Kid.md');
    expect(livePathsForId(vaultDir, D)).toEqual(['Dup.md']);
    expectNoDuplicateIds(vaultDir);
    await third.app.close();
  });
});

test.describe('Nested duplicates — moving the winner after convergence', () => {
  const F = 'e0000000-0000-4000-8000-000000000a01';
  const H = 'e0000000-0000-4000-8000-000000000a02';
  const D = 'e0000000-0000-4000-8000-000000000a03';
  test.use({
    vaultExtra: {
      'F.md': frontmatterNote({ id: F, title: 'F' }),
      'H.md': frontmatterNote({ id: H, title: 'H' }),
      'F/Dup.md': frontmatterNote(
        { id: D, title: 'Dup', updated: '2024-01-01T00:00:00.000Z' },
        'old',
      ),
    },
  });

  test('OS-moving the converged winner into a new folder reparents it and keeps one file', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F);
    await first.app.close();

    writeNote(vaultDir, 'Dup.md', { id: D, title: 'Dup', updated: '2024-07-01T00:00:00.000Z' }, 'new');
    const second = await boot(userDataDir, vaultDir);
    await expect.poll(() => livePathsForId(vaultDir, D), { timeout: 30_000 }).toEqual(['Dup.md']);
    await second.app.close();

    const third = await boot(userDataDir, vaultDir);
    fs.mkdirSync(path.join(vaultDir, 'H'), { recursive: true });
    fs.renameSync(path.join(vaultDir, 'Dup.md'), path.join(vaultDir, 'H/Dup.md'));

    await expect
      .poll(async () => (await getDocumentFromDb(third.window, D))?.parentId, { timeout: 30_000 })
      .toBe(H);
    expect(livePathsForId(vaultDir, D)).toEqual(['H/Dup.md']);
    expect(trashedPathsForId(vaultDir, D)).toEqual(['F/Dup.md']);
    expectNoDuplicateIds(vaultDir);
    await third.app.close();
  });
});

test.describe('Nested movement — live back-and-forth', () => {
  const F1 = 'e1000000-0000-4000-8000-000000000b01';
  const F2 = 'e1000000-0000-4000-8000-000000000b02';
  const D = 'e1000000-0000-4000-8000-000000000b03';
  test.use({
    vaultExtra: {
      'F1.md': frontmatterNote({ id: F1, title: 'F1' }),
      'F2.md': frontmatterNote({ id: F2, title: 'F2' }),
      'Dup.md': frontmatterNote({ id: D, title: 'Dup' }, 'body'),
    },
  });

  test('a nested note shuffled in/out/to another folder live ends at the last location', async ({
    window,
    vaultDir,
  }) => {
    renameVaultPath(vaultDir, 'Dup.md', 'F1/Dup.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.parentId, { timeout: 30_000 })
      .toBe(F1);

    renameVaultPath(vaultDir, 'F1/Dup.md', 'F2/Dup.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.parentId, { timeout: 30_000 })
      .toBe(F2);

    renameVaultPath(vaultDir, 'F2/Dup.md', 'Dup.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, D)) != null, { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(async () => (await getDocumentFromDb(window, F1)) != null, { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(async () => (await getDocumentFromDb(window, F2)) != null, { timeout: 30_000 })
      .toBe(true);
    renameVaultPath(vaultDir, 'Dup.md', 'F1/Dup.md');
    await expect
      .poll(async () => (await getDocumentFromDb(window, D))?.parentId, { timeout: 30_000 })
      .toBe(F1);

    expect(filePathForId(vaultDir, D)).toBe('F1/Dup.md');
    expect(livePathsForId(vaultDir, D)).toHaveLength(1);
  });

  test('renaming the converged nested winner at the OS level keeps one file', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await boot(userDataDir, vaultDir);
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.title, { timeout: 30_000 })
      .toBe('Dup');
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, F1)) != null, { timeout: 30_000 })
      .toBe(true);
    writeNote(vaultDir, 'F1/Dup.md', { id: D, title: 'Dup', updated: '2099-01-01T00:00:00.000Z' }, 'new');
    await expect
      .poll(async () => (await getDocumentFromDb(first.window, D))?.parentId, { timeout: 30_000 })
      .toBe(F1);
    await first.app.close();

    const second = await boot(userDataDir, vaultDir);
    renameVaultPath(vaultDir, 'F1/Dup.md', 'F1/Dup Renamed.md');
    await expect
      .poll(async () => (await getDocumentFromDb(second.window, D))?.title, { timeout: 30_000 })
      .toBe('Dup Renamed');
    expect(livePathsForId(vaultDir, D)).toEqual(['F1/Dup Renamed.md']);
    expectNoDuplicateIds(vaultDir);
    await second.app.close();
  });
});
