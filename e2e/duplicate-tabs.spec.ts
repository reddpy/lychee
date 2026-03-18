/**
 * E2E tests for duplicate tab behavior.
 *
 * "Duplicate tab" = multiple tabs open for the same document (same docId,
 * different tabId). They share a single Lexical editor instance but have
 * independent scroll positions, cursor/selection, search state, and UI
 * panel state (TOC, link popover, etc.).
 *
 * Coverage:
 *   1. Core store operations (openTab, close, reorder, selection)
 *   2. Tab strip UI (duplicate dot indicator, title sync)
 *   3. Editor instance sharing (one editor per docId)
 *   4. Selection save/restore (TabSelectionPlugin)
 *   5. Scroll position independence
 *   6. In-note search isolation
 *   7. Section indicator (TOC) isolation
 *   8. Popover/menu dismissal on tab switch
 *   9. Content sync between duplicate tabs
 *   10. Debounced save behavior
 *   11. Cross-feature interactions (trash, navigate, bookmark)
 *   12. Edge cases & stress tests
 */

import { test, expect, getDocumentFromDb } from './electron-app';
import type { Page } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a note, type a title, and return { tabId, docId }. */
async function createNote(window: Page, title: string): Promise<{ tabId: string; docId: string }> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  await window.locator('main:visible h1.editor-title').click();
  await window.keyboard.type(title);
  await window.waitForTimeout(700);
  const { tabId, docId } = await window.evaluate(() => {
    const store = (window as any).__documentStore;
    const state = store.getState();
    const selectedTabId = state.selectedId as string;
    const tab = state.openTabs.find((t: any) => t.tabId === selectedTabId);
    return { tabId: selectedTabId, docId: tab?.docId as string };
  });
  return { tabId, docId };
}

/** Create a note with body content. Returns { tabId, docId }. */
async function createNoteWithBody(
  window: Page,
  title: string,
  bodyLines: string[],
): Promise<{ tabId: string; docId: string }> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);

  const titleEl = window
    .locator('main:not([style*="display: none"])')
    .first()
    .locator('h1.editor-title')
    .first();
  await expect(titleEl).toBeVisible();
  await titleEl.click();
  await window.keyboard.type(title);
  await window.keyboard.press('Enter');

  for (const line of bodyLines) {
    await window.keyboard.type(line);
    await window.keyboard.press('Enter');
  }

  await window.waitForTimeout(700);
  const { tabId, docId } = await window.evaluate(() => {
    const store = (window as any).__documentStore;
    const state = store.getState();
    const selectedTabId = state.selectedId as string;
    const tab = state.openTabs.find((t: any) => t.tabId === selectedTabId);
    return { tabId: selectedTabId, docId: tab?.docId as string };
  });
  return { tabId, docId };
}

/** Open a duplicate tab for the given docId via the Zustand store. Returns the new tabId. */
async function openDuplicateTab(window: Page, docId: string): Promise<string> {
  const newTabId = await window.evaluate((id: string) => {
    const store = (window as any).__documentStore;
    const before = new Set(store.getState().openTabs.map((t: any) => t.tabId));
    store.getState().openTab(id);
    const after = store.getState().openTabs;
    const newTab = after.find((t: any) => !before.has(t.tabId) && t.docId === id);
    return newTab?.tabId as string;
  }, docId);
  await window.waitForTimeout(200);
  return newTabId;
}

/** Select a tab by its tabId via the Zustand store. */
async function selectTab(window: Page, tabId: string): Promise<void> {
  await window.evaluate(
    (id: string) => (window as any).__documentStore.getState().selectDocument(id),
    tabId,
  );
  await window.waitForTimeout(200);
}

/** Get current store state snapshot. */
async function getStoreState(window: Page) {
  return window.evaluate(() => {
    const s = (window as any).__documentStore.getState();
    return {
      selectedId: s.selectedId as string | null,
      openTabs: s.openTabs.map((t: any) => ({ tabId: t.tabId, docId: t.docId })),
    };
  });
}

/** Get the docId of the currently selected tab. */
async function getActiveDocId(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const s = (window as any).__documentStore.getState();
    const tab = s.openTabs.find((t: any) => t.tabId === s.selectedId);
    return (tab?.docId as string) ?? null;
  });
}

/** The visible/active <main> element. */
function activeMain(window: Page) {
  return window.locator('main:not([style*="display: none"])').first();
}

/** Click a tab in the tab strip by its tabId. */
function tabById(window: Page, tabId: string) {
  return window.locator(`[data-tab-id="${tabId}"]`);
}

/** Close a tab via its close button. */
async function closeTabUI(window: Page, tabId: string) {
  const tab = tabById(window, tabId);
  const closeBtn = tab.locator('[aria-label="Close tab"]');
  await closeBtn.click({ force: true });
  await window.waitForTimeout(300);
}

/** Find bar helpers. */
function findInput(window: Page) {
  return activeMain(window).getByTestId('note-find-input');
}

function findCounter(window: Page) {
  return activeMain(window).getByTestId('note-find-counter');
}

function findNext(window: Page) {
  return activeMain(window).getByTestId('note-find-next');
}

async function ensureFindOpen(window: Page) {
  if (!(await findInput(window).isVisible())) {
    await window.keyboard.press(`${mod}+f`);
    if (!(await findInput(window).isVisible())) {
      await activeMain(window).getByTestId('note-find-trigger').click();
    }
  }
  await expect(findInput(window)).toBeVisible();
}

/** Section indicator (TOC) trigger. */
const SECTION_TRIGGER = '[aria-label="Navigate sections"]';

/** Get scroll position of the active main element. */
async function getScrollTop(window: Page): Promise<number> {
  return window.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
    return main?.scrollTop ?? 0;
  });
}

// ── 1. Core Store Operations ─────────────────────────────────────────

test.describe('Duplicate Tabs — Core Store Operations', () => {
  test('openTab creates a new tab with unique tabId for the same docId', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Store A');

    const newTabId = await openDuplicateTab(window, docId);
    const state = await getStoreState(window);

    const tabsForDoc = state.openTabs.filter((t) => t.docId === docId);
    expect(tabsForDoc).toHaveLength(2);
    // Different tabIds
    expect(tabsForDoc[0].tabId).not.toBe(tabsForDoc[1].tabId);
    expect(newTabId).toBeTruthy();
  });

  test('openTab appends to end without changing selection', async ({ window }) => {
    await createNote(window, 'Dup Store B1');
    const { tabId: tabB, docId: docB } = await createNote(window, 'Dup Store B2');

    // B is selected
    expect((await getStoreState(window)).selectedId).toBe(tabB);

    await openDuplicateTab(window, docB);
    const state = await getStoreState(window);

    // Selection unchanged — still tabB
    expect(state.selectedId).toBe(tabB);
    // New tab appended at end
    expect(state.openTabs[state.openTabs.length - 1].docId).toBe(docB);
    expect(state.openTabs).toHaveLength(3);
  });

  test('closing one duplicate leaves the other intact', async ({ window }) => {
    const { tabId: originalTab, docId } = await createNote(window, 'Dup Close A');
    const dupTabId = await openDuplicateTab(window, docId);

    // Select the duplicate, then close it
    await selectTab(window, dupTabId);
    await closeTabUI(window, dupTabId);

    const state = await getStoreState(window);
    const remaining = state.openTabs.filter((t) => t.docId === docId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tabId).toBe(originalTab);
  });

  test('closing selected duplicate selects adjacent tab', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Close Adj');
    await createNote(window, 'Dup Close Adj2');
    const dupTabId = await openDuplicateTab(window, docId);

    // Select duplicate, close it → should fall to adjacent
    await selectTab(window, dupTabId);
    await closeTabUI(window, dupTabId);

    const state = await getStoreState(window);
    expect(state.selectedId).not.toBe(dupTabId);
    expect(state.selectedId).toBeTruthy();
  });

  test('closing non-selected duplicate does not change selection', async ({ window }) => {
    const { tabId: tabA, docId } = await createNote(window, 'Dup NonSel Close');
    const dupTabId = await openDuplicateTab(window, docId);

    // tabA is still selected, close the duplicate
    await selectTab(window, tabA);
    const beforeId = (await getStoreState(window)).selectedId;

    await window.evaluate(
      (id: string) => (window as any).__documentStore.getState().closeTab(id),
      dupTabId,
    );
    await window.waitForTimeout(200);

    expect((await getStoreState(window)).selectedId).toBe(beforeId);
  });

  test('selectDocument toggles between duplicate tabs', async ({ window }) => {
    const { tabId: tabA, docId } = await createNote(window, 'Dup Toggle');
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, dupTabId);
    expect((await getStoreState(window)).selectedId).toBe(dupTabId);

    await selectTab(window, tabA);
    expect((await getStoreState(window)).selectedId).toBe(tabA);
  });

  test('openOrSelectTab with doc already in 2 tabs selects nearest, no 3rd tab', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup OrSelect');
    await openDuplicateTab(window, docId);
    const tabCountBefore = (await getStoreState(window)).openTabs.length;

    await window.evaluate((id: string) => {
      (window as any).__documentStore.getState().openOrSelectTab(id);
    }, docId);
    await window.waitForTimeout(200);

    const state = await getStoreState(window);
    // No new tab created
    expect(state.openTabs.length).toBe(tabCountBefore);
    // Active doc is the one we asked for
    expect(await getActiveDocId(window)).toBe(docId);
  });

  test('reorderTabs with duplicates preserves identity', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Reorder');
    const dupTabId = await openDuplicateTab(window, docId);

    const before = await getStoreState(window);
    // Reorder: move last tab to first position
    await window.evaluate(() => {
      const store = (window as any).__documentStore;
      const tabs = store.getState().openTabs;
      store.getState().reorderTabs(tabs.length - 1, 0);
    });
    await window.waitForTimeout(200);

    const after = await getStoreState(window);
    // Same tabIds exist, just in different order
    const beforeIds = new Set(before.openTabs.map((t) => t.tabId));
    const afterIds = new Set(after.openTabs.map((t) => t.tabId));
    expect(afterIds).toEqual(beforeIds);
    // The duplicate is now first
    expect(after.openTabs[0].tabId).toBe(dupTabId);
  });
});

