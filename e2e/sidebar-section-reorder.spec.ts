/**
 * E2E tests for the sidebar section reorder feature.
 *
 * Sidebar sections (Bookmarks, Notes) are reorderable via drag on the section
 * header. The order is persisted to localStorage under
 * `lychee:sidebar-section-order` and applied on next mount.
 *
 * What this file covers:
 *  - Default DOM order matches the default order constant.
 *  - Clicking the section header still toggles open/close (drag controls
 *    initiate on pointerdown but a no-movement click passes through).
 *  - Drag past the sibling section header swaps the on-screen order and
 *    writes the new order to localStorage.
 *  - The reordered state survives an app restart.
 */

import {
  test as base,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test } from './electron-app';
import {
  findPackagedBinary,
  hasDevBuild,
  PROJECT_ROOT,
} from './electron-app';

// ── Helpers ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'lychee:sidebar-section-order';

/** Create a note titled `title`, return its docId. */
async function createNoteWithTitle(window: Page, title: string): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);

  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.type(title);
  await window.waitForTimeout(700);

  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    const s = store.getState();
    return s.openTabs.find((t: any) => t.tabId === s.selectedId)?.docId as string;
  });
}

/** Set bookmarkedAt on a doc + reflect in the Zustand store. */
async function bookmarkViaBackend(window: Page, docId: string, ts?: string): Promise<void> {
  const bookmarkedAt = ts ?? new Date().toISOString();
  await window.evaluate(
    ({ id, at }: { id: string; at: string }) =>
      (window as any).lychee.invoke('documents.update', {
        id,
        metadata: { bookmarkedAt: at },
      }),
    { id: docId, at: bookmarkedAt },
  );
  await window.evaluate(
    ({ id, at }: { id: string; at: string }) => {
      const store = (window as any).__documentStore;
      const state = store.getState();
      const doc = state.documents.find((d: any) => d.id === id);
      if (doc) {
        state.updateDocumentInStore(id, { metadata: { ...doc.metadata, bookmarkedAt: at } });
      }
    },
    { id: docId, at: bookmarkedAt },
  );
  await window.waitForTimeout(150);
}

/** Read the section order from the DOM (top-to-bottom by data-section-id). */
async function getDomOrder(window: Page): Promise<string[]> {
  const items = window.locator('[data-section-id]');
  const count = await items.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await items.nth(i).getAttribute('data-section-id');
    if (id) ids.push(id);
  }
  return ids;
}

/** Read the persisted order from localStorage. */
async function getStoredOrder(window: Page): Promise<string[] | null> {
  const raw = await window.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function bookmarksHeader(window: Page) {
  return window
    .locator('aside')
    .locator('button')
    .filter({ hasText: /^Bookmarks$/ })
    .first();
}

function notesHeader(window: Page) {
  return window
    .locator('aside')
    .locator('button')
    .filter({ hasText: /^Notes$/ })
    .first();
}

/**
 * Drag a section header past the sibling header so framer's Reorder swaps
 * positions. We deliberately move past the threshold (>3px) before traveling
 * the long distance, then settle past the sibling's vertical midpoint.
 */
async function dragSectionPastSibling(
  window: Page,
  source: ReturnType<typeof bookmarksHeader>,
  target: ReturnType<typeof notesHeader>,
  direction: 'down' | 'up',
) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Section header has no bounding box');

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const offset = direction === 'down' ? sourceBox.height + targetBox.height : -(sourceBox.height + targetBox.height);
  const endY = targetBox.y + targetBox.height / 2 + offset;

  await window.mouse.move(startX, startY);
  await window.mouse.down();
  // Cross the framer drag threshold first
  await window.mouse.move(startX, startY + (direction === 'down' ? 6 : -6), { steps: 4 });
  await window.waitForTimeout(80);
  // Travel to the destination across many steps so onReorder fires mid-drag
  await window.mouse.move(startX, endY, { steps: 25 });
  await window.waitForTimeout(200);
  await window.mouse.up();
  await window.waitForTimeout(300);
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Sidebar Section Reorder — Default & Persistence', () => {
  test('default DOM order is bookmarks then notes when bookmarks exist', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Default Order Note');
    await bookmarkViaBackend(window, docId);

    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 3000 });
    expect(await getDomOrder(window)).toEqual(['bookmarks', 'notes']);
  });

  test('only notes section renders when no bookmarks exist', async ({ window }) => {
    await createNoteWithTitle(window, 'No Bookmarks');

    await expect(notesHeader(window)).toBeVisible({ timeout: 3000 });
    expect(await getDomOrder(window)).toEqual(['notes']);
  });
});

