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
  createNote,
  createNoteViaIpc,
  idsByTitle,
  moveViaStore,
  moveViaIpc,
  moveViaIpcExpectError,
  filePathForId,
  listMarkdown,
  readNote,
  readRaw,
  typeInBody,
  commitSaves,
  waitForFile,
  waitForContent,
  waitForFileGone,
  frontmatterNote,
} from './vault-helpers';
import { isConflictCopyPath } from '../src/shared/vault-watch';

/**
 * Deep nesting × movement.
 *
 * The folder layout *is* the hierarchy: `A.md` + `A/` holds A's children. These
 * assert the real bytes on disk — exact relative paths, `order` frontmatter, and
 * body content — through mixed operations: nest, re-nest, move in/out of deep
 * branches, reorder a nested node, move entire subtrees (app and OS), trash and
 * restore nested subtrees, and survive relaunch. No happy-path-only checks.
 */

// ── test helpers ────────────────────────────────────────────────────

async function idMap(window: Parameters<typeof listDocumentsFromDb>[0]) {
  return idsByTitle(window);
}

/** Live markdown files that are real notes (have a frontmatter id). */
function notePaths(vaultDir: string): string[] {
  return listMarkdown(vaultDir).filter((rel) => {
    if (isConflictCopyPath(rel)) return false;
    try {
      return Boolean(readNote(vaultDir, rel).data.id);
    } catch {
      return false;
    }
  });
}

/** Exact set of live note paths (sorted), so stale/extra files fail loudly. */
function expectPaths(vaultDir: string, expected: string[]): void {
  expect(notePaths(vaultDir)).toEqual([...expected].sort());
}

function orderOf(vaultDir: string, relativePath: string): number {
  return Number(readNote(vaultDir, relativePath).data.order);
}

async function parentOf(
  window: Parameters<typeof listDocumentsFromDb>[0],
  title: string,
): Promise<string | null> {
  const id = (await idMap(window)).get(title)!;
  return (await getDocumentFromDb(window, id))?.parentId ?? null;
}

interface TreeRow {
  title: string;
  path: string;
  order: number;
  parent: string | null;
}

/**
 * Assert the full on-disk + DB state of a tree in one shot: each note's exact
 * file path, frontmatter `order`, and parent id. Catches cross-branch mistakes
 * that per-note assertions miss.
 */
async function expectTree(
  window: Parameters<typeof listDocumentsFromDb>[0],
  vaultDir: string,
  rows: TreeRow[],
): Promise<void> {
  const map = await idMap(window);
  for (const row of rows) {
    const id = map.get(row.title)!;
    await expect.poll(() => filePathForId(vaultDir, id), { timeout: 20_000 }).toBe(row.path);
    await expect
      .poll(
        () => {
          try {
            return Number(readNote(vaultDir, row.path).data.order ?? -1);
          } catch {
            return -1;
          }
        },
        { timeout: 20_000 },
      )
      .toBe(row.order);
    await expect
      .poll(async () => (await getDocumentFromDb(window, id))?.parentId ?? null, {
        timeout: 10_000,
      })
      .toBe(row.parent ? map.get(row.parent)! : null);
  }
}

async function trashIpc(window: Parameters<typeof listDocumentsFromDb>[0], id: string) {
  await window.evaluate(async (docId) => {
    await (window as any).lychee.invoke('documents.trash', { id: docId });
  }, id);
  await window.waitForTimeout(400);
}

async function restoreIpc(window: Parameters<typeof listDocumentsFromDb>[0], id: string) {
  await window.evaluate(async (docId) => {
    await (window as any).lychee.invoke('documents.restore', { id: docId });
  }, id);
  await window.waitForTimeout(400);
}

async function permanentDeleteIpc(window: Parameters<typeof listDocumentsFromDb>[0], id: string) {
  await window.evaluate(async (docId) => {
    await (window as any).lychee.invoke('documents.permanentDelete', { id: docId });
  }, id);
  await window.waitForTimeout(400);
}

/** Build a linear chain `L1 > L2 > ... > Ln` via the app and return title→id. */
async function buildChain(
  window: Parameters<typeof listDocumentsFromDb>[0],
  vaultDir: string,
  titles: string[],
): Promise<Map<string, string>> {
  for (const title of titles) await createNote(window, title);
  const map = await idMap(window);
  for (let i = 1; i < titles.length; i += 1) {
    await moveViaStore(window, map.get(titles[i])!, map.get(titles[i - 1])!, 0);
  }
  // Deep stems may be byte-truncated by the path planner, so locate by id.
  const last = map.get(titles[titles.length - 1])!;
  await expect.poll(() => filePathForId(vaultDir, last) != null, { timeout: 20_000 }).toBe(true);
  return map;
}

// ── 1. Building trees: exact paths ──────────────────────────────────

