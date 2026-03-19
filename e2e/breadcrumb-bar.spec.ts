import { test, expect, listDocumentsFromDb } from './electron-app';
import type { Page } from '@playwright/test';

// ── Selectors ──────────────────────────────────────────────────────
// Scope to the visible <main> so that hidden tab editors don't cause
// strict-mode violations when multiple tabs are open.

const VISIBLE_MAIN = 'main:not([style*="display: none"])';
const BREADCRUMB_NAV = `${VISIBLE_MAIN} nav[aria-label="Breadcrumb"]`;
const ELLIPSIS_TRIGGER = `${BREADCRUMB_NAV} button:has(svg.lucide-ellipsis)`;
const COLLAPSE_POPOVER = '[data-radix-popper-content-wrapper]';

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Seed a tree via IPC and return a Map<title, id>.
 * Specs use `parentTitle` to reference earlier items in the batch.
 */
async function seedTree(
  window: Page,
  specs: Array<{ title: string; parentTitle?: string; emoji?: string }>,
): Promise<Map<string, string>> {
  const titleToId = new Map<string, string>();

  const ids: string[] = await window.evaluate(async (s) => {
    const localMap: Record<string, string> = {};
    const result: string[] = [];
    for (const spec of s) {
      const parentId = spec.parentTitle !== undefined ? localMap[spec.parentTitle] : null;
      const { document } = await (window as any).lychee.invoke('documents.create', {
        title: spec.title,
        parentId,
      });
      const updatePayload: Record<string, any> = { id: document.id, title: spec.title };
      if (spec.emoji) updatePayload.emoji = spec.emoji;
      await (window as any).lychee.invoke('documents.update', updatePayload);
      localMap[spec.title] = document.id;
      result.push(document.id);
    }
    return result;
  }, specs);

  await window.evaluate(async () => {
    const store = (window as any).__documentStore;
    if (store) await store.getState().loadDocuments(true);
  });

  for (let i = 0; i < specs.length; i++) {
    titleToId.set(specs[i].title, ids[i]);
  }

  await window.waitForTimeout(200);
  return titleToId;
}

/** Select a document by navigating to it via the store (navigateCurrentTab). */
async function selectDoc(window: Page, id: string) {
  await window.evaluate((docId) => {
    const store = (window as any).__documentStore;
    store.getState().openOrSelectTab(docId);
  }, id);
  await window.waitForTimeout(300);
}

/** Get the currently selected document ID from the store. */
async function getSelectedDocId(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    const state = store.getState();
    const tab = state.openTabs.find((t: any) => t.tabId === state.selectedId);
    return tab?.docId ?? null;
  });
}

/** Get all open tab docIds. */
async function getOpenTabDocIds(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    return store.getState().openTabs.map((t: any) => t.docId);
  });
}

/** Get the count of open tabs. */
async function getTabCount(window: Page): Promise<number> {
  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    return store.getState().openTabs.length;
  });
}

/** Get full tab entries (tabId + docId) and the selected tabId. */
async function getTabState(window: Page): Promise<{ tabs: Array<{ tabId: string; docId: string }>; selectedId: string | null }> {
  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    const state = store.getState();
    return {
      tabs: state.openTabs.map((t: any) => ({ tabId: t.tabId, docId: t.docId })),
      selectedId: state.selectedId,
    };
  });
}

/** Select a tab by its tabId (not docId). */
async function selectTabById(window: Page, tabId: string) {
  await window.evaluate((id) => {
    const store = (window as any).__documentStore;
    store.getState().selectDocument(id);
  }, tabId);
  await window.waitForTimeout(300);
}

/** Get inline ancestor button texts only (excludes current note).
 *  Uses the `title` attribute for reliable exact text (unaffected by emoji spans). */
async function getInlineAncestorTexts(window: Page): Promise<string[]> {
  const nav = window.locator(BREADCRUMB_NAV);
  if (!(await nav.isVisible().catch(() => false))) return [];
  const buttons = nav.locator('button[title]:not(:has(svg.lucide-ellipsis))');
  const count = await buttons.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const title = await buttons.nth(i).getAttribute('title');
    if (title) texts.push(title);
  }
  return texts;
}

/** Get texts of collapsed (hidden) ancestors in the ellipsis popover.
 *  Uses the `title` attribute to avoid tree-guide characters (├ └) in innerText. */
async function getCollapsedAncestorTexts(window: Page): Promise<string[]> {
  const popover = window.locator(COLLAPSE_POPOVER);
  const buttons = popover.locator('button[title]');
  const count = await buttons.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const title = await buttons.nth(i).getAttribute('title');
    if (title) texts.push(title);
  }
  return texts;
}

/** Click an inline ancestor button by its title (exact match). */
async function clickInlineAncestor(window: Page, label: string) {
  const nav = window.locator(BREADCRUMB_NAV);
  const button = nav.locator(`button[title="${label}"]`);
  await button.click();
  await window.waitForTimeout(300);
}

/** Cmd/Ctrl+click an inline ancestor by title (exact match). */
async function cmdClickInlineAncestor(window: Page, label: string) {
  const nav = window.locator(BREADCRUMB_NAV);
  const button = nav.locator(`button[title="${label}"]`);
  await button.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await window.waitForTimeout(300);
}

/** Middle-click an inline ancestor by title (exact match). */
async function middleClickInlineAncestor(window: Page, label: string) {
  const nav = window.locator(BREADCRUMB_NAV);
  const button = nav.locator(`button[title="${label}"]`);
  await button.click({ button: 'middle' });
  await window.waitForTimeout(300);
}

/** Click a collapsed ancestor in the popover by title (exact match). */
async function clickCollapsedAncestor(window: Page, label: string) {
  const popover = window.locator(COLLAPSE_POPOVER);
  const button = popover.locator(`button[title="${label}"]`);
  await button.click();
  await window.waitForTimeout(300);
}

/** Cmd/Ctrl+click a collapsed ancestor in the popover by title (exact match). */
async function cmdClickCollapsedAncestor(window: Page, label: string) {
  const popover = window.locator(COLLAPSE_POPOVER);
  const button = popover.locator(`button[title="${label}"]`);
  await button.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await window.waitForTimeout(300);
}

/** Middle-click a collapsed ancestor in the popover by title (exact match). */
async function middleClickCollapsedAncestor(window: Page, label: string) {
  const popover = window.locator(COLLAPSE_POPOVER);
  const button = popover.locator(`button[title="${label}"]`);
  await button.click({ button: 'middle' });
  await window.waitForTimeout(300);
}

/** Open the ellipsis collapse popover. */
async function openCollapsePopover(window: Page) {
  const trigger = window.locator(ELLIPSIS_TRIGGER);
  await trigger.click();
  await window.locator(COLLAPSE_POPOVER).waitFor({ state: 'visible', timeout: 3000 });
}

/** Check if the ellipsis trigger is visible. */
async function isEllipsisVisible(window: Page): Promise<boolean> {
  return window.locator(ELLIPSIS_TRIGGER).isVisible().catch(() => false);
}

/** Get the visible editor title. */
async function getEditorTitle(window: Page): Promise<string> {
  const title = window.locator('main:visible h1.editor-title');
  return (await title.innerText()).trim();
}

// ── Visibility ──────────────────────────────────────────────────────

test.describe('BreadcrumbBar — Visibility', () => {
  test('always visible when a document is selected', async ({ window }) => {
    await seedTree(window, [{ title: 'Root' }]);
    const docs = await listDocumentsFromDb(window);
    await selectDoc(window, docs[0].id);

    await expect(window.locator(BREADCRUMB_NAV)).toBeVisible();
  });

  test('shows current note name for top-level note with no ancestors', async ({ window }) => {
    const m = await seedTree(window, [{ title: 'Standalone' }]);
    await selectDoc(window, m.get('Standalone')!);

    const nav = window.locator(BREADCRUMB_NAV);
    await expect(nav).toBeVisible();
    await expect(nav).toContainText('Standalone');
  });

  test('shows ancestor trail for nested note', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    const nav = window.locator(BREADCRUMB_NAV);
    await expect(nav).toContainText('Parent');
    await expect(nav).toContainText('Child');
  });

  test('visible regardless of sidebar state', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Leaf', parentTitle: 'Root' },
    ]);
    await selectDoc(window, m.get('Leaf')!);

    // Sidebar open
    await expect(window.locator(BREADCRUMB_NAV)).toBeVisible();

    // Sidebar closed
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(400);
    await expect(window.locator(BREADCRUMB_NAV)).toBeVisible();
  });
});

// ── Inline Trail ────────────────────────────────────────────────────

test.describe('BreadcrumbBar — Inline Trail', () => {
  test('2-level nesting: shows parent > current', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Alpha' },
      { title: 'Beta', parentTitle: 'Alpha' },
    ]);
    await selectDoc(window, m.get('Beta')!);

    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['Alpha']);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Beta');
  });

  test('3-level nesting: shows grandparent > parent > current', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
    ]);
    await selectDoc(window, m.get('C')!);

    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['A', 'B']);
  });

  test('4-level nesting: shows all ancestors inline (within threshold)', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
    ]);
    await selectDoc(window, m.get('L5')!);

    const ancestors = await getInlineAncestorTexts(window);
    // Threshold is 4 for wide mode: last 4 ancestors shown inline
    expect(ancestors).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  test('current note is not a clickable button', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Current', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Current')!);

    // Current note should be in a span, not a button
    const nav = window.locator(BREADCRUMB_NAV);
    const currentButtons = nav.locator('button[title="Current"]');
    await expect(currentButtons).toHaveCount(0);

    // But it should be visible as text
    await expect(nav).toContainText('Current');
  });

  test('chevron separators appear between segments', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
    ]);
    await selectDoc(window, m.get('C')!);

    const chevrons = window.locator(`${BREADCRUMB_NAV} svg.lucide-chevron-right`);
    // 2 chevrons: A > B > C
    await expect(chevrons).toHaveCount(2);
  });

  test('untitled notes display "Untitled"', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: '', parentTitle: 'Root' },
    ]);
    const childId = m.get('')!;
    await selectDoc(window, childId);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Untitled');
  });

  test('emoji is shown next to ancestor title', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Notes', emoji: '📝' },
      { title: 'Ideas', parentTitle: 'Notes' },
    ]);
    await selectDoc(window, m.get('Ideas')!);

    const nav = window.locator(BREADCRUMB_NAV);
    await expect(nav).toContainText('📝');
    await expect(nav).toContainText('Notes');
  });

  test('emoji is shown for current note', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Kid', parentTitle: 'Parent', emoji: '🎉' },
    ]);
    await selectDoc(window, m.get('Kid')!);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('🎉');
  });

  test('tooltip shows full title on ancestor button', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A Very Long Title That Will Be Truncated' },
      { title: 'Child', parentTitle: 'A Very Long Title That Will Be Truncated' },
    ]);
    await selectDoc(window, m.get('Child')!);

    const button = window.locator(`${BREADCRUMB_NAV} button`).first();
    await expect(button).toHaveAttribute('title', 'A Very Long Title That Will Be Truncated');
  });

  test('tooltip shows full title on current note', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'A Very Long Current Title', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('A Very Long Current Title')!);

    const currentSpan = window.locator(`${BREADCRUMB_NAV} > span:last-child`);
    await expect(currentSpan).toHaveAttribute('title', 'A Very Long Current Title');
  });
});

// ── Collapse / Ellipsis ─────────────────────────────────────────────

test.describe('BreadcrumbBar — Collapse Behavior', () => {
  test('5-level nesting: ellipsis appears, first ancestor is hidden', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    await selectDoc(window, m.get('L6')!);

    // Ellipsis should be visible (5 ancestors > threshold of 4)
    await expect(window.locator(ELLIPSIS_TRIGGER)).toBeVisible();

    // Last 4 ancestors shown inline
    const inline = await getInlineAncestorTexts(window);
    expect(inline).toEqual(['L2', 'L3', 'L4', 'L5']);
  });

  test('clicking ellipsis opens popover with hidden ancestors', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
      { title: 'D', parentTitle: 'C' },
      { title: 'E', parentTitle: 'D' },
      { title: 'F', parentTitle: 'E' },
    ]);
    await selectDoc(window, m.get('F')!);

    await openCollapsePopover(window);
    const collapsed = await getCollapsedAncestorTexts(window);
    expect(collapsed).toEqual(['A']);
  });

  test('6 ancestors: 2 hidden in popover', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
      { title: 'L7', parentTitle: 'L6' },
    ]);
    await selectDoc(window, m.get('L7')!);

    await openCollapsePopover(window);
    const collapsed = await getCollapsedAncestorTexts(window);
    expect(collapsed).toEqual(['L1', 'L2']);

    const inline = await getInlineAncestorTexts(window);
    expect(inline).toEqual(['L3', 'L4', 'L5', 'L6']);
  });

  test('popover shows tree guide characters for hierarchy', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Mid1', parentTitle: 'Root' },
      { title: 'Mid2', parentTitle: 'Mid1' },
      { title: 'Mid3', parentTitle: 'Mid2' },
      { title: 'Mid4', parentTitle: 'Mid3' },
      { title: 'Mid5', parentTitle: 'Mid4' },
      { title: 'Leaf', parentTitle: 'Mid5' },
    ]);
    await selectDoc(window, m.get('Leaf')!);

    await openCollapsePopover(window);
    const popover = window.locator(COLLAPSE_POPOVER);
    // Should contain tree guide characters
    await expect(popover).toContainText('├');
    await expect(popover).toContainText('└');
  });

  test('no ellipsis for 4 or fewer ancestors', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'Leaf', parentTitle: 'L4' },
    ]);
    await selectDoc(window, m.get('Leaf')!);

    expect(await isEllipsisVisible(window)).toBe(false);
    const inline = await getInlineAncestorTexts(window);
    expect(inline).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  test('popover closes when clicking ellipsis again', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
      { title: 'D', parentTitle: 'C' },
      { title: 'E', parentTitle: 'D' },
      { title: 'F', parentTitle: 'E' },
    ]);
    await selectDoc(window, m.get('F')!);

    await openCollapsePopover(window);
    await expect(window.locator(COLLAPSE_POPOVER)).toBeVisible();

    // Click again to close
    await window.locator(ELLIPSIS_TRIGGER).click();
    await window.waitForTimeout(300);
    await expect(window.locator(COLLAPSE_POPOVER)).not.toBeVisible();
  });
});

// ── Navigation — Click ──────────────────────────────────────────────