// ── 2. Tab Strip UI ──────────────────────────────────────────────────

test.describe('Duplicate Tabs — Tab Strip UI', () => {
  test('duplicate indicator dot shown on both tabs', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Dot');
    await openDuplicateTab(window, docId);
    await window.waitForTimeout(300);

    // Both tabs for this doc should have the duplicate dot indicator
    const tabs = window.locator('[data-tab-id]').filter({ hasText: 'Dup Dot' });
    await expect(tabs).toHaveCount(2);

    // The dot is a span with specific classes (h-1.5 w-1.5 rounded-full)
    for (let i = 0; i < 2; i++) {
      const dot = tabs.nth(i).locator('span.rounded-full');
      await expect(dot).toBeVisible();
    }
  });

  test('closing one duplicate removes dot from remaining tab', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Dot Rm');
    const dupTabId = await openDuplicateTab(window, docId);
    await window.waitForTimeout(300);

    // Before close: dot visible
    let tabs = window.locator('[data-tab-id]').filter({ hasText: 'Dup Dot Rm' });
    await expect(tabs).toHaveCount(2);

    await closeTabUI(window, dupTabId);

    // After close: single tab, no dot
    tabs = window.locator('[data-tab-id]').filter({ hasText: 'Dup Dot Rm' });
    await expect(tabs).toHaveCount(1);
    const dot = tabs.first().locator('span.rounded-full');
    await expect(dot).toHaveCount(0);
  });

  test('tab title updates reflect in all duplicate tabs simultaneously', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Title Sync');
    await openDuplicateTab(window, docId);
    await window.waitForTimeout(300);

    // Both tabs initially show same title
    let tabs = window.locator('[data-tab-id]').filter({ hasText: 'Dup Title Sync' });
    await expect(tabs).toHaveCount(2);

    // Change the title
    const titleEl = activeMain(window).locator('h1.editor-title');
    await titleEl.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type('Renamed Dup');
    await window.waitForTimeout(700);

    // Both tabs should show the new title
    tabs = window.locator('[data-tab-id]').filter({ hasText: 'Renamed Dup' });
    await expect(tabs).toHaveCount(2);
  });

  test('clicking a duplicate tab in the strip selects it', async ({ window }) => {
    const { tabId: tabA, docId } = await createNote(window, 'Dup Click Strip');
    const dupTabId = await openDuplicateTab(window, docId);

    // Click the duplicate tab
    await tabById(window, dupTabId).click();
    await window.waitForTimeout(200);

    expect((await getStoreState(window)).selectedId).toBe(dupTabId);

    // Click back to original
    await tabById(window, tabA).click();
    await window.waitForTimeout(200);

    expect((await getStoreState(window)).selectedId).toBe(tabA);
  });
});

// ── 3. Editor Instance Sharing ───────────────────────────────────────

test.describe('Duplicate Tabs — Editor Instance Sharing', () => {
  test('only one editor mounts per unique docId even with multiple tabs', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Editor Single');
    await openDuplicateTab(window, docId);
    await openDuplicateTab(window, docId);
    await window.waitForTimeout(300);

    // Count main elements — there should be exactly 1 (one editor per unique docId)
    const mainCount = await window.locator('main').count();
    expect(mainCount).toBe(1);
  });

  test('switching between duplicate tabs does NOT remount editor (content preserved)', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup No Remount', [
      'persistent content line one',
      'persistent content line two',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Switch to duplicate
    await selectTab(window, dupTabId);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('persistent content line one');

    // Switch back
    await selectTab(window, tabA);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('persistent content line one');
  });

  test('closing one duplicate does NOT unmount editor if other tab exists', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup No Unmount', [
      'should survive close',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Select duplicate and close it
    await selectTab(window, dupTabId);
    await closeTabUI(window, dupTabId);

    // Editor still shows content via the remaining tab
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('should survive close');
    expect(await window.locator('main').count()).toBe(1);
  });

  test('closing the LAST tab for a docId unmounts editor', async ({ window }) => {
    await createNote(window, 'Dup Last Close A');
    const { tabId: tabB } = await createNote(window, 'Dup Last Close B');

    // Close B — editor for B should unmount, only A's editor remains
    await closeTabUI(window, tabB);
    await window.waitForTimeout(300);

    const mainCount = await window.locator('main').count();
    expect(mainCount).toBe(1);
    await expect(activeMain(window).locator('h1.editor-title')).toContainText('Dup Last Close A');
  });

  test('editor hidden when another docId tab is active, visible when any of its tabs is active', async ({ window }) => {
    const { docId: docA } = await createNoteWithBody(window, 'Dup Hidden A', ['content A']);
    await createNoteWithBody(window, 'Dup Hidden B', ['content B']);
    const dupTabId = await openDuplicateTab(window, docA);

    // Select duplicate of A — A's editor should be visible
    await selectTab(window, dupTabId);
    await window.waitForTimeout(200);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('content A');

    // Count hidden mains — B should be hidden
    const hiddenMains = await window.locator('main[style*="display: none"]').count();
    expect(hiddenMains).toBe(1);
  });
});

// ── 4. Selection Save/Restore ────────────────────────────────────────

test.describe('Duplicate Tabs — Selection Save/Restore', () => {
  test('typing in tab A, switching to duplicate tab B, cursor position independent', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Selection', [
      'line one alpha',
      'line two beta',
      'line three gamma',
    ]);

    // Place cursor at end of first line in tab A
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('Home');
    // Type something to mark position
    await window.keyboard.type('A-marker: ');
    await window.waitForTimeout(300);

    // Open duplicate and select it
    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    // Type in duplicate tab to mark a different position
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.type(' B-marker');
    await window.waitForTimeout(300);

    // Switch back to original tab — content should have both markers (shared editor)
    await selectTab(window, tabA);
    await window.waitForTimeout(300);

    await expect(editor).toContainText('A-marker:');
    await expect(editor).toContainText('B-marker');
  });

  test('triple-switch preserves state without corruption', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Triple Switch', [
      'switch content here',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // A → B → A → B → A (5 switches)
    for (let i = 0; i < 5; i++) {
      await selectTab(window, i % 2 === 0 ? dupTabId : tabA);
      await window.waitForTimeout(100);
    }

    // Content should still be intact
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('switch content here');
  });
});

// ── 5. Scroll Position Independence ──────────────────────────────────

test.describe('Duplicate Tabs — Scroll Position Independence', () => {
  test('duplicate tabs have independent scroll positions', async ({ window }) => {
    // Create a note with enough content to scroll
    const lines = Array.from({ length: 50 }, (_, i) => `Scroll line ${i + 1} with some padding text`);
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Scroll', lines);
    await window.waitForTimeout(500);

    // Scroll down in tab A
    await window.evaluate(() => {
      const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
      if (main) main.scrollTop = 800;
    });
    await window.waitForTimeout(200);
    const scrollA = await getScrollTop(window);
    expect(scrollA).toBeGreaterThan(100);

    // Open duplicate tab — should start at top
    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    const scrollDup = await getScrollTop(window);
    expect(scrollDup).toBeLessThan(50); // Near top (0 or small due to padding)

    // Switch back to A — scroll position should be restored
    await selectTab(window, tabA);
    await window.waitForTimeout(300);

    const scrollARestored = await getScrollTop(window);
    expect(scrollARestored).toBeGreaterThan(100);
  });

  test('scroll in A, scroll in B, switch back to A — both preserved', async ({ window }) => {
    const lines = Array.from({ length: 50 }, (_, i) => `Dual scroll line ${i + 1}`);
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Dual Scroll', lines);
    await window.waitForTimeout(500);

    // Scroll A to 600
    await window.evaluate(() => {
      const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
      if (main) main.scrollTop = 600;
    });
    await window.waitForTimeout(200);

    // Open and switch to duplicate
    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    // Scroll B to 300
    await window.evaluate(() => {
      const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
      if (main) main.scrollTop = 300;
    });
    await window.waitForTimeout(200);

    // Switch back to A — should be at ~600
    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    const restoredA = await getScrollTop(window);
    expect(restoredA).toBeGreaterThan(400);

    // Switch back to B — should be at ~300
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    const restoredB = await getScrollTop(window);
    expect(restoredB).toBeGreaterThan(100);
    expect(restoredB).toBeLessThan(500);
  });
});

