import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { parseFrontmatter, serializeFrontmatter } from '../src/shared/frontmatter';

/**
 * Shared helpers for exercising Lychee against markdown files that come from the
 * OS (Finder, an editor, a sync client). Everything operates on a hermetic
 * `vaultDir` provided by the test fixture — never the user's real vault.
 */

// ── Filesystem ──────────────────────────────────────────────────────

/** Every `.md` path under the vault (or `.trash`), POSIX-relative and sorted. */
export function listMarkdown(vaultDir: string, options: { trash?: boolean } = {}): string[] {
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

export function readNote(vaultDir: string, relativePath: string) {
  const raw = fs.readFileSync(path.join(vaultDir, relativePath), 'utf8');
  return parseFrontmatter(raw);
}

/** Read a note from `.trash` (path relative to the trash root). */
export function readTrashedNote(vaultDir: string, relativePath: string) {
  const raw = fs.readFileSync(path.join(vaultDir, '.trash', relativePath), 'utf8');
  return parseFrontmatter(raw);
}

/** Frontmatter ids of every note file on disk (optionally in `.trash`). */
export function fileIdsOnDisk(vaultDir: string, options: { trash?: boolean } = {}): string[] {
  const read = options.trash ? readTrashedNote : readNote;
  return listMarkdown(vaultDir, options)
    .map((rel) => {
      try {
        return read(vaultDir, rel).data.id ?? '';
      } catch {
        return '';
      }
    })
    .filter((id): id is string => Boolean(id));
}

/** Filenames under `<vault>/assets/` (top level only). */
export function listAssets(vaultDir: string): string[] {
  const dir = path.join(vaultDir, 'assets');
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Build frontmatter + body without going through the app. */
export function frontmatterNote(
  note: {
    id: string;
    title?: string;
    emoji?: string;
    bookmarked?: string;
    order?: number;
    updated?: string;
    created?: string;
  },
  body = '',
): string {
  const frontmatter = serializeFrontmatter({
    id: note.id,
    title: note.title,
    emoji: note.emoji,
    bookmarked: note.bookmarked,
    created: note.created ?? '2024-01-01T00:00:00.000Z',
    updated: note.updated ?? '2024-01-02T00:00:00.000Z',
    contentSchemaVersion: 1,
    order: note.order,
  });
  return `${frontmatter}\n${body}`;
}

export async function waitForFile(absolute: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fs.existsSync(absolute)) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${absolute}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function waitForFileGone(absolute: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (!fs.existsSync(absolute)) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${absolute} to go away`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function waitForContent(
  vaultDir: string,
  relativePath: string,
  needle: string,
  timeout = 8000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      if (fs.readFileSync(path.join(vaultDir, relativePath), 'utf8').includes(needle)) return;
    } catch {
      // not written yet
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${relativePath} to contain ${needle}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export interface NoteFrontmatter {
  id: string;
  title?: string;
  emoji?: string;
  bookmarked?: string;
  contentSchemaVersion?: number;
  order?: number;
  updated?: string;
}

/** Write a note the way the OS/another writer would: frontmatter + body. */
export function writeNote(
  vaultDir: string,
  relativePath: string,
  note: NoteFrontmatter,
  body = '',
  updated = new Date().toISOString(),
): void {
  const absolute = path.join(vaultDir, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const frontmatter = serializeFrontmatter({
    id: note.id,
    title: note.title,
    emoji: note.emoji,
    bookmarked: note.bookmarked,
    created: '2024-01-01T00:00:00.000Z',
    updated: note.updated ?? updated,
    contentSchemaVersion: note.contentSchemaVersion ?? 1,
    order: note.order,
  });
  fs.writeFileSync(absolute, `${frontmatter}\n${body}`);
}

export function deleteVaultPath(vaultDir: string, relativePath: string): void {
  fs.rmSync(path.join(vaultDir, relativePath), { recursive: true, force: true });
}

export function renameVaultPath(vaultDir: string, from: string, to: string): void {
  const target = path.join(vaultDir, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(path.join(vaultDir, from), target);
}

// ── UI ──────────────────────────────────────────────────────────────

export function noteItem(page: Page, title: string) {
  return page.locator('[data-note-id]').filter({ hasText: title }).first();
}

export function visibleTitle(page: Page) {
  return page.locator('main:visible h1.editor-title');
}

/** Title edits commit on blur/tab-switch; trigger the same flush. */
export async function commitSaves(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(500);
}

/** Create a note via the UI with a title; Enter commits (titles are commit-only). */
export async function createNote(page: Page, title: string): Promise<void> {
  await page.locator('[aria-label="New note"]').click();
  await page.waitForTimeout(400);
  await visibleTitle(page).click();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}

/** Replace the open note's title and commit it with Enter. */
export async function replaceTitle(page: Page, nextTitle: string): Promise<void> {
  await visibleTitle(page).click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.type(nextTitle);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}

/** Clear the open note's title back to blank and commit it with Enter. */
export async function clearTitle(page: Page): Promise<void> {
  await visibleTitle(page).click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}

/** Type into the open note's markdown body. */
export async function typeInBody(page: Page, text: string): Promise<void> {
  const body = page.locator('main:visible .ContentEditable__root');
  await body.click();
  await page.keyboard.type(text);
  await page.waitForTimeout(700);
}

/** Replace the entire body with `text` (select-all then type). */
export async function setBody(page: Page, text: string): Promise<void> {
  const body = page.locator('main:visible .ContentEditable__root');
  await body.click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.type(text);
  await page.waitForTimeout(700);
}

/** Sidebar note-row titles, top to bottom. */
export async function sidebarTitles(page: Page): Promise<string[]> {
  return (await page.locator('[data-note-id]').allTextContents()).map((text) => text.trim());
}

export function readRaw(vaultDir: string, relativePath: string): string {
  return fs.readFileSync(path.join(vaultDir, relativePath), 'utf8');
}

/** Deterministically reorder/reparent via the same IPC the drop handler uses. */
export async function moveViaIpc(
  page: Page,
  id: string,
  parentId: string | null,
  sortOrder: number,
): Promise<void> {
  await page.evaluate(
    async (payload) => {
      await (window as any).lychee.invoke('documents.move', payload);
    },
    { id, parentId, sortOrder },
  );
  await page.waitForTimeout(500);
}

/**
 * Reorder/reparent the way the UI does: through the store action, which invokes
 * the IPC *and* reloads the document list so the sidebar re-renders.
 */
export async function moveViaStore(
  page: Page,
  id: string,
  parentId: string | null,
  sortOrder: number,
): Promise<void> {
  await page.evaluate(
    async (payload) => {
      await (window as any).__documentStore
        .getState()
        .moveDocument(payload.id, payload.parentId, payload.sortOrder);
    },
    { id, parentId, sortOrder },
  );
  await page.waitForTimeout(300);
}

/** Attempt a move and return the rejection message, or null on success. */
export async function moveViaIpcExpectError(
  page: Page,
  id: string,
  parentId: string | null,
  sortOrder: number,
): Promise<string | null> {
  return page.evaluate(
    async (payload) => {
      try {
        await (window as any).lychee.invoke('documents.move', payload);
        return null;
      } catch (error) {
        return String((error as Error)?.message ?? error);
      }
    },
    { id, parentId, sortOrder },
  );
}

/** Expand a folder node in the sidebar tree. */
export async function expandFolder(page: Page, title: string): Promise<void> {
  await noteItem(page, title).locator('[aria-label="Expand"]').click();
  await page.waitForTimeout(200);
}

/** Sidebar note rows, top-to-bottom, as visible text. */
export async function sidebarOrder(page: Page): Promise<string[]> {
  return (await page.locator('[data-note-id]').allTextContents()).map((text) => text.trim());
}

/** Move a note to the Trash Bin via its context menu. */
export async function trashViaMenu(page: Page, title: string): Promise<void> {
  await noteItem(page, title).click({ button: 'right' });
  await page.getByText('Move to Trash Bin').click();
  await page.waitForTimeout(500);
}

/** Open the Trash Bin dialog. */
export async function openTrashBin(page: Page): Promise<void> {
  await page.locator('[aria-label="Trash Bin"]').click();
  await page.waitForTimeout(400);
}

/** Restore the first trashed note from the Trash Bin and close the dialog. */
export async function restoreFirstFromTrash(page: Page): Promise<void> {
  await page.locator('[aria-label="Restore"]').first().click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/** Permanently delete the first trashed note (confirming the dialog). */
export async function permanentlyDeleteFirstFromTrash(page: Page): Promise<void> {
  await page.locator('[aria-label="Permanently delete"]').first().click();
  const confirm = page.getByTestId('trash-delete-confirm');
  await confirm.getByRole('button', { name: 'Delete note' }).click();
  await page.waitForTimeout(500);
}

/** Append a cross-device tombstone so the watcher reconciles it. */
export function writeTombstone(
  vaultDir: string,
  deviceId: string,
  entries: Array<{ id: string; action: 'trash' | 'restore' | 'purge'; at: string }>,
): void {
  const dir = path.join(vaultDir, '.lychee', 'tombstones');
  fs.mkdirSync(dir, { recursive: true });
  const lines = entries
    .map((entry) => JSON.stringify({ ...entry, device: deviceId }))
    .join('\n');
  fs.writeFileSync(path.join(dir, `${deviceId}.jsonl`), `${lines}\n`);
}

/** Append records to a device's tombstone log without rewriting earlier ones. */
export function appendTombstone(
  vaultDir: string,
  deviceId: string,
  entries: Array<{ id: string; action: 'trash' | 'restore' | 'purge'; at: string }>,
): void {
  const dir = path.join(vaultDir, '.lychee', 'tombstones');
  fs.mkdirSync(dir, { recursive: true });
  const lines = entries
    .map((entry) => JSON.stringify({ ...entry, device: deviceId }))
    .join('\n');
  fs.appendFileSync(path.join(dir, `${deviceId}.jsonl`), `${lines}\n`);
}

/** Every tombstone line across all device logs, concatenated. */
export function tombstoneText(vaultDir: string): string {
  const dir = path.join(vaultDir, '.lychee', 'tombstones');
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');
}

/** The live vault-relative path of the file whose frontmatter id matches. */
export function filePathForId(
  vaultDir: string,
  id: string,
  options: { trash?: boolean } = {},
): string | undefined {
  const read = options.trash ? readTrashedNote : readNote;
  return listMarkdown(vaultDir, options).find((relativePath) => {
    try {
      return read(vaultDir, relativePath).data.id === id;
    } catch {
      return false;
    }
  });
}

/** Create a note through the same IPC the UI calls; returns the created row. */
export async function createNoteViaIpc(
  page: Page,
  title: string,
): Promise<{ id: string; title: string }> {
  const document = await page.evaluate(
    async (payload) =>
      (
        await (window as any).lychee.invoke('documents.create', payload)
      ).document,
    { title },
  );
  await page.waitForTimeout(400);
  return document;
}

/** All live documents keyed by their title (last write wins on collisions). */
export async function idsByTitle(page: Page): Promise<Map<string, string>> {
  const docs = await page.evaluate(async () =>
    (await (window as any).lychee.invoke('documents.list', { limit: 500, offset: 0 })).documents,
  );
  return new Map((docs as Array<{ id: string; title: string }>).map((doc) => [doc.title, doc.id]));
}


