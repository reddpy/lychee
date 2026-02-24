import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  findPackagedBinary,
  hasDevBuild,
  PROJECT_ROOT,
  listDocumentsFromDb,
} from './electron-app';

/**
 * Persistence tests verify that data survives an app restart.
 * They manage the Electron lifecycle manually (launch → interact → close → relaunch → verify).
 */

function buildLaunchOpts(tmpDir: string) {
  const packagedBinary = findPackagedBinary();
  const opts: Parameters<typeof _electron.launch>[0] = {
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30_000,
  };

  if (packagedBinary) {
    opts.executablePath = packagedBinary;
    opts.args = [`--user-data-dir=${tmpDir}`];
  } else if (hasDevBuild()) {
    opts.args = [PROJECT_ROOT, `--user-data-dir=${tmpDir}`];
  } else {
    throw new Error('No Electron build found.');
  }

  return opts;
}

async function launchAndGetWindow(tmpDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await _electron.launch(buildLaunchOpts(tmpDir));
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
  return { app, window };
}

base.describe('Persistence — data survives app restart', () => {
  let tmpDir: string;

  base.beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-persist-'));
  });

  base.afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  base('notes persist after closing and reopening the app', async () => {
    // ── Session 1: create notes ──
    let { app, window } = await launchAndGetWindow(tmpDir);

    // Create first note with a title
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Persistent Note A');
    await window.waitForTimeout(700);

    // Create second note with a title
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Persistent Note B');
    await window.waitForTimeout(700);

    // Verify both exist in DB before closing
    let docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(2);

    // Close the app
    await app.close();

    // ── Session 2: reopen and verify ──
    ({ app, window } = await launchAndGetWindow(tmpDir));

    // Both notes should be in the sidebar
    await expect(window.locator('[data-note-id]')).toHaveCount(2);
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Persistent Note A' })).toHaveCount(1);
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Persistent Note B' })).toHaveCount(1);

    // Backend: documents still in SQLite
    docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(2);
    const titles = docs.map((d) => d.title).sort();
    expect(titles).toEqual(['Persistent Note A', 'Persistent Note B']);

    await app.close();
  });

  base('edited content persists after restart', async () => {
    // ── Session 1: create a note and add body content ──
    let { app, window } = await launchAndGetWindow(tmpDir);

    // There may be notes from the previous test; create a fresh one
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Content Test');
    await window.keyboard.press('Enter');
    await window.keyboard.type('This body text must survive a restart.');
    await window.waitForTimeout(1000);

    // Verify content is saved
    const docs = await listDocumentsFromDb(window);
    const doc = docs.find((d) => d.title === 'Content Test');
    expect(doc).toBeTruthy();
    expect(doc!.content).toContain('This body text must survive a restart.');

    await app.close();

    // ── Session 2: verify content ──
    ({ app, window } = await launchAndGetWindow(tmpDir));

    // Click the note in the sidebar to open it
    const noteInSidebar = window.locator('[data-note-id]').filter({ hasText: 'Content Test' });
    await noteInSidebar.click();
    await window.waitForTimeout(500);

    // The editor should show the persisted content
    const editorRoot = window.locator('main:visible .ContentEditable__root');
    await expect(editorRoot).toContainText('This body text must survive a restart.');

    await app.close();
  });

  base('trashed notes stay trashed after restart', async () => {
    // ── Session 1: create and trash a note ──
    let { app, window } = await launchAndGetWindow(tmpDir);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Trash Persist');
    await window.waitForTimeout(700);

    const note = window.locator('[data-note-id]').filter({ hasText: 'Trash Persist' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Confirm it's not in the active list
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Trash Persist' })).toHaveCount(0);

    await app.close();

    // ── Session 2: verify it's still trashed ──
    ({ app, window } = await launchAndGetWindow(tmpDir));

    // Should NOT appear in the sidebar
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Trash Persist' })).toHaveCount(0);

    // Open trash bin and verify it's there
    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);
    await expect(window.getByText('Trash Persist')).toBeVisible();

    await app.close();
  });
});