test.describe('BreadcrumbBar — Click Navigation', () => {
  test('clicking ancestor navigates current tab to it', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    await clickInlineAncestor(window, 'Parent');

    const selected = await getSelectedDocId(window);
    expect(selected).toBe(m.get('Parent')!);
    // Tab count should NOT increase — navigated in place
    expect(await getTabCount(window)).toBe(tabsBefore);
  });

  test('clicking ancestor updates the editor title', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent Note' },
      { title: 'Child Note', parentTitle: 'Parent Note' },
    ]);
    await selectDoc(window, m.get('Child Note')!);

    await clickInlineAncestor(window, 'Parent Note');
    await window.waitForTimeout(500);

    const title = await getEditorTitle(window);
    expect(title).toBe('Parent Note');
  });

  test('clicking ancestor does NOT switch to existing tab of same doc', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Open parent in its own tab first
    await selectDoc(window, m.get('Parent')!);

    // Open child in a new tab
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    // Select the child tab
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    // Click parent in breadcrumb — should navigate current tab, not switch to parent tab
    await clickInlineAncestor(window, 'Parent');

    // Tab count should stay the same (navigated in place, didn't switch)
    expect(await getTabCount(window)).toBe(tabsBefore);
  });

  test('clicking collapsed ancestor in popover navigates and closes popover', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    await selectDoc(window, m.get('L6')!);

    await openCollapsePopover(window);
    await clickCollapsedAncestor(window, 'L1');

    expect(await getSelectedDocId(window)).toBe(m.get('L1')!);
    await expect(window.locator(COLLAPSE_POPOVER)).not.toBeVisible();
  });

  test('navigating up then down: breadcrumb updates correctly each step', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Mid', parentTitle: 'Root' },
      { title: 'Leaf', parentTitle: 'Mid' },
    ]);
    await selectDoc(window, m.get('Leaf')!);

    // Breadcrumb: Root > Mid > Leaf
    let ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['Root', 'Mid']);

    // Navigate up to Mid
    await clickInlineAncestor(window, 'Mid');
    ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['Root']);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Mid');

    // Navigate up to Root
    await clickInlineAncestor(window, 'Root');
    ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual([]);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Root');
  });

  test('navigate from deepest to root in one jump', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'R' },
      { title: 'A', parentTitle: 'R' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
    ]);
    await selectDoc(window, m.get('C')!);

    await clickInlineAncestor(window, 'R');
    expect(await getSelectedDocId(window)).toBe(m.get('R')!);

    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual([]);
  });
});

// ── Navigation — Cmd+Click (New Tab) ────────────────────────────────

test.describe('BreadcrumbBar — Cmd+Click', () => {
  test('cmd+click opens ancestor in new tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    await cmdClickInlineAncestor(window, 'Parent');

    expect(await getTabCount(window)).toBe(tabsBefore + 1);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs).toContain(m.get('Parent')!);
  });

  test('cmd+click keeps child as the selected document', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    await cmdClickInlineAncestor(window, 'Parent');

    // New tab was created for Parent
    const tabs = await getOpenTabDocIds(window);
    expect(tabs).toContain(m.get('Parent')!);
    // But breadcrumb should still show Child's context (not Parent's)
    // because cmd+click opens in background
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');
  });

  test('repeated cmd+click creates multiple tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    await cmdClickInlineAncestor(window, 'Parent');
    // Re-select child to get breadcrumb back
    await selectDoc(window, m.get('Child')!);
    await cmdClickInlineAncestor(window, 'Parent');

    expect(await getTabCount(window)).toBe(tabsBefore + 2);
  });

  test('cmd+click on collapsed ancestor opens new tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    await selectDoc(window, m.get('L6')!);
    const tabsBefore = await getTabCount(window);

    await openCollapsePopover(window);
    await cmdClickCollapsedAncestor(window, 'L1');

    expect(await getTabCount(window)).toBe(tabsBefore + 1);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs).toContain(m.get('L1')!);
  });
});

// ── Navigation — Middle-Click ───────────────────────────────────────

test.describe('BreadcrumbBar — Middle-Click', () => {
  test('middle-click opens ancestor in new tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    await middleClickInlineAncestor(window, 'Parent');

    expect(await getTabCount(window)).toBe(tabsBefore + 1);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs).toContain(m.get('Parent')!);
  });
});

// ── Reactivity ──────────────────────────────────────────────────────

test.describe('BreadcrumbBar — Reactive Updates', () => {
  test('breadcrumb updates when ancestor is renamed', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'OldName' },
      { title: 'Child', parentTitle: 'OldName' },
    ]);
    await selectDoc(window, m.get('Child')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('OldName');

    // Rename via IPC
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, title: 'NewName' });
      const store = (window as any).__documentStore;
      store.getState().updateDocumentInStore(id, { title: 'NewName' });
    }, m.get('OldName')!);
    await window.waitForTimeout(300);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('NewName');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('OldName');
  });

  test('breadcrumb updates when note is moved to new parent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent1' },
      { title: 'Parent2' },
      { title: 'Child', parentTitle: 'Parent1' },
    ]);
    await selectDoc(window, m.get('Child')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent1');

    // Move child under Parent2
    await window.evaluate(async ({ childId, newParentId }) => {
      await (window as any).lychee.invoke('documents.move', { id: childId, parentId: newParentId, sortOrder: 0 });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, { childId: m.get('Child')!, newParentId: m.get('Parent2')! });
    await window.waitForTimeout(400);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent2');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('Parent1');
  });

  test('trashing ancestor cascade-trashes entire subtree: breadcrumb reflects new state', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Grandparent' },
      { title: 'Parent', parentTitle: 'Grandparent' },
      { title: 'Child', parentTitle: 'Parent' },
      { title: 'Survivor' },
    ]);
    // Open Survivor in a tab so we have somewhere to land after cascade trash
    await selectDoc(window, m.get('Survivor')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);
    await selectDoc(window, m.get('Child')!);

    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['Grandparent', 'Parent']);

    // Trash grandparent — cascade should remove Parent + Child too
    await window.evaluate(async (id) => {
      const store = (window as any).__documentStore;
      await store.getState().trashDocument(id);
    }, m.get('Grandparent')!);
    await window.waitForTimeout(500);

    // Child's tab was closed by trashDocument. Selection should move to Survivor.
    const selectedId = await getSelectedDocId(window);
    expect(selectedId).toBe(m.get('Survivor')!);
    // Breadcrumb should show Survivor (no ancestors)
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Survivor');
    const survivorAncestors = await getInlineAncestorTexts(window);
    expect(survivorAncestors).toEqual([]);
  });

  test('breadcrumb updates when switching between tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'A', parentTitle: 'Root' },
      { title: 'B' },
    ]);
    await selectDoc(window, m.get('A')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Root');

    // Open B in a new tab
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('B')!);
    await window.waitForTimeout(200);

    // Select B's tab
    await selectDoc(window, m.get('B')!);
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('Root');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('B');

    // Switch back to A
    await selectDoc(window, m.get('A')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Root');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('A');
  });

  test('breadcrumb updates when note emoji changes', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Add emoji to parent
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, emoji: '🔥' });
      const store = (window as any).__documentStore;
      store.getState().updateDocumentInStore(id, { emoji: '🔥' });
    }, m.get('Parent')!);
    await window.waitForTimeout(300);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('🔥');
  });

  test('breadcrumb appears when root note is nested under another', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'WillBeParent' },
      { title: 'WillBeChild' },
    ]);
    await selectDoc(window, m.get('WillBeChild')!);

    // No ancestors yet
    const ancestorsBefore = await getInlineAncestorTexts(window);
    expect(ancestorsBefore).toEqual([]);

    // Move under WillBeParent
    await window.evaluate(async ({ childId, parentId }) => {
      await (window as any).lychee.invoke('documents.move', { id: childId, parentId, sortOrder: 0 });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, { childId: m.get('WillBeChild')!, parentId: m.get('WillBeParent')! });
    await window.waitForTimeout(400);

    const ancestorsAfter = await getInlineAncestorTexts(window);
    expect(ancestorsAfter).toEqual(['WillBeParent']);
  });

  test('breadcrumb disappears when nested note is unnested to root', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    expect((await getInlineAncestorTexts(window)).length).toBeGreaterThan(0);

    // Unnest to root
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.move', { id, parentId: null, sortOrder: 0 });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Child')!);
    await window.waitForTimeout(400);

    const ancestorsAfter = await getInlineAncestorTexts(window);
    expect(ancestorsAfter).toEqual([]);
  });
});

// ── Tab Interaction ─────────────────────────────────────────────────

test.describe('BreadcrumbBar — Tab Behavior', () => {
  test('clicking breadcrumb navigates current tab, does not create new tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    await clickInlineAncestor(window, 'Parent');

    expect(await getTabCount(window)).toBe(tabsBefore);
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);
  });

  test('with multiple tabs open, breadcrumb click navigates current tab only', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
      { title: 'Other' },
    ]);

    // Open 3 tabs
    await selectDoc(window, m.get('Other')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    // Select child tab
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    // Click parent in breadcrumb
    await clickInlineAncestor(window, 'Parent');

    // Same number of tabs — navigated in place
    expect(await getTabCount(window)).toBe(tabsBefore);
  });

  test('parent already open in another tab: breadcrumb click still navigates current tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);

    // Open parent in tab 1
    await selectDoc(window, m.get('Parent')!);
    // Open child in tab 2
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);
    await selectDoc(window, m.get('Child')!);

    const tabsBefore = await getTabCount(window);

    // Click parent in breadcrumb — should NOT switch to existing parent tab
    await clickInlineAncestor(window, 'Parent');

    // Tab count stays same — current tab was replaced, not switched
    expect(await getTabCount(window)).toBe(tabsBefore);

    // Should now have 2 tabs showing Parent
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Parent')!).length).toBe(2);
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────

test.describe('BreadcrumbBar — Edge Cases', () => {
  test('rapid navigation via breadcrumbs works correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
    ]);
    await selectDoc(window, m.get('L4')!);

    // Rapidly click up the chain
    await clickInlineAncestor(window, 'L3');
    await clickInlineAncestor(window, 'L2');
    await clickInlineAncestor(window, 'L1');

    expect(await getSelectedDocId(window)).toBe(m.get('L1')!);
    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual([]);
  });

  test('ping-pong navigation: parent → child → parent via sidebar and breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Go up via breadcrumb
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);

    // Go back down via sidebar
    await selectDoc(window, m.get('Child')!);
    expect(await getSelectedDocId(window)).toBe(m.get('Child')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent');
  });

  test('double-click on ancestor does not break navigation', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    const button = window.locator(`${BREADCRUMB_NAV} button[title="Parent"]`);
    await button.dblclick();
    await window.waitForTimeout(400);

    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);
  });

  test('parent and child with identical titles', async ({ window }) => {
    await seedTree(window, [
      { title: 'Same Name' },
      { title: 'Same Name', parentTitle: 'Same Name' },
    ]);
    // Get the child ID (second one created)
    const docs = await listDocumentsFromDb(window);
    const child = docs.find((d) => d.parentId !== null);
    await selectDoc(window, child!.id);

    // Both "Same Name" should appear: ancestor button + current span
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Same Name');
    const buttons = window.locator(`${BREADCRUMB_NAV} button[title="Same Name"]`);
    await expect(buttons).toHaveCount(1); // ancestor is a button
  });

  test('unicode and special characters in titles', async ({ window }) => {
    await seedTree(window, [
      { title: '日本語ノート' },
      { title: 'Child <script>alert(1)</script>', parentTitle: '日本語ノート' },
    ]);
    const docs = await listDocumentsFromDb(window);
    const child = docs.find((d) => d.parentId !== null);
    await selectDoc(window, child!.id);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('日本語ノート');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('<script>');
  });

  test('breadcrumb still works after sidebar toggle cycle', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Toggle sidebar closed then open
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(400);
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(400);

    // Breadcrumb still works
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent');
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);
  });
});

// ── Stress Tests ────────────────────────────────────────────────────

