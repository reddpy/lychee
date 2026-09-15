import fs from 'fs';
import path from 'path';
import {
  test,
  expect,
  launchLychee,
  firstWindowReady,
  listDocumentsFromDb,
} from './electron-app';
import {
  createNote,
  noteItem,
  waitForFile,
  waitForContent,
  readNote,
  filePathForId,
  renameVaultPath,
  typeInBody,
} from './vault-helpers';
import {
  createNote as createNoteOnDisk,
  updateNote as updateNoteOnDisk,
  trashNote as trashNoteOnDisk,
  moveNote as moveNoteOnDisk,
} from '../src/main/vault-store';

/**
 * Stage 5 — the vault is the source of truth; SQLite is a disposable projection
 * that any device can rebuild from files.
 *
 * This spec drives the real app (UI + watcher + index) and asserts the behavior
 * a user sees, including what happens when the database is deleted or corrupted
 * — the two failure modes that must never cost a note.
 */

// ── Files are truth ─────────────────────────────────────────────────

test.describe('the vault is the source of truth', () => {
  test.use({ vaultSeed: 'vault' });

  test('a cold index is rebuilt entirely from the vault on launch', async ({
    window,
    vaultDir,
  }) => {
    await expect(noteItem(window, 'Roadmap')).toBeVisible();
    await expect(noteItem(window, 'Bookmarked')).toBeVisible();

    const docs = await listDocumentsFromDb(window);
    const titles = docs.map((doc) => doc.title);
    expect(titles).toContain('Roadmap');
    expect(titles).toContain('Bookmarked');

    // A markdown file without a frontmatter id is not a note.
    expect(titles).not.toContain('plain');

    // Every indexed row maps 1:1 to a file carrying the same id.
    for (const doc of docs) {
      expect(filePathForId(vaultDir, doc.id), `file for "${doc.title}"`).toBeTruthy();
    }
  });

  test('creating a note writes markdown and the index agrees with it', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Projected');
    await waitForFile(path.join(vaultDir, 'Projected.md'));

    const { data } = readNote(vaultDir, 'Projected.md');
    const rows = await listDocumentsFromDb(window);
    const row = rows.find((candidate) => candidate.title === 'Projected')!;
    expect(row.id).toBe(data.id);
    expect(row.metadata?.vaultRelativePath).toBe('Projected.md');
  });

  test('typing in the editor writes the body to the markdown file', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Live Body');
    await waitForFile(path.join(vaultDir, 'Live Body.md'));

    await typeInBody(window, 'typed from the editor');
    await waitForContent(vaultDir, 'Live Body.md', 'typed from the editor');
  });
});

// ── App + external writer (MCP / sync / agent) ──────────────────────