test.describe('Nesting — tree building', () => {
  test('a five-level chain maps to nested files and parents', async ({ window, vaultDir }) => {
    const titles = ['L1', 'L2', 'L3', 'L4', 'L5'];
    const map = await buildChain(window, vaultDir, titles);

    expectPaths(vaultDir, [
      'L1.md',
      'L1/L2.md',
      'L1/L2/L3.md',
      'L1/L2/L3/L4.md',
      'L1/L2/L3/L4/L5.md',
    ]);
    expect((await getDocumentFromDb(window, map.get('L1')!))!.parentId).toBeNull();
    for (let i = 1; i < titles.length; i += 1) {
      expect((await getDocumentFromDb(window, map.get(titles[i])!))!.parentId).toBe(
        map.get(titles[i - 1]),
      );
    }
    // Every file keeps its own frontmatter id.
    for (const rel of listMarkdown(vaultDir)) {
      expect(readNote(vaultDir, rel).data.id).toBeTruthy();
    }
  });

  test('a wide folder holds every child at order 0..n-1', async ({ window, vaultDir }) => {
    for (const t of ['P', 'A', 'B', 'C', 'D']) await createNote(window, t);
    const map = await idMap(window);
    const children = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < children.length; i += 1) {
      await moveViaStore(window, map.get(children[i])!, map.get('P')!, i);
    }
    await waitForFile(path.join(vaultDir, 'P/D.md'));

    expectPaths(vaultDir, ['P.md', 'P/A.md', 'P/B.md', 'P/C.md', 'P/D.md']);
    for (let i = 0; i < children.length; i += 1) {
      expect(orderOf(vaultDir, `P/${children[i]}.md`)).toBe(i);
      expect(await parentOf(window, children[i])).toBe(map.get('P'));
    }
  });

  test('a child moved to the front of a deep folder lands at order 0', async ({
    window,
    vaultDir,
  }) => {
    for (const t of ['Root', 'One', 'Two', 'Three']) await createNote(window, t);
    const map = await idMap(window);
    for (let i = 0; i < 3; i += 1) {
      await moveViaStore(window, map.get(['One', 'Two', 'Three'][i])!, map.get('Root')!, i);
    }
    await waitForFile(path.join(vaultDir, 'Root/Three.md'));

    await moveViaStore(window, map.get('Three')!, map.get('Root')!, 0);

    expect(orderOf(vaultDir, 'Root/Three.md')).toBe(0);
    expect(orderOf(vaultDir, 'Root/One.md')).toBe(1);
    expect(orderOf(vaultDir, 'Root/Two.md')).toBe(2);
    expectPaths(vaultDir, ['Root.md', 'Root/One.md', 'Root/Two.md', 'Root/Three.md']);
  });

  test('a three-level chain inside a folder keeps every file in place', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Box');
    await createNote(window, 'Sub');
    await createNote(window, 'Leaf');
    const map = await idMap(window);
    await moveViaStore(window, map.get('Sub')!, map.get('Box')!, 0);
    await moveViaStore(window, map.get('Leaf')!, map.get('Sub')!, 0);
    await waitForFile(path.join(vaultDir, 'Box/Sub/Leaf.md'));

    expectPaths(vaultDir, ['Box.md', 'Box/Sub.md', 'Box/Sub/Leaf.md']);
    expect(await parentOf(window, 'Sub')).toBe(map.get('Box'));
    expect(await parentOf(window, 'Leaf')).toBe(map.get('Sub'));
  });
});

// ── 2. Nesting × reordering ─────────────────────────────────────────

test.describe('Nesting — nested reorder', () => {
  test('reordering inside a deep folder rewrites only that folder', async ({
    window,
    vaultDir,
  }) => {
    for (const t of ['P', 'A', 'B', 'C', 'D']) await createNote(window, t);
    const map = await idMap(window);
    const kids = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < kids.length; i += 1) {
      await moveViaStore(window, map.get(kids[i])!, map.get('P')!, i);
    }
    await waitForFile(path.join(vaultDir, 'P/D.md'));

    await moveViaStore(window, map.get('B')!, map.get('P')!, 3);
    await moveViaStore(window, map.get('C')!, map.get('P')!, 0);

    expect(orderOf(vaultDir, 'P/C.md')).toBe(0);
    expect(orderOf(vaultDir, 'P/A.md')).toBe(1);
    expect(orderOf(vaultDir, 'P/D.md')).toBe(2);
    expect(orderOf(vaultDir, 'P/B.md')).toBe(3);
    // Root file is untouched.
    expect(readNote(vaultDir, 'P.md').data.id).toBe(map.get('P'));
  });

  test('reordering a root node leaves its nested subtree order intact', async ({
    window,
    vaultDir,
  }) => {
    for (const t of ['Host', 'Kid One', 'Kid Two', 'Root X', 'Root Y']) await createNote(window, t);
    const map = await idMap(window);
    await moveViaStore(window, map.get('Kid One')!, map.get('Host')!, 0);
    await moveViaStore(window, map.get('Kid Two')!, map.get('Host')!, 1);
    await waitForFile(path.join(vaultDir, 'Host/Kid Two.md'));
    const before = ['Kid One', 'Kid Two'].map((t) => orderOf(vaultDir, `Host/${t}.md`));

    await moveViaStore(window, map.get('Host')!, null, 0);
    await moveViaStore(window, map.get('Root Y')!, null, 1);

    expect(['Kid One', 'Kid Two'].map((t) => orderOf(vaultDir, `Host/${t}.md`))).toEqual(before);
    expect(await parentOf(window, 'Kid One')).toBe(map.get('Host'));
    expect(await parentOf(window, 'Kid Two')).toBe(map.get('Host'));
  });

  test('reorder, nest deeper, reorder again keeps path and order consistent', async ({
    window,
    vaultDir,
  }) => {
    for (const t of ['Top', 'Mid', 'Leaf', 'Other']) await createNote(window, t);
    const map = await idMap(window);
    await moveViaStore(window, map.get('Leaf')!, map.get('Top')!, 0);
    await moveViaStore(window, map.get('Other')!, map.get('Top')!, 1);
    await waitForFile(path.join(vaultDir, 'Top/Other.md'));
    // Top/Leaf(0), Top/Other(1) → move Other to 0.
    await moveViaStore(window, map.get('Other')!, map.get('Top')!, 0);
    expect(orderOf(vaultDir, 'Top/Other.md')).toBe(0);
    expect(orderOf(vaultDir, 'Top/Leaf.md')).toBe(1);

    // Now nest Leaf under Mid, then Mid under Top.
    await moveViaStore(window, map.get('Leaf')!, map.get('Mid')!, 0);
    await moveViaStore(window, map.get('Mid')!, map.get('Top')!, 1);
    await waitForFile(path.join(vaultDir, 'Top/Mid/Leaf.md'));

    expectPaths(vaultDir, ['Top.md', 'Top/Other.md', 'Top/Mid.md', 'Top/Mid/Leaf.md']);
    expect(orderOf(vaultDir, 'Top/Other.md')).toBe(0);
    expect(orderOf(vaultDir, 'Top/Mid.md')).toBe(1);
    expect(orderOf(vaultDir, 'Top/Mid/Leaf.md')).toBe(0);
  });

  test('nested sibling order stays dense after a move in and a move out', async ({
    window,
    vaultDir,
  }) => {
    for (const t of ['P', 'A', 'B', 'C']) await createNote(window, t);
    const map = await idMap(window);
    await moveViaStore(window, map.get('A')!, map.get('P')!, 0);
    await moveViaStore(window, map.get('B')!, map.get('P')!, 1);
    await moveViaStore(window, map.get('C')!, map.get('P')!, 2);
    await waitForFile(path.join(vaultDir, 'P/C.md'));

    // Pull B out, then put it back in the middle.
    await moveViaStore(window, map.get('B')!, null, 0);
    await waitForFileGone(path.join(vaultDir, 'P/B.md'));
    await moveViaStore(window, map.get('B')!, map.get('P')!, 1);

    expectPaths(vaultDir, ['P.md', 'P/A.md', 'P/B.md', 'P/C.md']);
    const orders = ['A', 'B', 'C']
      .map((t) => orderOf(vaultDir, `P/${t}.md`))
      .sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2]);
  });
});