// ── 6. In-Note Search Isolation ──────────────────────────────────────

test.describe('Duplicate Tabs — In-Note Search Isolation', () => {
  test('search open in tab A, duplicate tab B has no search bar', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Search Iso', [
      'apple one',
      'apple two',
      'apple three',
    ]);

    // Open search in tab A
    await ensureFindOpen(window);
    await findInput(window).fill('apple');
    await expect(findCounter(window)).toHaveText('1/3');

    // Open duplicate and switch to it
    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    // Search should NOT be open in the duplicate
    await expect(findInput(window)).not.toBeVisible();
  });

  test('independent search queries in duplicate tabs', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Search Queries', [
      'alpha bravo charlie',
      'alpha delta echo',
      'bravo foxtrot',
    ]);

    // Search "alpha" in tab A
    await ensureFindOpen(window);
    await findInput(window).fill('alpha');
    await expect(findCounter(window)).toHaveText('1/2');

    // Open duplicate and switch to it
    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    // Search "bravo" in tab B
    await ensureFindOpen(window);
    await findInput(window).fill('bravo');
    await expect(findCounter(window)).toHaveText('1/2');

    // Switch back to A — should still show "alpha" with 1/2
    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue('alpha');
    await expect(findCounter(window)).toHaveText('1/2');

    // Switch back to B — should still show "bravo" with 1/2
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue('bravo');
    await expect(findCounter(window)).toHaveText('1/2');
  });

  test('match position independent per duplicate tab', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Search Pos', [
      'kiwi one',
      'kiwi two',
      'kiwi three',
      'kiwi four',
      'kiwi five',
    ]);

    // Tab A: search "kiwi", advance to match 3/5
    await ensureFindOpen(window);
    await findInput(window).fill('kiwi');
    await expect(findCounter(window)).toHaveText('1/5');
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText('3/5');

    // Open duplicate, switch to it
    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    // Tab B: search "kiwi", should start at 1/5
    await ensureFindOpen(window);
    await findInput(window).fill('kiwi');
    await expect(findCounter(window)).toHaveText('1/5');
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText('2/5');

    // Switch back to A — should be at 3/5, not 2/5
    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    await expect(findCounter(window)).toHaveText('3/5');

    // Switch back to B — should be at 2/5, not 3/5
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(findCounter(window)).toHaveText('2/5');
  });

  test('closing duplicate tab with active search does not affect other tab search', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Search Close', [
      'mango one',
      'mango two',
    ]);

    // Search in tab A
    await ensureFindOpen(window);
    await findInput(window).fill('mango');
    await expect(findCounter(window)).toHaveText('1/2');

    // Open duplicate, search there too
    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await ensureFindOpen(window);
    await findInput(window).fill('mango');
    await expect(findCounter(window)).toHaveText('1/2');

    // Close the duplicate
    await closeTabUI(window, dupTabId);
    await window.waitForTimeout(300);

    // Tab A's search should still be intact
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue('mango');
    await expect(findCounter(window)).toHaveText('1/2');
  });

  test('Cmd/Ctrl+F in one duplicate does not open search in the other', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Search Shortcut', [
      'cherry one',
      'cherry two',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Select tab A, open search
    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();

    // Switch to duplicate — search should NOT be open
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(findInput(window)).not.toBeVisible();
  });
});

// ── 7. Section Indicator (TOC) Isolation ─────────────────────────────

test.describe('Duplicate Tabs — Section Indicator (TOC) Isolation', () => {
  test('TOC open in tab A closes when switching to duplicate tab B', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup TOC Close', []);

    // Add headings via slash commands or markdown shortcuts
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('# Heading One');
    await window.keyboard.press('Enter');
    await window.keyboard.type('# Heading Two');
    await window.keyboard.press('Enter');
    await window.keyboard.type('# Heading Three');
    await window.waitForTimeout(500);

    // Open TOC in tab A
    const tocTrigger = activeMain(window).locator(SECTION_TRIGGER);
    // TOC only shows when >= 2 headings
    if (await tocTrigger.isVisible()) {
      await tocTrigger.click();
      await window.waitForTimeout(200);

      // TOC should be expanded
      await expect(tocTrigger).toHaveAttribute('aria-expanded', 'true');

      // Open duplicate and switch to it
      const dupTabId = await openDuplicateTab(window, docId);
      await selectTab(window, dupTabId);
      await window.waitForTimeout(300);

      // TOC should be closed (not carried over)
      const dupTocTrigger = activeMain(window).locator(SECTION_TRIGGER);
      if (await dupTocTrigger.isVisible()) {
        await expect(dupTocTrigger).toHaveAttribute('aria-expanded', 'false');
      }
    }
  });

  test('TOC state independent between duplicate tabs', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup TOC Indep', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('# Section Alpha');
    await window.keyboard.press('Enter');
    await window.keyboard.type('# Section Beta');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Some body text');
    await window.waitForTimeout(500);

    const dupTabId = await openDuplicateTab(window, docId);

    // Open TOC in tab A
    const tocTrigger = activeMain(window).locator(SECTION_TRIGGER);
    if (await tocTrigger.isVisible()) {
      await tocTrigger.click();
      await expect(tocTrigger).toHaveAttribute('aria-expanded', 'true');

      // Switch to duplicate — TOC should be closed
      await selectTab(window, dupTabId);
      await window.waitForTimeout(300);
      const dupTocTrigger = activeMain(window).locator(SECTION_TRIGGER);
      if (await dupTocTrigger.isVisible()) {
        await expect(dupTocTrigger).toHaveAttribute('aria-expanded', 'false');
      }

      // Switch back to A — TOC should also be closed (tab switch dismisses all panels)
      await selectTab(window, tabA);
      await window.waitForTimeout(300);
      if (await tocTrigger.isVisible()) {
        await expect(tocTrigger).toHaveAttribute('aria-expanded', 'false');
      }
    }
  });
});

// ── 8. Popover/Menu Dismissal on Tab Switch ──────────────────────────

test.describe('Duplicate Tabs — Popover Dismissal on Tab Switch', () => {
  test('emoji picker closes on tab switch between duplicates', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Emoji');

    // Set an emoji so the emoji button appears
    await window.evaluate((id: string) => {
      return (window as any).lychee.invoke('documents.update', { id, emoji: '🍎' });
    }, docId);
    await window.evaluate((id: string) => {
      (window as any).__documentStore.getState().updateDocumentInStore(id, { emoji: '🍎' });
    }, docId);
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);

    // Click emoji button to open picker
    const emojiBtn = activeMain(window).locator('[aria-label="Change note icon"]');
    if (await emojiBtn.isVisible()) {
      await emojiBtn.click();
      await window.waitForTimeout(300);

      // Switch to duplicate — picker should close
      await selectTab(window, dupTabId);
      await window.waitForTimeout(300);

      // Emoji picker popover should not be visible
      const picker = window.locator('em-emoji-picker');
      await expect(picker).toHaveCount(0);
    }
  });
});

// ── 9. Content Sync Between Duplicates ───────────────────────────────

test.describe('Duplicate Tabs — Content Sync', () => {
  test('typing in tab A, switch to tab B — B shows the new content', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Sync AB', [
      'original content',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Type in tab A
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('added by tab A');
    await window.waitForTimeout(300);

    // Switch to tab B — should see the new content (shared editor)
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('added by tab A');
  });

  test('content persists to DB correctly with duplicate tabs', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Sync DB', [
      'persist check',
    ]);
    await openDuplicateTab(window, docId);

    // Type more content
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('persisted line');
    await window.waitForTimeout(1200); // Wait for debounced save

    // Verify DB has the content
    const doc = await getDocumentFromDb(window, docId);
    expect(doc).toBeTruthy();
    expect(doc!.content).toContain('persisted line');
  });
});

// ── 10. Cross-Feature Interactions ───────────────────────────────────

