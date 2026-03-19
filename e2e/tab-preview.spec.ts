/**
 * E2E tests for tab hover preview feature.
 *
 * The preview popup appears when hovering over an inactive tab for 500ms.
 * It shows the note title (with emoji fallback) and a read-only preview
 * of the content. Empty notes show "Empty page" placeholder.
 *
 * Coverage:
 *   1.  Basic show/hide behavior
 *   2.  Active tab exclusion
 *   3.  Empty state variations (blank, title-only, body-only)
 *   4.  Content accuracy
 *   5.  Interaction with tab switching (click & store)
 *   6.  Interaction with tab close
 *   7.  Interaction with drag & drop
 *   8.  Rapid hover / timer cancellation
 *   9.  Multi-tab edge cases
 *   10. Content updates
 *   11. Special content (emoji, long title)
 *   12. Duplicate tabs
 *   13. Stress tests
 */

import { test, expect } from './electron-app';
import type { Page } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a note with title and body content. Returns { tabId, docId }. */
async function createNoteWithBody(window: Page, title: string, bodyLines: string[]) {
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

/** Create a note with only a title (no body). Returns { tabId, docId }. */
async function createNoteWithTitle(window: Page, title: string) {
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

/** Create a completely blank note (no title, no body). Returns tabId. */
async function createBlankNote(window: Page): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    return store.getState().selectedId as string;
  });
}

/** Select a tab via the Zustand store. */
async function selectTab(window: Page, tabId: string) {
  await window.evaluate(
    (id: string) => (window as any).__documentStore.getState().selectDocument(id),
    tabId,
  );
  await window.waitForTimeout(200);
}

/** Open a duplicate tab for the given docId via the store. Returns the new tabId. */
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

/** Get the tab element by tabId. */
function tabEl(window: Page, tabId: string) {
  return window.locator(`[data-tab-id="${tabId}"]`);
}

/** The preview popup selector — portal appended to body. */
const PREVIEW_SELECTOR = 'body > .fixed.z-\\[9999\\]';

/** Hover over a tab's center and wait for the preview to appear. */
async function hoverTabAndWait(window: Page, tabId: string) {
  const tab = tabEl(window, tabId);
  await tab.scrollIntoViewIfNeeded();
  await window.waitForTimeout(100);
  const box = await tab.boundingBox();
  if (!box) throw new Error(`Tab ${tabId} not found`);
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Wait beyond the 500ms delay + buffer
  await window.waitForTimeout(700);
}

/** Hover briefly (under the 500ms threshold). */
async function hoverTabBriefly(window: Page, tabId: string, ms = 200) {
  const tab = tabEl(window, tabId);
  const box = await tab.boundingBox();
  if (!box) throw new Error(`Tab ${tabId} not found`);
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.waitForTimeout(ms);
}

/** Move mouse away from all tabs. */
async function moveMouseAway(window: Page) {
  await window.mouse.move(0, 300);
  await window.waitForTimeout(100);
}