test.describe('the app and an external vault writer converge', () => {
  test('an agent-created note appears in the sidebar', async ({ window, vaultDir }) => {
    const created = createNoteOnDisk(vaultDir, { title: 'Agent Note', body: 'made by an agent' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(noteItem(window, 'Agent Note')).toBeVisible({ timeout: 10_000 });
    expect(filePathForId(vaultDir, created.id)).toBe('Agent Note.md');
  });

  test('an edit made outside the app updates the open note', async ({ window, vaultDir }) => {
    const created = createNoteOnDisk(vaultDir, { title: 'Shared Note', body: 'v1' });
    if (!created.ok) throw new Error('setup failed');

    await expect(noteItem(window, 'Shared Note')).toBeVisible({ timeout: 10_000 });
    await noteItem(window, 'Shared Note').click();
    await expect(window.locator('main:visible .ContentEditable__root')).toContainText('v1');

    const updated = updateNoteOnDisk(vaultDir, created.id, 'v2 from another device');
    expect(updated.ok).toBe(true);

    await expect(window.locator('main:visible .ContentEditable__root')).toContainText(
      'v2 from another device',
      { timeout: 10_000 },
    );
  });

  test('an external rename retitles the note (filename is the title)', async ({
    window,
    vaultDir,
  }) => {
    const created = createNoteOnDisk(vaultDir, { title: 'Disk Name', body: 'x' });
    if (!created.ok) throw new Error('setup failed');

    await expect(noteItem(window, 'Disk Name')).toBeVisible({ timeout: 10_000 });
    const relative = filePathForId(vaultDir, created.id)!;
    renameVaultPath(vaultDir, relative, 'Disk Renamed.md');

    await expect(noteItem(window, 'Disk Renamed')).toBeVisible({ timeout: 10_000 });
    await expect(
      window.locator('[data-note-id]').filter({ hasText: 'Disk Name' }),
    ).toHaveCount(0);
  });

  test('an agent trashing a note removes it from the sidebar', async ({ window, vaultDir }) => {
    const created = createNoteOnDisk(vaultDir, { title: 'Agent Trash', body: 'x' });
    if (!created.ok) throw new Error('setup failed');
    await expect(noteItem(window, 'Agent Trash')).toBeVisible({ timeout: 10_000 });

    expect(trashNoteOnDisk(vaultDir, created.id).ok).toBe(true);

    await expect(window.locator('[data-note-id]').filter({ hasText: 'Agent Trash' })).toHaveCount(
      0,
      { timeout: 10_000 },
    );
    expect(filePathForId(vaultDir, created.id)).toBeUndefined();
    expect(filePathForId(vaultDir, created.id, { trash: true })).toBeTruthy();
  });

  test('an agent re-parenting a note moves its file and updates the tree', async ({
    window,
    vaultDir,
  }) => {
    const parent = createNoteOnDisk(vaultDir, { title: 'Agent Parent' });
    const child = createNoteOnDisk(vaultDir, { title: 'Agent Child' });
    if (!parent.ok || !child.ok) throw new Error('setup failed');

    await expect(noteItem(window, 'Agent Parent')).toBeVisible({ timeout: 10_000 });
    await expect(noteItem(window, 'Agent Child')).toBeVisible({ timeout: 10_000 });

    expect(moveNoteOnDisk(vaultDir, child.id, parent.id).ok).toBe(true);

    // The file moves into the parent folder…
    await expect
      .poll(() => filePathForId(vaultDir, child.id), { timeout: 10_000 })
      .toBe('Agent Parent/Agent Child.md');

    // …and the index records the new parent.
    await expect
      .poll(
        async () =>
          (await listDocumentsFromDb(window)).find((doc) => doc.id === child.id)?.parentId,
        { timeout: 10_000 },
      )
      .toBe(parent.id);
  });
});

// ── Index rebuild is safe and idempotent ────────────────────────────

test.describe('rebuilding the index', () => {
  test('reconcile does not duplicate or lose notes', async ({ window, vaultDir }) => {
    await createNote(window, 'Stable One');
    await createNote(window, 'Stable Two');
    await waitForFile(path.join(vaultDir, 'Stable One.md'));
    await waitForFile(path.join(vaultDir, 'Stable Two.md'));

    const rebuild = () =>
      window.evaluate(() => (window as any).lychee.invoke('vault.rebuildIndex', {}));

    const before = await listDocumentsFromDb(window);
    await rebuild();
    await rebuild();
    const after = await listDocumentsFromDb(window);

    expect(after.map((doc) => doc.id).sort()).toEqual(before.map((doc) => doc.id).sort());
    expect(new Set(after.map((doc) => doc.title)).size).toBe(after.length);
  });

  test('a file added while the app is closed is imported on next launch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchWithUserData(userDataDir, vaultDir);
    await createNote(first.window, 'Existing');
    await waitForFile(path.join(vaultDir, 'Existing.md'));
    await first.app.close();

    // Another device / agent drops a new file into the vault while offline.
    createNoteOnDisk(vaultDir, { title: 'Added Offline', body: 'synced later' });

    const second = await launchWithUserData(userDataDir, vaultDir);
    await expect(noteItem(second.window, 'Added Offline')).toBeVisible({ timeout: 10_000 });
    await second.app.close();
  });
});

// ── SQLite is disposable ────────────────────────────────────────────

async function launchWithUserData(userDataDir: string, vaultDir: string) {
  const app = await launchLychee({ userDataDir, vaultDir });
  const window = await firstWindowReady(app);
  return { app, window };
}

test.describe('the SQLite index is disposable', () => {
  test('deleting the database rebuilds every note from files on next launch', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchWithUserData(userDataDir, vaultDir);
    await createNote(first.window, 'Survives DB loss');
    await waitForFile(path.join(vaultDir, 'Survives DB loss.md'));
    await first.app.close();

    // Delete the entire local index, including its WAL sidecars.
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(path.join(userDataDir, `lychee.sqlite3${suffix}`), { force: true });
    }

    const second = await launchWithUserData(userDataDir, vaultDir);
    await expect(noteItem(second.window, 'Survives DB loss')).toBeVisible({ timeout: 10_000 });
    expect(fs.existsSync(path.join(vaultDir, 'Survives DB loss.md'))).toBe(true);
    await second.app.close();
  });

  test('a corrupt database is quarantined and the vault still opens', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchWithUserData(userDataDir, vaultDir);
    await createNote(first.window, 'Survives corruption');
    await waitForFile(path.join(vaultDir, 'Survives corruption.md'));
    await first.app.close();

    // Replace the index with garbage; SQLite cannot open it.
    const dbPath = path.join(userDataDir, 'lychee.sqlite3');
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
    fs.writeFileSync(dbPath, 'this is not a sqlite database');

    const second = await launchWithUserData(userDataDir, vaultDir);
    await expect(noteItem(second.window, 'Survives corruption')).toBeVisible({ timeout: 10_000 });

    const quarantined = fs
      .readdirSync(userDataDir)
      .filter((name) => name.startsWith('lychee.sqlite3.corrupt-'));
    expect(quarantined.length).toBeGreaterThanOrEqual(1);
    await second.app.close();
  });

  test('a note edited offline is intact after the index is thrown away', async ({
    testDir,
    vaultDir,
  }) => {
    const userDataDir = path.join(testDir, 'userdata');

    const first = await launchWithUserData(userDataDir, vaultDir);
    await createNote(first.window, 'Offline Edit');
    await waitForFile(path.join(vaultDir, 'Offline Edit.md'));
    await typeInBody(first.window, 'content that must persist');
    await waitForContent(vaultDir, 'Offline Edit.md', 'content that must persist');
    await first.app.close();

    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(path.join(userDataDir, `lychee.sqlite3${suffix}`), { force: true });
    }

    const second = await launchWithUserData(userDataDir, vaultDir);
    await noteItem(second.window, 'Offline Edit').click();
    await expect(second.window.locator('main:visible .ContentEditable__root')).toContainText(
      'content that must persist',
      { timeout: 10_000 },
    );
    await second.app.close();
  });
});