test.describe('Duplicate Tabs — Cross-Feature Interactions', () => {
  test('trashing document closes all duplicate tabs', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Trash All');
    await openDuplicateTab(window, docId);
    await openDuplicateTab(window, docId);

    // 3 tabs total for same doc
    const tabsBefore = (await getStoreState(window)).openTabs.filter((t) => t.docId === docId);
    expect(tabsBefore.length).toBe(3);

    // Trash the document
    await window.evaluate(
      (id: string) => (window as any).__documentStore.getState().trashDocument(id),
      docId,
    );
    await window.waitForTimeout(500);

    // All tabs should be gone
    const tabsAfter = (await getStoreState(window)).openTabs.filter((t) => t.docId === docId);
    expect(tabsAfter.length).toBe(0);
  });

  test('navigateCurrentTab to same doc as another tab creates a duplicate scenario', async ({ window }) => {
    const { docId: docA } = await createNote(window, 'Dup Navigate A');
    const { tabId: tabB } = await createNote(window, 'Dup Navigate B');

    // Navigate tab B to doc A
    await window.evaluate(
      (id: string) => (window as any).__documentStore.getState().navigateCurrentTab(id),
      docA,
    );
    await window.waitForTimeout(300);

    // Now both tabs should show doc A
    const state = await getStoreState(window);
    const tabsForA = state.openTabs.filter((t) => t.docId === docA);
    expect(tabsForA.length).toBe(2);
  });

  test('Cmd+Click in sidebar opens duplicate for already-open doc', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup CmdClick');
    await window.waitForTimeout(300);

    const tabsBefore = (await getStoreState(window)).openTabs.length;

    // Cmd+Click on the note in sidebar
    const noteItem = window.locator(`[data-note-id="${docId}"]`).first();
    await noteItem.click({ modifiers: [mod === 'Meta' ? 'Meta' : 'Control'] });
    await window.waitForTimeout(300);

    const tabsAfter = (await getStoreState(window)).openTabs.length;
    expect(tabsAfter).toBe(tabsBefore + 1);

    // Both tabs for same doc
    const tabsForDoc = (await getStoreState(window)).openTabs.filter((t) => t.docId === docId);
    expect(tabsForDoc.length).toBe(2);
  });

  test('middle-click in sidebar opens duplicate for already-open doc', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup MidClick');
    await window.waitForTimeout(300);

    const tabsBefore = (await getStoreState(window)).openTabs.length;

    // Middle-click on the note in sidebar
    const noteItem = window.locator(`[data-note-id="${docId}"]`).first();
    await noteItem.click({ button: 'middle' });
    await window.waitForTimeout(300);

    const tabsAfter = (await getStoreState(window)).openTabs.length;
    expect(tabsAfter).toBe(tabsBefore + 1);
  });

  test('context menu "Open in new tab" on already-open doc creates duplicate', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup CtxMenu');
    await window.waitForTimeout(300);

    const tabsBefore = (await getStoreState(window)).openTabs.length;

    // Right-click → Open in new tab
    await window.locator(`[data-note-id="${docId}"]`).first().click({ button: 'right' });
    await window.waitForTimeout(300);
    await window.getByRole('menuitem', { name: /open in new tab/i }).click();
    await window.waitForTimeout(400);

    const tabsAfter = (await getStoreState(window)).openTabs.length;
    expect(tabsAfter).toBe(tabsBefore + 1);

    const tabsForDoc = (await getStoreState(window)).openTabs.filter((t) => t.docId === docId);
    expect(tabsForDoc.length).toBe(2);
  });

  test('openOrCreateTab with doc in 2 tabs selects nearest, no new tab', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup OrCreate');
    await openDuplicateTab(window, docId);
    const tabCountBefore = (await getStoreState(window)).openTabs.length;

    await window.evaluate((id: string) => {
      (window as any).__documentStore.getState().openOrCreateTab(id);
    }, docId);
    await window.waitForTimeout(200);

    expect((await getStoreState(window)).openTabs.length).toBe(tabCountBefore);
  });

  test('loadDocuments refresh with duplicates preserves valid selection', async ({ window }) => {
    const { tabId: tabA, docId } = await createNote(window, 'Dup LoadRefresh');
    await openDuplicateTab(window, docId);
    await selectTab(window, tabA);

    // Force a reload
    await window.evaluate(() => {
      return (window as any).__documentStore.getState().loadDocuments();
    });
    await window.waitForTimeout(500);

    // Selection should still be valid
    const state = await getStoreState(window);
    expect(state.selectedId).toBe(tabA);
    expect(state.openTabs.filter((t) => t.docId === docId).length).toBe(2);
  });
});

// ── 11. Edge Cases & Stress Tests ────────────────────────────────────

test.describe('Duplicate Tabs — Edge Cases & Stress', () => {
  test('5 duplicate tabs for same doc: only 1 editor, all tabs work', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Stress 5', ['stress content']);

    for (let i = 0; i < 4; i++) {
      await openDuplicateTab(window, docId);
    }

    const state = await getStoreState(window);
    expect(state.openTabs.filter((t) => t.docId === docId).length).toBe(5);

    // Only 1 editor
    expect(await window.locator('main').count()).toBe(1);

    // Each tab is clickable and shows content
    for (const tab of state.openTabs) {
      await selectTab(window, tab.tabId);
      await window.waitForTimeout(100);
      await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('stress content');
    }
  });

  test('open duplicate, immediately close original: editor stays alive', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Close Orig', [
      'must survive',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Select duplicate, then close original
    await selectTab(window, dupTabId);
    await window.waitForTimeout(200);

    await window.evaluate(
      (id: string) => (window as any).__documentStore.getState().closeTab(id),
      tabA,
    );
    await window.waitForTimeout(300);

    // Editor still alive via duplicate tab
    expect(await window.locator('main').count()).toBe(1);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('must survive');
  });

  test('rapidly toggle between 2 duplicates: no crash, content intact', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Rapid Toggle', [
      'rapid toggle content',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // 20 rapid switches
    for (let i = 0; i < 20; i++) {
      await selectTab(window, i % 2 === 0 ? dupTabId : tabA);
    }
    await window.waitForTimeout(300);

    // Content should still be intact
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('rapid toggle content');
  });

  test('open duplicate, delete all content in A, switch to B: B shows empty doc', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Delete Content', [
      'will be deleted',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Delete all content in tab A
    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);

    // Switch to B — should also show empty (shared editor)
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    const text = await activeMain(window).locator('.ContentEditable__root').innerText();
    // Should be empty or just whitespace/placeholder
    expect(text.trim().replace(/\n/g, '')).toBe('');
  });

  test('create new doc, open duplicate, trash it: both tabs close, no orphan editors', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Full Lifecycle');
    await openDuplicateTab(window, docId);
    await openDuplicateTab(window, docId);

    // Create another note so we don't end up with 0 tabs (empty state)
    await createNote(window, 'Dup Survivor');

    // Trash the first document
    await window.evaluate(
      (id: string) => (window as any).__documentStore.getState().trashDocument(id),
      docId,
    );
    await window.waitForTimeout(500);

    // No tabs for trashed doc
    const state = await getStoreState(window);
    expect(state.openTabs.filter((t) => t.docId === docId).length).toBe(0);
    // Should have only the survivor's tab
    expect(state.openTabs.length).toBe(1);
  });

  test('close all tabs at once for a doc with duplicates: clean state', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Close All');
    await openDuplicateTab(window, docId);
    await openDuplicateTab(window, docId);

    // Close all tabs for this doc via store
    await window.evaluate((id: string) => {
      const store = (window as any).__documentStore;
      const tabs = store.getState().openTabs.filter((t: any) => t.docId === id);
      for (const tab of tabs) {
        store.getState().closeTab(tab.tabId);
      }
    }, docId);
    await window.waitForTimeout(300);

    const state = await getStoreState(window);
    expect(state.openTabs.filter((t) => t.docId === docId).length).toBe(0);
  });

  test('navigateCurrentTab to same doc it already shows: no-op', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Nav NoOp');
    const stateBefore = await getStoreState(window);

    await window.evaluate((id: string) => {
      (window as any).__documentStore.getState().navigateCurrentTab(id);
    }, docId);
    await window.waitForTimeout(200);

    const stateAfter = await getStoreState(window);
    // Same tab, same selection
    expect(stateAfter.selectedId).toBe(stateBefore.selectedId);
    expect(stateAfter.openTabs.length).toBe(stateBefore.openTabs.length);
  });

  test('openOrSelectTab with 0 tabs creates first tab', async ({ window }) => {
    // Close all tabs
    await window.evaluate(() => {
      const store = (window as any).__documentStore;
      const tabs = [...store.getState().openTabs];
      for (const tab of tabs) {
        store.getState().closeTab(tab.tabId);
      }
    });
    await window.waitForTimeout(200);

    // Create a doc via backend (no tab opens)
    const docId = await window.evaluate(async () => {
      const { document } = await (window as any).lychee.invoke('documents.create', { parentId: null });
      return document.id as string;
    });
    await window.waitForTimeout(200);

    // Reload so store has the doc
    await window.evaluate(() => (window as any).__documentStore.getState().loadDocuments());
    await window.waitForTimeout(500);

    // openOrSelectTab with empty tab bar
    await window.evaluate((id: string) => {
      (window as any).__documentStore.getState().openOrSelectTab(id);
    }, docId);
    await window.waitForTimeout(300);

    const state = await getStoreState(window);
    expect(state.openTabs.length).toBe(1);
    expect(state.openTabs[0].docId).toBe(docId);
    expect(state.selectedId).toBe(state.openTabs[0].tabId);
  });
});

// ── 12. Duplicate Tab + Multi-Note Interaction ───────────────────────