// ── 3. Move in / out / nest anywhere ────────────────────────────────

test.describe('Nesting — move in, out, and between branches', () => {
  test('a note can travel root → deep → root → a different deep branch', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Traveller');
    await buildChain(window, vaultDir, ['A', 'B', 'C', 'D']);
    await createNote(window, 'Z');
    const map = await idMap(window);

    await moveViaStore(window, map.get('Traveller')!, map.get('D')!, 0);
    await waitForFile(path.join(vaultDir, 'A/B/C/D/Traveller.md'));
    expect(await parentOf(window, 'Traveller')).toBe(map.get('D'));

    await moveViaStore(window, map.get('Traveller')!, null, 0);
    await waitForFile(path.join(vaultDir, 'Traveller.md'));
    expect(await parentOf(window, 'Traveller')).toBeNull();

    await moveViaStore(window, map.get('Traveller')!, map.get('Z')!, 0);
    await waitForFile(path.join(vaultDir, 'Z/Traveller.md'));
    expect(await parentOf(window, 'Traveller')).toBe(map.get('Z'));
    expectPaths(vaultDir, [
      'A.md',
      'A/B.md',
      'A/B/C.md',
      'A/B/C/D.md',
      'Z.md',
      'Z/Traveller.md',
    ]);
  });

  test('moving a subtree out to the root carries its whole nest', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['Branch', 'Child', 'Grand']);
    await createNote(window, 'Elsewhere');
    const full = await idMap(window);
    await moveViaStore(window, full.get('Branch')!, full.get('Elsewhere')!, 0);
    await waitForFile(path.join(vaultDir, 'Elsewhere/Branch/Child/Grand.md'));

    await moveViaStore(window, full.get('Branch')!, null, 0);
    await waitForFile(path.join(vaultDir, 'Branch/Child/Grand.md'));

    expectPaths(vaultDir, ['Branch.md', 'Branch/Child.md', 'Branch/Child/Grand.md', 'Elsewhere.md']);
    expect(await parentOf(window, 'Branch')).toBeNull();
    expect(await parentOf(window, 'Child')).toBe(map.get('Branch'));
    expect(await parentOf(window, 'Grand')).toBe(map.get('Child'));
  });

  test('two subtrees can swap parents without losing their children', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'P1');
    await createNote(window, 'P2');
    await createNote(window, 'X');
    await createNote(window, 'Y');
    await createNote(window, 'X Kid');
    const map = await idMap(window);
    await moveViaStore(window, map.get('X')!, map.get('P1')!, 0);
    await moveViaStore(window, map.get('X Kid')!, map.get('X')!, 0);
    await moveViaStore(window, map.get('Y')!, map.get('P2')!, 0);
    await waitForFile(path.join(vaultDir, 'P1/X/X Kid.md'));

    await moveViaStore(window, map.get('X')!, map.get('P2')!, 0);
    await moveViaStore(window, map.get('Y')!, map.get('P1')!, 0);
    await waitForFile(path.join(vaultDir, 'P2/X/X Kid.md'));

    expectPaths(vaultDir, [
      'P1.md',
      'P1/Y.md',
      'P2.md',
      'P2/X.md',
      'P2/X/X Kid.md',
    ]);
    expect(await parentOf(window, 'X')).toBe(map.get('P2'));
    expect(await parentOf(window, 'X Kid')).toBe(map.get('X'));
    expect(await parentOf(window, 'Y')).toBe(map.get('P1'));
  });

  test('a note can become a sibling of its former ancestor', async ({ window, vaultDir }) => {
    const map = await buildChain(window, vaultDir, ['Top', 'Mid', 'Deep']);
    // Deep is Top/Mid/Deep. Move Deep to be a direct child of Top.
    await moveViaStore(window, map.get('Deep')!, map.get('Top')!, 0);
    await waitForFile(path.join(vaultDir, 'Top/Deep.md'));

    expectPaths(vaultDir, ['Top.md', 'Top/Mid.md', 'Top/Deep.md']);
    expect(await parentOf(window, 'Deep')).toBe(map.get('Top'));
    expect(await parentOf(window, 'Mid')).toBe(map.get('Top'));
    expect(orderOf(vaultDir, 'Top/Deep.md')).toBe(0);
    expect(orderOf(vaultDir, 'Top/Mid.md')).toBe(1);
  });

  test('deep ping-pong in and out settles to a single file at the final path', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['Home', 'A', 'B']);
    await createNote(window, 'Wanderer');
    const wanderer = (await idMap(window)).get('Wanderer')!;

    await moveViaStore(window, wanderer, map.get('B')!, 0);
    await waitForFile(path.join(vaultDir, 'Home/A/B/Wanderer.md'));
    await moveViaStore(window, wanderer, null, 0);
    await waitForFile(path.join(vaultDir, 'Wanderer.md'));
    await moveViaStore(window, wanderer, map.get('A')!, 0);
    await waitForFile(path.join(vaultDir, 'Home/A/Wanderer.md'));

    expectPaths(vaultDir, [
      'Home.md',
      'Home/A.md',
      'Home/A/B.md',
      'Home/A/Wanderer.md',
    ]);
    expect(filePathForId(vaultDir, wanderer)).toBe('Home/A/Wanderer.md');
  });

  test('moving a deep node under its own descendant is rejected', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['R', 'C', 'G']);
    const error = await moveViaIpcExpectError(window, map.get('R')!, map.get('G')!, 0);
    expect(error).toBeTruthy();
    expect(await parentOf(window, 'R')).toBeNull();
    expectPaths(vaultDir, ['R.md', 'R/C.md', 'R/C/G.md']);
  });

  test('a raw IPC move of a subtree reparents and relocates every descendant', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['One', 'Two', 'Three']);
    await createNote(window, 'NewBase');
    const full = await idMap(window);
    await moveViaIpc(window, full.get('One')!, full.get('NewBase')!, 0);
    await waitForFile(path.join(vaultDir, 'NewBase/One/Two/Three.md'));

    expect(await parentOf(window, 'One')).toBe(full.get('NewBase'));
    expect(await parentOf(window, 'Two')).toBe(map.get('One'));
    expect(await parentOf(window, 'Three')).toBe(map.get('Two'));
  });
});