/** Get the preview popup locator. */
function previewPopup(window: Page) {
  return window.locator(PREVIEW_SELECTOR);
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Tab Preview', () => {

  // ── 1. Basic show/hide ─────────────────────────────────────────────

  test('hovering inactive tab shows preview after delay', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Preview A', ['Hello from note A']);
    await createNoteWithBody(window, 'Preview B', ['Hello from note B']);

    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();
  });

  test('preview disappears when mouse leaves tab', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Leave A', ['Content A']);
    await createNoteWithBody(window, 'Leave B', ['Content B']);

    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    await moveMouseAway(window);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('preview does not appear if hover is shorter than delay', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Quick A', ['Content']);
    await createNoteWithBody(window, 'Quick B', ['Content']);

    await hoverTabBriefly(window, noteA.tabId, 200);
    await moveMouseAway(window);

    await window.waitForTimeout(400);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('preview appears exactly after the 500ms threshold', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Threshold A', ['Content']);
    await createNoteWithBody(window, 'Threshold B', ['Content']);

    // Hover but check at 400ms — should NOT be visible yet
    await hoverTabBriefly(window, noteA.tabId, 400);
    await expect(previewPopup(window)).toHaveCount(0);

    // Wait another 300ms (total ~700ms) — should now be visible
    await window.waitForTimeout(300);
    await expect(previewPopup(window)).toBeVisible();
  });

  // ── 2. Active tab exclusion ────────────────────────────────────────

  test('hovering active tab does NOT show preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Active A', ['Content']);
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('hovering active tab with multiple tabs does NOT show preview', async ({ window }) => {
    await createNoteWithBody(window, 'Multi A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Multi B', ['Content B']);

    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('single tab (always active) never shows preview', async ({ window }) => {
    await createNoteWithBody(window, 'Solo', ['Solo content']);

    const tabs = window.locator('[data-tab-id]');
    await expect(tabs).toHaveCount(1);

    const tabId = await tabs.first().getAttribute('data-tab-id');
    await hoverTabAndWait(window, tabId!);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  // ── 3. Empty state variations ──────────────────────────────────────

  test('blank note (no title, no body) shows "Empty page" placeholder', async ({ window }) => {
    const blankTabId = await createBlankNote(window);
    await createNoteWithBody(window, 'Other Note', ['Has content']);

    await hoverTabAndWait(window, blankTabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('📄');
    await expect(popup).toContainText('New Page');
    await expect(popup).toContainText('Empty page');
  });

  test('title-only note (no body) shows title without "Empty page"', async ({ window }) => {
    const noteA = await createNoteWithTitle(window, 'Title Only Note');
    await createNoteWithBody(window, 'Other', ['Has body']);

    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Title Only Note');
    // Should NOT show "Empty page" — it has a title
    const text = await popup.textContent();
    expect(text).not.toContain('Empty page');
  });

  test('body-only note (no title) shows content preview with "New Page" title', async ({ window }) => {
    // Create a note, type body but leave title as default
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    const titleEl = window.locator('main:visible h1.editor-title');
    await titleEl.click();
    await window.keyboard.press('Enter'); // skip title, go to body
    await window.keyboard.type('Body without title');
    await window.waitForTimeout(700);

    const bodyTabId = await window.evaluate(() => {
      const store = (window as any).__documentStore;
      return store.getState().selectedId as string;
    });

    await createNoteWithBody(window, 'Other', ['stuff']);

    await hoverTabAndWait(window, bodyTabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('New Page');
    await expect(popup).toContainText('Body without title');
  });

  test('preview uses default 📄 emoji when note has no custom emoji', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'No Emoji', ['Content']);
    await createNoteWithBody(window, 'Other', ['Stuff']);

    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toContainText('📄');
  });

  test('blank note with custom emoji shows emoji instead of 📄', async ({ window }) => {
    const blankTabId = await createBlankNote(window);
    // Set emoji on the blank note
    const docId = await window.evaluate((tabId: string) => {
      const store = (window as any).__documentStore;
      const tab = store.getState().openTabs.find((t: any) => t.tabId === tabId);
      return tab?.docId as string;
    }, blankTabId);
    await window.evaluate((id: string) => {
      const store = (window as any).__documentStore;
      store.getState().updateDocumentInStore(id, { emoji: '🔥' });
    }, docId);
    await window.waitForTimeout(200);

    await createNoteWithBody(window, 'Other', ['Content']);

    await hoverTabAndWait(window, blankTabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('🔥');
    await expect(popup).toContainText('New Page');
    await expect(popup).toContainText('Empty page');
  });

  test('multiple blank notes each show their own preview correctly', async ({ window }) => {
    const blank1 = await createBlankNote(window);
    const blank2 = await createBlankNote(window);
    await createNoteWithBody(window, 'Active', ['Content']);

    // Hover first blank
    await hoverTabAndWait(window, blank1);
    let popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Empty page');

    await moveMouseAway(window);
    await window.waitForTimeout(200);

    // Hover second blank — should also show preview
    await hoverTabAndWait(window, blank2);
    popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Empty page');
  });

  test('blank note transitions to title-only preview after adding title', async ({ window }) => {
    const blankTabId = await createBlankNote(window);
    await createNoteWithBody(window, 'Other', ['Content']);

    // First verify it shows "Empty page"
    await hoverTabAndWait(window, blankTabId);
    await expect(previewPopup(window)).toContainText('Empty page');
    await moveMouseAway(window);
    await window.waitForTimeout(200);

    // Now add a title to the blank note
    await selectTab(window, blankTabId);
    await window.waitForTimeout(200);
    const titleEl = window.locator('main:visible h1.editor-title');
    await titleEl.click();
    await window.keyboard.type('Now Has Title');
    await window.waitForTimeout(700);

    // Switch away and hover again
    const otherTabId = await window.evaluate((blankId: string) => {
      const store = (window as any).__documentStore;
      const other = store.getState().openTabs.find((t: any) => t.tabId !== blankId);
      return other?.tabId as string;
    }, blankTabId);
    await selectTab(window, otherTabId);

    await hoverTabAndWait(window, blankTabId);
    const popup = previewPopup(window);
    await expect(popup).toContainText('Now Has Title');
    const text = await popup.textContent();
    expect(text).not.toContain('Empty page');
  });

  test('blank note transitions to full preview after adding body', async ({ window }) => {
    const blankTabId = await createBlankNote(window);
    await createNoteWithBody(window, 'Other', ['Content']);

    // Verify blank state first
    await hoverTabAndWait(window, blankTabId);
    await expect(previewPopup(window)).toContainText('Empty page');
    await moveMouseAway(window);
    await window.waitForTimeout(200);

    // Add body content to the blank note
    await selectTab(window, blankTabId);
    await window.waitForTimeout(200);
    const titleEl = window.locator('main:visible h1.editor-title');
    await titleEl.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('Now has body content');
    await window.waitForTimeout(1000);

    // Switch away and hover again
    const otherTabId = await window.evaluate((blankId: string) => {
      const store = (window as any).__documentStore;
      const other = store.getState().openTabs.find((t: any) => t.tabId !== blankId);
      return other?.tabId as string;
    }, blankTabId);
    await selectTab(window, otherTabId);

    await hoverTabAndWait(window, blankTabId);
    const popup = previewPopup(window);
    await expect(popup).toContainText('Now has body content');
    const text = await popup.textContent();
    expect(text).not.toContain('Empty page');
  });

  test('title-only note has same height preview as note with content', async ({ window }) => {
    const titleOnly = await createNoteWithTitle(window, 'Just Title');
    const withBody = await createNoteWithBody(window, 'Has Body', ['Some content here']);
    await createNoteWithBody(window, 'Active', ['Active stuff']);

    // Measure title-only preview height
    await hoverTabAndWait(window, titleOnly.tabId);
    const popup1 = previewPopup(window);
    await expect(popup1).toBeVisible();
    const box1 = await popup1.boundingBox();

    await moveMouseAway(window);
    await window.waitForTimeout(200);

    // Measure content preview height
    await hoverTabAndWait(window, withBody.tabId);
    const popup2 = previewPopup(window);
    await expect(popup2).toBeVisible();
    const box2 = await popup2.boundingBox();

    // The content area is fixed at 140px, so total heights should be equal
    expect(box1!.height).toBe(box2!.height);
  });

  // ── 4. Content accuracy ────────────────────────────────────────────

  test('preview shows the correct note title', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Unique Title XYZ', ['Some body text']);
    await createNoteWithBody(window, 'Other Note', ['Other body']);

    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Unique Title XYZ');
  });

  test('preview shows body content from the note', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Content Check', [
      'First paragraph of content',
      'Second paragraph here',
    ]);
    await createNoteWithBody(window, 'Other', ['Other stuff']);

    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toContainText('First paragraph of content');
  });

  test('preview shows custom emoji instead of default', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Emoji Note', ['Has an emoji']);
    await window.evaluate((docId: string) => {
      const store = (window as any).__documentStore;
      store.getState().updateDocumentInStore(docId, { emoji: '🍒' });
    }, noteA.docId);
    await window.waitForTimeout(200);

    await createNoteWithBody(window, 'Other', ['Other body']);

    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('🍒');
    await expect(popup).toContainText('Emoji Note');
  });

  test('preview truncates long title', async ({ window }) => {
    const longTitle = 'This is a very long note title that should be truncated in the preview popup';
    const noteA = await createNoteWithBody(window, longTitle, ['Some body']);
    await createNoteWithBody(window, 'Short', ['Body']);

    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('This is a very long');
  });

  // ── 5. Interaction with tab switching ──────────────────────────────

  test('clicking tab to activate it dismisses preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Click A', ['Content A']);
    await createNoteWithBody(window, 'Click B', ['Content B']);

    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    await tabEl(window, noteA.tabId).click();
    await window.waitForTimeout(300);

    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('switching tabs via store dismisses preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Store A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Store B', ['Content B']);

    await selectTab(window, noteA.tabId);
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();

    await selectTab(window, noteB.tabId);
    await window.waitForTimeout(200);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('switching away and back keeps preview working', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Back A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Back B', ['Content B']);

    // Show preview on A, dismiss it
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await moveMouseAway(window);
    await expect(previewPopup(window)).toHaveCount(0);

    // Switch to A, then hover B
    await selectTab(window, noteA.tabId);
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('Back B');
  });

  // ── 6. Interaction with tab close ──────────────────────────────────

  test('closing a tab removes its preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Close A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Close B', ['Content B']);

    await selectTab(window, noteA.tabId);
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();

    const closeBtn = tabEl(window, noteB.tabId).locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });
    await window.waitForTimeout(300);

    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('closing a different tab dismisses preview because mouse moves away', async ({ window }) => {
    // Clicking the close button on another tab moves the mouse off the
    // hovered tab, triggering mouseLeave and dismissing the preview.
    const noteA = await createNoteWithBody(window, 'Keep A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Keep B', ['Content B']);
    await createNoteWithBody(window, 'Keep C', ['Content C']);

    // C is active. Hover A to show preview.
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Close B — mouse moves to B's close button, leaving A
    const closeBtn = tabEl(window, noteB.tabId).locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });
    await window.waitForTimeout(300);

    await expect(previewPopup(window)).toHaveCount(0);

    // But re-hovering A still works
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('Keep A');
  });

  // ── 7. Drag interaction ────────────────────────────────────────────

  test('starting a drag dismisses any visible preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Drag A', ['Content A']);
    await createNoteWithBody(window, 'Drag B', ['Content B']);
    await createNoteWithBody(window, 'Drag C', ['Content C']);

    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    const tabBox = await tabEl(window, noteA.tabId).boundingBox();
    if (!tabBox) throw new Error('Tab not found');
    await window.mouse.down();
    await window.mouse.move(tabBox.x + tabBox.width / 2 + 20, tabBox.y + tabBox.height / 2);
    await window.waitForTimeout(200);

    await expect(previewPopup(window)).toHaveCount(0);

    await window.mouse.up();
  });

  test('preview reappears after drag ends if cursor still over tab', async ({ window }) => {
    await createNoteWithBody(window, 'DragEnd A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'DragEnd B', ['Content B']);
    await createNoteWithBody(window, 'DragEnd C', ['Content C']);

    // Start a drag on B (inactive), then drop it in the same place
    const tabBox = await tabEl(window, noteB.tabId).boundingBox();
    if (!tabBox) throw new Error('Tab not found');
    await window.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(tabBox.x + tabBox.width / 2 + 10, tabBox.y + tabBox.height / 2);
    await window.waitForTimeout(100);
    // Drop back
    await window.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await window.mouse.up();

    // Wait for preview timer to fire again (500ms + buffer)
    await window.waitForTimeout(800);
    // The tab should still be inactive (C was active) so preview should reappear
    await expect(previewPopup(window)).toBeVisible();
  });

  // ── 8. Rapid hover / timer cancellation ────────────────────────────

  test('rapidly hovering across multiple tabs does not leave stale previews', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Rapid A', ['A content']);
    const noteB = await createNoteWithBody(window, 'Rapid B', ['B content']);
    await createNoteWithBody(window, 'Rapid C', ['C content']);

    // Rapidly hover A → B → A → B (all under 500ms each)
    for (let i = 0; i < 4; i++) {
      const target = i % 2 === 0 ? noteA : noteB;
      await hoverTabBriefly(window, target.tabId, 100);
    }

    await moveMouseAway(window);
    await window.waitForTimeout(600);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('hovering one tab then quickly moving to another shows only the second preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Switch A', ['A body']);
    const noteB = await createNoteWithBody(window, 'Switch B', ['B body']);
    await createNoteWithBody(window, 'Switch C', ['C body']);

    await hoverTabBriefly(window, noteA.tabId, 200);
    await hoverTabAndWait(window, noteB.tabId);

    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Switch B');
    // Verify A's content is NOT shown
    const text = await popup.textContent();
    expect(text).not.toContain('Switch A');
  });

  test('hovering then moving to active tab cancels preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Cancel A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Cancel B', ['Content B']);

    // Start hovering A (inactive)
    await hoverTabBriefly(window, noteA.tabId, 200);

    // Move to B (active) before preview fires
    await hoverTabBriefly(window, noteB.tabId, 600);

    await expect(previewPopup(window)).toHaveCount(0);
  });

  // ── 9. Multi-tab edge cases ────────────────────────────────────────

  test('only one preview visible at a time', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'One A', ['A content']);
    await createNoteWithBody(window, 'One B', ['B content']);

    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toHaveCount(1);
  });

  test('preview works after closing and reopening a tab', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Reopen A', ['Content A']);
    await createNoteWithBody(window, 'Reopen B', ['Content B']);

    // Close A
    const closeBtn = tabEl(window, noteA.tabId).locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });
    await window.waitForTimeout(300);

    // Reopen A via store
    const newTabIdA = await window.evaluate((docId: string) => {
      const store = (window as any).__documentStore;
      const before = new Set(store.getState().openTabs.map((t: any) => t.tabId));
      store.getState().openTab(docId);
      const after = store.getState().openTabs;
      const newTab = after.find((t: any) => !before.has(t.tabId) && t.docId === docId);
      return newTab?.tabId as string;
    }, noteA.docId);
    await window.waitForTimeout(400);

    // Make B active so A is inactive
    const tabIdB = await window.evaluate((docIdA: string) => {
      const store = (window as any).__documentStore;
      const other = store.getState().openTabs.find((t: any) => t.docId !== docIdA);
      return other?.tabId as string;
    }, noteA.docId);
    await selectTab(window, tabIdB);

    await hoverTabAndWait(window, newTabIdA);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('Reopen A');
  });

  // ── 10. Content updates ────────────────────────────────────────────

  test('preview reflects updated content after editing', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Update A', ['Original content']);
    const noteB = await createNoteWithBody(window, 'Update B', ['B stuff']);

    // Go back to A and edit
    await selectTab(window, noteA.tabId);
    await window.waitForTimeout(200);
    const body = window.locator('main:visible .ContentEditable__root');
    await body.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type('Updated content now');
    await window.waitForTimeout(1000);

    await selectTab(window, noteB.tabId);

    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Updated content now');
  });

  test('preview reflects updated title after renaming', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Old Name', ['Content']);
    const noteB = await createNoteWithBody(window, 'Other', ['Stuff']);

    // Go back to A and rename
    await selectTab(window, noteA.tabId);
    await window.waitForTimeout(200);
    const titleEl = window.locator('main:visible h1.editor-title');
    await titleEl.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type('New Name');
    await window.waitForTimeout(700);

    await selectTab(window, noteB.tabId);

    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toContainText('New Name');
  });

  // ── 11. Duplicate tabs ─────────────────────────────────────────────

  test('preview works on duplicate tab showing same document', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Dup Note', ['Duplicate content']);
    await createNoteWithBody(window, 'Other', ['Other']);

    // Open a duplicate tab for A
    const dupTabId = await openDuplicateTab(window, noteA.docId);

    // Make the original A active
    await selectTab(window, noteA.tabId);

    // Hover the duplicate (inactive)
    await hoverTabAndWait(window, dupTabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Dup Note');
    await expect(popup).toContainText('Duplicate content');
  });

  // ── 12. Stress tests ──────────────────────────────────────────────

  test('preview works correctly with many tabs open', async ({ window }) => {
    const tabs: { tabId: string; docId: string }[] = [];

    for (let i = 0; i < 6; i++) {
      const note = await createNoteWithBody(window, `Tab ${i}`, [`Content of tab ${i}`]);
      tabs.push(note);
    }

    // Last created tab is active (Tab 5). Hover Tab 0.
    await hoverTabAndWait(window, tabs[0].tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Tab 0');

    // Move away, then hover Tab 3
    await moveMouseAway(window);
    await window.waitForTimeout(200);
    await hoverTabAndWait(window, tabs[3].tabId);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Tab 3');
  });

  test('repeatedly showing and dismissing preview does not break', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Stress A', ['Content A']);
    await createNoteWithBody(window, 'Stress B', ['Content B']);

    // Show and dismiss 5 times with settle time between cycles
    for (let i = 0; i < 5; i++) {
      await hoverTabAndWait(window, noteA.tabId);
      await expect(previewPopup(window)).toBeVisible();
      await moveMouseAway(window);
      await expect(previewPopup(window)).toHaveCount(0);
      await window.waitForTimeout(200); // settle before next cycle
    }

    // Should still work on the 6th time
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('Stress A');
  });

  test('preview on each inactive tab shows correct content', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Verify A', ['Alpha content']);
    const noteB = await createNoteWithBody(window, 'Verify B', ['Beta content']);
    await createNoteWithBody(window, 'Verify C', ['Gamma content']);

    // C is active. Verify A and B previews show correct content.
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toContainText('Alpha content');

    await moveMouseAway(window);
    await window.waitForTimeout(200);

    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toContainText('Beta content');
  });

  // ── 13. UX edge cases ─────────────────────────────────────────────

  test('moving directly between two inactive tabs shows correct preview for each', async ({ window }) => {
    // User drags mouse across tab bar — each tab should show its own content, no mix-ups
    const noteA = await createNoteWithBody(window, 'Adjacent A', ['Alpha text']);
    const noteB = await createNoteWithBody(window, 'Adjacent B', ['Beta text']);
    await createNoteWithBody(window, 'Adjacent C', ['Gamma text']);

    // Hover A, wait for preview
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toContainText('Alpha text');

    // Move directly to B (no moveMouseAway — simulates sliding across tabs)
    await hoverTabAndWait(window, noteB.tabId);
    const popup = previewPopup(window);
    await expect(popup).toContainText('Beta text');
    // Must NOT contain A's content
    const text = await popup.textContent();
    expect(text).not.toContain('Alpha text');
  });

  test('preview matches what you see after clicking the tab', async ({ window }) => {
    // The core UX promise: preview is accurate to what you'll get
    const noteA = await createNoteWithBody(window, 'Promise Note', [
      'This is the first line',
      'Second line of content',
    ]);
    await createNoteWithBody(window, 'Other', ['Other stuff']);

    // Check preview content
    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toContainText('Promise Note');
    await expect(popup).toContainText('This is the first line');

    // Now click the tab and verify the actual editor matches
    await tabEl(window, noteA.tabId).click();
    await window.waitForTimeout(300);

    const editorTitle = window.locator('main:visible h1.editor-title');
    await expect(editorTitle).toContainText('Promise Note');
    const editorBody = window.locator('main:visible .ContentEditable__root');
    await expect(editorBody).toContainText('This is the first line');
  });

  test('previous-tab chevron dismisses preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'ChevP A', ['Content A']);
    await createNoteWithBody(window, 'ChevP B', ['Content B']);
    await createNoteWithBody(window, 'ChevP C', ['Content C']);

    // C is active (index 2). Hover A (index 0).
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Previous tab: C→B. Preview on A should dismiss because active tab changed.
    await window.locator('[aria-label="Previous tab"]').click();
    await window.waitForTimeout(300);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('next-tab chevron dismisses preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'ChevN A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'ChevN B', ['Content B']);
    await createNoteWithBody(window, 'ChevN C', ['Content C']);

    // C is active (index 2). Make A active so we can use "Next tab".
    await selectTab(window, noteA.tabId);

    // Hover B (inactive, index 1)
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Next tab: A→B. B becomes active, so preview on B should dismiss.
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(300);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('chevron navigates to the hovered tab — preview dismisses because it becomes active', async ({ window }) => {
    // A B C — B active. Hover C. Previous: B→A. C is still inactive, but
    // the active tab change should clear preview state.
    await createNoteWithBody(window, 'ChevAct A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'ChevAct B', ['Content B']);
    const noteC = await createNoteWithBody(window, 'ChevAct C', ['Content C']);

    // Make B active
    await selectTab(window, noteB.tabId);

    // Hover C
    await hoverTabAndWait(window, noteC.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('ChevAct C');

    // Next tab: B→C. C becomes active — its preview must dismiss.
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(300);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('preview still works on other tabs after chevron navigation', async ({ window }) => {
    // After using chevrons, hover preview should still function normally
    const noteA = await createNoteWithBody(window, 'ChevStill A', ['Content A']);
    await createNoteWithBody(window, 'ChevStill B', ['Content B']);
    await createNoteWithBody(window, 'ChevStill C', ['Content C']);

    // C is active. Use previous to go to B.
    await window.locator('[aria-label="Previous tab"]').click();
    await window.waitForTimeout(300);

    // B is now active. Hover A (inactive).
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('ChevStill A');
  });

  test('rapid chevron clicks while hovering do not leave stale preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'ChevRapid A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'ChevRapid B', ['Content B']);
    await createNoteWithBody(window, 'ChevRapid C', ['Content C']);

    // Start at A
    await selectTab(window, noteA.tabId);

    // Hover B
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Rapidly click next twice: A→B→C
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(100);
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(300);

    // C is now active. No preview should be showing.
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('chevron making hovered tab the only inactive does not break preview', async ({ window }) => {
    // 2 tabs: A active, B inactive with preview. Previous is disabled.
    // This tests the boundary where chevrons can't go further.
    const noteA = await createNoteWithBody(window, 'ChevBound A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'ChevBound B', ['Content B']);

    // A is not active, B is active. Make A active.
    await selectTab(window, noteA.tabId);

    // Hover B (inactive)
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Previous tab is disabled (A is first). Click it — nothing should happen.
    const prevBtn = window.locator('[aria-label="Previous tab"]');
    const isDisabled = await prevBtn.isDisabled();
    expect(isDisabled).toBe(true);

    // Preview should still be showing (nothing changed)
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('ChevBound B');
  });

  test('hovering tab then using next chevron repeatedly cycles through correctly', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Cycle A', ['Alpha']);
    const noteB = await createNoteWithBody(window, 'Cycle B', ['Beta']);
    const noteC = await createNoteWithBody(window, 'Cycle C', ['Gamma']);
    const noteD = await createNoteWithBody(window, 'Cycle D', ['Delta']);

    // Start at A
    await selectTab(window, noteA.tabId);

    // Hover B, verify preview
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toContainText('Beta');

    // Next: A→B. B becomes active, preview dismissed.
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(300);
    await expect(previewPopup(window)).toHaveCount(0);

    // Now hover C
    await hoverTabAndWait(window, noteC.tabId);
    await expect(previewPopup(window)).toContainText('Gamma');

    // Next: B→C. C becomes active, preview dismissed.
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(300);
    await expect(previewPopup(window)).toHaveCount(0);

    // Hover D
    await hoverTabAndWait(window, noteD.tabId);
    await expect(previewPopup(window)).toContainText('Delta');

    // Next is disabled (D is last, C is active at index 2, D at 3... next goes to D)
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(300);
    // D is now active — preview dismissed
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('chevron click during preview delay cancels the preview', async ({ window }) => {
    // User hovers a tab but clicks chevron before 500ms — preview should never appear
    const noteA = await createNoteWithBody(window, 'ChevCancel A', ['Content A']);
    await createNoteWithBody(window, 'ChevCancel B', ['Content B']);
    await createNoteWithBody(window, 'ChevCancel C', ['Content C']);

    // C is active. Start hovering A but don't wait for preview.
    await hoverTabBriefly(window, noteA.tabId, 200);

    // Click previous chevron before preview fires — active changes from C to B
    await window.locator('[aria-label="Previous tab"]').click();
    await window.waitForTimeout(500);

    // Preview should never have appeared
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('spamming chevron rapidly never shows a preview', async ({ window }) => {
    // User holds chevron button rapidly — active tab jumps through multiple tabs
    const tabs: { tabId: string; docId: string }[] = [];
    for (let i = 0; i < 5; i++) {
      tabs.push(await createNoteWithBody(window, `Spam ${i}`, [`Content ${i}`]));
    }

    // Start at first tab
    await selectTab(window, tabs[0].tabId);

    // Hover tab 2
    await hoverTabBriefly(window, tabs[2].tabId, 100);

    // Spam next chevron 4 times quickly
    const nextBtn = window.locator('[aria-label="Next tab"]');
    for (let i = 0; i < 4; i++) {
      await nextBtn.click();
      await window.waitForTimeout(50);
    }
    await window.waitForTimeout(600);

    // No preview should exist — active tab kept changing
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('chevron oscillation (next/prev/next/prev) while hovering does not leave stale preview', async ({ window }) => {
    await createNoteWithBody(window, 'Osc A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Osc B', ['Content B']);
    const noteC = await createNoteWithBody(window, 'Osc C', ['Content C']);

    // Start at B (middle)
    await selectTab(window, noteB.tabId);

    // Hover C
    await hoverTabBriefly(window, noteC.tabId, 100);

    // Oscillate: next (B→C), prev (C→B), next (B→C), prev (C→B)
    const nextBtn = window.locator('[aria-label="Next tab"]');
    const prevBtn = window.locator('[aria-label="Previous tab"]');
    await nextBtn.click();
    await window.waitForTimeout(80);
    await prevBtn.click();
    await window.waitForTimeout(80);
    await nextBtn.click();
    await window.waitForTimeout(80);
    await prevBtn.click();
    await window.waitForTimeout(600);

    // B is active again. C was hovered. Active tab oscillated rapidly.
    // No stale preview should remain.
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('chevron makes hovered tab active then inactive — no auto-reappear since mouse left', async ({ window }) => {
    // Clicking the chevron button moves the mouse OFF the hovered tab.
    // Even though B becomes inactive again after prev, the mouse is on the
    // chevron button, not on tab B — so preview does NOT reappear automatically.
    const noteA = await createNoteWithBody(window, 'Bounce A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Bounce B', ['Content B']);
    await createNoteWithBody(window, 'Bounce C', ['Content C']);

    await selectTab(window, noteA.tabId);

    // Hover B and wait for preview
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('Bounce B');

    // Next: A→B. Mouse moves to chevron, B is active — preview dismissed.
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(300);
    await expect(previewPopup(window)).toHaveCount(0);

    // Prev: B→A. B is inactive again, but mouse is on chevron, not on B.
    await window.locator('[aria-label="Previous tab"]').click();
    await window.waitForTimeout(800);
    await expect(previewPopup(window)).toHaveCount(0);

    // But manually re-hovering B still works
    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('Bounce B');
  });

  test('chevron at boundary with preview on the only other tab', async ({ window }) => {
    // Only 2 tabs: A active, B inactive with preview.
    // Next: A→B. B becomes active. A becomes inactive. Preview dismissed.
    // Then hover A — should work.
    const noteA = await createNoteWithBody(window, 'Bound A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Bound B', ['Content B']);

    await selectTab(window, noteA.tabId);

    await hoverTabAndWait(window, noteB.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Next: A→B
    await window.locator('[aria-label="Next tab"]').click();
    await window.waitForTimeout(300);
    await expect(previewPopup(window)).toHaveCount(0);

    // Now A is the only inactive tab. Hover it.
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('Bound A');
  });

  test('chevron traversal across all tabs — each step clean', async ({ window }) => {
    // Create 5 tabs, start at 0, next all the way to 4 — verify no preview leaks at each step
    const tabs: { tabId: string; docId: string }[] = [];
    for (let i = 0; i < 5; i++) {
      tabs.push(await createNoteWithBody(window, `Trav ${i}`, [`Content ${i}`]));
    }

    await selectTab(window, tabs[0].tabId);
    const nextBtn = window.locator('[aria-label="Next tab"]');

    for (let i = 0; i < 4; i++) {
      // Before clicking next, hover the next tab briefly
      await hoverTabBriefly(window, tabs[i + 1].tabId, 100);

      // Click next — active moves to i+1
      await nextBtn.click();
      await window.waitForTimeout(300);

      // No preview should be showing (tab we hovered just became active)
      await expect(previewPopup(window)).toHaveCount(0);
    }

    // End at tab 4 (active). Hover tab 0 — should work fine after all that.
    await hoverTabAndWait(window, tabs[0].tabId);
    await expect(previewPopup(window)).toBeVisible();
    await expect(previewPopup(window)).toContainText('Trav 0');
  });

  test('preview does not appear while mouse is moving through tab bar quickly', async ({ window }) => {
    // User is just moving mouse across the top of the window, not trying to preview
    const noteA = await createNoteWithBody(window, 'Pass A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Pass B', ['Content B']);
    await createNoteWithBody(window, 'Pass C', ['Content C']);

    // Quickly pass through A then B then off the tabs (50ms each — well under 500ms)
    await hoverTabBriefly(window, noteA.tabId, 50);
    await hoverTabBriefly(window, noteB.tabId, 50);
    await moveMouseAway(window);

    await window.waitForTimeout(600);
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('preview positioned within viewport for leftmost tab', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Left Edge', ['Content']);
    await createNoteWithBody(window, 'Other', ['Other content']);

    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();

    const box = await popup.boundingBox();
    // Preview should not overflow left edge of viewport
    expect(box!.x).toBeGreaterThanOrEqual(0);
  });

  test('preview positioned within viewport for rightmost tab', async ({ window }) => {
    // Create enough tabs to push the last one to the right edge
    const tabs: { tabId: string; docId: string }[] = [];
    for (let i = 0; i < 5; i++) {
      tabs.push(await createNoteWithBody(window, `Right ${i}`, [`Content ${i}`]));
    }

    // Tab 4 is active. Hover Tab 3 (second to last, near right edge).
    await hoverTabAndWait(window, tabs[3].tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();

    const box = await popup.boundingBox();
    const viewportWidth = await window.evaluate(() => (window as any).innerWidth as number);
    // Preview right edge should not overflow viewport
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  });

  test('preview is not interactive (pointer-events-none)', async ({ window }) => {
    // User should be able to click through the preview to the tab underneath
    const noteA = await createNoteWithBody(window, 'Passthrough A', ['Content A']);
    await createNoteWithBody(window, 'Passthrough B', ['Content B']);
    await createNoteWithBody(window, 'Passthrough C', ['Content C']);

    // Hover A to show preview, which appears below the tab
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Click the tab — should still register despite preview being rendered
    await tabEl(window, noteA.tabId).click();
    await window.waitForTimeout(300);

    // A should now be active
    const activeTitle = window.locator('main:visible h1.editor-title');
    await expect(activeTitle).toContainText('Passthrough A');
  });

  test('hovering close button area does not flicker the preview', async ({ window }) => {
    // User moves mouse within the tab — between title and close button
    const noteA = await createNoteWithBody(window, 'Flicker A', ['Content A']);
    await createNoteWithBody(window, 'Flicker B', ['Content B']);

    // Hover tab to show preview
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Move mouse to the close button area (still within the tab element)
    const closeBtn = tabEl(window, noteA.tabId).locator('[aria-label="Close tab"]');
    const closeBox = await closeBtn.boundingBox();
    if (closeBox) {
      await window.mouse.move(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
      await window.waitForTimeout(200);
    }

    // Preview should still be visible (mouse is still within the tab)
    await expect(previewPopup(window)).toBeVisible();
  });

  test('opening a new note while preview is shown dismisses it', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Before New', ['Content']);
    await createNoteWithBody(window, 'Active', ['Active content']);

    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Create a new note — this changes active tab and moves mouse focus
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(500);

    // Preview should be gone (new tab is now active, layout shifted)
    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('sidebar click to open note dismisses existing preview', async ({ window }) => {
    const noteA = await createNoteWithBody(window, 'Sidebar A', ['Content A']);
    const noteB = await createNoteWithBody(window, 'Sidebar B', ['Content B']);

    // Hover A
    await hoverTabAndWait(window, noteA.tabId);
    await expect(previewPopup(window)).toBeVisible();

    // Click note B in the sidebar — switches active tab
    await window.locator(`[data-note-id="${noteB.docId}"]`).first().click();
    await window.waitForTimeout(300);

    await expect(previewPopup(window)).toHaveCount(0);
  });

  test('preview shows correct content for note with multiple block types', async ({ window }) => {
    // Real notes have headings, lists, etc. — preview should render them
    const noteA = await createNoteWithBody(window, 'Rich Note', [
      'A normal paragraph',
      '- First bullet item',
      '- Second bullet item',
    ]);
    await createNoteWithBody(window, 'Other', ['Stuff']);

    await hoverTabAndWait(window, noteA.tabId);
    const popup = previewPopup(window);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('A normal paragraph');
    await expect(popup).toContainText('First bullet item');
  });
});