test.describe('BreadcrumbBar — Stress Tests', () => {
  test('10-level deep nesting: all ancestors render, navigation works', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 10; i++) {
      specs.push({
        title: `Level${i}`,
        ...(i > 1 ? { parentTitle: `Level${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);
    await selectDoc(window, m.get('Level10')!);

    // 9 ancestors: 4 inline (threshold) + 5 collapsed
    const inline = await getInlineAncestorTexts(window);
    expect(inline).toHaveLength(4);
    expect(inline).toEqual(['Level6', 'Level7', 'Level8', 'Level9']);

    await expect(window.locator(ELLIPSIS_TRIGGER)).toBeVisible();

    // Open collapsed
    await openCollapsePopover(window);
    const collapsed = await getCollapsedAncestorTexts(window);
    expect(collapsed).toEqual(['Level1', 'Level2', 'Level3', 'Level4', 'Level5']);

    // Navigate to deepest collapsed ancestor
    await clickCollapsedAncestor(window, 'Level1');
    expect(await getSelectedDocId(window)).toBe(m.get('Level1')!);
  });

  test('navigate up 10 levels one at a time', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 10; i++) {
      specs.push({
        title: `N${i}`,
        ...(i > 1 ? { parentTitle: `N${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);
    await selectDoc(window, m.get('N10')!);

    // Walk up one level at a time using breadcrumb
    for (let level = 9; level >= 1; level--) {
      const target = `N${level}`;
      // The target might be inline or collapsed depending on current depth
      const inlineTexts = await getInlineAncestorTexts(window);
      if (inlineTexts.includes(target)) {
        await clickInlineAncestor(window, target);
      } else {
        await openCollapsePopover(window);
        await clickCollapsedAncestor(window, target);
      }
      expect(await getSelectedDocId(window)).toBe(m.get(target)!);
    }

    // At root now
    const finalAncestors = await getInlineAncestorTexts(window);
    expect(finalAncestors).toEqual([]);
  });

  test('15-level deep tree with long titles: truncation and tooltips', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 15; i++) {
      specs.push({
        title: `This Is A Very Long Title For Level Number ${i}`,
        ...(i > 1 ? { parentTitle: `This Is A Very Long Title For Level Number ${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);
    await selectDoc(window, m.get('This Is A Very Long Title For Level Number 15')!);

    // Should have ellipsis (14 ancestors > threshold 4)
    await expect(window.locator(ELLIPSIS_TRIGGER)).toBeVisible();

    // Inline ancestors should have title tooltips
    const firstInlineButton = window.locator(`${BREADCRUMB_NAV} button:not(:has(svg.lucide-ellipsis))`).first();
    const tooltip = await firstInlineButton.getAttribute('title');
    expect(tooltip).toContain('This Is A Very Long Title For Level Number');
  });

  test('rapid tab switches update breadcrumb correctly each time', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'RootA' },
      { title: 'ChildA', parentTitle: 'RootA' },
      { title: 'RootB' },
      { title: 'ChildB', parentTitle: 'RootB' },
    ]);

    // Open both children in tabs
    await selectDoc(window, m.get('ChildA')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('ChildB')!);
    await window.waitForTimeout(200);

    // Rapidly switch between tabs
    for (let i = 0; i < 5; i++) {
      await selectDoc(window, m.get('ChildA')!);
      await expect(window.locator(BREADCRUMB_NAV)).toContainText('RootA');

      await selectDoc(window, m.get('ChildB')!);
      await expect(window.locator(BREADCRUMB_NAV)).toContainText('RootB');
    }
  });

  test('create deep chain incrementally: breadcrumb grows at each step', async ({ window }) => {
    const ids: string[] = [];

    // Create root
    const rootId = await window.evaluate(async () => {
      const { document } = await (window as any).lychee.invoke('documents.create', { title: 'Step1' });
      await (window as any).lychee.invoke('documents.update', { id: document.id, title: 'Step1' });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
      return document.id;
    });
    ids.push(rootId);
    await selectDoc(window, rootId);

    // No ancestors for root
    expect((await getInlineAncestorTexts(window))).toEqual([]);

    // Add children one at a time
    for (let i = 2; i <= 5; i++) {
      const parentId = ids[ids.length - 1];
      const newId = await window.evaluate(async ({ pId, title }) => {
        const { document } = await (window as any).lychee.invoke('documents.create', { title, parentId: pId });
        await (window as any).lychee.invoke('documents.update', { id: document.id, title });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
        return document.id;
      }, { pId: parentId, title: `Step${i}` });

      ids.push(newId);
      await selectDoc(window, newId);
      await window.waitForTimeout(300);

      const ancestors = await getInlineAncestorTexts(window);
      expect(ancestors).toHaveLength(i - 1);
    }
  });
});

// ── Responsive Behavior ─────────────────────────────────────────────

test.describe('BreadcrumbBar — Responsive', () => {
  test('resizing window changes collapse threshold', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
    ]);
    await selectDoc(window, m.get('L3')!);

    // Save original size
    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getContentSize();
    });

    // At wide width: both ancestors inline
    if (originalSize[0] >= 768) {
      const ancestors = await getInlineAncestorTexts(window);
      expect(ancestors).toEqual(['L1', 'L2']);
    }

    // Resize to medium
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(600, win.getContentSize()[1]);
    });
    await window.waitForTimeout(500);

    // At medium: threshold 1, only L2 inline, L1 in ellipsis
    const mediumAncestors = await getInlineAncestorTexts(window);
    expect(mediumAncestors).toEqual(['L2']);
    await expect(window.locator(ELLIPSIS_TRIGGER)).toBeVisible();

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });

  test('popover closes on breakpoint change during resize', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
      { title: 'D', parentTitle: 'C' },
      { title: 'E', parentTitle: 'D' },
      { title: 'F', parentTitle: 'E' },
    ]);
    await selectDoc(window, m.get('F')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getContentSize();
    });

    // Open the collapse popover
    await openCollapsePopover(window);
    await expect(window.locator(COLLAPSE_POPOVER)).toBeVisible();

    // Resize to trigger breakpoint change
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(600, win.getContentSize()[1]);
    });
    await window.waitForTimeout(500);

    // Popover should be closed
    await expect(window.locator(COLLAPSE_POPOVER)).not.toBeVisible();

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });
});

// ── Sidebar Integration ─────────────────────────────────────────────

test.describe('BreadcrumbBar — Sidebar Integration', () => {
  test('clicking note in sidebar updates breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'RootA' },
      { title: 'ChildA', parentTitle: 'RootA' },
      { title: 'RootB' },
    ]);

    // Expand RootA in sidebar so ChildA is visible
    const rootAItem = window.locator(`[data-note-id="${m.get('RootA')!}"]`);
    await rootAItem.locator('[aria-label="Expand"]').click();
    await window.waitForTimeout(300);

    // Click ChildA in sidebar
    const childItem = window.locator(`[data-note-id="${m.get('ChildA')!}"]`);
    await childItem.click();
    await window.waitForTimeout(300);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('RootA');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('ChildA');

    // Click RootB in sidebar
    const rootBItem = window.locator(`[data-note-id="${m.get('RootB')!}"]`);
    await rootBItem.click();
    await window.waitForTimeout(300);

    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('RootA');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('RootB');
  });

  test('right-click "Open in new tab" in sidebar: breadcrumb shows for new tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);

    // Expand Parent so Child is visible in the sidebar
    const parentItem = window.locator(`[data-note-id="${m.get('Parent')!}"]`);
    await parentItem.locator('[aria-label="Expand"]').click();
    await window.waitForTimeout(300);

    const childItem = window.locator(`[data-note-id="${m.get('Child')!}"]`);
    await childItem.click({ button: 'right' });
    await window.waitForTimeout(200);

    await window.getByText('Open in new tab').click();
    await window.waitForTimeout(300);

    // Select the new tab
    await selectDoc(window, m.get('Child')!);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');
  });

  test('creating child via "Add page inside" updates breadcrumb when selected', async ({ window }) => {
    const m = await seedTree(window, [{ title: 'Root' }]);
    await selectDoc(window, m.get('Root')!);

    // Right-click and add page inside
    const rootItem = window.locator(`[data-note-id="${m.get('Root')!}"]`);
    await rootItem.click({ button: 'right' });
    await window.waitForTimeout(200);

    await window.getByText('Add page inside').click();
    await window.waitForTimeout(500);

    // New child is auto-selected, breadcrumb should show Root as ancestor
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Root');
  });
});

// ── Additional Visibility Tests ─────────────────────────────────────

test.describe('BreadcrumbBar — Visibility (Extended)', () => {
  test('breadcrumb visible on app launch with initial document', async ({ window }) => {
    await seedTree(window, [{ title: 'First Note' }]);
    const docs = await listDocumentsFromDb(window);
    await selectDoc(window, docs[0].id);

    await expect(window.locator(BREADCRUMB_NAV)).toBeVisible();
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('First Note');
  });

  test('breadcrumb updates immediately when switching from root to nested doc', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Nested', parentTitle: 'Root' },
    ]);

    await selectDoc(window, m.get('Root')!);
    let ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual([]);

    await selectDoc(window, m.get('Nested')!);
    ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['Root']);
  });

  test('breadcrumb visible after closing and reopening sidebar multiple times', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'P' },
      { title: 'C', parentTitle: 'P' },
    ]);
    await selectDoc(window, m.get('C')!);

    for (let i = 0; i < 3; i++) {
      await window.locator('[aria-label="Toggle sidebar"]').click();
      await window.waitForTimeout(400);
      await expect(window.locator(BREADCRUMB_NAV)).toBeVisible();
      await expect(window.locator(BREADCRUMB_NAV)).toContainText('P');
    }
  });

  test('breadcrumb shows correct state after all tabs are closed and a new one is opened', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Close all tabs
    await window.evaluate(() => {
      const store = (window as any).__documentStore;
      const tabs = store.getState().openTabs;
      for (const t of tabs) {
        store.getState().closeTab(t.tabId);
      }
    });
    await window.waitForTimeout(300);

    // Re-open
    await selectDoc(window, m.get('Child')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');
  });

  test('breadcrumb nav element has correct aria-label', async ({ window }) => {
    const m = await seedTree(window, [{ title: 'Note' }]);
    await selectDoc(window, m.get('Note')!);

    const nav = window.locator('nav[aria-label="Breadcrumb"]');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveAttribute('aria-label', 'Breadcrumb');
  });

  test('breadcrumb with no selected document does not render', async ({ window }) => {
    // Deselect by closing all tabs
    await window.evaluate(() => {
      const store = (window as any).__documentStore;
      const tabs = store.getState().openTabs;
      for (const t of tabs) {
        store.getState().closeTab(t.tabId);
      }
    });
    await window.waitForTimeout(300);

    await expect(window.locator(BREADCRUMB_NAV)).not.toBeVisible();
  });

  test('breadcrumb remains visible when editor body is scrolled', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Type many lines to make editor scrollable
    const title = window.locator('main:visible h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    for (let i = 0; i < 30; i++) {
      await window.keyboard.type(`Line ${i}`);
      await window.keyboard.press('Enter');
    }
    await window.waitForTimeout(300);

    // Scroll down
    await window.locator('main:visible').evaluate((el) => el.scrollTo(0, 9999));
    await window.waitForTimeout(200);

    // Breadcrumb should still be visible (it's sticky)
    await expect(window.locator(BREADCRUMB_NAV)).toBeVisible();
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent');
  });
});

// ── Additional Middle-Click Tests ───────────────────────────────────

test.describe('BreadcrumbBar — Middle-Click (Extended)', () => {
  test('middle-click on ancestor does not navigate current tab away', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    await middleClickInlineAncestor(window, 'Parent');

    // Breadcrumb should still show Child's context — we didn't navigate away
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent');
    // And a new tab was created
    expect(await getTabCount(window)).toBeGreaterThan(1);
  });

  test('middle-click creates distinct new tab even if doc already open', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Open parent in its own tab
    await selectDoc(window, m.get('Parent')!);
    // Open child
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);
    await selectDoc(window, m.get('Child')!);

    const tabsBefore = await getTabCount(window);
    await middleClickInlineAncestor(window, 'Parent');

    // Should create a new tab even though Parent is already open
    expect(await getTabCount(window)).toBe(tabsBefore + 1);
  });

  test('repeated middle-clicks create multiple tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    await middleClickInlineAncestor(window, 'Parent');
    // Re-select child to get its breadcrumb back for the next middle-click
    await selectDoc(window, m.get('Child')!);
    await middleClickInlineAncestor(window, 'Parent');
    await selectDoc(window, m.get('Child')!);
    await middleClickInlineAncestor(window, 'Parent');

    expect(await getTabCount(window)).toBe(tabsBefore + 3);
    // All 3 new tabs should contain Parent
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Parent')!).length).toBe(3);
  });

  test('middle-click on collapsed ancestor in popover opens new tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    await selectDoc(window, m.get('L6')!);
    const tabsBefore = await getTabCount(window);

    await openCollapsePopover(window);
    await middleClickCollapsedAncestor(window, 'L1');

    expect(await getTabCount(window)).toBe(tabsBefore + 1);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs).toContain(m.get('L1')!);
  });

  test('middle-click on each ancestor in a 4-level chain opens 3 new tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
      { title: 'D', parentTitle: 'C' },
    ]);
    await selectDoc(window, m.get('D')!);
    const tabsBefore = await getTabCount(window);

    // Middle-click each ancestor
    await middleClickInlineAncestor(window, 'A');
    await selectDoc(window, m.get('D')!);
    await middleClickInlineAncestor(window, 'B');
    await selectDoc(window, m.get('D')!);
    await middleClickInlineAncestor(window, 'C');

    expect(await getTabCount(window)).toBe(tabsBefore + 3);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs).toContain(m.get('A')!);
    expect(tabs).toContain(m.get('B')!);
    expect(tabs).toContain(m.get('C')!);
  });

  test('middle-click and cmd+click on same ancestor both create separate tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const tabsBefore = await getTabCount(window);

    await middleClickInlineAncestor(window, 'Parent');
    await selectDoc(window, m.get('Child')!);
    await cmdClickInlineAncestor(window, 'Parent');

    expect(await getTabCount(window)).toBe(tabsBefore + 2);
  });
});

// ── Additional Stress Tests ─────────────────────────────────────────

test.describe('BreadcrumbBar — Stress Tests (Extended)', () => {
  test('20-level deep nesting: correct inline/collapsed split', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 20; i++) {
      specs.push({
        title: `D${i}`,
        ...(i > 1 ? { parentTitle: `D${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);
    await selectDoc(window, m.get('D20')!);

    // 19 ancestors: 4 inline, 15 collapsed
    const inline = await getInlineAncestorTexts(window);
    expect(inline).toHaveLength(4);
    expect(inline).toEqual(['D16', 'D17', 'D18', 'D19']);

    await openCollapsePopover(window);
    const collapsed = await getCollapsedAncestorTexts(window);
    expect(collapsed).toHaveLength(15);
    expect(collapsed[0]).toBe('D1');
    expect(collapsed[14]).toBe('D15');
  });

  test('navigate from level 20 to level 1 via collapsed popover', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 20; i++) {
      specs.push({
        title: `X${i}`,
        ...(i > 1 ? { parentTitle: `X${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);
    await selectDoc(window, m.get('X20')!);

    await openCollapsePopover(window);
    await clickCollapsedAncestor(window, 'X1');
    expect(await getSelectedDocId(window)).toBe(m.get('X1')!);

    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual([]);
  });

  test('wide tree: parent with 20 children, navigate to each child and verify breadcrumb', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [{ title: 'Hub' }];
    for (let i = 1; i <= 20; i++) {
      specs.push({ title: `Spoke${i}`, parentTitle: 'Hub' });
    }
    const m = await seedTree(window, specs);

    for (let i = 1; i <= 20; i++) {
      await selectDoc(window, m.get(`Spoke${i}`)!);
      const ancestors = await getInlineAncestorTexts(window);
      expect(ancestors).toEqual(['Hub']);
      await expect(window.locator(BREADCRUMB_NAV)).toContainText(`Spoke${i}`);
    }
  });

  test('rapid back-and-forth between two deeply nested notes', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 5; i++) {
      specs.push({
        title: `ChainA${i}`,
        ...(i > 1 ? { parentTitle: `ChainA${i - 1}` } : {}),
      });
    }
    for (let i = 1; i <= 5; i++) {
      specs.push({
        title: `ChainB${i}`,
        ...(i > 1 ? { parentTitle: `ChainB${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);

    for (let i = 0; i < 10; i++) {
      await selectDoc(window, m.get('ChainA5')!);
      await expect(window.locator(BREADCRUMB_NAV)).toContainText('ChainA4');
      await expect(window.locator(BREADCRUMB_NAV)).toContainText('ChainA5');

      await selectDoc(window, m.get('ChainB5')!);
      await expect(window.locator(BREADCRUMB_NAV)).toContainText('ChainB4');
      await expect(window.locator(BREADCRUMB_NAV)).toContainText('ChainB5');
    }
  });

  test('collapse threshold boundary: exactly 4 ancestors shows no ellipsis, 5 shows ellipsis', async ({ window }) => {
    // 4 ancestors (5 levels): no collapse
    const m4 = await seedTree(window, [
      { title: 'A1' },
      { title: 'A2', parentTitle: 'A1' },
      { title: 'A3', parentTitle: 'A2' },
      { title: 'A4', parentTitle: 'A3' },
      { title: 'A5', parentTitle: 'A4' },
    ]);
    await selectDoc(window, m4.get('A5')!);
    expect(await isEllipsisVisible(window)).toBe(false);
    expect(await getInlineAncestorTexts(window)).toEqual(['A1', 'A2', 'A3', 'A4']);

    // 5 ancestors (6 levels): collapse kicks in
    const m5 = await seedTree(window, [
      { title: 'B1' },
      { title: 'B2', parentTitle: 'B1' },
      { title: 'B3', parentTitle: 'B2' },
      { title: 'B4', parentTitle: 'B3' },
      { title: 'B5', parentTitle: 'B4' },
      { title: 'B6', parentTitle: 'B5' },
    ]);
    await selectDoc(window, m5.get('B6')!);
    expect(await isEllipsisVisible(window)).toBe(true);
    expect(await getInlineAncestorTexts(window)).toEqual(['B2', 'B3', 'B4', 'B5']);
  });

  test('navigate up and down a 10-level chain alternating click and middle-click', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 10; i++) {
      specs.push({
        title: `Z${i}`,
        ...(i > 1 ? { parentTitle: `Z${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);
    await selectDoc(window, m.get('Z10')!);
    const initialTabs = await getTabCount(window);

    // Go up 3 levels via click (navigates in place)
    for (let level = 9; level >= 7; level--) {
      const target = `Z${level}`;
      const inlineTexts = await getInlineAncestorTexts(window);
      if (inlineTexts.includes(target)) {
        await clickInlineAncestor(window, target);
      } else {
        await openCollapsePopover(window);
        await clickCollapsedAncestor(window, target);
      }
    }
    // Tab count should be same (click navigates in place)
    expect(await getTabCount(window)).toBe(initialTabs);
    expect(await getSelectedDocId(window)).toBe(m.get('Z7')!);

    // Now middle-click 3 ancestors to open new tabs
    const ancestors = await getInlineAncestorTexts(window);
    for (const ancestor of ancestors.slice(0, 3)) {
      await middleClickInlineAncestor(window, ancestor);
      await selectDoc(window, m.get('Z7')!); // re-select to keep breadcrumb
    }
    expect(await getTabCount(window)).toBe(initialTabs + 3);
  });

  test('many documents: 50 flat notes, select each and verify breadcrumb shows only its name', async ({ window }) => {
    const specs: Array<{ title: string }> = [];
    for (let i = 1; i <= 50; i++) {
      specs.push({ title: `Note${i}` });
    }
    const m = await seedTree(window, specs);

    // Spot-check a few
    for (const idx of [1, 10, 25, 50]) {
      await selectDoc(window, m.get(`Note${idx}`)!);
      await expect(window.locator(BREADCRUMB_NAV)).toContainText(`Note${idx}`);
      const ancestors = await getInlineAncestorTexts(window);
      expect(ancestors).toEqual([]);
    }
  });

  test('rebuild tree: delete all notes, create new tree, breadcrumb reflects new structure', async ({ window }) => {
    const m1 = await seedTree(window, [
      { title: 'OldParent' },
      { title: 'OldChild', parentTitle: 'OldParent' },
    ]);
    await selectDoc(window, m1.get('OldChild')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('OldParent');

    // Trash everything
    await window.evaluate(async () => {
      const store = (window as any).__documentStore;
      const docs = store.getState().documents;
      for (const doc of docs) {
        await store.getState().trashDocument(doc.id);
      }
    });
    await window.waitForTimeout(500);

    // Create new tree
    const m2 = await seedTree(window, [
      { title: 'NewParent' },
      { title: 'NewChild', parentTitle: 'NewParent' },
    ]);
    await selectDoc(window, m2.get('NewChild')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('NewParent');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('OldParent');
  });
});

// ── Additional Responsive Tests ─────────────────────────────────────

test.describe('BreadcrumbBar — Responsive (Extended)', () => {
  // Only medium and wide breakpoints exist (app minWidth is 680px, see src/index.ts).

  test('medium mode: only direct parent shown inline', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'G' },
      { title: 'P', parentTitle: 'G' },
      { title: 'C', parentTitle: 'P' },
    ]);
    await selectDoc(window, m.get('C')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getContentSize();
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(600, win.getContentSize()[1]);
    });
    await window.waitForTimeout(500);

    const inline = await getInlineAncestorTexts(window);
    expect(inline).toEqual(['P']);
    await expect(window.locator(ELLIPSIS_TRIGGER)).toBeVisible();

    await openCollapsePopover(window);
    const collapsed = await getCollapsedAncestorTexts(window);
    expect(collapsed).toEqual(['G']);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });

  test('resize from medium to wide restores full inline trail', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
    ]);
    await selectDoc(window, m.get('C')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getContentSize();
    });

    // Go to medium (680px floor due to minWidth: 680)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(600, win.getContentSize()[1]);
    });
    await window.waitForTimeout(500);
    // Medium: threshold 1, only direct parent inline
    expect(await getInlineAncestorTexts(window)).toEqual(['B']);

    // Go wide
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(900, win.getContentSize()[1]);
    });
    await window.waitForTimeout(500);
    expect(await getInlineAncestorTexts(window)).toEqual(['A', 'B']);
    expect(await isEllipsisVisible(window)).toBe(false);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });

  test('navigation still works at each breakpoint', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Child', parentTitle: 'Root' },
    ]);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getContentSize();
    });

    // Wide: click inline ancestor
    await selectDoc(window, m.get('Child')!);
    await clickInlineAncestor(window, 'Root');
    expect(await getSelectedDocId(window)).toBe(m.get('Root')!);

    // Medium: ancestor goes to ellipsis for 2+ ancestors, but with 1 ancestor it stays inline
    await selectDoc(window, m.get('Child')!);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(600, win.getContentSize()[1]);
    });
    await window.waitForTimeout(500);

    // With only 1 ancestor at medium threshold 1, it should still be inline
    const mediumInline = await getInlineAncestorTexts(window);
    expect(mediumInline).toEqual(['Root']);
    await clickInlineAncestor(window, 'Root');
    expect(await getSelectedDocId(window)).toBe(m.get('Root')!);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });

  test('cmd+click and middle-click work at medium breakpoint via popover', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'Grandparent' },
      { title: 'Parent', parentTitle: 'Grandparent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getContentSize();
    });

    // Medium mode: threshold 1, so Grandparent goes into collapse popover
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(600, win.getContentSize()[1]);
    });
    await window.waitForTimeout(500);

    const tabsBefore = await getTabCount(window);

    // cmd+click collapsed Grandparent via popover
    await openCollapsePopover(window);
    await cmdClickCollapsedAncestor(window, 'Grandparent');
    expect(await getTabCount(window)).toBe(tabsBefore + 1);

    // Re-select child and middle-click collapsed Grandparent via popover
    await selectDoc(window, m.get('Child')!);
    await openCollapsePopover(window);
    await middleClickCollapsedAncestor(window, 'Grandparent');
    expect(await getTabCount(window)).toBe(tabsBefore + 2);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });

  test('rapid resize between breakpoints does not crash or leave stale state', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'R' },
      { title: 'M', parentTitle: 'R' },
      { title: 'L', parentTitle: 'M' },
    ]);
    await selectDoc(window, m.get('L')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getContentSize();
    });

    // Rapidly cycle through breakpoints
    for (let i = 0; i < 5; i++) {
      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setContentSize(350, win.getContentSize()[1]);
      });
      await window.waitForTimeout(150);

      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setContentSize(600, win.getContentSize()[1]);
      });
      await window.waitForTimeout(150);

      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setContentSize(900, win.getContentSize()[1]);
      });
      await window.waitForTimeout(150);
    }

    // After settling at wide, should be correct
    await window.waitForTimeout(500);
    await expect(window.locator(BREADCRUMB_NAV)).toBeVisible();
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('L');

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });
});

// ── Robustness & Corner Cases ───────────────────────────────────────

test.describe('BreadcrumbBar — Robustness', () => {
  test('orphaned parentId (parent deleted from DB): ancestor chain stops gracefully', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Grandparent' },
      { title: 'Parent', parentTitle: 'Grandparent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    expect(await getInlineAncestorTexts(window)).toEqual(['Grandparent', 'Parent']);

    // Simulate orphaned parentId by removing grandparent from store only
    await window.evaluate(async (gpId) => {
      const store = (window as any).__documentStore;
      const docs = store.getState().documents.filter((d: any) => d.id !== gpId);
      store.setState({ documents: docs });
    }, m.get('Grandparent')!);
    await window.waitForTimeout(300);

    // Chain should stop at Parent (grandparent no longer found)
    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['Parent']);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');
  });

  test('ZWJ emoji sequence in ancestor renders without breaking layout', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Family', emoji: '👨‍👩‍👧‍👦' },
      { title: 'Child Note', parentTitle: 'Family' },
    ]);
    await selectDoc(window, m.get('Child Note')!);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('👨‍👩‍👧‍👦');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Family');

    // Navigation still works
    await clickInlineAncestor(window, 'Family');
    expect(await getSelectedDocId(window)).toBe(m.get('Family')!);
  });

  test('flag emoji in ancestor', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Japan Notes', emoji: '🇯🇵' },
      { title: 'Tokyo', parentTitle: 'Japan Notes' },
    ]);
    await selectDoc(window, m.get('Tokyo')!);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('🇯🇵');
  });

  test('close current tab while ellipsis popover is open', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    // Open two tabs so closing one doesn't leave us with nothing
    await selectDoc(window, m.get('L1')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('L6')!);
    await window.waitForTimeout(200);
    await selectDoc(window, m.get('L6')!);

    await openCollapsePopover(window);
    await expect(window.locator(COLLAPSE_POPOVER)).toBeVisible();

    // Close current tab
    await window.evaluate(() => {
      const store = (window as any).__documentStore;
      const tabId = store.getState().selectedId;
      if (tabId) store.getState().closeTab(tabId);
    });
    await window.waitForTimeout(400);

    // Should not crash. Popover should be gone.
    await expect(window.locator(COLLAPSE_POPOVER)).not.toBeVisible();
    // Should fall back to L1's tab, which has no ancestors
    await expect(window.locator(BREADCRUMB_NAV)).toBeVisible();
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('L1');
    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual([]);
  });

  test('navigate via breadcrumb during active debounced save flushes content', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Type something in the editor (triggers debounced save)
    const title = window.locator('main:visible h1.editor-title');
    await title.click();
    await window.keyboard.press('End');
    await window.keyboard.type(' edited');
    // Don't wait for debounce — navigate immediately
    await clickInlineAncestor(window, 'Parent');

    // Wait for any flush
    await window.waitForTimeout(1000);

    // Verify the child's title was saved
    await expect(async () => {
      const docs = await listDocumentsFromDb(window);
      const child = docs.find((d) => d.id === m.get('Child')!);
      expect(child?.title).toContain('edited');
    }).toPass({ timeout: 5000 });
  });

  test('move subtree to new parent: all children breadcrumbs update', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'OldRoot' },
      { title: 'SubParent', parentTitle: 'OldRoot' },
      { title: 'SubChild', parentTitle: 'SubParent' },
      { title: 'NewRoot' },
    ]);

    // Move SubParent under NewRoot
    await window.evaluate(async ({ subParentId, newRootId }) => {
      await (window as any).lychee.invoke('documents.move', {
        id: subParentId,
        parentId: newRootId,
        sortOrder: 0,
      });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, { subParentId: m.get('SubParent')!, newRootId: m.get('NewRoot')! });
    await window.waitForTimeout(400);

    // Select SubChild — should now show NewRoot > SubParent > SubChild
    await selectDoc(window, m.get('SubChild')!);
    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['NewRoot', 'SubParent']);
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('OldRoot');
  });

  test('empty documents array: breadcrumb not visible', async ({ window }) => {
    // Ensure no documents
    await window.evaluate(async () => {
      const store = (window as any).__documentStore;
      const docs = store.getState().documents;
      for (const doc of docs) {
        await store.getState().trashDocument(doc.id);
      }
    });
    await window.waitForTimeout(500);

    await expect(window.locator(BREADCRUMB_NAV)).not.toBeVisible();
  });

  test('ancestor renamed to empty string shows "Untitled" in breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Named Parent' },
      { title: 'Child', parentTitle: 'Named Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Named Parent');

    // Rename to empty
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, title: '' });
      const store = (window as any).__documentStore;
      store.getState().updateDocumentInStore(id, { title: '' });
    }, m.get('Named Parent')!);
    await window.waitForTimeout(300);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Untitled');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('Named Parent');
  });

  test('very long title (500 chars): truncated in breadcrumb, full title in tooltip', async ({ window }) => {
    const longTitle = 'A'.repeat(500);
    const m = await seedTree(window, [
      { title: longTitle },
      { title: 'Child', parentTitle: longTitle },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Ancestor button should have the full title as tooltip
    const button = window.locator(`${BREADCRUMB_NAV} button[title]`).first();
    await expect(button).toHaveAttribute('title', longTitle);

    // The text span inside should have the `truncate` class and a constrained maxWidth
    const textSpan = button.locator('span.truncate');
    await expect(textSpan).toBeVisible();
    const maxWidth = await textSpan.evaluate((el) => el.style.maxWidth);
    expect(maxWidth).toBeTruthy(); // e.g. "120px"
  });

  test('breadcrumb navigable after switching via store directly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'P1' },
      { title: 'C1', parentTitle: 'P1' },
      { title: 'P2' },
      { title: 'C2', parentTitle: 'P2' },
    ]);

    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('C1')!);
    await window.waitForTimeout(300);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('P1');
    await clickInlineAncestor(window, 'P1');
    expect(await getSelectedDocId(window)).toBe(m.get('P1')!);

    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('C2')!);
    await window.waitForTimeout(300);

    await expect(window.locator(BREADCRUMB_NAV)).toContainText('P2');
    await clickInlineAncestor(window, 'P2');
    expect(await getSelectedDocId(window)).toBe(m.get('P2')!);
  });

  test('swap parent and child via move: breadcrumb reflects swapped hierarchy', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'WasParent' },
      { title: 'WasChild', parentTitle: 'WasParent' },
    ]);

    // Unnest child, then nest parent under child
    await window.evaluate(async ({ childId, parentId }) => {
      await (window as any).lychee.invoke('documents.move', {
        id: childId,
        parentId: null,
        sortOrder: 0,
      });
      await (window as any).lychee.invoke('documents.move', {
        id: parentId,
        parentId: childId,
        sortOrder: 0,
      });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, { childId: m.get('WasChild')!, parentId: m.get('WasParent')! });
    await window.waitForTimeout(400);

    // Select WasParent — should now show WasChild as ancestor
    await selectDoc(window, m.get('WasParent')!);
    const ancestors = await getInlineAncestorTexts(window);
    expect(ancestors).toEqual(['WasChild']);
  });

  test('deeply nested note moved to root: all ancestors disappear', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 8; i++) {
      specs.push({
        title: `Lvl${i}`,
        ...(i > 1 ? { parentTitle: `Lvl${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);
    await selectDoc(window, m.get('Lvl8')!);

    expect(await isEllipsisVisible(window)).toBe(true);

    // Move to root
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.move', {
        id,
        parentId: null,
        sortOrder: 0,
      });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Lvl8')!);
    await window.waitForTimeout(400);

    expect(await getInlineAncestorTexts(window)).toEqual([]);
    expect(await isEllipsisVisible(window)).toBe(false);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Lvl8');
  });
});

// ── Duplicate / Copy Tab Scenarios ──────────────────────────────────

test.describe('BreadcrumbBar — Duplicate Tab Creation', () => {
  test('breadcrumb click creates duplicate when ancestor already open in another tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Open Parent in tab 1
    await selectDoc(window, m.get('Parent')!);
    // Open Child in tab 2
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);
    await selectDoc(window, m.get('Child')!);

    const before = await getTabState(window);
    const parentTabsBefore = before.tabs.filter((t) => t.docId === m.get('Parent')!).length;
    expect(parentTabsBefore).toBe(1);

    // Click Parent in breadcrumb — navigates current tab in-place
    await clickInlineAncestor(window, 'Parent');

    const after = await getTabState(window);
    // Now 2 tab entries point to Parent (original tab + navigated-in-place tab)
    const parentTabsAfter = after.tabs.filter((t) => t.docId === m.get('Parent')!).length;
    expect(parentTabsAfter).toBe(2);
    // Tab count unchanged (navigated in-place, not appended)
    expect(after.tabs.length).toBe(before.tabs.length);
    // Selected tab changed (new tabId was generated)
    expect(after.selectedId).not.toBe(before.selectedId);
  });

  test('cmd+click always creates a new background tab regardless of existing duplicates', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const initialTabs = await getTabCount(window);

    // Cmd+click Parent 3 times, re-selecting Child each time to restore breadcrumb
    await cmdClickInlineAncestor(window, 'Parent');
    await selectDoc(window, m.get('Child')!);
    await cmdClickInlineAncestor(window, 'Parent');
    await selectDoc(window, m.get('Child')!);
    await cmdClickInlineAncestor(window, 'Parent');

    // 3 new background tabs created
    expect(await getTabCount(window)).toBe(initialTabs + 3);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Parent')!).length).toBe(3);
    // Still on Child — cmd+click doesn't change selection
    expect(await getSelectedDocId(window)).toBe(m.get('Child')!);
  });

  test('middle-click always creates a new background tab regardless of existing duplicates', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const initialTabs = await getTabCount(window);

    await middleClickInlineAncestor(window, 'Parent');
    await selectDoc(window, m.get('Child')!);
    await middleClickInlineAncestor(window, 'Parent');
    await selectDoc(window, m.get('Child')!);
    await middleClickInlineAncestor(window, 'Parent');

    expect(await getTabCount(window)).toBe(initialTabs + 3);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Parent')!).length).toBe(3);
    expect(await getSelectedDocId(window)).toBe(m.get('Child')!);
  });

  test('cmd+click and middle-click on same ancestor both add independent tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const initialTabs = await getTabCount(window);

    await cmdClickInlineAncestor(window, 'Parent');
    await selectDoc(window, m.get('Child')!);
    await middleClickInlineAncestor(window, 'Parent');

    expect(await getTabCount(window)).toBe(initialTabs + 2);

    const state = await getTabState(window);
    const parentTabs = state.tabs.filter((t) => t.docId === m.get('Parent')!);
    expect(parentTabs.length).toBe(2);
    // Each has a unique tabId
    expect(parentTabs[0].tabId).not.toBe(parentTabs[1].tabId);
  });

  test('navigate + cmd+click + middle-click: three different ways to create duplicates', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Mid', parentTitle: 'Root' },
      { title: 'Leaf', parentTitle: 'Mid' },
    ]);
    // Tab 1: open Root directly
    await selectDoc(window, m.get('Root')!);
    // Tab 2: open Leaf
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Leaf')!);
    await window.waitForTimeout(200);
    await selectDoc(window, m.get('Leaf')!);

    // Navigate current tab (Leaf) to Root via breadcrumb click → duplicate Root
    await clickInlineAncestor(window, 'Root');
    const afterNav = await getOpenTabDocIds(window);
    expect(afterNav.filter((id) => id === m.get('Root')!).length).toBe(2);

    // Go back to Leaf for more duplicates
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Leaf')!);
    await window.waitForTimeout(300);

    // Cmd+click Root → another duplicate
    await cmdClickInlineAncestor(window, 'Root');
    const afterCmd = await getOpenTabDocIds(window);
    expect(afterCmd.filter((id) => id === m.get('Root')!).length).toBe(2);

    // Go back to Leaf again
    await selectDoc(window, m.get('Leaf')!);
    // Middle-click Root → yet another duplicate
    await middleClickInlineAncestor(window, 'Root');
    const afterMiddle = await getOpenTabDocIds(window);
    expect(afterMiddle.filter((id) => id === m.get('Root')!).length).toBe(3);
  });
});

test.describe('BreadcrumbBar — Duplicate Tab State & Independence', () => {
  test('switching between duplicate tabs shows consistent breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Child', parentTitle: 'Root' },
    ]);
    // Create 2 tabs for Child
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(childTabs.length).toBe(2);

    // Select first Child tab
    await selectTabById(window, childTabs[0].tabId);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Root');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');

    // Select second Child tab — same breadcrumb
    await selectTabById(window, childTabs[1].tabId);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Root');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');
  });

  test('navigate one duplicate away: other duplicate tab keeps its doc', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Child', parentTitle: 'Root' },
      { title: 'Sibling' },
    ]);
    // Create 2 tabs for Child
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(childTabs.length).toBe(2);

    // Select first Child tab, navigate it to Sibling
    await selectTabById(window, childTabs[0].tabId);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Sibling')!);
    await window.waitForTimeout(300);

    // Verify: current tab shows Sibling
    expect(await getSelectedDocId(window)).toBe(m.get('Sibling')!);

    // Other tab still shows Child
    const afterState = await getTabState(window);
    const remainingChildTabs = afterState.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(remainingChildTabs.length).toBe(1);
    expect(remainingChildTabs[0].tabId).toBe(childTabs[1].tabId);

    // Switch to the remaining Child tab — breadcrumb still correct
    await selectTabById(window, childTabs[1].tabId);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Root');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');
  });

  test('navigate duplicate tab via breadcrumb: only that tab changes, other stays', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Grandparent' },
      { title: 'Parent', parentTitle: 'Grandparent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Open Child in 2 tabs
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);

    // Select first Child tab, click Parent in breadcrumb → navigates to Parent
    await selectTabById(window, childTabs[0].tabId);
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);

    // Second Child tab still shows Child
    const afterState = await getTabState(window);
    const stillChild = afterState.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(stillChild.length).toBe(1);
    expect(stillChild[0].tabId).toBe(childTabs[1].tabId);

    // Switched tab now shows Parent (exactly 1 — no Parent tab existed before)
    const parentTabs = afterState.tabs.filter((t) => t.docId === m.get('Parent')!);
    expect(parentTabs.length).toBe(1);
  });

  test('two sibling children: cmd+click parent breadcrumb from each creates 2 separate parent tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child1', parentTitle: 'Parent' },
      { title: 'Child2', parentTitle: 'Parent' },
    ]);
    // Open both children in separate tabs
    await selectDoc(window, m.get('Child1')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child2')!);
    await window.waitForTimeout(200);

    const initialTabs = await getTabCount(window);

    // Cmd+click Parent from Child1's breadcrumb
    await selectDoc(window, m.get('Child1')!);
    await cmdClickInlineAncestor(window, 'Parent');

    // Cmd+click Parent from Child2's breadcrumb
    await selectDoc(window, m.get('Child2')!);
    await cmdClickInlineAncestor(window, 'Parent');

    // 2 new tabs for Parent created
    expect(await getTabCount(window)).toBe(initialTabs + 2);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Parent')!).length).toBe(2);
  });

  test('two sibling children: breadcrumb-click parent from each creates 2 duplicate parent tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child1', parentTitle: 'Parent' },
      { title: 'Child2', parentTitle: 'Parent' },
    ]);
    // Open both children
    await selectDoc(window, m.get('Child1')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child2')!);
    await window.waitForTimeout(200);

    // Navigate Child1's tab → Parent
    await selectDoc(window, m.get('Child1')!);
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);

    // Navigate Child2's tab → Parent
    await selectDoc(window, m.get('Child2')!);
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);

    // Both tabs now show Parent
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Parent')!).length).toBe(2);
    // No Child tabs remain (both navigated away)
    expect(tabs.filter((id) => id === m.get('Child1')!).length).toBe(0);
    expect(tabs.filter((id) => id === m.get('Child2')!).length).toBe(0);
  });
});