// ── 4. OS-level directory movement ──────────────────────────────────

test.describe('Nesting — OS directory moves', () => {
  test.use({ vaultSeed: 'vault' });

  test('moving a folder and its parent file into another folder carries the subtree', async ({
    window,
    vaultDir,
  }) => {
    const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
    const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
    const BETA_ID = '44444444-4444-4444-8444-444444444444';
    const WORK_ID = 'e0000000-0000-4000-8000-0000000000f1';
    fs.writeFileSync(path.join(vaultDir, 'Work.md'), frontmatterNote({ id: WORK_ID, title: 'Work' }));
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.title, { timeout: 15_000 })
      .toBe('Alpha');

    fs.mkdirSync(path.join(vaultDir, 'Work'), { recursive: true });
    fs.renameSync(path.join(vaultDir, 'Projects.md'), path.join(vaultDir, 'Work/Projects.md'));
    fs.renameSync(path.join(vaultDir, 'Projects'), path.join(vaultDir, 'Work/Projects'));

    await waitForFile(path.join(vaultDir, 'Work/Projects/Alpha.md'));
    await expect
      .poll(async () => (await getDocumentFromDb(window, PROJECTS_ID))?.parentId, { timeout: 15_000 })
      .toBe(WORK_ID);
    expect((await getDocumentFromDb(window, ALPHA_ID))!.parentId).toBe(PROJECTS_ID);
    expect((await getDocumentFromDb(window, BETA_ID))!.parentId).toBe(PROJECTS_ID);
    expectPaths(vaultDir, [
      'Bookmarked.md',
      'Legacy.md',
      'Roadmap.md',
      'Untitled.md',
      'Work.md',
      'Work/Projects.md',
      'Work/Projects/Alpha.md',
      'Work/Projects/Beta.md',
    ]);
  });

  test('moving a deep child between OS folders reparents only that note', async ({
    window,
    vaultDir,
  }) => {
    const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
    const BETA_ID = '44444444-4444-4444-8444-444444444444';
    const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.title, { timeout: 15_000 })
      .toBe('Alpha');
    await createNote(window, 'Archive');
    const archiveId = (await idMap(window)).get('Archive')!;
    await waitForFile(path.join(vaultDir, 'Archive.md'));
    fs.mkdirSync(path.join(vaultDir, 'Archive'), { recursive: true });
    fs.renameSync(
      path.join(vaultDir, 'Projects/Alpha.md'),
      path.join(vaultDir, 'Archive/Alpha.md'),
    );

    await waitForFile(path.join(vaultDir, 'Archive/Alpha.md'));
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(archiveId);
    // Beta is untouched.
    expect((await getDocumentFromDb(window, BETA_ID))!.parentId).toBe(PROJECTS_ID);
    await waitForFileGone(path.join(vaultDir, 'Projects/Alpha.md'));
  });

  test('an OS rename of a branch moves its file and folder, carrying the subtree', async ({
    window,
    vaultDir,
  }) => {
    const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
    const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
    const BETA_ID = '44444444-4444-4444-8444-444444444444';
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    // A folder note is its `.md` plus the same-named directory; move both.
    fs.renameSync(path.join(vaultDir, 'Projects.md'), path.join(vaultDir, 'Renamed Branch.md'));
    fs.renameSync(path.join(vaultDir, 'Projects'), path.join(vaultDir, 'Renamed Branch'));

    await expect
      .poll(async () => (await getDocumentFromDb(window, PROJECTS_ID))?.title, { timeout: 15_000 })
      .toBe('Renamed Branch');
    await waitForFile(path.join(vaultDir, 'Renamed Branch/Alpha.md'));
    expect((await getDocumentFromDb(window, ALPHA_ID))!.parentId).toBe(PROJECTS_ID);
    expect((await getDocumentFromDb(window, BETA_ID))!.parentId).toBe(PROJECTS_ID);
    await waitForFileGone(path.join(vaultDir, 'Projects/Alpha.md'));
  });

  test('deleting a parent file trashes the subtree, moving its files into .trash', async ({
    window,
    vaultDir,
  }) => {
    const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';
    const ALPHA_ID = '33333333-3333-4333-8333-333333333333';
    const BETA_ID = '44444444-4444-4444-8444-444444444444';
    await expect
      .poll(async () => (await getDocumentFromDb(window, ALPHA_ID))?.parentId, { timeout: 15_000 })
      .toBe(PROJECTS_ID);

    // Remove only the parent note file; the companion folder and its children
    // remain, so the cascade can move each child's file into .trash.
    fs.rmSync(path.join(vaultDir, 'Projects.md'));

    await expect
      .poll(async () => (await listDocumentsFromDb(window)).some((d) => d.id === PROJECTS_ID), {
        timeout: 15_000,
      })
      .toBe(false);
    await expect
      .poll(() => listMarkdown(vaultDir, { trash: true }).includes('Projects/Alpha.md'), {
        timeout: 10_000,
      })
      .toBe(true);
    expectPaths(vaultDir, ['Bookmarked.md', 'Legacy.md', 'Roadmap.md', 'Untitled.md']);
    expect(filePathForId(vaultDir, ALPHA_ID, { trash: true })).toBe('Projects/Alpha.md');
    expect(filePathForId(vaultDir, BETA_ID, { trash: true })).toBe('Projects/Beta.md');
  });
});

// ── 5. Markdown / frontmatter fidelity through moves ────────────────

