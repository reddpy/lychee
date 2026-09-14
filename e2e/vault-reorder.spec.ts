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
  moveViaIpc,
  readNote,
  waitForFile,
  waitForContent,
  noteItem,
  writeNote,
} from './vault-helpers';

/**
 * Reorder — order is durable per-note frontmatter (`order`), so a reorder must
 * land in the files and survive relaunch.
 */

const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
const PROJECTS_ID = '22222222-2222-4222-8222-222222222222';

test.describe('Reorder — app → files', () => {
  test('reordering siblings writes order to every affected file', async ({ window, vaultDir }) => {
    await createNote(window, 'Order C');
    await createNote(window, 'Order A');
    await createNote(window, 'Order B');
    await waitForFile(path.join(vaultDir, 'Order A.md'));
    await waitForFile(path.join(vaultDir, 'Order B.md'));
    await waitForFile(path.join(vaultDir, 'Order C.md'));

    const docs = await listDocumentsFromDb(window);
    const target = docs.find((doc) => doc.title === 'Order C')!;
    await moveViaIpc(window, target.id, null, 2);

    await waitForContent(vaultDir, 'Order C.md', 'order: 2');
    const orders = ['Order A.md', 'Order B.md', 'Order C.md']
      .map((name) => Number(readNote(vaultDir, name).data.order))
      .sort();
    expect(orders).toEqual([0, 1, 2]);
  });

  test('reordering within a parent keeps the files in that folder', async ({ window, vaultDir }) => {
    await createNote(window, 'Parent Note');
    await createNote(window, 'Kid One');
    await createNote(window, 'Kid Two');
    const docs = await listDocumentsFromDb(window);
    const parent = docs.find((doc) => doc.title === 'Parent Note')!;
    const kidOne = docs.find((doc) => doc.title === 'Kid One')!;
    const kidTwo = docs.find((doc) => doc.title === 'Kid Two')!;
    await moveViaIpc(window, kidOne.id, parent.id, 0);
    await moveViaIpc(window, kidTwo.id, parent.id, 1);
    await waitForFile(path.join(vaultDir, 'Parent Note/Kid One.md'));
    await waitForFile(path.join(vaultDir, 'Parent Note/Kid Two.md'));

    await moveViaIpc(window, kidTwo.id, parent.id, 0);

    await waitForContent(vaultDir, 'Parent Note/Kid Two.md', 'order: 0');
    await waitForContent(vaultDir, 'Parent Note/Kid One.md', 'order: 1');
    expect(readNote(vaultDir, 'Parent Note/Kid Two.md').data.id).toBe(kidTwo.id);
  });

  test('reordering a child among three siblings writes order for all', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Boss');
    await createNote(window, 'Kid A');
    await createNote(window, 'Kid B');
    await createNote(window, 'Kid C');
    const docs = await listDocumentsFromDb(window);
    const boss = docs.find((doc) => doc.title === 'Boss')!;
    const kids = ['Kid A', 'Kid B', 'Kid C'].map(
      (title) => docs.find((doc) => doc.title === title)!,
    );
    for (const [i, kid] of kids.entries()) await moveViaIpc(window, kid.id, boss.id, i);
    await waitForFile(path.join(vaultDir, 'Boss/Kid A.md'));

    // Move the last kid to the front.
    await moveViaIpc(window, kids[2].id, boss.id, 0);

    await waitForContent(vaultDir, 'Boss/Kid C.md', 'order: 0');
    const orders = ['Kid A', 'Kid B', 'Kid C']
      .map((name) => Number(readNote(vaultDir, `Boss/${name}.md`).data.order))
      .sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2]);
  });

  test('an app reorder survives a relaunch', async ({ testDir, vaultDir }) => {
    const userDataDir = path.join(testDir, 'userdata');
    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await createNote(firstWindow, 'Apple');
    await createNote(firstWindow, 'Banana');
    await createNote(firstWindow, 'Cherry');
    const docs = await listDocumentsFromDb(firstWindow);
    const cherry = docs.find((doc) => doc.title === 'Cherry')!;
    await moveViaIpc(firstWindow, cherry.id, null, 0);
    await waitForContent(vaultDir, 'Cherry.md', 'order: 0');
    await first.close();

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, cherry.id))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(0);
    await second.close();
  });
});