test.describe('BreadcrumbBar — Duplicate Tab Lifecycle', () => {
  test('close one duplicate tab: others remain and work', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Create 3 tabs for Child via cmd+click
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(childTabs.length).toBe(3);

    // Close the first one
    await window.evaluate((tabId) => {
      (window as any).__documentStore.getState().closeTab(tabId);
    }, childTabs[0].tabId);
    await window.waitForTimeout(200);

    // 2 remain
    const afterState = await getTabState(window);
    const remaining = afterState.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(remaining.length).toBe(2);

    // The remaining tabs still work — select one and verify breadcrumb
    await selectTabById(window, remaining[0].tabId);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent');
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Child');
  });

  test('close all duplicate tabs one by one: selection moves correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Other' },
    ]);
    // Create 3 tabs for Root
    await selectDoc(window, m.get('Root')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Root')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Root')!);
    // Open Other as safety net
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Other')!);
    await window.waitForTimeout(200);

    // Close Root tabs one by one
    for (let i = 0; i < 3; i++) {
      const state = await getTabState(window);
      const rootTab = state.tabs.find((t) => t.docId === m.get('Root')!);
      if (!rootTab) break;
      await window.evaluate((tabId) => {
        (window as any).__documentStore.getState().closeTab(tabId);
      }, rootTab.tabId);
      await window.waitForTimeout(200);
    }

    // All Root tabs gone, Other is selected
    const finalState = await getTabState(window);
    expect(finalState.tabs.filter((t) => t.docId === m.get('Root')!).length).toBe(0);
    expect(finalState.tabs.some((t) => t.docId === m.get('Other')!)).toBe(true);
    expect(await getSelectedDocId(window)).toBe(m.get('Other')!);
  });

  test('trash doc with 3 duplicate tabs: all close', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Target' },
      { title: 'Survivor' },
    ]);
    // Create 3 tabs for Target
    await selectDoc(window, m.get('Target')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Target')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Target')!);
    // Open Survivor
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Survivor')!);
    await window.waitForTimeout(200);

    const before = await getTabState(window);
    expect(before.tabs.filter((t) => t.docId === m.get('Target')!).length).toBe(3);

    // Trash Target
    await window.evaluate(async (id) => {
      const store = (window as any).__documentStore;
      await store.getState().trashDocument(id);
    }, m.get('Target')!);
    await window.waitForTimeout(500);

    // ALL Target tabs gone
    const after = await getTabState(window);
    expect(after.tabs.filter((t) => t.docId === m.get('Target')!).length).toBe(0);
    // Survivor is now selected
    expect(await getSelectedDocId(window)).toBe(m.get('Survivor')!);
  });

  test('trash ancestor with duplicate child tabs: all descendant tabs close', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Child', parentTitle: 'Root' },
      { title: 'Grandchild', parentTitle: 'Child' },
      { title: 'Safe' },
    ]);
    // Open 2 tabs for Child, 2 for Grandchild
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Grandchild')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Grandchild')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Safe')!);
    await window.waitForTimeout(200);

    // Verify precondition: duplicate tabs actually exist
    const before = await getTabState(window);
    expect(before.tabs.filter((t) => t.docId === m.get('Child')!).length).toBe(2);
    expect(before.tabs.filter((t) => t.docId === m.get('Grandchild')!).length).toBe(2);

    // Trash Root — cascade removes Root, Child, Grandchild
    await window.evaluate(async (id) => {
      const store = (window as any).__documentStore;
      await store.getState().trashDocument(id);
    }, m.get('Root')!);
    await window.waitForTimeout(500);

    const after = await getTabState(window);
    expect(after.tabs.filter((t) => t.docId === m.get('Child')!).length).toBe(0);
    expect(after.tabs.filter((t) => t.docId === m.get('Grandchild')!).length).toBe(0);
    expect(after.tabs.filter((t) => t.docId === m.get('Root')!).length).toBe(0);
    expect(await getSelectedDocId(window)).toBe(m.get('Safe')!);
  });

  test('rename doc with duplicate tabs: all tabs reflect new name', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'OldName' },
    ]);
    // Create 3 tabs for the doc
    await selectDoc(window, m.get('OldName')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('OldName')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('OldName')!);
    await window.waitForTimeout(200);

    // Rename
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, title: 'NewName' });
      const store = (window as any).__documentStore;
      store.getState().updateDocumentInStore(id, { title: 'NewName' });
    }, m.get('OldName')!);
    await window.waitForTimeout(300);

    // All tabs should show NewName — breadcrumb shows it for the selected tab
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('NewName');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('OldName');
  });

  test('rename ancestor with duplicate child tabs: breadcrumb updates for all', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'OldParent' },
      { title: 'Child', parentTitle: 'OldParent' },
    ]);
    // Open Child in 2 tabs
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);

    // Rename parent
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, title: 'NewParent' });
      const store = (window as any).__documentStore;
      store.getState().updateDocumentInStore(id, { title: 'NewParent' });
    }, m.get('OldParent')!);
    await window.waitForTimeout(300);

    // Check breadcrumb from first Child tab
    await selectTabById(window, childTabs[0].tabId);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('NewParent');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('OldParent');

    // Check breadcrumb from second Child tab
    await selectTabById(window, childTabs[1].tabId);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('NewParent');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('OldParent');
  });
});