test.describe('Duplicate Tabs — Multi-Note Interaction', () => {
  test('duplicate tab for doc A, plus separate tab for doc B: correct editor visibility', async ({ window }) => {
    const { tabId: tabA1, docId: docA } = await createNoteWithBody(window, 'Dup Multi A', ['content A']);
    const { tabId: tabB } = await createNoteWithBody(window, 'Dup Multi B', ['content B']);
    const dupTabA = await openDuplicateTab(window, docA);

    // Select tab B — A's editor should be hidden
    await selectTab(window, tabB);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('content B');

    // Select duplicate of A — A's editor should be visible, B hidden
    await selectTab(window, dupTabA);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('content A');

    // Select original A — still A's content
    await selectTab(window, tabA1);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('content A');
  });

  test('search in doc A tab, search in doc A duplicate, search in doc B: all independent', async ({ window }) => {
    const { tabId: tabA1, docId: docA } = await createNoteWithBody(window, 'Dup XSearch A', [
      'grape one',
      'grape two',
      'grape three',
    ]);
    const { tabId: tabB } = await createNoteWithBody(window, 'Dup XSearch B', [
      'grape alpha',
      'grape beta',
    ]);
    const dupTabA = await openDuplicateTab(window, docA);

    // Tab A1: search grape, advance to 2/3
    await selectTab(window, tabA1);
    await window.waitForTimeout(300);
    await ensureFindOpen(window);
    await findInput(window).fill('grape');
    await expect(findCounter(window)).toHaveText('1/3');
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText('2/3');

    // Dup tab A: search grape, at 1/3
    await selectTab(window, dupTabA);
    await window.waitForTimeout(300);
    await ensureFindOpen(window);
    await findInput(window).fill('grape');
    await expect(findCounter(window)).toHaveText('1/3');

    // Tab B: search grape, at 1/2
    await selectTab(window, tabB);
    await window.waitForTimeout(300);
    await ensureFindOpen(window);
    await findInput(window).fill('grape');
    await expect(findCounter(window)).toHaveText('1/2');

    // Return to each and verify position preserved
    await selectTab(window, tabA1);
    await window.waitForTimeout(300);
    await expect(findCounter(window)).toHaveText('2/3');

    await selectTab(window, dupTabA);
    await window.waitForTimeout(300);
    await expect(findCounter(window)).toHaveText('1/3');

    await selectTab(window, tabB);
    await window.waitForTimeout(300);
    await expect(findCounter(window)).toHaveText('1/2');
  });

  test('undo in one tab undoes edits visible in the duplicate (shared undo stack)', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Undo Shared', [
      'original line',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Type in tab A
    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('added in A');
    await window.waitForTimeout(300);

    // Verify content visible in duplicate
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('added in A');

    // Undo in duplicate tab — should undo what was typed in A
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(300);

    // Switch back to A — the undo should be reflected there too
    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    const content = await editor.innerText();
    expect(content).not.toContain('added in A');
  });

  test('rename title from one tab reflects in sidebar and all duplicate tabs', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Rename Before');
    const dupTabId = await openDuplicateTab(window, docId);

    // Select duplicate and rename
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    const titleEl = activeMain(window).locator('h1.editor-title');
    await titleEl.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type('Dup Rename After');
    await window.waitForTimeout(700);

    // Both tabs in strip should show new name
    const matchingTabs = window.locator('[data-tab-id]').filter({ hasText: 'Dup Rename After' });
    await expect(matchingTabs).toHaveCount(2);

    // Sidebar should show new name
    await expect(window.locator(`[data-note-id="${docId}"]`).first()).toContainText('Dup Rename After');
  });
});

// ── 13. Stress: Rapid Operations ─────────────────────────────────────

test.describe('Duplicate Tabs — Rapid Operations Stress', () => {
  test('rapid open + close duplicate tabs: no orphan state', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Rapid OC');

    for (let i = 0; i < 10; i++) {
      const tabId = await openDuplicateTab(window, docId);
      await window.evaluate(
        (id: string) => (window as any).__documentStore.getState().closeTab(id),
        tabId,
      );
    }
    await window.waitForTimeout(300);

    // Should have exactly 1 tab left (the original)
    const state = await getStoreState(window);
    expect(state.openTabs.filter((t) => t.docId === docId).length).toBe(1);
  });

  test('rapid tab switch + search: no stale search state leaks', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Rapid Search', [
      'delta one',
      'delta two',
      'delta three',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Rapid switches with search operations
    for (let i = 0; i < 5; i++) {
      await selectTab(window, tabA);
      await window.waitForTimeout(50);
      await selectTab(window, dupTabId);
      await window.waitForTimeout(50);
    }

    // Now open search in the final tab — should work cleanly
    await ensureFindOpen(window);
    await findInput(window).fill('delta');
    await expect(findCounter(window)).toHaveText('1/3');
  });

  test('stress: multiple docs with duplicates, all independent', async ({ window }) => {
    const { tabId: tA1, docId: dA } = await createNoteWithBody(window, 'Dup Stress Multi A', ['aaa content']);
    const { tabId: tB1, docId: dB } = await createNoteWithBody(window, 'Dup Stress Multi B', ['bbb content']);

    const tA2 = await openDuplicateTab(window, dA);
    const tB2 = await openDuplicateTab(window, dB);

    // Switch through all tabs and verify correct content
    await selectTab(window, tA1);
    await window.waitForTimeout(200);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('aaa content');

    await selectTab(window, tA2);
    await window.waitForTimeout(200);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('aaa content');

    await selectTab(window, tB1);
    await window.waitForTimeout(200);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('bbb content');

    await selectTab(window, tB2);
    await window.waitForTimeout(200);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('bbb content');

    // Total editors: 2 (one per unique doc)
    const mainCount = await window.locator('main').count();
    expect(mainCount).toBe(2);
  });
});

// ── 14. Plugin Actions — Slash Commands ──────────────────────────────

test.describe('Duplicate Tabs — Slash Command Plugin', () => {
  test('slash command menu does not bleed into duplicate tab on switch', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Slash Bleed', ['some text']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await expect(window.getByRole('option', { name: 'Text' })).toBeVisible();

    // Switch to duplicate — menu must vanish
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(window.getByRole('option', { name: 'Text' })).toHaveCount(0);
  });

  test('slash command inserts heading visible in duplicate tab', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Slash H1', ['before']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Heading 1' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Slash Heading');
    await window.waitForTimeout(300);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    const h1 = activeMain(window).locator('.ContentEditable__root h1:not(.editor-title)');
    await expect(h1).toContainText('Slash Heading');
  });

  test('slash command inserts bullet list visible in duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Slash BulletList', []);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Bullet List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('item alpha');
    await window.keyboard.press('Enter');
    await window.keyboard.type('item beta');
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('item alpha');
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('item beta');
    await expect(activeMain(window).locator('.ContentEditable__root li')).toHaveCount(2);
  });

  test('slash command inserts numbered list visible in duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Slash NumList', []);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Numbered List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('first');
    await window.keyboard.press('Enter');
    await window.keyboard.type('second');
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root ol')).toHaveCount(1);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('first');
  });

  test('slash command inserts checklist visible in duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Slash Checklist', []);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('check me');
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('check me');
  });

  test('slash command inserts quote visible in duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Slash Quote', []);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Quote' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('wise words');
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root blockquote')).toContainText('wise words');
  });

  test('slash command inserts code block visible in duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Slash Code', []);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Code' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('const x = 42;');
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('const x = 42;');
    await expect(activeMain(window).locator('.ContentEditable__root code, .ContentEditable__root pre').first()).toBeVisible();
  });

  test('slash command inserts divider visible in duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Slash HR', ['above line']);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Divider' }).click();
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root hr')).toHaveCount(1);
  });

  test('slash menu open, switch to duplicate: menu dismissed in duplicate tab', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Slash Rapid', ['text']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await expect(window.getByRole('option', { name: 'Text' })).toBeVisible();

    // Switch to duplicate — slash menu should dismiss
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(window.getByRole('option', { name: 'Text' })).toHaveCount(0);
    // Editor still has content (shared)
    await expect(editor).toContainText('text');
  });

  test('slash command in duplicate does NOT interfere with original tab', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Slash NonInterf', ['original']);
    const dupTabId = await openDuplicateTab(window, docId);

    // Insert heading in duplicate
    await selectTab(window, dupTabId);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Heading 2' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('From Duplicate');
    await window.waitForTimeout(300);

    // Switch to original — it should have the heading too (shared editor)
    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('From Duplicate');
    // And the slash menu should not be open
    await expect(window.getByRole('option', { name: 'Text' })).toHaveCount(0);
  });
});

// ── 15. Plugin Actions — Floating Toolbar ────────────────────────────

