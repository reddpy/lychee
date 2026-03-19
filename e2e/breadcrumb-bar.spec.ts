import { test, expect, listDocumentsFromDb } from './electron-app';
import type { Page } from '@playwright/test';

// ── Selectors ──────────────────────────────────────────────────────

const BREADCRUMB_NAV = 'nav[aria-label="Breadcrumb"]';
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

/** Get inline ancestor button texts only (excludes current note). */
async function getInlineAncestorTexts(window: Page): Promise<string[]> {
  const nav = window.locator(BREADCRUMB_NAV);
  if (!(await nav.isVisible().catch(() => false))) return [];
  const buttons = nav.locator('button:not(:has(svg.lucide-ellipsis))');
  const count = await buttons.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await buttons.nth(i).innerText()).trim();
    if (text) texts.push(text);
  }
  return texts;
}

/** Get texts of collapsed (hidden) ancestors in the ellipsis popover. */
async function getCollapsedAncestorTexts(window: Page): Promise<string[]> {
  const popover = window.locator(COLLAPSE_POPOVER);
  const buttons = popover.locator('button');
  const count = await buttons.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await buttons.nth(i).innerText()).trim();
    if (text) texts.push(text);
  }
  return texts;
}

/** Click an inline ancestor button by its text label. */
async function clickInlineAncestor(window: Page, label: string) {
  const nav = window.locator(BREADCRUMB_NAV);
  const button = nav.locator(`button:not(:has(svg.lucide-ellipsis))`).filter({ hasText: label });
  await button.click();
  await window.waitForTimeout(300);
}

/** Cmd/Ctrl+click an inline ancestor by text label. */
async function cmdClickInlineAncestor(window: Page, label: string) {
  const nav = window.locator(BREADCRUMB_NAV);
  const button = nav.locator(`button:not(:has(svg.lucide-ellipsis))`).filter({ hasText: label });
  await button.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await window.waitForTimeout(300);
}

/** Middle-click an inline ancestor by text label. */
async function middleClickInlineAncestor(window: Page, label: string) {
  const nav = window.locator(BREADCRUMB_NAV);
  const button = nav.locator(`button:not(:has(svg.lucide-ellipsis))`).filter({ hasText: label });
  await button.click({ button: 'middle' });
  await window.waitForTimeout(300);
}

/** Click a collapsed ancestor in the popover by text label. */
async function clickCollapsedAncestor(window: Page, label: string) {
  const popover = window.locator(COLLAPSE_POPOVER);
  const button = popover.locator('button').filter({ hasText: label });
  await button.click();
  await window.waitForTimeout(300);
}

/** Cmd/Ctrl+click a collapsed ancestor in the popover. */
async function cmdClickCollapsedAncestor(window: Page, label: string) {
  const popover = window.locator(COLLAPSE_POPOVER);
  const button = popover.locator('button').filter({ hasText: label });
  await button.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await window.waitForTimeout(300);
}