test.describe('BreadcrumbBar — Duplicate Tab Stress Tests', () => {
  test('open 10 duplicate tabs via cmd+click, verify all exist, close all', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
      { title: 'Fallback' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const initialTabs = await getTabCount(window);

    // Cmd+click Parent 10 times
    for (let i = 0; i < 10; i++) {
      await selectDoc(window, m.get('Child')!);
      await cmdClickInlineAncestor(window, 'Parent');
    }

    expect(await getTabCount(window)).toBe(initialTabs + 10);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Parent')!).length).toBe(10);

    // Open fallback, then close all Parent tabs
    await selectDoc(window, m.get('Fallback')!);
    for (let i = 0; i < 10; i++) {
      const state = await getTabState(window);
      const parentTab = state.tabs.find((t) => t.docId === m.get('Parent')!);
      if (!parentTab) break;
      await window.evaluate((tabId) => {
        (window as any).__documentStore.getState().closeTab(tabId);
      }, parentTab.tabId);
    }
    await window.waitForTimeout(200);

    const finalTabs = await getOpenTabDocIds(window);
    expect(finalTabs.filter((id) => id === m.get('Parent')!).length).toBe(0);
  });

  test('cmd+click every ancestor in a 6-level chain: creates a tab per level', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    await selectDoc(window, m.get('L6')!);
    const initialTabs = await getTabCount(window);

    // Cmd+click each visible ancestor (L2-L5 are inline, L1 is collapsed)
    const inlineAncestors = await getInlineAncestorTexts(window);
    for (const ancestor of inlineAncestors) {
      await selectDoc(window, m.get('L6')!);
      await cmdClickInlineAncestor(window, ancestor);
    }

    // Also cmd+click the collapsed ancestor
    await selectDoc(window, m.get('L6')!);
    await openCollapsePopover(window);
    await cmdClickCollapsedAncestor(window, 'L1');

    // 5 new tabs (L1-L5), each for a different ancestor
    expect(await getTabCount(window)).toBe(initialTabs + 5);
    for (let i = 1; i <= 5; i++) {
      const tabs = await getOpenTabDocIds(window);
      expect(tabs).toContain(m.get(`L${i}`)!);
    }
  });

  test('navigate all duplicate tabs to different docs: all become unique', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'A', parentTitle: 'Root' },
      { title: 'B', parentTitle: 'Root' },
      { title: 'C', parentTitle: 'Root' },
    ]);
    // Create 3 tabs for Root
    await selectDoc(window, m.get('Root')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Root')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Root')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const rootTabs = state.tabs.filter((t) => t.docId === m.get('Root')!);
    expect(rootTabs.length).toBe(3);

    // Navigate each duplicate to a different child
    const children = ['A', 'B', 'C'];
    for (let i = 0; i < 3; i++) {
      await selectTabById(window, rootTabs[i].tabId);
      await window.evaluate((docId) => {
        (window as any).__documentStore.getState().navigateCurrentTab(docId);
      }, m.get(children[i])!);
      await window.waitForTimeout(200);
    }

    // No Root tabs remain, each child has exactly 1 tab
    const after = await getTabState(window);
    expect(after.tabs.filter((t) => t.docId === m.get('Root')!).length).toBe(0);
    for (const child of children) {
      expect(after.tabs.filter((t) => t.docId === m.get(child)!).length).toBe(1);
    }
  });

  test('rapid cmd+click spam: 20 rapid clicks all register', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);
    const initialTabs = await getTabCount(window);

    // Rapid-fire 20 cmd+clicks without re-selecting Child between each
    // After the first cmd+click, the breadcrumb still shows Child's context
    // because cmd+click doesn't change selection
    const nav = window.locator(BREADCRUMB_NAV);
    const button = nav.locator('button[title="Parent"]');
    for (let i = 0; i < 20; i++) {
      await button.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    }
    await window.waitForTimeout(500);

    // All 20 should have registered (cmd+click stays on Child, so breadcrumb persists)
    expect(await getTabCount(window)).toBe(initialTabs + 20);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Parent')!).length).toBe(20);
  });

  test('chain navigation: cmd+click to open ancestor, select it, cmd+click its ancestor, repeat', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
    ]);
    await selectDoc(window, m.get('L4')!);
    const initialTabs = await getTabCount(window);

    // Cmd+click L3 → opens background tab for L3
    await cmdClickInlineAncestor(window, 'L3');
    // Select the new L3 tab
    await selectDoc(window, m.get('L3')!);
    // Cmd+click L2 from L3's breadcrumb
    await cmdClickInlineAncestor(window, 'L2');
    // Select the new L2 tab
    await selectDoc(window, m.get('L2')!);
    // Cmd+click L1 from L2's breadcrumb
    await cmdClickInlineAncestor(window, 'L1');

    // 3 new tabs created
    expect(await getTabCount(window)).toBe(initialTabs + 3);
    const tabs = await getOpenTabDocIds(window);
    expect(tabs).toContain(m.get('L3')!);
    expect(tabs).toContain(m.get('L2')!);
    expect(tabs).toContain(m.get('L1')!);
  });

  test('move doc with duplicates to new parent: breadcrumbs update for all tabs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'OldParent' },
      { title: 'NewParent' },
      { title: 'Child', parentTitle: 'OldParent' },
    ]);
    // Open Child in 2 tabs
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);

    // Move Child to NewParent
    await window.evaluate(async ({ childId, newParentId }) => {
      await (window as any).lychee.invoke('documents.move', {
        id: childId,
        parentId: newParentId,
        sortOrder: 0,
      });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, { childId: m.get('Child')!, newParentId: m.get('NewParent')! });
    await window.waitForTimeout(400);

    // Both tabs should show NewParent in breadcrumb
    await selectTabById(window, childTabs[0].tabId);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('NewParent');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('OldParent');

    await selectTabById(window, childTabs[1].tabId);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('NewParent');
    await expect(window.locator(BREADCRUMB_NAV)).not.toContainText('OldParent');
  });

  test('duplicate tabs after breadcrumb nav: close original, remaining duplicate still works', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Tab 1: Parent, Tab 2: Child
    await selectDoc(window, m.get('Parent')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);
    await selectDoc(window, m.get('Child')!);

    // Navigate Child tab to Parent via breadcrumb → now 2 tabs show Parent
    await clickInlineAncestor(window, 'Parent');
    const state = await getTabState(window);
    const parentTabs = state.tabs.filter((t) => t.docId === m.get('Parent')!);
    expect(parentTabs.length).toBe(2);

    // Close the ORIGINAL Parent tab (the one we opened first)
    // Find the tab that was NOT just navigated to (not the selected one)
    const otherParentTab = parentTabs.find((t) => t.tabId !== state.selectedId)!;
    await window.evaluate((tabId) => {
      (window as any).__documentStore.getState().closeTab(tabId);
    }, otherParentTab.tabId);
    await window.waitForTimeout(200);

    // Remaining tab still shows Parent and breadcrumb works
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Parent');
    const remaining = await getTabState(window);
    expect(remaining.tabs.filter((t) => t.docId === m.get('Parent')!).length).toBe(1);
  });

  test('deep chain: cmd+click all collapsed ancestors creates tabs for each', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 10; i++) {
      specs.push({
        title: `N${i}`,
        ...(i > 1 ? { parentTitle: `N${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);
    await selectDoc(window, m.get('N10')!);

    const initialTabs = await getTabCount(window);

    // Open collapse popover and cmd+click each collapsed ancestor
    await openCollapsePopover(window);
    const collapsed = await getCollapsedAncestorTexts(window);
    for (const ancestor of collapsed) {
      // Cmd+click doesn't change selection, so we need to ensure the popover
      // fully closes before re-opening. Click outside to dismiss, then re-open.
      await window.locator('body').click({ position: { x: 10, y: 10 } });
      await window.waitForTimeout(400);
      await openCollapsePopover(window);
      await cmdClickCollapsedAncestor(window, ancestor);
    }

    // Also cmd+click the inline ancestors
    for (const ancestor of ['N6', 'N7', 'N8', 'N9']) {
      await selectDoc(window, m.get('N10')!);
      await cmdClickInlineAncestor(window, ancestor);
    }

    // 9 new tabs (N1 through N9)
    expect(await getTabCount(window)).toBe(initialTabs + 9);
    for (let i = 1; i <= 9; i++) {
      const tabs = await getOpenTabDocIds(window);
      expect(tabs).toContain(m.get(`N${i}`)!);
    }
  });

  test('mixed interaction: navigate, cmd+click, middle-click on duplicates, then trash', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Mid', parentTitle: 'Root' },
      { title: 'Leaf', parentTitle: 'Mid' },
      { title: 'Safe' },
    ]);
    await selectDoc(window, m.get('Safe')!);

    // Create tabs for Leaf: 1 via selectDoc, 2 via openTab
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Leaf')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Leaf')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Leaf')!);
    await window.waitForTimeout(200);

    // Select one Leaf tab
    await selectDoc(window, m.get('Leaf')!);
    // Cmd+click Mid → new tab for Mid
    await cmdClickInlineAncestor(window, 'Mid');
    // Middle-click Root → new tab for Root
    await selectDoc(window, m.get('Leaf')!);
    await middleClickInlineAncestor(window, 'Root');

    // Navigate one Leaf tab to Mid via breadcrumb click
    await selectDoc(window, m.get('Leaf')!);
    await clickInlineAncestor(window, 'Mid');

    // State: Safe, 2 Leaf tabs, 2 Mid tabs, 1 Root tab
    const tabs = await getOpenTabDocIds(window);
    expect(tabs.filter((id) => id === m.get('Leaf')!).length).toBe(2);
    expect(tabs.filter((id) => id === m.get('Mid')!).length).toBe(2);
    expect(tabs.filter((id) => id === m.get('Root')!).length).toBe(1);

    // Trash Root — cascade removes Root, Mid, Leaf
    await window.evaluate(async (id) => {
      const store = (window as any).__documentStore;
      await store.getState().trashDocument(id);
    }, m.get('Root')!);
    await window.waitForTimeout(500);

    // ALL tabs for Root, Mid, Leaf should be gone
    const afterTabs = await getOpenTabDocIds(window);
    expect(afterTabs.filter((id) => id === m.get('Root')!).length).toBe(0);
    expect(afterTabs.filter((id) => id === m.get('Mid')!).length).toBe(0);
    expect(afterTabs.filter((id) => id === m.get('Leaf')!).length).toBe(0);
    // Safe survives
    expect(await getSelectedDocId(window)).toBe(m.get('Safe')!);
  });
});

// ── Cross-Feature: Search + Breadcrumb ──────────────────────────────

test.describe('BreadcrumbBar — Search Bar Interaction', () => {
  /**
   * Helper: open the in-note search bar on the visible tab, type a query,
   * and return the counter text ("X/Y" or "0/0").
   */
  async function openSearchAndType(window: Page, query: string): Promise<string> {
    const main = window.locator(VISIBLE_MAIN);
    const trigger = main.locator('[data-testid="note-find-trigger"]');
    // Only click if not already expanded
    const expanded = await trigger.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await trigger.click();
      await window.waitForTimeout(200);
    }
    const input = main.locator('[data-testid="note-find-input"]');
    await input.fill(query);
    await window.waitForTimeout(300);
    return main.locator('[data-testid="note-find-counter"]').innerText();
  }

  /** Check if the search bar is expanded on the currently visible tab. */
  async function isSearchOpen(window: Page): Promise<boolean> {
    const main = window.locator(VISIBLE_MAIN);
    const trigger = main.locator('[data-testid="note-find-trigger"]');
    const expanded = await trigger.getAttribute('aria-expanded');
    return expanded === 'true';
  }

  /** Get the search input value on the currently visible tab. */
  async function getSearchQuery(window: Page): Promise<string> {
    const main = window.locator(VISIBLE_MAIN);
    const input = main.locator('[data-testid="note-find-input"]');
    return input.inputValue();
  }

  /** Get the search counter text on the currently visible tab. */
  async function getSearchCounter(window: Page): Promise<string> {
    const main = window.locator(VISIBLE_MAIN);
    return main.locator('[data-testid="note-find-counter"]').innerText();
  }

  test('navigate via breadcrumb clears search state (new tabId)', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Open search and type a query on Child
    await openSearchAndType(window, 'test query');
    expect(await isSearchOpen(window)).toBe(true);
    expect(await getSearchQuery(window)).toBe('test query');

    // Navigate to Parent via breadcrumb (navigateCurrentTab — new tabId, old search cleaned up)
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);

    // Search should NOT be open on the new tab (search state was on old tabId)
    expect(await isSearchOpen(window)).toBe(false);
  });

  test('cmd+click ancestor with search open: search stays on original tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Open search on Child
    await openSearchAndType(window, 'my search');
    expect(await isSearchOpen(window)).toBe(true);

    // Cmd+click Parent → opens background tab, does NOT change selection
    await cmdClickInlineAncestor(window, 'Parent');

    // Still on Child tab — search should remain open with the query
    expect(await getSelectedDocId(window)).toBe(m.get('Child')!);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await getSearchQuery(window)).toBe('my search');

    // Switch to the new Parent tab
    await selectDoc(window, m.get('Parent')!);
    // Parent tab should have no search open
    expect(await isSearchOpen(window)).toBe(false);
  });

  test('two tabs with search open: navigating one via breadcrumb does not affect the other', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'ChildA', parentTitle: 'Root' },
      { title: 'ChildB', parentTitle: 'Root' },
    ]);
    // Open both children in separate tabs
    await selectDoc(window, m.get('ChildA')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('ChildB')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const tabA = state.tabs.find((t) => t.docId === m.get('ChildA')!)!;
    const tabB = state.tabs.find((t) => t.docId === m.get('ChildB')!)!;

    // Open search on ChildA
    await selectTabById(window, tabA.tabId);
    await openSearchAndType(window, 'query A');

    // Open search on ChildB
    await selectTabById(window, tabB.tabId);
    await openSearchAndType(window, 'query B');

    // Navigate ChildB to Root via breadcrumb
    await clickInlineAncestor(window, 'Root');
    expect(await getSelectedDocId(window)).toBe(m.get('Root')!);
    // Root tab has no search
    expect(await isSearchOpen(window)).toBe(false);

    // Switch back to ChildA — its search should still be intact
    await selectTabById(window, tabA.tabId);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await getSearchQuery(window)).toBe('query A');
  });

  test('middle-click ancestor with search open: search stays on current tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Open search
    await openSearchAndType(window, 'middle click test');
    expect(await isSearchOpen(window)).toBe(true);

    // Middle-click Parent → opens background tab
    await middleClickInlineAncestor(window, 'Parent');

    // Still on Child tab with search intact
    expect(await getSelectedDocId(window)).toBe(m.get('Child')!);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await getSearchQuery(window)).toBe('middle click test');
  });

  test('navigate via breadcrumb, then navigate back: search does not reappear', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Open search on Child
    await openSearchAndType(window, 'vanishing query');
    expect(await isSearchOpen(window)).toBe(true);

    // Navigate to Parent (clears search — new tabId)
    await clickInlineAncestor(window, 'Parent');
    expect(await isSearchOpen(window)).toBe(false);

    // Navigate back to Child via sidebar
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(300);

    // Search should NOT reappear — the old tabId's state was cleaned up
    expect(await isSearchOpen(window)).toBe(false);
  });

  test('search counter does not carry over after breadcrumb navigation', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Open search — counter shows "0/0" since no content matches
    await openSearchAndType(window, 'nonexistent');
    const counter = await getSearchCounter(window);
    expect(counter).toBe('0/0');

    // Navigate to Parent via breadcrumb
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);

    // Search is closed on Parent — no stale counter visible
    expect(await isSearchOpen(window)).toBe(false);
  });
});

// ── Cross-Feature: Bookmark + Breadcrumb ────────────────────────────

test.describe('BreadcrumbBar — Bookmark Interaction', () => {
  /** Get the bookmark button's aria-label on the visible tab. */
  async function getBookmarkLabel(window: Page): Promise<string> {
    const main = window.locator(VISIBLE_MAIN);
    // BookmarkButton uses aria-label "Remove bookmark" when active, "Bookmark this note" when not
    const btn = main.locator('button:has(svg.lucide-bookmark)');
    return (await btn.getAttribute('aria-label')) ?? '';
  }

  /** Check if the bookmark is currently active (filled) on the visible tab. */
  async function isBookmarked(window: Page): Promise<boolean> {
    const label = await getBookmarkLabel(window);
    return label === 'Remove bookmark';
  }

  /** Click the bookmark button on the visible tab. */
  async function clickBookmark(window: Page) {
    const main = window.locator(VISIBLE_MAIN);
    const btn = main.locator('button:has(svg.lucide-bookmark)');
    await btn.click();
    await window.waitForTimeout(300);
  }

  test('bookmarked child → navigate to unbookmarked parent: bookmark reflects parent state', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Bookmark the Child
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to Parent via breadcrumb
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);

    // Parent is NOT bookmarked — bookmark icon should show "Bookmark this note"
    expect(await isBookmarked(window)).toBe(false);
    expect(await getBookmarkLabel(window)).toBe('Bookmark this note');
  });

  test('navigate to bookmarked parent: bookmark icon shows active state', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);

    // Bookmark the Parent first
    await selectDoc(window, m.get('Parent')!);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Go to Child
    await selectDoc(window, m.get('Child')!);
    expect(await isBookmarked(window)).toBe(false);

    // Navigate back to Parent via breadcrumb
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);

    // Parent's bookmark state should be active
    expect(await isBookmarked(window)).toBe(true);
    expect(await getBookmarkLabel(window)).toBe('Remove bookmark');
  });

  test('bookmark does not bleed: bookmark child, cmd+click parent, parent shows unbookmarked', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Bookmark Child
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Cmd+click Parent (opens new tab in background)
    await cmdClickInlineAncestor(window, 'Parent');

    // Child still shows bookmarked
    expect(await getSelectedDocId(window)).toBe(m.get('Child')!);
    expect(await isBookmarked(window)).toBe(true);

    // Switch to Parent tab — should show unbookmarked
    await selectDoc(window, m.get('Parent')!);
    expect(await isBookmarked(window)).toBe(false);
  });

  test('bookmark round-trip: bookmark child, navigate to parent, navigate back, child still bookmarked', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Bookmark Child
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to Parent via breadcrumb
    await clickInlineAncestor(window, 'Parent');
    expect(await isBookmarked(window)).toBe(false);

    // Navigate back to Child
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(300);

    // Child is still bookmarked (bookmark is per-document, not per-tab)
    expect(await isBookmarked(window)).toBe(true);
  });

  test('toggle bookmark on ancestor reached via breadcrumb: only that doc affected', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Verify neither is bookmarked
    expect(await isBookmarked(window)).toBe(false);

    // Navigate to Parent via breadcrumb
    await clickInlineAncestor(window, 'Parent');
    expect(await isBookmarked(window)).toBe(false);

    // Bookmark Parent
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate back to Child
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(300);

    // Child should NOT be bookmarked — only Parent was
    expect(await isBookmarked(window)).toBe(false);
  });

  test('duplicate tabs: bookmark state is consistent across all tabs for same doc', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Open Child in 2 tabs
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(childTabs.length).toBe(2);

    // Select first tab and bookmark
    await selectTabById(window, childTabs[0].tabId);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Switch to second tab — should also show bookmarked (per-document state)
    await selectTabById(window, childTabs[1].tabId);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate second tab to Parent via breadcrumb
    await clickInlineAncestor(window, 'Parent');
    expect(await isBookmarked(window)).toBe(false);

    // First tab still shows Child as bookmarked
    await selectTabById(window, childTabs[0].tabId);
    expect(await isBookmarked(window)).toBe(true);
  });
});

// ── Cross-Feature: Search + Bookmark + Breadcrumb Combined ──────────

test.describe('BreadcrumbBar — Combined Cross-Feature', () => {
  /** Helper: open search and type query on visible tab. */
  async function openSearch(window: Page, query: string) {
    const main = window.locator(VISIBLE_MAIN);
    const trigger = main.locator('[data-testid="note-find-trigger"]');
    const expanded = await trigger.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await trigger.click();
      await window.waitForTimeout(200);
    }
    const input = main.locator('[data-testid="note-find-input"]');
    await input.fill(query);
    await window.waitForTimeout(300);
  }

  async function isSearchOpen(window: Page): Promise<boolean> {
    const main = window.locator(VISIBLE_MAIN);
    const trigger = main.locator('[data-testid="note-find-trigger"]');
    const expanded = await trigger.getAttribute('aria-expanded');
    return expanded === 'true';
  }

  async function isBookmarked(window: Page): Promise<boolean> {
    const main = window.locator(VISIBLE_MAIN);
    const btn = main.locator('button:has(svg.lucide-bookmark)');
    const label = await btn.getAttribute('aria-label');
    return label === 'Remove bookmark';
  }

  async function clickBookmark(window: Page) {
    const main = window.locator(VISIBLE_MAIN);
    const btn = main.locator('button:has(svg.lucide-bookmark)');
    await btn.click();
    await window.waitForTimeout(300);
  }

  test('search + bookmark on child, navigate to parent: both states reset correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Set up both features on Child
    await openSearch(window, 'test');
    await clickBookmark(window);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to Parent via breadcrumb
    await clickInlineAncestor(window, 'Parent');

    // Search should be closed (new tabId), bookmark should be off (different doc)
    expect(await isSearchOpen(window)).toBe(false);
    expect(await isBookmarked(window)).toBe(false);
  });

  test('cmd+click preserves both search and bookmark on original tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Set up search and bookmark on Child
    await openSearch(window, 'preserved');
    await clickBookmark(window);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await isBookmarked(window)).toBe(true);

    // Cmd+click Parent — background tab
    await cmdClickInlineAncestor(window, 'Parent');

    // Still on Child — both features intact
    expect(await getSelectedDocId(window)).toBe(m.get('Child')!);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await isBookmarked(window)).toBe(true);

    // Switch to Parent — clean state
    await selectDoc(window, m.get('Parent')!);
    expect(await isSearchOpen(window)).toBe(false);
    expect(await isBookmarked(window)).toBe(false);
  });

  test('navigate away and back: bookmark persists, search does not', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Search + bookmark on Child
    await openSearch(window, 'ephemeral');
    await clickBookmark(window);

    // Navigate to Parent via breadcrumb
    await clickInlineAncestor(window, 'Parent');

    // Navigate back to Child
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(300);

    // Bookmark persists (per-document), search does not (per-tabId, cleaned up)
    expect(await isBookmarked(window)).toBe(true);
    expect(await isSearchOpen(window)).toBe(false);
  });
});

// ── Cross-Feature Edge Cases & Stress Tests ─────────────────────────

test.describe('BreadcrumbBar — Search Edge Cases', () => {
  // Re-declare helpers within this describe scope
  async function openSearchAndType(window: Page, query: string): Promise<string> {
    const main = window.locator(VISIBLE_MAIN);
    const trigger = main.locator('[data-testid="note-find-trigger"]');
    const expanded = await trigger.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await trigger.click();
      await window.waitForTimeout(200);
    }
    const input = main.locator('[data-testid="note-find-input"]');
    await input.fill(query);
    await window.waitForTimeout(300);
    return main.locator('[data-testid="note-find-counter"]').innerText();
  }

  async function isSearchOpen(window: Page): Promise<boolean> {
    const main = window.locator(VISIBLE_MAIN);
    const trigger = main.locator('[data-testid="note-find-trigger"]');
    const expanded = await trigger.getAttribute('aria-expanded');
    return expanded === 'true';
  }

  async function getSearchQuery(window: Page): Promise<string> {
    const main = window.locator(VISIBLE_MAIN);
    const input = main.locator('[data-testid="note-find-input"]');
    return input.inputValue();
  }

  test('search open on duplicate tab: navigate one via breadcrumb, other keeps its independent search', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Open Child in 2 tabs
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(childTabs.length).toBe(2);

    // Open search on tab 1 with "query alpha"
    await selectTabById(window, childTabs[0].tabId);
    await openSearchAndType(window, 'query alpha');

    // Open search on tab 2 with "query beta"
    await selectTabById(window, childTabs[1].tabId);
    await openSearchAndType(window, 'query beta');

    // Navigate tab 2 to Parent via breadcrumb — kills tab 2's search state
    await clickInlineAncestor(window, 'Parent');
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);
    expect(await isSearchOpen(window)).toBe(false);

    // Tab 1 still has its search intact
    await selectTabById(window, childTabs[0].tabId);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await getSearchQuery(window)).toBe('query alpha');
  });

  test('search open + navigate via collapsed ancestor popover: search clears', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    await selectDoc(window, m.get('L6')!);

    // Open search
    await openSearchAndType(window, 'deep search');
    expect(await isSearchOpen(window)).toBe(true);

    // Navigate via collapsed ancestor (L1 is in the collapse popover)
    await openCollapsePopover(window);
    await clickCollapsedAncestor(window, 'L1');

    // Now on L1 — search should be cleared
    expect(await getSelectedDocId(window)).toBe(m.get('L1')!);
    expect(await isSearchOpen(window)).toBe(false);
  });

  test('chain navigation through 4 levels: search never leaks between hops', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
      { title: 'D', parentTitle: 'C' },
    ]);
    await selectDoc(window, m.get('D')!);

    // Open search on D
    await openSearchAndType(window, 'start');
    expect(await isSearchOpen(window)).toBe(true);

    // D → C (search clears)
    await clickInlineAncestor(window, 'C');
    expect(await isSearchOpen(window)).toBe(false);

    // Open a new search on C
    await openSearchAndType(window, 'hop2');

    // C → B (search clears again)
    await clickInlineAncestor(window, 'B');
    expect(await isSearchOpen(window)).toBe(false);

    // B → A (no search opened, still clean)
    await clickInlineAncestor(window, 'A');
    expect(await isSearchOpen(window)).toBe(false);
  });

  test('trash doc while search is open: search state cleaned up with tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Target' },
      { title: 'Safe' },
    ]);
    await selectDoc(window, m.get('Target')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Safe')!);
    await window.waitForTimeout(200);

    // Record the tabId for Target
    const state = await getTabState(window);
    const targetTab = state.tabs.find((t) => t.docId === m.get('Target')!)!;

    // Open search on Target
    await selectTabById(window, targetTab.tabId);
    await openSearchAndType(window, 'doomed query');
    expect(await isSearchOpen(window)).toBe(true);

    // Trash Target — closes all tabs for it, removeTabState called
    await window.evaluate(async (id) => {
      const store = (window as any).__documentStore;
      await store.getState().trashDocument(id);
    }, m.get('Target')!);
    await window.waitForTimeout(500);

    // Verify the search state for that tabId was cleaned up (no stale accumulation)
    const searchStateCount = await window.evaluate((tabId) => {
      const store = (window as any).__searchHighlightStore;
      // If store is not exposed, we can't check — but the tab is gone, so the test
      // still validates that no crash occurred and Safe is selected
      if (!store) return -1;
      return store.getState().states[tabId] ? 1 : 0;
    }, targetTab.tabId);

    // Safe is now selected and has no search
    expect(await getSelectedDocId(window)).toBe(m.get('Safe')!);
    expect(await isSearchOpen(window)).toBe(false);
    // If store is exposed, verify cleanup happened
    if (searchStateCount !== -1) {
      expect(searchStateCount).toBe(0);
    }
  });

  test('10 tabs with search: close each via breadcrumb navigation, no stale search state', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Child', parentTitle: 'Root' },
    ]);

    // Create 10 tabs for Child via openTab
    for (let i = 0; i < 10; i++) {
      await window.evaluate((docId) => {
        (window as any).__documentStore.getState().openTab(docId);
      }, m.get('Child')!);
    }
    await window.waitForTimeout(300);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(childTabs.length).toBe(10);

    // Open search on each tab with a unique query
    for (let i = 0; i < childTabs.length; i++) {
      await selectTabById(window, childTabs[i].tabId);
      await openSearchAndType(window, `query-${i}`);
    }

    // Navigate each tab to Root via breadcrumb (kills its search)
    for (let i = 0; i < childTabs.length; i++) {
      await selectTabById(window, childTabs[i].tabId);
      // After first navigation, tab shows Root (no breadcrumb ancestor to click).
      // So only the first one we can click breadcrumb. But actually after navigating,
      // the tab is now showing Root and has a new tabId. We need to find it.
      // Actually, navigateCurrentTab creates a new tabId, so we need to re-fetch.
      const currentState = await getTabState(window);
      const thisTab = currentState.tabs.find((t) => t.tabId === childTabs[i].tabId);
      if (!thisTab || thisTab.docId !== m.get('Child')!) continue; // already navigated
      await clickInlineAncestor(window, 'Root');
    }
    await window.waitForTimeout(300);

    // All tabs now show Root, none should have search open
    const finalState = await getTabState(window);
    for (const tab of finalState.tabs) {
      await selectTabById(window, tab.tabId);
      expect(await isSearchOpen(window)).toBe(false);
    }
  });

  test('cmd+click collapsed ancestor with search open: search stays, new tab is clean', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    await selectDoc(window, m.get('L6')!);

    // Open search on L6
    await openSearchAndType(window, 'collapsed test');
    expect(await isSearchOpen(window)).toBe(true);

    // Cmd+click L1 in collapse popover (background tab)
    await openCollapsePopover(window);
    await cmdClickCollapsedAncestor(window, 'L1');

    // Still on L6 with search intact
    expect(await getSelectedDocId(window)).toBe(m.get('L6')!);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await getSearchQuery(window)).toBe('collapsed test');

    // Switch to L1 tab — no search
    await selectDoc(window, m.get('L1')!);
    expect(await isSearchOpen(window)).toBe(false);
  });

  test('rapid: open search, navigate, open search, navigate — 5 cycles', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);

    for (let i = 0; i < 5; i++) {
      // Navigate to Child
      await window.evaluate((docId) => {
        (window as any).__documentStore.getState().navigateCurrentTab(docId);
      }, m.get('Child')!);
      await window.waitForTimeout(300);

      // Open search
      await openSearchAndType(window, `cycle-${i}`);
      expect(await isSearchOpen(window)).toBe(true);

      // Navigate to Parent via breadcrumb — search clears
      await clickInlineAncestor(window, 'Parent');
      expect(await isSearchOpen(window)).toBe(false);
    }

    // After 5 cycles, we're on Parent with no search — no stale state
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);
    expect(await isSearchOpen(window)).toBe(false);
  });
});

test.describe('BreadcrumbBar — Bookmark Edge Cases', () => {
  async function isBookmarked(window: Page): Promise<boolean> {
    const main = window.locator(VISIBLE_MAIN);
    const btn = main.locator('button:has(svg.lucide-bookmark)');
    const label = await btn.getAttribute('aria-label');
    return label === 'Remove bookmark';
  }

  async function clickBookmark(window: Page) {
    const main = window.locator(VISIBLE_MAIN);
    const btn = main.locator('button:has(svg.lucide-bookmark)');
    await btn.click();
    await window.waitForTimeout(300);
  }

  test('bookmark every ancestor in a chain via breadcrumb, verify all persist', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
      { title: 'D', parentTitle: 'C' },
    ]);
    await selectDoc(window, m.get('D')!);

    // Navigate to C, bookmark it
    await clickInlineAncestor(window, 'C');
    expect(await isBookmarked(window)).toBe(false);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to B, bookmark it
    await clickInlineAncestor(window, 'B');
    expect(await isBookmarked(window)).toBe(false);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to A, bookmark it
    await clickInlineAncestor(window, 'A');
    expect(await isBookmarked(window)).toBe(false);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Now verify: navigate back through the chain and confirm all bookmarks persist
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('B')!);
    await window.waitForTimeout(300);
    expect(await isBookmarked(window)).toBe(true);

    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('C')!);
    await window.waitForTimeout(300);
    expect(await isBookmarked(window)).toBe(true);

    // D was never bookmarked
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('D')!);
    await window.waitForTimeout(300);
    expect(await isBookmarked(window)).toBe(false);
  });

  test('unbookmark from duplicate tab: all tabs for same doc reflect unbookmarked', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Open Child in 3 tabs
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);
    expect(childTabs.length).toBe(3);

    // Bookmark from tab 1
    await selectTabById(window, childTabs[0].tabId);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Verify all 3 tabs show bookmarked
    for (const tab of childTabs) {
      await selectTabById(window, tab.tabId);
      expect(await isBookmarked(window)).toBe(true);
    }

    // Unbookmark from tab 3 (different tab than where we bookmarked)
    await selectTabById(window, childTabs[2].tabId);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(false);

    // All tabs should now show unbookmarked
    for (const tab of childTabs) {
      await selectTabById(window, tab.tabId);
      expect(await isBookmarked(window)).toBe(false);
    }
  });

  test('bookmark, navigate via collapsed ancestor, verify bookmark on original doc', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L1' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
      { title: 'L4', parentTitle: 'L3' },
      { title: 'L5', parentTitle: 'L4' },
      { title: 'L6', parentTitle: 'L5' },
    ]);
    await selectDoc(window, m.get('L6')!);

    // Bookmark L6
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to L1 via collapsed popover
    await openCollapsePopover(window);
    await clickCollapsedAncestor(window, 'L1');
    expect(await getSelectedDocId(window)).toBe(m.get('L1')!);
    expect(await isBookmarked(window)).toBe(false);

    // Navigate back to L6 — bookmark should persist
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('L6')!);
    await window.waitForTimeout(300);
    expect(await isBookmarked(window)).toBe(true);
  });

  test('bookmark, trash doc, restore: bookmark state survives restore', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'BookmarkedNote' },
      { title: 'Safe' },
    ]);
    await selectDoc(window, m.get('BookmarkedNote')!);

    // Bookmark it
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Open Safe tab so we have somewhere to land
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Safe')!);
    await window.waitForTimeout(200);

    // Trash BookmarkedNote
    await window.evaluate(async (id) => {
      const store = (window as any).__documentStore;
      await store.getState().trashDocument(id);
    }, m.get('BookmarkedNote')!);
    await window.waitForTimeout(500);

    // Restore it
    await window.evaluate(async (id) => {
      const store = (window as any).__documentStore;
      await store.getState().restoreDocument(id);
    }, m.get('BookmarkedNote')!);
    await window.waitForTimeout(500);

    // Navigate to it and check bookmark persists
    await selectDoc(window, m.get('BookmarkedNote')!);
    expect(await isBookmarked(window)).toBe(true);
  });

  test('rapid bookmark toggle while navigating: final state is consistent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Rapid toggle: bookmark, unbookmark, bookmark
    await clickBookmark(window); // bookmarked
    await clickBookmark(window); // unbookmarked
    await clickBookmark(window); // bookmarked
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to Parent
    await clickInlineAncestor(window, 'Parent');
    expect(await isBookmarked(window)).toBe(false);

    // Navigate back to Child — should still be bookmarked (odd number of toggles)
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(300);
    expect(await isBookmarked(window)).toBe(true);
  });

  test('bookmark parent and child independently, navigate between via breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);

    // Bookmark Parent
    await selectDoc(window, m.get('Parent')!);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to Child via store, bookmark Child
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(300);
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to Parent via breadcrumb — Parent should be bookmarked
    await clickInlineAncestor(window, 'Parent');
    expect(await isBookmarked(window)).toBe(true);

    // Navigate back to Child — Child should be bookmarked
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(300);
    expect(await isBookmarked(window)).toBe(true);

    // Unbookmark Child, navigate to Parent — Parent still bookmarked
    await clickBookmark(window);
    expect(await isBookmarked(window)).toBe(false);
    await clickInlineAncestor(window, 'Parent');
    expect(await isBookmarked(window)).toBe(true);
  });
});

test.describe('BreadcrumbBar — Combined Stress Tests', () => {
  async function openSearch(window: Page, query: string) {
    const main = window.locator(VISIBLE_MAIN);
    const trigger = main.locator('[data-testid="note-find-trigger"]');
    const expanded = await trigger.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await trigger.click();
      await window.waitForTimeout(200);
    }
    const input = main.locator('[data-testid="note-find-input"]');
    await input.fill(query);
    await window.waitForTimeout(300);
  }

  async function isSearchOpen(window: Page): Promise<boolean> {
    const main = window.locator(VISIBLE_MAIN);
    const trigger = main.locator('[data-testid="note-find-trigger"]');
    const expanded = await trigger.getAttribute('aria-expanded');
    return expanded === 'true';
  }

  async function getSearchQuery(window: Page): Promise<string> {
    const main = window.locator(VISIBLE_MAIN);
    const input = main.locator('[data-testid="note-find-input"]');
    return input.inputValue();
  }

  async function isBookmarked(window: Page): Promise<boolean> {
    const main = window.locator(VISIBLE_MAIN);
    const btn = main.locator('button:has(svg.lucide-bookmark)');
    const label = await btn.getAttribute('aria-label');
    return label === 'Remove bookmark';
  }

  async function clickBookmark(window: Page) {
    const main = window.locator(VISIBLE_MAIN);
    const btn = main.locator('button:has(svg.lucide-bookmark)');
    await btn.click();
    await window.waitForTimeout(300);
  }

  test('5 tabs: each with different search+bookmark combos, navigate all via breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'C1', parentTitle: 'Root' },
      { title: 'C2', parentTitle: 'Root' },
      { title: 'C3', parentTitle: 'Root' },
      { title: 'C4', parentTitle: 'Root' },
      { title: 'C5', parentTitle: 'Root' },
    ]);

    // Open all 5 children in separate tabs
    const childNames = ['C1', 'C2', 'C3', 'C4', 'C5'];
    await selectDoc(window, m.get('C1')!);
    for (let i = 1; i < 5; i++) {
      await window.evaluate((docId) => {
        (window as any).__documentStore.getState().openTab(docId);
      }, m.get(childNames[i])!);
    }
    await window.waitForTimeout(300);

    const state = await getTabState(window);

    // Set up different combos on each:
    // C1: search only
    // C2: bookmark only
    // C3: search + bookmark
    // C4: neither
    // C5: search only (different query)
    const tabC1 = state.tabs.find((t) => t.docId === m.get('C1')!)!;
    const tabC2 = state.tabs.find((t) => t.docId === m.get('C2')!)!;
    const tabC3 = state.tabs.find((t) => t.docId === m.get('C3')!)!;
    const tabC4 = state.tabs.find((t) => t.docId === m.get('C4')!)!;
    const tabC5 = state.tabs.find((t) => t.docId === m.get('C5')!)!;

    await selectTabById(window, tabC1.tabId);
    await openSearch(window, 'search-c1');

    await selectTabById(window, tabC2.tabId);
    await clickBookmark(window);

    await selectTabById(window, tabC3.tabId);
    await openSearch(window, 'search-c3');
    await clickBookmark(window);

    // C4: leave as-is

    await selectTabById(window, tabC5.tabId);
    await openSearch(window, 'search-c5');

    // Now navigate all 5 to Root via breadcrumb
    for (const tabInfo of [tabC1, tabC2, tabC3, tabC4, tabC5]) {
      await selectTabById(window, tabInfo.tabId);
      // After navigation the tabId changes, but we can still select the old one
      // if it hasn't been navigated yet
      const currentState = await getTabState(window);
      const tab = currentState.tabs.find((t) => t.tabId === tabInfo.tabId);
      if (tab && tab.docId !== m.get('Root')!) {
        await clickInlineAncestor(window, 'Root');
      }
    }
    await window.waitForTimeout(300);

    // All tabs now show Root
    const afterState = await getTabState(window);
    for (const tab of afterState.tabs) {
      expect(tab.docId).toBe(m.get('Root')!);
    }

    // All searches should be closed (each got a new tabId)
    for (const tab of afterState.tabs) {
      await selectTabById(window, tab.tabId);
      expect(await isSearchOpen(window)).toBe(false);
    }

    // Root is NOT bookmarked — but C2 and C3's bookmarks are per-document, so Root shouldn't have them
    expect(await isBookmarked(window)).toBe(false);
  });

  test('duplicate tabs with search: close one tab, other tab search unaffected', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    // Open Child in 2 tabs
    await selectDoc(window, m.get('Child')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const childTabs = state.tabs.filter((t) => t.docId === m.get('Child')!);

    // Search on tab 1
    await selectTabById(window, childTabs[0].tabId);
    await openSearch(window, 'tab1-search');

    // Search on tab 2
    await selectTabById(window, childTabs[1].tabId);
    await openSearch(window, 'tab2-search');

    // Close tab 1 (removeTabState cleans up its search)
    await window.evaluate((tabId) => {
      (window as any).__documentStore.getState().closeTab(tabId);
    }, childTabs[0].tabId);
    await window.waitForTimeout(200);

    // Tab 2 search should be unaffected
    await selectTabById(window, childTabs[1].tabId);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await getSearchQuery(window)).toBe('tab2-search');
  });

  test('search + bookmark + navigate + cmd+click: complex multi-tab scenario', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Grandparent' },
      { title: 'Parent', parentTitle: 'Grandparent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Bookmark Child and open search
    await clickBookmark(window);
    await openSearch(window, 'complex');
    expect(await isBookmarked(window)).toBe(true);
    expect(await isSearchOpen(window)).toBe(true);

    // Cmd+click Parent (background tab)
    await cmdClickInlineAncestor(window, 'Parent');
    // Still on Child with everything intact
    expect(await isBookmarked(window)).toBe(true);
    expect(await isSearchOpen(window)).toBe(true);

    // Navigate Child's tab to Grandparent via breadcrumb
    // With only 2 ancestors at wide breakpoint (threshold=4), both are inline
    await clickInlineAncestor(window, 'Grandparent');

    // Now on Grandparent: search is cleared (new tab), bookmark reflects Grandparent (not bookmarked)
    expect(await getSelectedDocId(window)).toBe(m.get('Grandparent')!);
    expect(await isSearchOpen(window)).toBe(false);
    expect(await isBookmarked(window)).toBe(false);

    // Switch to the cmd+clicked Parent tab — no search, not bookmarked
    await selectDoc(window, m.get('Parent')!);
    expect(await isSearchOpen(window)).toBe(false);
    expect(await isBookmarked(window)).toBe(false);

    // Navigate Parent tab back to Child — Child's bookmark persists
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('Child')!);
    await window.waitForTimeout(300);
    expect(await isBookmarked(window)).toBe(true);
    expect(await isSearchOpen(window)).toBe(false); // search was per-tab, gone
  });

  test('breadcrumb navigation with search focused: navigation succeeds, no stuck focus', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    // Open search and keep input focused
    await openSearch(window, 'focused');
    const main = window.locator(VISIBLE_MAIN);
    const input = main.locator('[data-testid="note-find-input"]');
    await input.focus();
    await window.waitForTimeout(100);

    // Click breadcrumb while search input is focused
    await clickInlineAncestor(window, 'Parent');

    // Navigation should succeed
    expect(await getSelectedDocId(window)).toBe(m.get('Parent')!);
    // Search should be closed on new tab
    expect(await isSearchOpen(window)).toBe(false);
  });

  test('10 notes: bookmark all, navigate through chain via breadcrumbs, all bookmarks persist', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 1; i <= 10; i++) {
      specs.push({
        title: `N${i}`,
        ...(i > 1 ? { parentTitle: `N${i - 1}` } : {}),
      });
    }
    const m = await seedTree(window, specs);

    // Bookmark every node by visiting each one
    for (let i = 1; i <= 10; i++) {
      await window.evaluate((docId) => {
        (window as any).__documentStore.getState().navigateCurrentTab(docId);
      }, m.get(`N${i}`)!);
      await window.waitForTimeout(300);
      await clickBookmark(window);
      expect(await isBookmarked(window)).toBe(true);
    }

    // Now navigate from N10 down to N1 via breadcrumbs, verify each is bookmarked
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('N10')!);
    await window.waitForTimeout(300);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to N6 via inline (N6, N7, N8, N9 are inline at wide breakpoint)
    await clickInlineAncestor(window, 'N9');
    expect(await isBookmarked(window)).toBe(true);

    await clickInlineAncestor(window, 'N8');
    expect(await isBookmarked(window)).toBe(true);

    // Navigate to N1 via collapsed popover
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().navigateCurrentTab(docId);
    }, m.get('N10')!);
    await window.waitForTimeout(300);
    await openCollapsePopover(window);
    await clickCollapsedAncestor(window, 'N1');
    expect(await isBookmarked(window)).toBe(true);
  });

  test('interleaved search and bookmark across 3 tabs, navigate all, verify isolation', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'A', parentTitle: 'Root' },
      { title: 'B', parentTitle: 'Root' },
      { title: 'C', parentTitle: 'Root' },
    ]);

    // Open 3 tabs: A, B, C
    await selectDoc(window, m.get('A')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('B')!);
    await window.evaluate((docId) => {
      (window as any).__documentStore.getState().openTab(docId);
    }, m.get('C')!);
    await window.waitForTimeout(200);

    const state = await getTabState(window);
    const tabA = state.tabs.find((t) => t.docId === m.get('A')!)!;
    const tabB = state.tabs.find((t) => t.docId === m.get('B')!)!;
    const tabC = state.tabs.find((t) => t.docId === m.get('C')!)!;

    // Tab A: search + bookmark
    await selectTabById(window, tabA.tabId);
    await openSearch(window, 'alpha');
    await clickBookmark(window);

    // Tab B: bookmark only
    await selectTabById(window, tabB.tabId);
    await clickBookmark(window);

    // Tab C: search only
    await selectTabById(window, tabC.tabId);
    await openSearch(window, 'gamma');

    // Navigate tab A to Root via breadcrumb
    await selectTabById(window, tabA.tabId);
    await clickInlineAncestor(window, 'Root');
    expect(await isSearchOpen(window)).toBe(false);
    expect(await isBookmarked(window)).toBe(false); // Root is not bookmarked

    // Tab B should be unaffected
    await selectTabById(window, tabB.tabId);
    expect(await isSearchOpen(window)).toBe(false); // B never had search
    expect(await isBookmarked(window)).toBe(true);

    // Tab C should be unaffected
    await selectTabById(window, tabC.tabId);
    expect(await isSearchOpen(window)).toBe(true);
    expect(await getSearchQuery(window)).toBe('gamma');
    expect(await isBookmarked(window)).toBe(false); // C was never bookmarked

    // Navigate tab C to Root
    await clickInlineAncestor(window, 'Root');
    expect(await isSearchOpen(window)).toBe(false);

    // Tab B still intact
    await selectTabById(window, tabB.tabId);
    expect(await isBookmarked(window)).toBe(true);

    // Navigate tab B to Root
    await clickInlineAncestor(window, 'Root');
    // B's bookmark was per-document — B is still bookmarked but we're on Root now
    expect(await isBookmarked(window)).toBe(false);

    // Verify the per-document bookmarks: A and B are still bookmarked in the store
    const aBookmarked = await window.evaluate((docId) => {
      const store = (window as any).__documentStore;
      const doc = store.getState().documents.find((d: any) => d.id === docId);
      return !!doc?.metadata?.bookmarkedAt;
    }, m.get('A')!);
    expect(aBookmarked).toBe(true);

    const bBookmarked = await window.evaluate((docId) => {
      const store = (window as any).__documentStore;
      const doc = store.getState().documents.find((d: any) => d.id === docId);
      return !!doc?.metadata?.bookmarkedAt;
    }, m.get('B')!);
    expect(bBookmarked).toBe(true);
  });
});