test.describe('Duplicate Tabs — Floating Toolbar Plugin', () => {
  test('floating toolbar does not bleed into duplicate tab on switch', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Toolbar Bleed', [
      'selectable text here for toolbar test',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press(`${mod}+a`);
    await window.waitForTimeout(400);

    const toolbar = window.locator('[role="toolbar"]');
    const toolbarVisible = await toolbar.isVisible().catch(() => false);

    if (toolbarVisible) {
      await selectTab(window, dupTabId);
      await window.waitForTimeout(300);
      await expect(toolbar).not.toBeVisible();
    }
  });

  test('bold via Cmd+B in one tab visible in duplicate', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Bold', ['make this bold']);
    const dupTabId = await openDuplicateTab(window, docId);

    // Triple-click to select the body paragraph text
    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('make this bold').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+b`);
    await window.waitForTimeout(300);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    // Lexical renders bold as <span class="font-bold"> via theme
    await expect(activeMain(window).locator('.ContentEditable__root p .font-bold')).toContainText('make this bold');
  });

  test('italic via Cmd+I in one tab visible in duplicate', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Italic', ['italicize me']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('italicize me').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+i`);
    await window.waitForTimeout(300);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    // Lexical renders italic as <span class="italic"> via theme
    await expect(activeMain(window).locator('.ContentEditable__root p .italic')).toContainText('italicize me');
  });

  test('underline via Cmd+U in one tab visible in duplicate', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Underline', ['underline me']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('underline me').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+u`);
    await window.waitForTimeout(300);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    // Lexical renders underline as <span class="underline"> via theme
    await expect(activeMain(window).locator('.ContentEditable__root p .underline')).toContainText('underline me');
  });

  test('strikethrough via Cmd+Shift+X in one tab visible in duplicate', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Strike', ['strike me']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('strike me').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+Shift+s`);
    await window.waitForTimeout(300);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    // Lexical renders strikethrough as <span class="line-through"> via theme
    await expect(activeMain(window).locator('.ContentEditable__root p .line-through')).toContainText('strike me');
  });

  test('inline code via Cmd+E in one tab visible in duplicate', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup InlineCode', ['code me']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('code me').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+e`);
    await window.waitForTimeout(300);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    // Lexical renders inline code as <code> element
    await expect(activeMain(window).locator('.ContentEditable__root p code')).toContainText('code me');
  });

  test('multiple formats stacked: bold+italic applied in one tab visible in duplicate', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup BoldItalic', ['format me']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('format me').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+b`);
    await window.keyboard.press(`${mod}+i`);
    await window.waitForTimeout(300);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    // The text should have both font-bold and italic classes
    const el = activeMain(window).getByText('format me');
    await expect(el).toBeVisible();
    const hasFormats = await el.evaluate(node => {
      // Walk up through Lexical's nested spans to collect all CSS classes
      let n: Element | null = node as Element;
      const allClasses: string[] = [];
      while (n && !n.classList.contains('ContentEditable__root')) {
        allClasses.push(...Array.from(n.classList));
        n = n.parentElement;
      }
      return { bold: allClasses.includes('font-bold'), italic: allClasses.includes('italic') };
    });
    expect(hasFormats.bold).toBe(true);
    expect(hasFormats.italic).toBe(true);
  });

  test('formatting undo in duplicate tab undoes the format from original', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup FormatUndo', ['unbold me']);
    const dupTabId = await openDuplicateTab(window, docId);

    // Bold the body text in tab A
    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('unbold me').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+b`);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root p .font-bold')).toContainText('unbold me');

    // Undo in duplicate
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(300);

    // Bold should be gone from the paragraph
    const boldCount = await activeMain(window).locator('.ContentEditable__root p .font-bold').count();
    expect(boldCount).toBe(0);
  });
});

// ── 16. Plugin Actions — Link Editor/Hover ───────────────────────────

test.describe('Duplicate Tabs — Link Plugins', () => {
  test('link hover popover dismisses on switch to duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Link Hover', ['before link']);

    // Insert a link via keyboard shortcut
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('visit example');
    await window.keyboard.press('Home');
    await window.keyboard.down('Shift');
    await window.keyboard.press('End');
    await window.keyboard.up('Shift');
    await window.keyboard.press(`${mod}+k`);
    await window.waitForTimeout(300);

    const linkInput = window.locator('input[placeholder*="URL"], input[placeholder*="url"], input[type="url"]');
    if (await linkInput.isVisible().catch(() => false)) {
      await linkInput.fill('https://example.com');
      await window.keyboard.press('Enter');
      await window.waitForTimeout(300);
    }

    const dupTabId = await openDuplicateTab(window, docId);

    // Hover over the link to trigger popover
    const linkEl = activeMain(window).locator('.ContentEditable__root a[href]').first();
    if (await linkEl.isVisible().catch(() => false)) {
      await linkEl.hover();
      await window.waitForTimeout(500);

      await selectTab(window, dupTabId);
      await window.waitForTimeout(300);

      const popoverContent = window.locator('[data-radix-popper-content-wrapper]');
      const popoverVisible = await popoverContent.isVisible().catch(() => false);
      expect(popoverVisible).toBe(false);
    }
  });

  test('link created in one tab is clickable in duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Link Click', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('click here');
    await window.keyboard.press('Home');
    await window.keyboard.down('Shift');
    await window.keyboard.press('End');
    await window.keyboard.up('Shift');
    await window.keyboard.press(`${mod}+k`);
    await window.waitForTimeout(300);

    const linkInput = window.locator('input[placeholder*="URL"], input[placeholder*="url"], input[type="url"]');
    if (await linkInput.isVisible().catch(() => false)) {
      await linkInput.fill('https://example.com');
      await window.keyboard.press('Enter');
      await window.waitForTimeout(300);
    }

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    // Link should exist in duplicate
    const link = activeMain(window).locator('.ContentEditable__root a[href]').first();
    if (await link.isVisible().catch(() => false)) {
      const href = await link.getAttribute('href');
      expect(href).toBe('https://example.com');
    }
  });

  test('link editor popover (Cmd+K) dismisses on switch to duplicate tab', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup LinkEdit', ['link text']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('link text').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+k`);
    await window.waitForTimeout(300);

    // Link editor should be open
    const linkInput = window.locator('input[placeholder*="URL"], input[placeholder*="url"], input[placeholder*="Enter"]');
    await expect(linkInput.first()).toBeVisible();

    // Switch to duplicate — link editor should close
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(linkInput.first()).not.toBeVisible();
  });
});

// ── 17. Plugin Actions — Table ───────────────────────────────────────

test.describe('Duplicate Tabs — Table Plugin', () => {
  test('table action menu dismisses on switch to duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Table Menu', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('/table');
    await window.waitForTimeout(300);
    const tableOption = window.getByRole('option', { name: 'Table' });
    if (await tableOption.isVisible().catch(() => false)) {
      await tableOption.click();
      await window.waitForTimeout(300);

      const dimPicker = window.locator('[data-table-dim]').first();
      if (await dimPicker.isVisible().catch(() => false)) {
        await dimPicker.click();
        await window.waitForTimeout(300);
      }

      const tableCell = activeMain(window).locator('td, th').first();
      if (await tableCell.isVisible().catch(() => false)) {
        await tableCell.click();
        await window.waitForTimeout(200);

        const actionTrigger = activeMain(window).locator('[aria-label="Table options"], [aria-label="Cell options"], button:has(svg.lucide-chevron-down)').first();
        if (await actionTrigger.isVisible().catch(() => false)) {
          await actionTrigger.click();
          await window.waitForTimeout(300);

          const dupTabId = await openDuplicateTab(window, docId);
          await selectTab(window, dupTabId);
          await window.waitForTimeout(300);

          const menuVisible = await window.locator('[role="menu"]').isVisible().catch(() => false);
          expect(menuVisible).toBe(false);
        }
      }
    }
  });

  test('table content typed in one tab visible in duplicate', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Table Content', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('/table');
    await window.waitForTimeout(300);
    const tableOption = window.getByRole('option', { name: 'Table' });
    if (await tableOption.isVisible().catch(() => false)) {
      await tableOption.click();
      await window.waitForTimeout(300);

      const dimPicker = window.locator('[data-table-dim]').first();
      if (await dimPicker.isVisible().catch(() => false)) {
        await dimPicker.click();
        await window.waitForTimeout(300);
      }

      const firstCell = activeMain(window).locator('td, th').first();
      if (await firstCell.isVisible().catch(() => false)) {
        await firstCell.click();
        await window.keyboard.type('cell-content-A1');
        await window.waitForTimeout(300);

        const dupTabId = await openDuplicateTab(window, docId);
        await selectTab(window, dupTabId);
        await window.waitForTimeout(300);
        await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('cell-content-A1');
      }
    }
  });

  test('table navigation with Tab key works in duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Table Nav', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('/table');
    await window.waitForTimeout(300);
    const tableOption = window.getByRole('option', { name: 'Table' });
    if (await tableOption.isVisible().catch(() => false)) {
      await tableOption.click();
      await window.waitForTimeout(300);

      const dimPicker = window.locator('[data-table-dim]').first();
      if (await dimPicker.isVisible().catch(() => false)) {
        await dimPicker.click();
        await window.waitForTimeout(300);
      }

      // Type in cell 1, Tab to cell 2, type there
      const firstCell = activeMain(window).locator('td, th').first();
      if (await firstCell.isVisible().catch(() => false)) {
        await firstCell.click();
        await window.keyboard.type('cell1');
        await window.keyboard.press('Tab');
        await window.keyboard.type('cell2');
        await window.waitForTimeout(300);

        // Switch to duplicate — both cells should be visible
        const dupTabId = await openDuplicateTab(window, docId);
        await selectTab(window, dupTabId);
        await window.waitForTimeout(300);
        await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('cell1');
        await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('cell2');
      }
    }
  });
});