/** Middle-click a collapsed ancestor in the popover. */
async function middleClickCollapsedAncestor(window: Page, label: string) {
  const popover = window.locator(COLLAPSE_POPOVER);
  const button = popover.locator('button').filter({ hasText: label });
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
    const currentButtons = nav.locator('button').filter({ hasText: 'Current' });
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

    const button = window.locator(`${BREADCRUMB_NAV} button`).filter({ hasText: 'Parent' });
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
    const buttons = window.locator(`${BREADCRUMB_NAV} button`).filter({ hasText: 'Same Name' });
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
      return win.getSize();
    });

    // At wide width: both ancestors inline
    if (originalSize[0] >= 768) {
      const ancestors = await getInlineAncestorTexts(window);
      expect(ancestors).toEqual(['L1', 'L2']);
    }

    // Resize to medium
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(600, win.getSize()[1]);
    });
    await window.waitForTimeout(500);

    // At medium: threshold 1, only L2 inline, L1 in ellipsis
    const mediumAncestors = await getInlineAncestorTexts(window);
    expect(mediumAncestors).toEqual(['L2']);
    await expect(window.locator(ELLIPSIS_TRIGGER)).toBeVisible();

    // Resize to narrow
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(400, win.getSize()[1]);
    });
    await window.waitForTimeout(500);

    // At narrow: threshold 0, no ancestors inline, all in ellipsis
    const narrowAncestors = await getInlineAncestorTexts(window);
    expect(narrowAncestors).toEqual([]);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size[0], size[1]);
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
      return win.getSize();
    });

    // Open the collapse popover
    await openCollapsePopover(window);
    await expect(window.locator(COLLAPSE_POPOVER)).toBeVisible();

    // Resize to trigger breakpoint change
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(600, win.getSize()[1]);
    });
    await window.waitForTimeout(500);

    // Popover should be closed
    await expect(window.locator(COLLAPSE_POPOVER)).not.toBeVisible();

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size[0], size[1]);
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
  test('narrow mode: all ancestors hidden in ellipsis, only current note shown', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Mid', parentTitle: 'Root' },
      { title: 'Leaf', parentTitle: 'Mid' },
    ]);
    await selectDoc(window, m.get('Leaf')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getSize();
    });

    // Resize to narrow
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(400, win.getSize()[1]);
    });
    await window.waitForTimeout(500);

    // No inline ancestors
    const inline = await getInlineAncestorTexts(window);
    expect(inline).toEqual([]);

    // Ellipsis should be visible (ancestors exist but all hidden)
    await expect(window.locator(ELLIPSIS_TRIGGER)).toBeVisible();

    // Current note still visible
    await expect(window.locator(BREADCRUMB_NAV)).toContainText('Leaf');

    // Clicking ellipsis shows both ancestors
    await openCollapsePopover(window);
    const collapsed = await getCollapsedAncestorTexts(window);
    expect(collapsed).toEqual(['Root', 'Mid']);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });

  test('medium mode: only direct parent shown inline', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'G' },
      { title: 'P', parentTitle: 'G' },
      { title: 'C', parentTitle: 'P' },
    ]);
    await selectDoc(window, m.get('C')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getSize();
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(600, win.getSize()[1]);
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
      win.setSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });

  test('resize from narrow to wide restores full inline trail', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
    ]);
    await selectDoc(window, m.get('C')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getSize();
    });

    // Go narrow
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(400, win.getSize()[1]);
    });
    await window.waitForTimeout(500);
    expect(await getInlineAncestorTexts(window)).toEqual([]);

    // Go wide
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(900, win.getSize()[1]);
    });
    await window.waitForTimeout(500);
    expect(await getInlineAncestorTexts(window)).toEqual(['A', 'B']);
    expect(await isEllipsisVisible(window)).toBe(false);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size[0], size[1]);
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
      return win.getSize();
    });

    // Wide: click inline ancestor
    await selectDoc(window, m.get('Child')!);
    await clickInlineAncestor(window, 'Root');
    expect(await getSelectedDocId(window)).toBe(m.get('Root')!);

    // Medium: ancestor goes to ellipsis for 2+ ancestors, but with 1 ancestor it stays inline
    await selectDoc(window, m.get('Child')!);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(600, win.getSize()[1]);
    });
    await window.waitForTimeout(500);

    // With only 1 ancestor at medium threshold 1, it should still be inline
    const mediumInline = await getInlineAncestorTexts(window);
    expect(mediumInline).toEqual(['Root']);
    await clickInlineAncestor(window, 'Root');
    expect(await getSelectedDocId(window)).toBe(m.get('Root')!);

    // Narrow: ancestor is in ellipsis
    await selectDoc(window, m.get('Child')!);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(400, win.getSize()[1]);
    });
    await window.waitForTimeout(500);

    await openCollapsePopover(window);
    await clickCollapsedAncestor(window, 'Root');
    expect(await getSelectedDocId(window)).toBe(m.get('Root')!);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size[0], size[1]);
    }, originalSize);
    await window.waitForTimeout(500);
  });

  test('cmd+click and middle-click work at narrow breakpoint via popover', async ({ window, electronApp }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDoc(window, m.get('Child')!);

    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getSize();
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(400, win.getSize()[1]);
    });
    await window.waitForTimeout(500);

    const tabsBefore = await getTabCount(window);

    // cmd+click via popover
    await openCollapsePopover(window);
    await cmdClickCollapsedAncestor(window, 'Parent');
    expect(await getTabCount(window)).toBe(tabsBefore + 1);

    // Re-select child and middle-click via popover
    await selectDoc(window, m.get('Child')!);
    await openCollapsePopover(window);
    await middleClickCollapsedAncestor(window, 'Parent');
    expect(await getTabCount(window)).toBe(tabsBefore + 2);

    // Restore
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size[0], size[1]);
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
      return win.getSize();
    });

    // Rapidly cycle through breakpoints
    for (let i = 0; i < 5; i++) {
      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setSize(400, win.getSize()[1]);
      });
      await window.waitForTimeout(150);

      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setSize(600, win.getSize()[1]);
      });
      await window.waitForTimeout(150);

      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setSize(900, win.getSize()[1]);
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
      win.setSize(size[0], size[1]);
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
    const button = window.locator(`${BREADCRUMB_NAV} button`).first();
    await expect(button).toHaveAttribute('title', longTitle);

    // The visible text should be truncated
    const visibleText = await button.innerText();
    expect(visibleText.length).toBeLessThan(100);
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