test.describe('Nesting — markdown fidelity', () => {
  test('a nested note’s body survives nesting and re-nesting', async ({ window, vaultDir }) => {
    // Create the destination first so the note under test stays the active tab.
    await createNote(window, 'Bucket');
    await createNote(window, 'Doc');
    const map = await idMap(window);
    await typeInBody(window, 'unique body text 42');
    await commitSaves(window);
    await waitForFile(path.join(vaultDir, 'Doc.md'));
    await waitForContent(vaultDir, 'Doc.md', 'unique body text 42');

    await moveViaStore(window, map.get('Doc')!, map.get('Bucket')!, 0);
    await waitForFile(path.join(vaultDir, 'Bucket/Doc.md'));
    expect(readRaw(vaultDir, 'Bucket/Doc.md')).toContain('unique body text 42');

    await moveViaStore(window, map.get('Doc')!, null, 0);
    await waitForFile(path.join(vaultDir, 'Doc.md'));
    expect(readRaw(vaultDir, 'Doc.md')).toContain('unique body text 42');
  });

  test('frontmatter id/title/order survive a subtree move', async ({ window, vaultDir }) => {
    const map = await buildChain(window, vaultDir, ['Alpha Root', 'Beta Mid', 'Gamma Leaf']);
    await createNote(window, 'New Home');
    const full = await idMap(window);
    await moveViaStore(window, map.get('Alpha Root')!, full.get('New Home')!, 0);
    await waitForFile(path.join(vaultDir, 'New Home/Alpha Root/Beta Mid/Gamma Leaf.md'));

    const leaf = readNote(vaultDir, 'New Home/Alpha Root/Beta Mid/Gamma Leaf.md').data;
    expect(leaf.id).toBe(map.get('Gamma Leaf'));
    expect(leaf.title).toBe('Gamma Leaf');
    expect(leaf.order).toBe(0);
  });

  test('the folder encodes parentage; no parent field is written', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['Parent Note', 'Child Note']);
    await waitForFile(path.join(vaultDir, 'Parent Note/Child Note.md'));
    const raw = readRaw(vaultDir, 'Parent Note/Child Note.md');
    expect(raw).toContain(`id: "${map.get('Child Note')}"`);
    expect(raw).toContain('order:');
    expect(raw).not.toMatch(/^parent/m);
  });

  test('order frontmatter matches the database after mixed nesting operations', async ({
    window,
    vaultDir,
  }) => {
    for (const t of ['Root', 'A', 'B', 'C', 'D']) await createNote(window, t);
    const map = await idMap(window);
    const kids = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < kids.length; i += 1) {
      await moveViaStore(window, map.get(kids[i])!, map.get('Root')!, i);
    }
    await waitForFile(path.join(vaultDir, 'Root/D.md'));
    await moveViaStore(window, map.get('D')!, map.get('Root')!, 0);
    await moveViaStore(window, map.get('A')!, map.get('Root')!, 2);

    const titles = ['Root', 'A', 'B', 'C', 'D'];
    for (const t of titles) {
      const id = map.get(t)!;
      const db = (await getDocumentFromDb(window, id))!;
      const rel = filePathForId(vaultDir, id)!;
      if (rel.endsWith('.md')) {
        expect(Number(readNote(vaultDir, rel).data.order)).toBe(db.sortOrder);
      }
    }
  });
});

// ── 6. Trash / restore nested subtrees ──────────────────────────────

test.describe('Nesting — trash and restore subtrees', () => {
  test('trashing a deep parent preserves the nested paths inside .trash', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['Root', 'Mid', 'Leaf']);
    await trashIpc(window, map.get('Root')!);

    expect(listMarkdown(vaultDir)).not.toContain('Root.md');
    expect(listMarkdown(vaultDir, { trash: true })).toContain('Root/Mid/Leaf.md');
    expect(listMarkdown(vaultDir, { trash: true })).toContain('Root/Mid.md');
    expect(listMarkdown(vaultDir, { trash: true })).toContain('Root.md');
  });

  test('restoring a deep parent brings the whole subtree back to its paths', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['Root', 'Mid', 'Leaf']);
    await trashIpc(window, map.get('Root')!);
    await restoreIpc(window, map.get('Root')!);

    await waitForFile(path.join(vaultDir, 'Root/Mid/Leaf.md'));
    expectPaths(vaultDir, ['Root.md', 'Root/Mid.md', 'Root/Mid/Leaf.md']);
    expect(await parentOf(window, 'Leaf')).toBe(map.get('Mid'));
  });

  test('trashing a deep leaf leaves its ancestors and siblings untouched', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Root');
    await createNote(window, 'Keep');
    await createNote(window, 'Drop');
    const map = await idMap(window);
    await moveViaStore(window, map.get('Keep')!, map.get('Root')!, 0);
    await moveViaStore(window, map.get('Drop')!, map.get('Root')!, 1);
    await waitForFile(path.join(vaultDir, 'Root/Drop.md'));

    await trashIpc(window, map.get('Drop')!);

    expect(listMarkdown(vaultDir)).toEqual(['Root.md', 'Root/Keep.md']);
    expect(listMarkdown(vaultDir, { trash: true })).toContain('Root/Drop.md');
    expect((await getDocumentFromDb(window, map.get('Root')!))!.deletedAt).toBeNull();
  });

  test('permanent delete removes a nested subtree from .trash', async ({ window, vaultDir }) => {
    const map = await buildChain(window, vaultDir, ['Root', 'Mid', 'Leaf']);
    await trashIpc(window, map.get('Root')!);
    expect(listMarkdown(vaultDir, { trash: true })).toContain('Root/Mid/Leaf.md');

    await permanentDeleteIpc(window, map.get('Root')!);

    await expect.poll(() => listMarkdown(vaultDir, { trash: true })).toEqual([]);
    expect((await listDocumentsFromDb(window)).some((d) => d.id === map.get('Leaf'))).toBe(false);
  });

  test('a restored subtree can be moved and reordered immediately', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['Base', 'Branch', 'Tip']);
    await createNote(window, 'Other Base');
    const full = await idMap(window);
    await trashIpc(window, map.get('Base')!);
    await restoreIpc(window, map.get('Base')!);
    await waitForFile(path.join(vaultDir, 'Base/Branch/Tip.md'));

    await moveViaStore(window, full.get('Base')!, full.get('Other Base')!, 0);
    await waitForFile(path.join(vaultDir, 'Other Base/Base/Branch/Tip.md'));

    expect(await parentOf(window, 'Base')).toBe(full.get('Other Base'));
    expect(await parentOf(window, 'Tip')).toBe(map.get('Branch'));
  });
});

// ── 7. Deep path budgets and unicode ────────────────────────────────