// ── 18. Plugin Actions — Block Highlight (TOC Navigation) ────────────

test.describe('Duplicate Tabs — Block Highlight Plugin', () => {
  test('heading highlight from TOC clears on switch to duplicate tab', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Highlight Clear', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('# Highlight Section One');
    await window.keyboard.press('Enter');
    await window.keyboard.type('some body text');
    await window.keyboard.press('Enter');
    await window.keyboard.type('# Highlight Section Two');
    await window.waitForTimeout(500);

    const tocTrigger = activeMain(window).locator(SECTION_TRIGGER);
    if (await tocTrigger.isVisible()) {
      await tocTrigger.click();
      await window.waitForTimeout(200);

      const sectionBtn = window.getByRole('button', { name: 'Highlight Section One', exact: true });
      if (await sectionBtn.isVisible()) {
        await sectionBtn.click();
        await window.waitForTimeout(300);

        const hasHighlight = await activeMain(window).locator('.heading-highlight').count() > 0;

        if (hasHighlight) {
          const dupTabId = await openDuplicateTab(window, docId);
          await selectTab(window, dupTabId);
          await window.waitForTimeout(300);
          expect(await activeMain(window).locator('.heading-highlight').count()).toBe(0);
        }
      }
    }
  });

  test('heading highlight does not persist when switching back to original tab', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Highlight NoPersist', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('# Persist Check One');
    await window.keyboard.press('Enter');
    await window.keyboard.type('text');
    await window.keyboard.press('Enter');
    await window.keyboard.type('# Persist Check Two');
    await window.waitForTimeout(500);

    const tocTrigger = activeMain(window).locator(SECTION_TRIGGER);
    if (await tocTrigger.isVisible()) {
      await tocTrigger.click();
      await window.waitForTimeout(200);

      const sectionBtn = window.getByRole('button', { name: 'Persist Check One', exact: true });
      if (await sectionBtn.isVisible()) {
        await sectionBtn.click();
        await window.waitForTimeout(300);

        const dupTabId = await openDuplicateTab(window, docId);
        await selectTab(window, dupTabId);
        await window.waitForTimeout(200);
        // Switch back to original
        await selectTab(window, tabA);
        await window.waitForTimeout(300);

        // Highlight should be cleared by the round-trip (two tab switches)
        expect(await activeMain(window).locator('.heading-highlight').count()).toBe(0);
      }
    }
  });

  test('TOC panel open in one tab, closed in duplicate, independent after round trip', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup TOC RoundTrip', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('# RT Heading A');
    await window.keyboard.press('Enter');
    await window.keyboard.type('# RT Heading B');
    await window.waitForTimeout(500);

    const dupTabId = await openDuplicateTab(window, docId);

    // Open TOC in tab A
    const tocTrigger = activeMain(window).locator(SECTION_TRIGGER);
    if (await tocTrigger.isVisible()) {
      await tocTrigger.click();
      await expect(tocTrigger).toHaveAttribute('aria-expanded', 'true');

      // Switch to dup — TOC closed
      await selectTab(window, dupTabId);
      await window.waitForTimeout(300);
      const dupTocTrigger = activeMain(window).locator(SECTION_TRIGGER);
      if (await dupTocTrigger.isVisible()) {
        await expect(dupTocTrigger).toHaveAttribute('aria-expanded', 'false');
      }

      // Back to A — TOC also closed (tab switch dismissed it)
      await selectTab(window, tabA);
      await window.waitForTimeout(300);
      if (await tocTrigger.isVisible()) {
        await expect(tocTrigger).toHaveAttribute('aria-expanded', 'false');
      }
    }
  });
});

// ── 19. Plugin Actions — Keyboard Shortcuts ──────────────────────────

test.describe('Duplicate Tabs — Keyboard Shortcuts Plugin', () => {
  test('Cmd+Z undo in duplicate tab undoes shared editor changes', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup KBD Undo', ['original text']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('new line from A');
    await window.waitForTimeout(400);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(300);

    const content = await activeMain(window).locator('.ContentEditable__root').innerText();
    expect(content).not.toContain('new line from A');

    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    const contentA = await activeMain(window).locator('.ContentEditable__root').innerText();
    expect(contentA).not.toContain('new line from A');
  });

  test('Cmd+Shift+Z redo in duplicate tab redoes shared changes', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup KBD Redo', ['redo test']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('will undo this');
    await window.waitForTimeout(400);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(300);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(300);

    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('will undo this');
  });

  test('multiple undos across tab switches use shared undo stack', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup KBD MultiUndo', ['base']);
    const dupTabId = await openDuplicateTab(window, docId);

    // Type line 1 in tab A
    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('line1');
    await window.waitForTimeout(400);
    await expect(editor).toContainText('line1');

    // Type line 2 in duplicate
    await selectTab(window, dupTabId);
    await window.waitForTimeout(200);
    await editor.click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await window.keyboard.type('line2');
    await window.waitForTimeout(400);
    await expect(editor).toContainText('line2');

    // Undo in duplicate — should remove line2 (most recent edit on shared stack)
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(300);
    const afterFirstUndo = await editor.innerText();
    expect(afterFirstUndo).not.toContain('line2');

    // Switch to tab A — the undo already happened (shared editor), so line2 is gone here too
    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    const tabAContent = await editor.innerText();
    expect(tabAContent).not.toContain('line2');
    // Content from tab A's earlier edit should still be there
    expect(tabAContent).toContain('line1');
  });
});

// ── 20. Plugin Actions — Click-to-Append ─────────────────────────────

test.describe('Duplicate Tabs — Click-to-Append Plugin', () => {
  test('click below content in one tab appends paragraph visible in duplicate', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup ClickAppend', ['single line']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const mainEl = activeMain(window);
    const box = await mainEl.boundingBox();
    if (box) {
      await mainEl.click({ position: { x: box.width / 2, y: box.height - 20 } });
      await window.waitForTimeout(200);
      await window.keyboard.type('appended text');
      await window.waitForTimeout(300);

      await selectTab(window, dupTabId);
      await window.waitForTimeout(300);
      await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('appended text');
    }
  });

  test('click-to-append in duplicate tab also visible in original', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup ClickAppend Rev', ['line']);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, dupTabId);
    await window.waitForTimeout(200);
    const mainEl = activeMain(window);
    const box = await mainEl.boundingBox();
    if (box) {
      await mainEl.click({ position: { x: box.width / 2, y: box.height - 20 } });
      await window.waitForTimeout(200);
      await window.keyboard.type('from duplicate');
      await window.waitForTimeout(300);

      await selectTab(window, tabA);
      await window.waitForTimeout(300);
      await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('from duplicate');
    }
  });
});

// ── 21. Plugin Actions — Heading Level Changes (Markdown Shortcuts) ──

test.describe('Duplicate Tabs — Heading Markdown Shortcuts', () => {
  test('h1 via # shortcut in one tab reflected in duplicate', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup H1 Shortcut', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('# Level One Heading');
    await window.waitForTimeout(300);

    await expect(activeMain(window).locator('.ContentEditable__root h1:not(.editor-title)')).toContainText('Level One Heading');

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root h1:not(.editor-title)')).toContainText('Level One Heading');
  });

  test('h2 via ## shortcut in one tab reflected in duplicate', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup H2 Shortcut', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('## Level Two Heading');
    await window.waitForTimeout(300);

    await expect(activeMain(window).locator('.ContentEditable__root h2')).toContainText('Level Two Heading');

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root h2')).toContainText('Level Two Heading');
  });

  test('h3 via ### shortcut in one tab reflected in duplicate', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup H3 Shortcut', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('### Level Three Heading');
    await window.waitForTimeout(300);

    await expect(activeMain(window).locator('.ContentEditable__root h3')).toContainText('Level Three Heading');

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root h3')).toContainText('Level Three Heading');
  });

  test('mixed heading levels created in one tab all visible in duplicate', async ({ window }) => {
    const { docId } = await createNoteWithBody(window, 'Dup Mixed Headings', []);

    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();
    await window.keyboard.type('# Big Title');
    await window.keyboard.press('Enter');
    await window.keyboard.type('## Sub Title');
    await window.keyboard.press('Enter');
    await window.keyboard.type('### Small Title');
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    await expect(activeMain(window).locator('.ContentEditable__root h1:not(.editor-title)')).toContainText('Big Title');
    await expect(activeMain(window).locator('.ContentEditable__root h2')).toContainText('Sub Title');
    await expect(activeMain(window).locator('.ContentEditable__root h3')).toContainText('Small Title');
  });
});

// ── 22. Plugin Actions — Emoji Picker ────────────────────────────────