test.describe('Reorder — files → app (adopted on relaunch)', () => {
  test.use({ vaultSeed: 'vault' });

  test('frontmatter order edits made while closed are adopted on next launch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchLychee({ userDataDir, vaultDir });
    const firstWindow = await firstWindowReady(first);
    await expect
      .poll(async () => (await listDocumentsFromDb(firstWindow)).length, { timeout: 15_000 })
      .toBe(7);
    await first.close();

    // Reorder in a text editor while Lychee is closed: Projects becomes first.
    const rewrite = (name: string, id: string, title: string, order: number, body: string) => {
      const raw = `---\nid: "${id}"\ntitle: "${title}"\ncreated: "2024-01-01T00:00:00.000Z"\nupdated: "2024-01-02T00:00:00.000Z"\ncontent_schema_version: 1\norder: ${order}\n---\n\n${body}`;
      fs.writeFileSync(path.join(vaultDir, name), raw);
    };
    rewrite('Roadmap.md', ROADMAP_ID, 'Roadmap', 9, 'roadmap');
    rewrite('Projects.md', PROJECTS_ID, 'Projects', 0, 'projects');

    const second = await launchLychee({ userDataDir, vaultDir });
    const secondWindow = await firstWindowReady(second);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, PROJECTS_ID))?.sortOrder, {
        timeout: 15_000,
      })
      .toBe(0);
    await expect
      .poll(async () => (await getDocumentFromDb(secondWindow, ROADMAP_ID))?.sortOrder)
      .toBe(9);
    await second.close();
  });

  test('the sidebar reflects the stored order', async ({ window }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);
    // Wait for the rows to paint before reading order — the DB poll above can
    // settle before the sidebar list has rendered.
    await expect(noteItem(window, 'Roadmap')).toBeVisible();
    await expect(noteItem(window, 'Projects')).toBeVisible();
    // Projects has order 1 and Roadmap order 0 in the fixture.
    const rows = await window.locator('[data-note-id]').allTextContents();
    const roadmap = rows.findIndex((text) => text.includes('Roadmap'));
    const projects = rows.findIndex((text) => text.includes('Projects'));
    expect(roadmap).toBeGreaterThanOrEqual(0);
    expect(projects).toBeGreaterThanOrEqual(0);
    expect(roadmap).toBeLessThan(projects);
    await expect(noteItem(window, 'Roadmap')).toBeVisible();
  });
});

test.describe('Reorder — live external order', () => {
  test.use({ vaultSeed: 'vault' });

  test('editing a file order while running reorders live', async ({ window, vaultDir }) => {
    await expect
      .poll(async () => (await listDocumentsFromDb(window)).length, { timeout: 15_000 })
      .toBe(7);

    // Push Roadmap (order 0) to the end from the OS. Order is clamped to the
    // sibling count, so it lands last rather than literally 9.
    writeNote(
      vaultDir,
      'Roadmap.md',
      { id: ROADMAP_ID, title: 'Roadmap', order: 9, updated: new Date().toISOString() },
      'roadmap',
    );

    await expect
      .poll(
        async () => {
          const roadmap = (await getDocumentFromDb(window, ROADMAP_ID))?.sortOrder ?? -1;
          const projects = (await getDocumentFromDb(window, PROJECTS_ID))?.sortOrder ?? -1;
          return roadmap > projects;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    // Sidebar reflects it live: Projects now precedes Roadmap.
    await expect
      .poll(async () => {
        const rows = await window.locator('[data-note-id]').allTextContents();
        const p = rows.findIndex((text) => text.includes('Projects'));
        const r = rows.findIndex((text) => text.includes('Roadmap'));
        return p >= 0 && r >= 0 && p < r;
      })
      .toBe(true);
  });
});