test.describe('Nesting — path budgets and unicode', () => {
  test('a very deep chain with long titles keeps every path under the byte budget', async ({
    window,
    vaultDir,
  }) => {
    const titles = Array.from({ length: 7 }, (_, i) => `Level ${i} ${'x'.repeat(24)}`);
    const map = await buildChain(window, vaultDir, titles);
    const files = listMarkdown(vaultDir);
    expect(files.length).toBe(titles.length);
    for (const rel of files) {
      expect(Buffer.byteLength(rel, 'utf8')).toBeLessThanOrEqual(220);
      expect(readNote(vaultDir, rel).data.id).toBeTruthy();
    }
    // The deepest file is still reachable and correctly parented.
    const deepPath = filePathForId(vaultDir, map.get(titles[titles.length - 1])!)!;
    expect(deepPath.startsWith(`${titles[0]}/`)).toBe(true);
  });

  test('a nested note whose title sanitizes to the same stem still gets its own file', async ({
    window,
    vaultDir,
  }) => {
    // Distinct titles are required by the app; sanitize-only collisions between
    // parent and child must still produce distinct, readable files.
    await createNoteViaIpc(window, 'A/B');
    await createNoteViaIpc(window, 'Bucket');
    const map = await idMap(window);
    await moveViaStore(window, map.get('A/B')!, map.get('Bucket')!, 0);
    await waitForFile(path.join(vaultDir, 'Bucket/A-B.md'));

    const deep = filePathForId(vaultDir, map.get('A/B'))!;
    expect(deep).toBe('Bucket/A-B.md');
    expect(readNote(vaultDir, deep).data.title).toBe('A/B');
  });
});

test.describe('Nesting — unicode import', () => {
  const U_ROOT = 'e2000000-0000-4000-8000-000000000001';
  const U_MID = 'e2000000-0000-4000-8000-000000000002';
  const U_LEAF = 'e2000000-0000-4000-8000-000000000003';
  test.use({
    vaultExtra: {
      'Café Root.md': frontmatterNote({ id: U_ROOT, title: 'Café Root' }),
      'Café Root/東京.md': frontmatterNote({ id: U_MID, title: '東京' }),
      'Café Root/東京/Rocket 🚀.md': frontmatterNote({ id: U_LEAF, title: 'Rocket 🚀' }),
    },
  });

  test('unicode and emoji titles nest to normalized, readable paths', async ({
    window,
    vaultDir,
  }) => {
    await expect
      .poll(async () => (await getDocumentFromDb(window, U_LEAF))?.parentId, { timeout: 15_000 })
      .toBe(U_MID);
    expect(filePathForId(vaultDir, U_LEAF)).toBe('Café Root/東京/Rocket 🚀.md');
    expect(readNote(vaultDir, 'Café Root/東京/Rocket 🚀.md').data.title).toBe('Rocket 🚀');
    expectPaths(vaultDir, [
      'Café Root.md',
      'Café Root/東京.md',
      'Café Root/東京/Rocket 🚀.md',
    ]);
  });
});

// ── 8. Durability and external order edits ──────────────────────────

test.describe('Nesting — durability', () => {
  test('a complex tree survives a relaunch with identical paths and orders', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    let app = await launchLychee({ userDataDir, vaultDir });
    let window = await firstWindowReady(app);
    const titles = ['Tree', 'Branch A', 'Branch B', 'Leaf A1', 'Leaf B1'];
    for (const t of titles) await createNote(window, t);
    let map = await idMap(window);
    await moveViaStore(window, map.get('Branch A')!, map.get('Tree')!, 0);
    await moveViaStore(window, map.get('Branch B')!, map.get('Tree')!, 1);
    await moveViaStore(window, map.get('Leaf A1')!, map.get('Branch A')!, 0);
    await moveViaStore(window, map.get('Leaf B1')!, map.get('Branch B')!, 0);
    await waitForFile(path.join(vaultDir, 'Tree/Branch B/Leaf B1.md'));
    const before = listMarkdown(vaultDir);
    const ordersBefore = before.map((rel) => `${rel}:${readNote(vaultDir, rel).data.order}`);
    await app.close();

    app = await launchLychee({ userDataDir, vaultDir });
    window = await firstWindowReady(app);
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(5);
    map = await idMap(window);
    expect(listMarkdown(vaultDir)).toEqual(before);
    expect(listMarkdown(vaultDir).map((rel) => `${rel}:${readNote(vaultDir, rel).data.order}`)).toEqual(
      ordersBefore,
    );
    expect(await parentOf(window, 'Leaf B1')).toBe(map.get('Branch B'));
    await app.close();
  });

  test('external frontmatter order edits on nested files are adopted after relaunch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    let app = await launchLychee({ userDataDir, vaultDir });
    let window = await firstWindowReady(app);
    for (const t of ['Host', 'K1', 'K2']) await createNote(window, t);
    let map = await idMap(window);
    await moveViaStore(window, map.get('K1')!, map.get('Host')!, 0);
    await moveViaStore(window, map.get('K2')!, map.get('Host')!, 1);
    await waitForFile(path.join(vaultDir, 'Host/K2.md'));
    await app.close();

    // Swap the two children's order on disk while closed.
    const k1 = readNote(vaultDir, 'Host/K1.md');
    const k2 = readNote(vaultDir, 'Host/K2.md');
    const writeOrder = (rel: string, id: string, title: string, order: number) => {
      fs.writeFileSync(
        path.join(vaultDir, rel),
        frontmatterNote({ id, title, order }, 'body'),
      );
    };
    writeOrder('Host/K1.md', map.get('K1')!, 'K1', 1);
    writeOrder('Host/K2.md', map.get('K2')!, 'K2', 0);
    expect(k1.data.id).toBe(map.get('K1'));
    expect(k2.data.id).toBe(map.get('K2'));

    app = await launchLychee({ userDataDir, vaultDir });
    window = await firstWindowReady(app);
    map = await idMap(window);
    await expect
      .poll(async () => (await getDocumentFromDb(window, map.get('K2')!))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(0);
    expect((await getDocumentFromDb(window, map.get('K1')!))!.sortOrder).toBe(1);
    await app.close();
  });

  test('nested paths and parents are restored after deleting the index', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');
    let app = await launchLychee({ userDataDir, vaultDir });
    let window = await firstWindowReady(app);
    for (const t of ['Nest', 'Inner', 'Core']) await createNote(window, t);
    const map = await idMap(window);
    await moveViaStore(window, map.get('Inner')!, map.get('Nest')!, 0);
    await moveViaStore(window, map.get('Core')!, map.get('Inner')!, 0);
    await waitForFile(path.join(vaultDir, 'Nest/Inner/Core.md'));
    await app.close();

    for (const name of ['lychee.sqlite3', 'lychee.sqlite3-wal', 'lychee.sqlite3-shm']) {
      fs.rmSync(path.join(userDataDir, name), { force: true });
    }

    app = await launchLychee({ userDataDir, vaultDir });
    window = await firstWindowReady(app);
    await expect
      .poll(async () => (await getDocumentFromDb(window, map.get('Core')!))?.parentId, {
        timeout: 20_000,
      })
      .toBe(map.get('Inner'));
    expect((await getDocumentFromDb(window, map.get('Inner')!))!.parentId).toBe(map.get('Nest'));
    expectPaths(vaultDir, ['Nest.md', 'Nest/Inner.md', 'Nest/Inner/Core.md']);
    await app.close();
  });
});