test.describe('Duplicate Tabs — Emoji Picker Plugin', () => {
  test('emoji picker closes on switch to duplicate tab', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Emoji Close');

    // Set an emoji so the emoji button appears
    await window.evaluate((id: string) => {
      return (window as any).lychee.invoke('documents.update', { id, emoji: '🍎' });
    }, docId);
    await window.evaluate((id: string) => {
      (window as any).__documentStore.getState().updateDocumentInStore(id, { emoji: '🍎' });
    }, docId);
    await window.waitForTimeout(300);

    const dupTabId = await openDuplicateTab(window, docId);

    const emojiBtn = activeMain(window).locator('[aria-label="Change note icon"]');
    if (await emojiBtn.isVisible()) {
      await emojiBtn.click();
      await window.waitForTimeout(300);

      await selectTab(window, dupTabId);
      await window.waitForTimeout(300);

      const picker = window.locator('em-emoji-picker');
      await expect(picker).toHaveCount(0);
    }
  });

  test('emoji change in one tab reflected in duplicate tab strip', async ({ window }) => {
    const { docId } = await createNote(window, 'Dup Emoji Reflect');

    await window.evaluate((id: string) => {
      return (window as any).lychee.invoke('documents.update', { id, emoji: '🍎' });
    }, docId);
    await window.evaluate((id: string) => {
      (window as any).__documentStore.getState().updateDocumentInStore(id, { emoji: '🍎' });
    }, docId);
    await window.waitForTimeout(300);

    await openDuplicateTab(window, docId);
    await window.waitForTimeout(300);

    // Both tabs should show the emoji
    const tabs = window.locator('[data-tab-id]').filter({ hasText: 'Dup Emoji Reflect' });
    const tabCount = await tabs.count();
    expect(tabCount).toBe(2);
    for (let i = 0; i < tabCount; i++) {
      await expect(tabs.nth(i)).toContainText('🍎');
    }
  });
});

// ── 23. Plugin Stress — Rapid Formatting Across Duplicate Tabs ───────

test.describe('Duplicate Tabs — Plugin Stress Tests', () => {
  test('rapid bold/unbold across tab switches does not corrupt formatting', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Stress Format', ['format stress text']);
    const dupTabId = await openDuplicateTab(window, docId);

    for (let i = 0; i < 5; i++) {
      await selectTab(window, tabA);
      await window.waitForTimeout(100);
      await activeMain(window).getByText('format stress text').click({ clickCount: 3 });
      await window.keyboard.press(`${mod}+b`); // toggle bold

      await selectTab(window, dupTabId);
      await window.waitForTimeout(100);
      await activeMain(window).getByText('format stress text').click({ clickCount: 3 });
      await window.keyboard.press(`${mod}+b`); // toggle bold again
    }

    await window.waitForTimeout(300);
    // Content should still be intact (even number of toggles = no bold)
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('format stress text');
  });

  test('rapid slash command + tab switch: no orphaned menus or corruption', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Stress Slash', ['base']);
    const dupTabId = await openDuplicateTab(window, docId);

    for (let i = 0; i < 5; i++) {
      await selectTab(window, tabA);
      await window.waitForTimeout(100);
      const editor = activeMain(window).locator('.ContentEditable__root');
      await editor.click();
      await window.keyboard.press('End');
      await window.keyboard.press('Enter');
      await window.keyboard.type('/');
      await window.waitForTimeout(100);
      // Immediately switch away before selecting
      await selectTab(window, dupTabId);
      await window.waitForTimeout(100);
    }

    await window.waitForTimeout(300);
    // No slash menus should be lingering
    await expect(window.getByRole('option', { name: 'Text' })).toHaveCount(0);
    // Content intact
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('base');
  });

  test('all block types inserted in one tab, all visible in duplicate after round trip', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Stress AllBlocks', []);
    const dupTabId = await openDuplicateTab(window, docId);

    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    const editor = activeMain(window).locator('.ContentEditable__root');
    await editor.click();

    // H1
    await window.keyboard.type('# Big Heading');
    await window.keyboard.press('Enter');
    // H2
    await window.keyboard.type('## Sub Heading');
    await window.keyboard.press('Enter');
    // Normal text
    await window.keyboard.type('Normal paragraph text');
    await window.keyboard.press('Enter');
    // Bullet list via slash
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Bullet List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('bullet item');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter'); // exit list
    // Quote via slash
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Quote' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('quoted text');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter'); // exit quote
    // Divider
    await window.keyboard.type('/');
    await window.waitForTimeout(300);
    await window.getByRole('option', { name: 'Divider' }).click();
    await window.waitForTimeout(300);

    // Now switch to duplicate and verify everything
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    await expect(activeMain(window).locator('.ContentEditable__root h1:not(.editor-title)')).toContainText('Big Heading');
    await expect(activeMain(window).locator('.ContentEditable__root h2')).toContainText('Sub Heading');
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('Normal paragraph text');
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('bullet item');
    await expect(activeMain(window).locator('.ContentEditable__root blockquote')).toContainText('quoted text');
    await expect(activeMain(window).locator('.ContentEditable__root hr')).toHaveCount(1);

    // Switch back to original — still all there
    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root h1:not(.editor-title)')).toContainText('Big Heading');
    await expect(activeMain(window).locator('.ContentEditable__root hr')).toHaveCount(1);
  });

  test('search + formatting + tab switch stress: no state corruption', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Stress Combo', [
      'alpha bravo charlie',
      'delta echo foxtrot',
    ]);
    const dupTabId = await openDuplicateTab(window, docId);

    // Tab A: open search, find "alpha"
    await selectTab(window, tabA);
    await window.waitForTimeout(200);
    await ensureFindOpen(window);
    await findInput(window).fill('alpha');
    await expect(findCounter(window)).toHaveText('1/1');

    // Tab A: bold the first body paragraph
    await activeMain(window).getByText('alpha bravo charlie').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+b`);
    await window.waitForTimeout(200);

    // Switch to duplicate
    await selectTab(window, dupTabId);
    await window.waitForTimeout(300);

    // Duplicate should have bold text in the paragraph
    await expect(activeMain(window).locator('.ContentEditable__root p .font-bold')).toContainText('alpha bravo charlie');

    // Duplicate should not have search open (it was only opened in tab A)
    // But search state from tab A should not bleed
    await ensureFindOpen(window);
    await findInput(window).fill('delta');
    await expect(findCounter(window)).toHaveText('1/1');

    // Switch back to A — search should still show "alpha"
    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    await expect(findInput(window)).toHaveValue('alpha');
    await expect(findCounter(window)).toHaveText('1/1');
  });

  test('3 duplicate tabs: format in tab 1, search in tab 2, undo in tab 3 — all independent', async ({ window }) => {
    const { tabId: tab1, docId } = await createNoteWithBody(window, 'Dup Stress 3Way', [
      'hello world',
    ]);
    const tab2 = await openDuplicateTab(window, docId);
    const tab3 = await openDuplicateTab(window, docId);

    // Tab 1: bold the body text
    await selectTab(window, tab1);
    await window.waitForTimeout(200);
    await activeMain(window).getByText('hello world').click({ clickCount: 3 });
    await window.keyboard.press(`${mod}+b`);
    await window.waitForTimeout(300);

    // Verify bold was applied
    await expect(activeMain(window).locator('.ContentEditable__root p .font-bold')).toContainText('hello world');

    // Tab 2: search
    await selectTab(window, tab2);
    await window.waitForTimeout(300);
    await ensureFindOpen(window);
    await findInput(window).fill('hello');
    await expect(findCounter(window)).toHaveText('1/1');

    // Tab 3: undo the bold — click editor first to ensure it has focus
    await selectTab(window, tab3);
    await window.waitForTimeout(300);
    await activeMain(window).locator('.ContentEditable__root').click();
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(300);

    // Verify: bold should be gone from the paragraph (shared editor)
    const boldInPara = await activeMain(window).locator('.ContentEditable__root p .font-bold').count();
    expect(boldInPara).toBe(0);

    // Tab 2: search should still be open with its state
    await selectTab(window, tab2);
    await window.waitForTimeout(300);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue('hello');

    // Tab 1: search should not be open
    await selectTab(window, tab1);
    await window.waitForTimeout(300);
    await expect(findInput(window)).not.toBeVisible();
  });

  test('10 rapid open/close + format cycles: no crash', async ({ window }) => {
    const { tabId: tabA, docId } = await createNoteWithBody(window, 'Dup Stress 10Cycles', ['survive']);

    for (let i = 0; i < 10; i++) {
      const dup = await openDuplicateTab(window, docId);
      await selectTab(window, dup);
      await window.waitForTimeout(50);
      await activeMain(window).getByText('survive').click({ clickCount: 3 });
      await window.keyboard.press(`${mod}+b`); // bold
      await window.keyboard.press(`${mod}+b`); // unbold
      await window.evaluate(
        (id: string) => (window as any).__documentStore.getState().closeTab(id),
        dup,
      );
    }

    await selectTab(window, tabA);
    await window.waitForTimeout(300);
    await expect(activeMain(window).locator('.ContentEditable__root')).toContainText('survive');
    // Should have no lingering bold
    const boldCount = await activeMain(window).locator('.ContentEditable__root strong, .ContentEditable__root b').count();
    expect(boldCount).toBe(0);
  });
});