test.describe('Sidebar Section Reorder — Click vs Drag', () => {
  test('clicking the Bookmarks header toggles open/close (no drag)', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Click Toggle Bookmarks');
    await bookmarkViaBackend(window, docId);

    // Bookmark item visible (section open by default)
    await expect(window.locator(`[data-note-id="${docId}"]`).first()).toBeVisible({ timeout: 3000 });
    const initialBookmarkCount = await window.locator(`[data-note-id="${docId}"]`).count();
    expect(initialBookmarkCount).toBeGreaterThanOrEqual(2); // notes + bookmarks duplicates

    await bookmarksHeader(window).click();
    await window.waitForTimeout(400);

    // After collapse, the bookmarks-section duplicate is gone (only the notes-tree one remains)
    await expect(async () => {
      const count = await window.locator(`[data-note-id="${docId}"]`).count();
      expect(count).toBe(1);
    }).toPass({ timeout: 3000 });

    await bookmarksHeader(window).click();
    await window.waitForTimeout(400);

    await expect(async () => {
      const count = await window.locator(`[data-note-id="${docId}"]`).count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 3000 });

    // Section order must not have changed from a click
    expect(await getDomOrder(window)).toEqual(['bookmarks', 'notes']);
  });

  test('clicking the Notes header toggles open/close', async ({ window }) => {
    await createNoteWithTitle(window, 'Click Toggle Notes');

    const noteItem = window.locator('[data-note-id]').first();
    await expect(noteItem).toBeVisible({ timeout: 3000 });

    await notesHeader(window).click();
    await window.waitForTimeout(400);
    await expect(noteItem).not.toBeVisible();

    await notesHeader(window).click();
    await window.waitForTimeout(400);
    await expect(noteItem).toBeVisible();
  });
});

test.describe('Sidebar Section Reorder — Drag Behavior', () => {
  test('drag bookmarks below notes swaps DOM order and writes localStorage', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Drag Reorder Bookmark');
    await bookmarkViaBackend(window, docId);

    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 3000 });
    expect(await getDomOrder(window)).toEqual(['bookmarks', 'notes']);

    await dragSectionPastSibling(window, bookmarksHeader(window), notesHeader(window), 'down');

    // DOM order swapped
    await expect(async () => {
      expect(await getDomOrder(window)).toEqual(['notes', 'bookmarks']);
    }).toPass({ timeout: 3000 });

    // localStorage reflects the same swap
    expect(await getStoredOrder(window)).toEqual(['notes', 'bookmarks']);

    // Bookmarks header is still a button that toggles — drag must not have
    // poisoned the click handler.
    expect(await bookmarksHeader(window).isVisible()).toBe(true);
  });

  test('drag past sibling and back leaves order in the original state', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Drag Roundtrip');
    await bookmarkViaBackend(window, docId);

    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 3000 });

    // Move bookmarks down past notes
    await dragSectionPastSibling(window, bookmarksHeader(window), notesHeader(window), 'down');
    await expect(async () => {
      expect(await getDomOrder(window)).toEqual(['notes', 'bookmarks']);
    }).toPass({ timeout: 3000 });

    // Move it back
    await dragSectionPastSibling(window, bookmarksHeader(window), notesHeader(window), 'up');
    await expect(async () => {
      expect(await getDomOrder(window)).toEqual(['bookmarks', 'notes']);
    }).toPass({ timeout: 3000 });

    expect(await getStoredOrder(window)).toEqual(['bookmarks', 'notes']);
  });
});

test.describe('Sidebar Section Reorder — Stress', () => {
  test('clicking the Bookmarks header right after a drag still toggles', async ({ window }) => {
    // Regression: didDragRef must reset after the post-drag click is suppressed,
    // otherwise the very next click is also suppressed and the toggle dies.
    const docId = await createNoteWithTitle(window, 'Click After Drag');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 3000 });

    await dragSectionPastSibling(window, bookmarksHeader(window), notesHeader(window), 'down');
    await expect(async () => {
      expect(await getDomOrder(window)).toEqual(['notes', 'bookmarks']);
    }).toPass({ timeout: 3000 });

    // Bookmarks duplicate is currently visible (section open). Click should collapse it.
    expect(await window.locator(`[data-note-id="${docId}"]`).count()).toBeGreaterThanOrEqual(2);
    await bookmarksHeader(window).click();
    await window.waitForTimeout(400);

    await expect(async () => {
      const count = await window.locator(`[data-note-id="${docId}"]`).count();
      expect(count).toBe(1);
    }).toPass({ timeout: 3000 });

    // And clicking again expands.
    await bookmarksHeader(window).click();
    await window.waitForTimeout(400);
    await expect(async () => {
      const count = await window.locator(`[data-note-id="${docId}"]`).count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 3000 });
  });

  test('rapid drag swaps converge to a consistent final state', async ({ window }) => {
    // Five swaps starting from the default. Odd count → final order is swapped.
    const docId = await createNoteWithTitle(window, 'Rapid Drag Swap');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 3000 });

    let expected: string[] = ['bookmarks', 'notes'];
    for (let i = 0; i < 5; i++) {
      const isDefault = expected[0] === 'bookmarks';
      const direction: 'down' | 'up' = isDefault ? 'down' : 'up';
      await dragSectionPastSibling(window, bookmarksHeader(window), notesHeader(window), direction);
      expected = isDefault ? ['notes', 'bookmarks'] : ['bookmarks', 'notes'];
      await expect(async () => {
        expect(await getDomOrder(window)).toEqual(expected);
      }).toPass({ timeout: 3000 });
    }

    // DOM and localStorage must agree at the end.
    expect(await getDomOrder(window)).toEqual(['notes', 'bookmarks']);
    expect(await getStoredOrder(window)).toEqual(['notes', 'bookmarks']);
  });

  test('reordered sections survive bookmarks-visibility flip', async ({ window }) => {
    // Reorder, then remove the bookmark so the bookmarks section hides
    // entirely, then re-bookmark — the previously-set order must be restored.
    const docId = await createNoteWithTitle(window, 'Visibility Flip Reorder');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 3000 });

    await dragSectionPastSibling(window, bookmarksHeader(window), notesHeader(window), 'down');
    await expect(async () => {
      expect(await getDomOrder(window)).toEqual(['notes', 'bookmarks']);
    }).toPass({ timeout: 3000 });

    // Unbookmark — Bookmarks section disappears.
    await window.evaluate(
      (id: string) => (window as any).lychee.invoke('documents.update', { id, metadata: { bookmarkedAt: null } }),
      docId,
    );
    await window.evaluate(
      (id: string) => {
        const store = (window as any).__documentStore;
        const state = store.getState();
        const doc = state.documents.find((d: any) => d.id === id);
        if (doc) {
          state.updateDocumentInStore(id, { metadata: { ...doc.metadata, bookmarkedAt: null } });
        }
      },
      docId,
    );
    await expect(bookmarksHeader(window)).not.toBeVisible({ timeout: 3000 });
    expect(await getDomOrder(window)).toEqual(['notes']);

    // Persisted order should still hold the reorder, not silently fall back.
    expect(await getStoredOrder(window)).toEqual(['notes', 'bookmarks']);

    // Re-bookmark — Bookmarks section returns and order should be restored.
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 3000 });
    await expect(async () => {
      expect(await getDomOrder(window)).toEqual(['notes', 'bookmarks']);
    }).toPass({ timeout: 3000 });
  });
});