// ── 9. Mixed movement scripts (whole-tree assertions) ───────────────

test.describe('Nesting — mixed movement scripts', () => {
  test('a multi-step nest/reorder script leaves the whole tree consistent', async ({
    window,
    vaultDir,
  }) => {
    for (const t of ['Root', 'A', 'B', 'C', 'A1', 'A2', 'B1']) await createNote(window, t);
    const map = await idMap(window);

    await moveViaStore(window, map.get('A')!, map.get('Root')!, 0);
    await moveViaStore(window, map.get('B')!, map.get('Root')!, 1);
    await moveViaStore(window, map.get('C')!, map.get('Root')!, 2);
    await moveViaStore(window, map.get('A1')!, map.get('A')!, 0);
    await moveViaStore(window, map.get('A2')!, map.get('A')!, 1);
    await moveViaStore(window, map.get('B1')!, map.get('B')!, 0);
    await waitForFile(path.join(vaultDir, 'Root/A/A2.md'));

    // Reorder at the root, then move a grandchild between branches.
    await moveViaStore(window, map.get('C')!, map.get('Root')!, 0);
    await moveViaStore(window, map.get('A')!, map.get('Root')!, 2);
    await moveViaStore(window, map.get('A1')!, map.get('B')!, 0);

    await expectTree(window, vaultDir, [
      { title: 'Root', path: 'Root.md', order: 0, parent: null },
      { title: 'C', path: 'Root/C.md', order: 0, parent: 'Root' },
      { title: 'B', path: 'Root/B.md', order: 1, parent: 'Root' },
      { title: 'A', path: 'Root/A.md', order: 2, parent: 'Root' },
      { title: 'A2', path: 'Root/A/A2.md', order: 0, parent: 'A' },
      { title: 'A1', path: 'Root/B/A1.md', order: 0, parent: 'B' },
      { title: 'B1', path: 'Root/B/B1.md', order: 1, parent: 'B' },
    ]);
    expectPaths(vaultDir, [
      'Root.md',
      'Root/A.md',
      'Root/B.md',
      'Root/C.md',
      'Root/A/A2.md',
      'Root/B/A1.md',
      'Root/B/B1.md',
    ]);
  });

  test('a note touring three deep branches leaves no stale file behind', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['Branch One', 'One Child']);
    await buildChain(window, vaultDir, ['Branch Two', 'Two Child']);
    await buildChain(window, vaultDir, ['Branch Three', 'Three Child']);
    await createNote(window, 'Tourist');
    const full = await idMap(window);

    await moveViaStore(window, full.get('Tourist')!, full.get('One Child')!, 0);
    await waitForFile(path.join(vaultDir, 'Branch One/One Child/Tourist.md'));
    expect(filePathForId(vaultDir, full.get('Tourist')!)).toBe(
      'Branch One/One Child/Tourist.md',
    );

    await moveViaStore(window, full.get('Tourist')!, full.get('Two Child')!, 0);
    await waitForFile(path.join(vaultDir, 'Branch Two/Two Child/Tourist.md'));
    await waitForFileGone(path.join(vaultDir, 'Branch One/One Child/Tourist.md'));

    await moveViaStore(window, full.get('Tourist')!, full.get('Three Child')!, 0);
    await waitForFile(path.join(vaultDir, 'Branch Three/Three Child/Tourist.md'));
    expect(filePathForId(vaultDir, full.get('Tourist')!)).toBe(
      'Branch Three/Three Child/Tourist.md',
    );

    await moveViaStore(window, full.get('Tourist')!, null, 0);
    await waitForFile(path.join(vaultDir, 'Tourist.md'));
    expectPaths(vaultDir, [
      'Branch One.md',
      'Branch One/One Child.md',
      'Branch Two.md',
      'Branch Two/Two Child.md',
      'Branch Three.md',
      'Branch Three/Three Child.md',
      'Tourist.md',
    ]);
    expect(full.get('Tourist')).toBeTruthy();
  });

  test('a subtree moved under a four-level nest parents every level', async ({
    window,
    vaultDir,
  }) => {
    await buildChain(window, vaultDir, ['N1', 'N2', 'N3', 'N4']);
    await buildChain(window, vaultDir, ['Sub', 'Sub Kid']);
    const full = await idMap(window);

    await moveViaStore(window, full.get('Sub')!, full.get('N4')!, 0);
    await waitForFile(path.join(vaultDir, 'N1/N2/N3/N4/Sub/Sub Kid.md'));

    await expectTree(window, vaultDir, [
      { title: 'N1', path: 'N1.md', order: 0, parent: null },
      { title: 'N2', path: 'N1/N2.md', order: 0, parent: 'N1' },
      { title: 'N3', path: 'N1/N2/N3.md', order: 0, parent: 'N2' },
      { title: 'N4', path: 'N1/N2/N3/N4.md', order: 0, parent: 'N3' },
      { title: 'Sub', path: 'N1/N2/N3/N4/Sub.md', order: 0, parent: 'N4' },
      { title: 'Sub Kid', path: 'N1/N2/N3/N4/Sub/Sub Kid.md', order: 0, parent: 'Sub' },
    ]);
  });

  test('reordering a moved subtree among its new siblings leaves its children alone', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Host');
    await createNote(window, 'Stable');
    await createNote(window, 'Moved Parent');
    await createNote(window, 'Moved Kid');
    const map = await idMap(window);
    await moveViaStore(window, map.get('Moved Kid')!, map.get('Moved Parent')!, 0);
    await moveViaStore(window, map.get('Moved Parent')!, map.get('Host')!, 0);
    await moveViaStore(window, map.get('Stable')!, map.get('Host')!, 1);
    await waitForFile(path.join(vaultDir, 'Host/Moved Parent/Moved Kid.md'));

    // Move the parent's own file to index 1 among Host's children.
    await moveViaStore(window, map.get('Moved Parent')!, map.get('Host')!, 1);

    await expectTree(window, vaultDir, [
      { title: 'Host', path: 'Host.md', order: 0, parent: null },
      { title: 'Stable', path: 'Host/Stable.md', order: 0, parent: 'Host' },
      { title: 'Moved Parent', path: 'Host/Moved Parent.md', order: 1, parent: 'Host' },
      { title: 'Moved Kid', path: 'Host/Moved Parent/Moved Kid.md', order: 0, parent: 'Moved Parent' },
    ]);
  });

  test('inverting a hierarchy moves the old parent under the detached leaf', async ({
    window,
    vaultDir,
  }) => {
    const map = await buildChain(window, vaultDir, ['Top', 'Mid', 'Leaf']);
    // Detach Leaf to the root, then put Top under it.
    await moveViaStore(window, map.get('Leaf')!, null, 0);
    await waitForFile(path.join(vaultDir, 'Leaf.md'));
    await moveViaStore(window, map.get('Top')!, map.get('Leaf')!, 0);
    await waitForFile(path.join(vaultDir, 'Leaf/Top/Mid.md'));

    await expectTree(window, vaultDir, [
      { title: 'Leaf', path: 'Leaf.md', order: 0, parent: null },
      { title: 'Top', path: 'Leaf/Top.md', order: 0, parent: 'Leaf' },
      { title: 'Mid', path: 'Leaf/Top/Mid.md', order: 0, parent: 'Top' },
    ]);
  });

  test('swapping two leaves between deep folders keeps both folders dense', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'P1');
    await createNote(window, 'P2');
    await createNote(window, 'L1');
    await createNote(window, 'L2');
    const map = await idMap(window);
    await moveViaStore(window, map.get('L1')!, map.get('P1')!, 0);
    await moveViaStore(window, map.get('L2')!, map.get('P2')!, 0);
    await waitForFile(path.join(vaultDir, 'P2/L2.md'));

    await moveViaStore(window, map.get('L1')!, map.get('P2')!, 1);
    await moveViaStore(window, map.get('L2')!, map.get('P1')!, 0);
    await waitForFile(path.join(vaultDir, 'P2/L1.md'));

    await expectTree(window, vaultDir, [
      { title: 'P1', path: 'P1.md', order: 1, parent: null },
      { title: 'P2', path: 'P2.md', order: 0, parent: null },
      { title: 'L1', path: 'P2/L1.md', order: 0, parent: 'P2' },
      { title: 'L2', path: 'P1/L2.md', order: 0, parent: 'P1' },
    ]);
  });

  test('moving a subtree to the root and back preserves order at every level', async ({
    window,
    vaultDir,
  }) => {
    await buildChain(window, vaultDir, ['Base', 'Inner', 'Tip']);
    await createNote(window, 'Decoy');
    const full = await idMap(window);
    await moveViaStore(window, full.get('Base')!, full.get('Decoy')!, 0);
    await waitForFile(path.join(vaultDir, 'Decoy/Base/Inner/Tip.md'));
    const nestedPaths = notePaths(vaultDir);

    await moveViaStore(window, full.get('Base')!, null, 0);
    await waitForFile(path.join(vaultDir, 'Base/Inner/Tip.md'));
    await moveViaStore(window, full.get('Base')!, full.get('Decoy')!, 0);
    await waitForFile(path.join(vaultDir, 'Decoy/Base/Inner/Tip.md'));

    expect(notePaths(vaultDir)).toEqual(nestedPaths);
    expect(orderOf(vaultDir, 'Decoy/Base.md')).toBe(0);
    expect(orderOf(vaultDir, 'Decoy/Base/Inner.md')).toBe(0);
    expect(orderOf(vaultDir, 'Decoy/Base/Inner/Tip.md')).toBe(0);
  });

  test('reordering every level of a chain keeps each folder ordered', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'C0');
    await createNote(window, 'C1');
    await createNote(window, 'C2');
    await createNote(window, 'C3');
    const map = await idMap(window);
    // C1>C2>C3 with C0 at the root.
    await moveViaStore(window, map.get('C1')!, map.get('C0')!, 0);
    await moveViaStore(window, map.get('C2')!, map.get('C1')!, 0);
    await moveViaStore(window, map.get('C3')!, map.get('C2')!, 0);
    await waitForFile(path.join(vaultDir, 'C0/C1/C2/C3.md'));

    // Add siblings at each level and order them.
    for (const t of ['C0b', 'C1b', 'C2b']) await createNote(window, t);
    const full = await idMap(window);
    await moveViaStore(window, full.get('C0b')!, full.get('C0')!, 0);
    await moveViaStore(window, full.get('C1b')!, full.get('C1')!, 0);
    await moveViaStore(window, full.get('C2b')!, full.get('C2')!, 0);

    await expectTree(window, vaultDir, [
      { title: 'C0', path: 'C0.md', order: 0, parent: null },
      { title: 'C0b', path: 'C0/C0b.md', order: 0, parent: 'C0' },
      { title: 'C1', path: 'C0/C1.md', order: 1, parent: 'C0' },
      { title: 'C1b', path: 'C0/C1/C1b.md', order: 0, parent: 'C1' },
      { title: 'C2', path: 'C0/C1/C2.md', order: 1, parent: 'C1' },
      { title: 'C2b', path: 'C0/C1/C2/C2b.md', order: 0, parent: 'C2' },
      { title: 'C3', path: 'C0/C1/C2/C3.md', order: 1, parent: 'C2' },
    ]);
  });
});
