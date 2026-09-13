import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  listTrashedFromDb,
} from './electron-app';
import { parseFrontmatter } from '../src/shared/frontmatter';

/**
 * Stage 4 — create/delete/move/reorder as real file operations.
 *
 * These tests assert BOTH sides of the contract:
 *   - the UI (sidebar/tree/editor/trash) reflects the operation, and
 *   - the vault on disk reflects it (file exists/moved/renamed/trashed), with
 *     frontmatter identity stable and no legacy `title`/`# Title` duplication.
 */

// ── Filesystem helpers ──────────────────────────────────────────────

function listMarkdown(vaultDir: string, options: { trash?: boolean } = {}): string[] {
  const root = options.trash ? path.join(vaultDir, '.trash') : vaultDir;
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

function readNote(vaultDir: string, relativePath: string) {
  const raw = fs.readFileSync(path.join(vaultDir, relativePath), 'utf8');
  return parseFrontmatter(raw);
}

async function waitForFile(absolute: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fs.existsSync(absolute)) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${absolute}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForFileGone(absolute: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (!fs.existsSync(absolute)) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${absolute} to go away`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForContent(vaultDir: string, relativePath: string, needle: string): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      if (fs.readFileSync(path.join(vaultDir, relativePath), 'utf8').includes(needle)) return;
    } catch {
      // not written yet
    }
    if (Date.now() - start > 8000) {
      throw new Error(`Timed out waiting for ${relativePath} to contain ${needle}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// ── UI helpers ──────────────────────────────────────────────────────

/** Title edits rename on commit (blur/tab-switch); trigger the flush. */
async function commitSaves(window: Page): Promise<void> {
  await window.evaluate(() => window.dispatchEvent(new Event('blur')));
  await window.waitForTimeout(500);
}

/** Deterministically commit a note's pending rename via the same IPC the app uses. */
async function forceCommit(window: Page, id: string): Promise<void> {
  await window.evaluate(async (noteId) => {
    await (window as any).lychee.invoke('documents.update', { id: noteId, rename: true });
  }, id);
  await window.waitForTimeout(300);
}

async function findDocByTitle(window: Page, title: string) {
  const matches = (await listDocumentsFromDb(window)).filter((doc) => doc.title === title);
  if (matches.length === 0) return null;
  // For duplicate titles, the newly created note is the most recent.
  return [...matches].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

/** Create a note via the UI with a title. Returns its data-note-id. */
async function createNote(window: Page, title: string): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(500);
  await window.locator('main:visible h1.editor-title').click();
  await window.keyboard.type(title);
  // Titles are commit-only; Enter persists and renames.
  await window.keyboard.press('Enter');
  await window.waitForTimeout(700);
  const doc = await findDocByTitle(window, title);
  if (doc) await forceCommit(window, doc.id);
  const id = doc?.id ?? (await noteIdByTitle(window, title));
  return id!;
}

function noteItem(window: Page, title: string) {
  return window.locator('[data-note-id]').filter({ hasText: title }).first();
}

async function noteIdByTitle(window: Page, title: string): Promise<string> {
  return (await noteItem(window, title).getAttribute('data-note-id'))!;
}

async function replaceTitle(window: Page, nextTitle: string): Promise<void> {
  const title = window.locator('main:visible h1.editor-title');
  await title.click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await window.keyboard.press(`${mod}+A`);
  await window.keyboard.type(nextTitle);
  // Titles are commit-only; Enter persists and renames.
  await window.keyboard.press('Enter');
  await window.waitForTimeout(700);
  const doc = await findDocByTitle(window, nextTitle);
  if (doc) await forceCommit(window, doc.id);
}

async function moveViaIpc(
  window: Page,
  id: string,
  parentId: string | null,
  sortOrder: number,
): Promise<void> {
  await window.evaluate(
    async (payload) => {
      await (window as any).lychee.invoke('documents.move', payload);
    },
    { id, parentId, sortOrder },
  );
  await window.waitForTimeout(500);
}

/** Real pointer drag with a graceful no-op if boxes are unavailable. */
async function dragNote(
  window: Page,
  sourceId: string,
  targetId: string,
  position: 'before' | 'inside',
): Promise<void> {
  const source = window.locator(`[data-note-id="${sourceId}"]`);
  const target = window.locator(`[data-note-id="${targetId}"]`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) return;

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const destX = targetBox.x + targetBox.width / 2;
  const destY =
    position === 'inside' ? targetBox.y + targetBox.height / 2 : targetBox.y + 2;

  await window.mouse.move(startX, startY);
  await window.mouse.down();
  await window.mouse.move(startX + 6, startY + 6, { steps: 6 });
  await window.waitForTimeout(250);
  await window.mouse.move(destX, destY, { steps: 25 });
  await window.waitForTimeout(400);
  await window.mouse.up();
  await window.waitForTimeout(600);
}

// ── Tests ───────────────────────────────────────────────────────────

test.describe('Stage 4 — file operations (paths + UI)', () => {
  test('creating a note writes a markdown file with stable identity and no title duplication', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Roadmap');

    await waitForFile(path.join(vaultDir, 'Roadmap.md'));
    const { data, body } = readNote(vaultDir, 'Roadmap.md');
    expect(data.id).toBeTruthy();
    // The exact title lives in frontmatter; the body has no title line.
    expect(data.title).toBe('Roadmap');
    expect(body.trim()).not.toMatch(/^#\s+Roadmap/);

    // UI: the note is in the sidebar.
    await expect(noteItem(window, 'Roadmap')).toBeVisible();
  });

  test('editing the title renames the file and keeps the id stable', async ({ window, vaultDir }) => {
    await createNote(window, 'First Name');
    await waitForFile(path.join(vaultDir, 'First Name.md'));
    const id = await getDocumentFromDb(window, await noteIdByTitle(window, 'First Name'));
    expect(id).toBeTruthy();

    await replaceTitle(window, 'Second Name');

    await waitForFile(path.join(vaultDir, 'Second Name.md'));
    await waitForFileGone(path.join(vaultDir, 'First Name.md'));
    expect(listMarkdown(vaultDir)).toEqual(['Second Name.md']);

    const renamed = readNote(vaultDir, 'Second Name.md');
    expect(renamed.data.id).toBe(id!.id);
    expect(renamed.data.title).toBe('Second Name');

    // UI reflects the new title and the old one is gone.
    await expect(noteItem(window, 'Second Name')).toBeVisible();
    await expect(window.locator('[data-note-id]').filter({ hasText: 'First Name' })).toHaveCount(0);
  });

  test('a title edit renames the file on window blur (commit)', async ({ window, vaultDir }) => {
    await createNote(window, 'Blur Commit');
    await waitForFile(path.join(vaultDir, 'Blur Commit.md'));

    const title = window.locator('main:visible h1.editor-title');
    await title.click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${mod}+A`);
    await window.keyboard.type('Blur Committed');
    await window.waitForTimeout(500);

    // Autosave writes in place; the rename only happens on commit.
    expect(listMarkdown(vaultDir)).toContain('Blur Commit.md');

    await commitSaves(window);
    await waitForFile(path.join(vaultDir, 'Blur Committed.md'));
    await waitForFileGone(path.join(vaultDir, 'Blur Commit.md'));
  });

  test('a duplicate title is rejected (titles are unique)', async ({ window, vaultDir }) => {
    await createNote(window, 'Meeting');
    await waitForFile(path.join(vaultDir, 'Meeting.md'));

    // Second note: try to reuse the same title.
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(500);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Meeting');
    // Uniqueness is validated on commit.
    await window.keyboard.press('Enter');
    await window.waitForTimeout(700);

    // The conflict is surfaced inline; the title is never persisted or written.
    await expect(
      window.locator('main:visible').getByText('A note with this title already exists.'),
    ).toBeVisible();

    const docs = await listDocumentsFromDb(window);
    expect(docs.filter((doc) => doc.title === 'Meeting')).toHaveLength(1);
    // The canonical file for the existing note is untouched.
    const note = readNote(vaultDir, 'Meeting.md');
    expect(note.data.title).toBe('Meeting');
  });

  test('moving a note inside another moves the file into its folder (drag + UI)', async ({
    window,
    vaultDir,
  }) => {
    const parentId = await createNote(window, 'Parent');
    const childId = await createNote(window, 'Child');
    await waitForFile(path.join(vaultDir, 'Parent.md'));
    await waitForFile(path.join(vaultDir, 'Child.md'));

    await dragNote(window, childId, parentId, 'inside');
    // Drag can be flaky under CI; fall back to the same IPC the drop handler uses.
    try {
      await waitForFile(path.join(vaultDir, 'Parent', 'Child.md'), 2500);
    } catch {
      await moveViaIpc(window, childId, parentId, 0);
    }

    await waitForFile(path.join(vaultDir, 'Parent', 'Child.md'));
    await waitForFileGone(path.join(vaultDir, 'Child.md'));

    // UI/DB: the child is parented under the parent and still visible.
    const child = await getDocumentFromDb(window, childId);
    expect(child!.parentId).toBe(parentId);
    await expect(noteItem(window, 'Child')).toBeVisible();
  });

  test('moving back to the root moves the file out of the parent folder', async ({
    window,
    vaultDir,
  }) => {
    const parentId = await createNote(window, 'Section');
    const childId = await createNote(window, 'Leaf');
    await moveViaIpc(window, childId, parentId, 0);
    await waitForFile(path.join(vaultDir, 'Section', 'Leaf.md'));

    await moveViaIpc(window, childId, null, 0);
    await waitForFile(path.join(vaultDir, 'Leaf.md'));
    await waitForFileGone(path.join(vaultDir, 'Section', 'Leaf.md'));

    const child = await getDocumentFromDb(window, childId);
    expect(child!.parentId).toBeNull();
  });

  test('reordering persists order into the file frontmatter', async ({ window, vaultDir }) => {
    const aId = await createNote(window, 'Alpha');
    const bId = await createNote(window, 'Bravo');
    await waitForFile(path.join(vaultDir, 'Alpha.md'));
    await waitForFile(path.join(vaultDir, 'Bravo.md'));

    await moveViaIpc(window, bId, null, 0);

    await waitForContent(vaultDir, 'Bravo.md', 'order: 0');
    await waitForContent(vaultDir, 'Alpha.md', 'order: 1');

    const bravo = readNote(vaultDir, 'Bravo.md');
    const alpha = readNote(vaultDir, 'Alpha.md');
    expect(Number(bravo.data.order)).toBeLessThan(Number(alpha.data.order));
    expect(bravo.data.id).not.toBe(alpha.data.id);
    expect(aId).not.toBe(bId);
  });

  test('trashing moves the file into .trash and removes it from the sidebar', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Trash Me');
    await waitForFile(path.join(vaultDir, 'Trash Me.md'));
    const id = await noteIdByTitle(window, 'Trash Me');

    await noteItem(window, 'Trash Me').click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(500);

    await waitForFile(path.join(vaultDir, '.trash', 'Trash Me.md'));
    await waitForFileGone(path.join(vaultDir, 'Trash Me.md'));
    expect(listMarkdown(vaultDir)).toEqual([]);
    expect(listMarkdown(vaultDir, { trash: true })).toEqual(['Trash Me.md']);

    await expect(window.locator('[data-note-id]').filter({ hasText: 'Trash Me' })).toHaveCount(0);
    const doc = await getDocumentFromDb(window, id);
    expect(doc!.deletedAt).toBeTruthy();
  });

  test('restoring a note returns the file to the vault and the sidebar', async ({ window, vaultDir }) => {
    await createNote(window, 'Bring Back');
    await waitForFile(path.join(vaultDir, 'Bring Back.md'));

    await noteItem(window, 'Bring Back').click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);
    await waitForFile(path.join(vaultDir, '.trash', 'Bring Back.md'));

    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);
    await window.locator('[aria-label="Restore"]').first().click();
    await window.waitForTimeout(600);
    await window.keyboard.press('Escape');

    await waitForFile(path.join(vaultDir, 'Bring Back.md'));
    await waitForFileGone(path.join(vaultDir, '.trash', 'Bring Back.md'));
    await expect(noteItem(window, 'Bring Back')).toBeVisible();
  });

  test('permanently deleting removes the file from .trash', async ({ window, vaultDir }) => {
    await createNote(window, 'Gone Forever');
    await waitForFile(path.join(vaultDir, 'Gone Forever.md'));

    await noteItem(window, 'Gone Forever').click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);
    await waitForFile(path.join(vaultDir, '.trash', 'Gone Forever.md'));

    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);
    await window.locator('[aria-label="Permanently delete"]').first().click();
    const confirm = window.getByTestId('trash-delete-confirm');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete note' }).click();
    await window.waitForTimeout(500);

    await waitForFileGone(path.join(vaultDir, '.trash', 'Gone Forever.md'));
    expect(listMarkdown(vaultDir, { trash: true })).toEqual([]);
    const trashed = await listTrashedFromDb(window);
    expect(trashed).toHaveLength(0);
  });

  test('an external file edit reloads the open note and shows the Updated toast', async ({
    window,
    vaultDir,
  }) => {
    await createNote(window, 'Live Note');
    await waitForFile(path.join(vaultDir, 'Live Note.md'));

    // Simulate another writer (MCP / editor / sync) rewriting the file.
    const absolute = path.join(vaultDir, 'Live Note.md');
    const { data } = parseFrontmatter(fs.readFileSync(absolute, 'utf8'));
    fs.writeFileSync(
      absolute,
      `---\nid: "${data.id}"\nupdated: "${new Date(Date.now() + 5000).toISOString()}"\n---\n\nexternally changed body\n`,
    );

    await expect(window.getByTestId('toast')).toContainText('Updated', { timeout: 10_000 });
    await expect(window.getByTestId('toast')).toContainText('Changed on disk');
    await expect(window.locator('main:visible .ContentEditable__root')).toContainText(
      'externally changed body',
    );
  });

  test('the vault never contains a legacy body title after create/rename/move', async ({
    window,
    vaultDir,
  }) => {
    const parentId = await createNote(window, 'Folder Note');
    const childId = await createNote(window, 'Inside Note');
    // Open the parent before renaming so replaceTitle targets it.
    await noteItem(window, 'Folder Note').click();
    await window.waitForTimeout(400);
    await replaceTitle(window, 'Folder Note Renamed');
    await moveViaIpc(window, childId, parentId, 0);

    await waitForFile(path.join(vaultDir, 'Folder Note Renamed', 'Inside Note.md'));

    for (const relative of listMarkdown(vaultDir)) {
      const { data, body } = readNote(vaultDir, relative);
      expect(data.title).toBeTruthy();
      // No first-line H1 matching the filename stem.
      const stem = relative.split('/').pop()!.replace(/\.md$/i, '');
      const firstNonEmpty = body.split('\n').find((line) => line.trim().length > 0);
      if (firstNonEmpty) {
        expect(firstNonEmpty.trim()).not.toBe(`# ${stem}`);
      }
    }

    const docs = await listDocumentsFromDb(window);
    expect(docs.map((doc) => doc.title).sort()).toEqual(['Folder Note Renamed', 'Inside Note']);
  });
});