// ── Persistence Across Restart ─────────────────────────────────────────

function buildLaunchOpts(tmpDir: string): Parameters<typeof _electron.launch>[0] {
  const packagedBinary = findPackagedBinary();
  const opts: Parameters<typeof _electron.launch>[0] = {
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30_000,
  };
  const extraArgs = process.env.CI ? ['--no-sandbox'] : [];
  if (packagedBinary) {
    opts.executablePath = packagedBinary;
    opts.args = [`--user-data-dir=${tmpDir}`, ...extraArgs];
  } else if (hasDevBuild()) {
    opts.args = [PROJECT_ROOT, `--user-data-dir=${tmpDir}`, ...extraArgs];
  } else {
    throw new Error('No Electron build found.');
  }
  return opts;
}

async function launchAndGetWindow(
  tmpDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await _electron.launch(buildLaunchOpts(tmpDir));
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
  return { app, window };
}

base.describe('Sidebar Section Reorder — Persistence Across Restart', () => {
  let tmpDir: string;

  base.beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-section-reorder-'));
  });

  base.afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  base('reordered sections render in the new order after a restart', async () => {
    let { app, window } = await launchAndGetWindow(tmpDir);

    // Seed: create a bookmarked note so both sections are visible.
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Section Reorder Persist');
    await window.waitForTimeout(700);

    const docId = await window.evaluate(() => {
      const s = (window as any).__documentStore.getState();
      return s.openTabs.find((t: any) => t.tabId === s.selectedId)?.docId as string;
    });

    await bookmarkViaBackend(window, docId);

    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 5000 });
    expect(await getDomOrder(window)).toEqual(['bookmarks', 'notes']);

    // Persist a swapped order directly via localStorage to avoid drag flake
    // and re-mount via app restart so loadOrder() re-reads.
    await window.evaluate(
      ({ key, order }) => localStorage.setItem(key, JSON.stringify(order)),
      { key: STORAGE_KEY, order: ['notes', 'bookmarks'] },
    );
    await app.close();

    // Session 2: order should reflect what was saved
    ({ app, window } = await launchAndGetWindow(tmpDir));
    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 5000 });
    expect(await getDomOrder(window)).toEqual(['notes', 'bookmarks']);

    await app.close();
  });

  base('corrupt stored order falls back to default on restart', async () => {
    // Plant junk into localStorage during the first session.
    let { app, window } = await launchAndGetWindow(tmpDir);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Corrupt Order Fallback');
    await window.waitForTimeout(700);

    const docId = await window.evaluate(() => {
      const s = (window as any).__documentStore.getState();
      return s.openTabs.find((t: any) => t.tabId === s.selectedId)?.docId as string;
    });
    await bookmarkViaBackend(window, docId);

    await window.evaluate(
      ({ key }) => localStorage.setItem(key, '{not valid json'),
      { key: STORAGE_KEY },
    );
    await app.close();

    // Session 2: parser falls back to default
    ({ app, window } = await launchAndGetWindow(tmpDir));
    await expect(bookmarksHeader(window)).toBeVisible({ timeout: 5000 });
    expect(await getDomOrder(window)).toEqual(['bookmarks', 'notes']);

    await app.close();
  });
});
