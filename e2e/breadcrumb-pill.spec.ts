import { test, expect, listDocumentsFromDb, getDocumentFromDb } from './electron-app';
import type { Page } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────

const BREADCRUMB_TRIGGER = '[aria-label="Navigate note hierarchy"]:visible';
const SIDEBAR_TOGGLE = '[aria-label="Toggle sidebar"]';

/** Close the sidebar so the breadcrumb pill can appear. */
async function closeSidebar(window: Page) {
  if ((await window.locator('aside[data-state="expanded"]').count()) > 0) {
    await window.locator(SIDEBAR_TOGGLE).click();
    await window.waitForTimeout(600);
    await expect(window.locator('aside[data-state="expanded"]')).not.toBeVisible();
  }
}

/** Open the sidebar (hides the breadcrumb pill). */
async function openSidebar(window: Page) {
  if ((await window.locator('aside[data-state="expanded"]').count()) === 0) {
    await window.locator(SIDEBAR_TOGGLE).click();
    await window.waitForTimeout(600);
    await expect(window.locator('aside[data-state="expanded"]')).toBeVisible();
  }
}

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

  // Expand parents by triggering lastCreatedId for one child per unique parent
  const parentToChild = new Map<string, string>();
  for (let i = 0; i < specs.length; i++) {
    if (specs[i].parentTitle) {
      const parentId = titleToId.get(specs[i].parentTitle!)!;
      parentToChild.set(parentId, ids[i]);
    }
  }
  for (const childId of parentToChild.values()) {
    await window.evaluate((id) => {
      (window as any).__documentStore.setState({ lastCreatedId: id });
    }, childId);
    await window.waitForTimeout(100);
  }

  if (parentToChild.size === 0) {
    await window.waitForTimeout(200);
  }
  return titleToId;
}

/** Select a document by navigating to it via the store. */
async function selectDocumentById(window: Page, id: string) {
  await window.evaluate((docId) => {
    const store = (window as any).__documentStore;
    store.getState().openOrSelectTab(docId);
  }, id);
  await window.waitForTimeout(300);
}

/** Get all button labels inside the open breadcrumb popover. */
async function getPopoverButtons(window: Page): Promise<string[]> {
  const buttons = window.locator('[data-radix-popper-content-wrapper] button');
  const count = await buttons.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await buttons.nth(i).innerText()).trim();
    if (text) labels.push(text);
  }
  return labels;
}

/** Ensure the breadcrumb popover is open. Idempotent — won't toggle closed if already open. */
async function openBreadcrumb(window: Page) {
  const popover = window.locator('[data-radix-popper-content-wrapper]');
  if (await popover.isVisible().catch(() => false)) return;
  await window.locator(BREADCRUMB_TRIGGER).click();
  await popover.waitFor({ state: 'visible', timeout: 5000 });
}

/** Click a breadcrumb row while simulating a modifier key. */
async function clickBreadcrumbWithModifier(
  window: Page,
  label: string,
  modifier: 'meta' | 'ctrl',
) {
  await window.evaluate(
    ({ rowLabel, rowModifier }) => {
      const button = Array.from(
        document.querySelectorAll('[data-radix-popper-content-wrapper] button'),
      ).find((el) => el.textContent?.includes(rowLabel)) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Breadcrumb button not found: ${rowLabel}`);
      const flags =
        rowModifier === 'meta'
          ? { metaKey: true, ctrlKey: false }
          : { metaKey: false, ctrlKey: true };
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...flags }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...flags }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, ...flags }));
    },
    { rowLabel: label, rowModifier: modifier },
  );
}

/** Get the currently selected document ID from the store. */
async function getSelectedId(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    const state = store.getState();
    const tab = state.openTabs.find((t: any) => t.tabId === state.selectedId);
    return tab?.docId ?? null;
  });
}

async function getOpenTabs(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    return store.getState().openTabs.map((t: any) => t.docId);
  });
}

// ── Visibility Tests ────────────────────────────────────────────────

test.describe('Breadcrumb Pill — Visibility', () => {
  test('hidden when sidebar is open', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Child', parentTitle: 'Root' },
    ]);
    await selectDocumentById(window, m.get('Child')!);

    // Sidebar is open by default — breadcrumb should NOT appear
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('appears when sidebar is closed and doc has ancestors', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Child', parentTitle: 'Parent' },
    ]);
    await selectDocumentById(window, m.get('Child')!);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
  });

  test('appears when sidebar is closed and doc has children', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Kid', parentTitle: 'Parent' },
    ]);
    await selectDocumentById(window, m.get('Parent')!);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
  });

  test('hidden for root doc with no children', async ({ window }) => {
    const m = await seedTree(window, [{ title: 'Lonely Root' }]);
    await selectDocumentById(window, m.get('Lonely Root')!);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('disappears when sidebar is reopened', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Top' },
      { title: 'Bottom', parentTitle: 'Top' },
    ]);
    await selectDocumentById(window, m.get('Bottom')!);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    await openSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('hidden when no document is selected', async ({ window }) => {
    await seedTree(window, [
      { title: 'Some Note' },
      { title: 'Child Note', parentTitle: 'Some Note' },
    ]);

    // Clear selection by closing all tabs
    await window.evaluate(() => {
      const store = (window as any).__documentStore;
      const { openTabs } = store.getState();
      for (const tab of openTabs) store.getState().closeTab(tab.tabId);
    });
    await window.waitForTimeout(300);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });
});

// ── Popover Content Tests ───────────────────────────────────────────

test.describe('Breadcrumb Pill — Popover Content', () => {
  test('shows "Note Tree" header', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Anc' },
      { title: 'Desc', parentTitle: 'Anc' },
    ]);
    await selectDocumentById(window, m.get('Desc')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.getByText('Note Tree')).toBeVisible();
  });

  test('shows ancestor chain for a child document', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Grandparent' },
      { title: 'Parent', parentTitle: 'Grandparent' },
      { title: 'Me', parentTitle: 'Parent' },
    ]);
    await selectDocumentById(window, m.get('Me')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Ancestors should be clickable buttons
    await expect(popover.getByRole('button', { name: 'Grandparent', exact: true })).toBeVisible();
    await expect(popover.getByRole('button', { name: 'Parent', exact: true })).toBeVisible();
  });

  test('current document is shown in the popover but is not a navigable button', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Above' },
      { title: 'Current Doc', parentTitle: 'Above' },
    ]);
    const currentDocId = m.get('Current Doc')!;
    await selectDocumentById(window, currentDocId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // The text "Current Doc" should be visible somewhere in the popover
    await expect(popover.getByText('Current Doc')).toBeVisible();
    // But it must NOT be a clickable button (ancestors and children are buttons)
    await expect(popover.locator('button', { hasText: 'Current Doc' })).toHaveCount(0);
  });

  test('clicking the current document entry does not navigate away', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Stay Root' },
      { title: 'Stay Here', parentTitle: 'Stay Root' },
      { title: 'Stay Child', parentTitle: 'Stay Here' },
    ]);
    const stayHereId = m.get('Stay Here')!;
    await selectDocumentById(window, stayHereId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Click the non-button current doc text area
    const currentDocText = popover.getByText('Stay Here');
    await currentDocText.click();
    await window.waitForTimeout(300);

    // Selection should not have changed
    expect(await getSelectedId(window)).toBe(stayHereId);
  });

  test('shows children for a parent document', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Papa' },
      { title: 'Kid A', parentTitle: 'Papa' },
      { title: 'Kid B', parentTitle: 'Papa' },
      { title: 'Kid C', parentTitle: 'Papa' },
    ]);
    await selectDocumentById(window, m.get('Papa')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Kid A' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Kid B' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Kid C' })).toBeVisible();
  });

  test('shows both ancestors and children for mid-level doc', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root Node' },
      { title: 'Middle Node', parentTitle: 'Root Node' },
      { title: 'Leaf Node', parentTitle: 'Middle Node' },
    ]);
    await selectDocumentById(window, m.get('Middle Node')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Ancestor: clickable button
    await expect(popover.locator('button', { hasText: 'Root Node' })).toBeVisible();
    // Current: visible text but NOT a button
    await expect(popover.getByText('Middle Node')).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Middle Node' })).toHaveCount(0);
    // Child: clickable button
    await expect(popover.locator('button', { hasText: 'Leaf Node' })).toBeVisible();
  });

  test('children appear in the same order as their sortOrder in the database', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Sort Parent' },
      { title: 'Alpha', parentTitle: 'Sort Parent' },
      { title: 'Beta', parentTitle: 'Sort Parent' },
      { title: 'Gamma', parentTitle: 'Sort Parent' },
    ]);
    const parentId = m.get('Sort Parent')!;

    // Ask the DB what order the children should be in
    const docs = await listDocumentsFromDb(window);
    const dbChildren = docs
      .filter((d) => d.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const expectedOrder = dbChildren.map((d) => d.title);

    await selectDocumentById(window, parentId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Popover should show children in the exact same order as the DB
    const popoverButtons = await getPopoverButtons(window);
    expect(popoverButtons).toEqual(expectedOrder);
  });

  test('popover closes when clicking trigger again', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Toggle Root' },
      { title: 'Toggle Child', parentTitle: 'Toggle Root' },
    ]);
    await selectDocumentById(window, m.get('Toggle Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover).toBeVisible();

    // Click trigger again to close
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(300);
    await expect(popover).not.toBeVisible();
  });

  test('leaf node shows only ancestors, no children section', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Leaf Root' },
      { title: 'Leaf Mid', parentTitle: 'Leaf Root' },
      { title: 'Leaf End', parentTitle: 'Leaf Mid' },
    ]);
    await selectDocumentById(window, m.get('Leaf End')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const buttons = await getPopoverButtons(window);
    // Only ancestors should be buttons: Leaf Root, Leaf Mid
    expect(buttons).toEqual(['Leaf Root', 'Leaf Mid']);
  });

  test('root with children shows only children, no ancestors', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root Only' },
      { title: 'C1', parentTitle: 'Root Only' },
      { title: 'C2', parentTitle: 'Root Only' },
    ]);
    await selectDocumentById(window, m.get('Root Only')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const buttons = await getPopoverButtons(window);
    // Only children should be buttons (no ancestors since Root Only is a root)
    expect(buttons).toContain('C1');
    expect(buttons).toContain('C2');
    expect(buttons).toHaveLength(2);
  });
});

// ── Navigation Tests ────────────────────────────────────────────────

test.describe('Breadcrumb Pill — Navigation', () => {
  test('clicking an ancestor navigates to it and loads it in the editor', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Nav Root' },
      { title: 'Nav Child', parentTitle: 'Nav Root' },
    ]);
    const rootId = m.get('Nav Root')!;
    await selectDocumentById(window, m.get('Nav Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Nav Root' }).click();
    await window.waitForTimeout(400);

    // Store reflects the navigation
    expect(await getSelectedId(window)).toBe(rootId);
    // Editor actually shows the navigated document
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('Nav Root');
  });

  test('clicking a child navigates to it and loads it in the editor', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Nav Parent' },
      { title: 'Nav Kid', parentTitle: 'Nav Parent' },
    ]);
    const kidId = m.get('Nav Kid')!;
    await selectDocumentById(window, m.get('Nav Parent')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Nav Kid' }).click();
    await window.waitForTimeout(400);

    expect(await getSelectedId(window)).toBe(kidId);
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('Nav Kid');
  });

  test('navigating via ancestor updates breadcrumb: old doc becomes reachable child', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'BC Root' },
      { title: 'BC Mid', parentTitle: 'BC Root' },
      { title: 'BC Leaf', parentTitle: 'BC Mid' },
    ]);
    await selectDocumentById(window, m.get('BC Leaf')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Click on BC Root (skip two levels up)
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'BC Root' }).click();
    await window.waitForTimeout(400);

    // Editor should now show BC Root
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('BC Root');

    // Reopen breadcrumb — BC Root is now current, BC Mid is its navigable child
    await openBreadcrumb(window);
    const newPopover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(newPopover.locator('button', { hasText: 'BC Mid' })).toBeVisible();
    // BC Root is the current doc — should NOT be a navigable button
    await expect(newPopover.locator('button', { hasText: 'BC Root' })).toHaveCount(0);
  });

  test('navigating via child updates the breadcrumb context', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Down Root' },
      { title: 'Down Child', parentTitle: 'Down Root' },
      { title: 'Down Grandchild', parentTitle: 'Down Child' },
    ]);
    await selectDocumentById(window, m.get('Down Root')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Navigate to Down Child
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Down Child' }).click();
    await window.waitForTimeout(400);

    // Reopen — now Down Root is ancestor, Down Child is current, Down Grandchild is child
    await openBreadcrumb(window);

    const newPopover = window.locator('[data-radix-popper-content-wrapper]');
    // Ancestor clickable
    await expect(newPopover.locator('button', { hasText: 'Down Root' })).toBeVisible();
    // Child clickable
    await expect(newPopover.locator('button', { hasText: 'Down Grandchild' })).toBeVisible();
    // Current doc visible but not a button
    await expect(newPopover.getByText('Down Child')).toBeVisible();
    await expect(newPopover.locator('button', { hasText: 'Down Child' })).toHaveCount(0);
  });

  test('navigate up through entire hierarchy one level at a time, editor updates each step', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'L0' },
      { title: 'L1', parentTitle: 'L0' },
      { title: 'L2', parentTitle: 'L1' },
      { title: 'L3', parentTitle: 'L2' },
    ]);
    const visibleTitle = window.locator('main:visible h1.editor-title');

    // Start at L3 (deepest)
    await selectDocumentById(window, m.get('L3')!);
    await closeSidebar(window);

    for (const target of ['L2', 'L1', 'L0']) {
      await openBreadcrumb(window);
      const popover = window.locator('[data-radix-popper-content-wrapper]');
      await popover.locator('button', { hasText: target }).click();
      await window.waitForTimeout(400);

      expect(await getSelectedId(window)).toBe(m.get(target)!);
      await expect(visibleTitle).toContainText(target);
    }
  });

  test('navigate down through hierarchy using children, editor updates each step', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Top' },
      { title: 'Mid', parentTitle: 'Top' },
      { title: 'Bot', parentTitle: 'Mid' },
    ]);
    const visibleTitle = window.locator('main:visible h1.editor-title');

    // Start at Top
    await selectDocumentById(window, m.get('Top')!);
    await closeSidebar(window);

    for (const target of ['Mid', 'Bot']) {
      await openBreadcrumb(window);
      const popover = window.locator('[data-radix-popper-content-wrapper]');
      await popover.locator('button', { hasText: target }).click();
      await window.waitForTimeout(400);

      expect(await getSelectedId(window)).toBe(m.get(target)!);
      await expect(visibleTitle).toContainText(target);
    }
  });
});

// ── Display Tests ───────────────────────────────────────────────────

test.describe('Breadcrumb Pill — Display & Emojis', () => {
  test('documents with emojis show emoji in the breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Emoji Parent', emoji: '📁' },
      { title: 'Emoji Child', emoji: '📝', parentTitle: 'Emoji Parent' },
    ]);
    await selectDocumentById(window, m.get('Emoji Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Ancestor should show its emoji
    const ancestorBtn = popover.locator('button', { hasText: 'Emoji Parent' });
    await expect(ancestorBtn).toContainText('📁');
  });

  test('documents without emojis show FileText icon', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'No Emoji Root' },
      { title: 'No Emoji Child', parentTitle: 'No Emoji Root' },
    ]);
    await selectDocumentById(window, m.get('No Emoji Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Ancestor should have an SVG icon (FileText from lucide-react)
    const ancestorBtn = popover.locator('button', { hasText: 'No Emoji Root' });
    await expect(ancestorBtn.locator('svg')).toBeVisible();
  });

  test('untitled documents display "Untitled"', async ({ window }) => {
    const m = await seedTree(window, [
      { title: '' },
      { title: 'Has Title', parentTitle: '' },
    ]);
    await selectDocumentById(window, m.get('Has Title')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Untitled' })).toBeVisible();
  });

  test('mixed emoji and non-emoji docs display correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Emoji Grandparent', emoji: '🌳' },
      { title: 'Plain Parent', parentTitle: 'Emoji Grandparent' },
      { title: 'Emoji Me', emoji: '🍃', parentTitle: 'Plain Parent' },
    ]);
    await selectDocumentById(window, m.get('Emoji Me')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');

    // Emoji ancestor shows emoji
    const emojiAncestor = popover.locator('button', { hasText: 'Emoji Grandparent' });
    await expect(emojiAncestor).toContainText('🌳');

    // Non-emoji ancestor shows SVG icon
    const plainAncestor = popover.locator('button', { hasText: 'Plain Parent' });
    await expect(plainAncestor.locator('svg')).toBeVisible();
  });

  test('current doc with emoji shows emoji in the breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'A Parent' },
      { title: 'Current Emoji Doc', emoji: '✨', parentTitle: 'A Parent' },
    ]);
    await selectDocumentById(window, m.get('Current Emoji Doc')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Current doc text is visible and contains the emoji, but it's not a navigable button
    await expect(popover.getByText('Current Emoji Doc')).toBeVisible();
    await expect(popover.getByText('✨')).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Current Emoji Doc' })).toHaveCount(0);
  });

  test('child documents with emojis show emojis', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Display Parent' },
      { title: 'Emoji Kid', emoji: '🎮', parentTitle: 'Display Parent' },
      { title: 'Plain Kid', parentTitle: 'Display Parent' },
    ]);
    await selectDocumentById(window, m.get('Display Parent')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    const emojiChild = popover.locator('button', { hasText: 'Emoji Kid' });
    await expect(emojiChild).toContainText('🎮');

    const plainChild = popover.locator('button', { hasText: 'Plain Kid' });
    await expect(plainChild.locator('svg')).toBeVisible();
  });
});

// ── Deep Hierarchy Tests ────────────────────────────────────────────

test.describe('Breadcrumb Pill — Deep Hierarchy', () => {
  test('4-level deep ancestor chain is fully displayed', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Level 0' },
      { title: 'Level 1', parentTitle: 'Level 0' },
      { title: 'Level 2', parentTitle: 'Level 1' },
      { title: 'Level 3', parentTitle: 'Level 2' },
      { title: 'Level 4', parentTitle: 'Level 3' },
    ]);
    await selectDocumentById(window, m.get('Level 4')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Level 0', 'Level 1', 'Level 2', 'Level 3']);
  });

  test('deep hierarchy shows correct ancestors when navigating to mid node', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'D0' },
      { title: 'D1', parentTitle: 'D0' },
      { title: 'D2', parentTitle: 'D1' },
      { title: 'D3', parentTitle: 'D2' },
    ]);
    await selectDocumentById(window, m.get('D2')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');

    // Ancestors: D0, D1
    await expect(popover.locator('button', { hasText: 'D0' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'D1' })).toBeVisible();

    // Current: D2 (visible text but not navigable)
    await expect(popover.getByText('D2')).toBeVisible();
    await expect(popover.locator('button', { hasText: 'D2' })).toHaveCount(0);

    // Child: D3
    await expect(popover.locator('button', { hasText: 'D3' })).toBeVisible();
  });

  test('wide tree: parent with many children shows all, and each is navigable', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [
      { title: 'Wide Root' },
    ];
    for (let i = 0; i < 8; i++) {
      specs.push({ title: `W Child ${i}`, parentTitle: 'Wide Root' });
    }

    const m = await seedTree(window, specs);
    await selectDocumentById(window, m.get('Wide Root')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(buttons).toContain(`W Child ${i}`);
    }

    // Verify one of them is actually navigable (click the last child)
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'W Child 3' }).click();
    await window.waitForTimeout(400);

    expect(await getSelectedId(window)).toBe(m.get('W Child 3')!);
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('W Child 3');
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────

test.describe('Breadcrumb Pill — Edge Cases', () => {
  test('breadcrumb updates after moving a note to a different parent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Original Parent' },
      { title: 'New Parent' },
      { title: 'Moving Note', parentTitle: 'Original Parent' },
    ]);
    const movingId = m.get('Moving Note')!;
    const newParentId = m.get('New Parent')!;

    await selectDocumentById(window, movingId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Initially the ancestor is "Original Parent"
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Original Parent' })).toBeVisible();

    // Close popover
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(300);

    // Move the note via IPC
    await window.evaluate(
      async ({ id, parentId }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        const store = (window as any).__documentStore;
        if (store) await store.getState().loadDocuments(true);
      },
      { id: movingId, parentId: newParentId },
    );
    await window.waitForTimeout(400);

    // Reopen breadcrumb — ancestor should now be "New Parent"
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'New Parent' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Original Parent' })).not.toBeVisible();
  });

  test('breadcrumb updates after trashing a child', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Trash Test Parent' },
      { title: 'Keep Child', parentTitle: 'Trash Test Parent' },
      { title: 'Trash Child', parentTitle: 'Trash Test Parent' },
    ]);
    const trashChildId = m.get('Trash Child')!;

    await selectDocumentById(window, m.get('Trash Test Parent')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Both children should be visible initially
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Keep Child' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Trash Child' })).toBeVisible();

    // Close popover and trash one child via IPC
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(300);

    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.trash', { id });
      const store = (window as any).__documentStore;
      if (store) await store.getState().loadDocuments(true);
    }, trashChildId);
    await window.waitForTimeout(400);

    // Reopen — only Keep Child should remain
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Keep Child' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Trash Child' })).not.toBeVisible();
  });

  test('selecting different documents updates breadcrumb without reopening sidebar', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root A' },
      { title: 'Child A', parentTitle: 'Root A' },
      { title: 'Root B' },
      { title: 'Child B', parentTitle: 'Root B' },
    ]);

    await selectDocumentById(window, m.get('Child A')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Root A' })).toBeVisible();

    // Close popover, switch to Child B
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(300);

    await selectDocumentById(window, m.get('Child B')!);
    await window.waitForTimeout(300);

    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Root B' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Root A' })).not.toBeVisible();
  });

  test('breadcrumb disappears when note becomes root with no children after un-nesting', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Solo Parent' },
      { title: 'Solo Child', parentTitle: 'Solo Parent' },
    ]);
    const childId = m.get('Solo Child')!;

    await selectDocumentById(window, childId);
    await closeSidebar(window);

    // Breadcrumb visible (has ancestor)
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Move child to root via IPC (un-nest it)
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.move', { id, parentId: null, sortOrder: 0 });
      const store = (window as any).__documentStore;
      if (store) await store.getState().loadDocuments(true);
    }, childId);
    await window.waitForTimeout(400);

    // Now it's a root with no children — breadcrumb should vanish
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('breadcrumb appears when a root note gains a child', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Gaining Parent' },
    ]);
    const parentId = m.get('Gaining Parent')!;

    await selectDocumentById(window, parentId);
    await closeSidebar(window);

    // No children yet — breadcrumb hidden
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Add a child via IPC
    await window.evaluate(async (pId) => {
      const { document } = await (window as any).lychee.invoke('documents.create', {
        title: 'New Kid',
        parentId: pId,
      });
      await (window as any).lychee.invoke('documents.update', {
        id: document.id,
        title: 'New Kid',
      });
      const store = (window as any).__documentStore;
      if (store) await store.getState().loadDocuments(true);
    }, parentId);
    await window.waitForTimeout(400);

    // Now it has a child — breadcrumb should appear
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    await openBreadcrumb(window);
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'New Kid' })).toBeVisible();
  });

  test('breadcrumb reflects renamed ancestor', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Old Name' },
      { title: 'Watcher', parentTitle: 'Old Name' },
    ]);
    const parentId = m.get('Old Name')!;

    await selectDocumentById(window, m.get('Watcher')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Old Name' })).toBeVisible();

    // Close popover, rename ancestor
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(300);

    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, title: 'New Name' });
      const store = (window as any).__documentStore;
      if (store) await store.getState().loadDocuments(true);
    }, parentId);
    await window.waitForTimeout(400);

    // Reopen — should show "New Name"
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'New Name' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Old Name' })).not.toBeVisible();
  });
});

// ── Integration with Tab / Document Selection ───────────────────────

test.describe('Breadcrumb Pill — Tab Integration', () => {
  test('navigating via breadcrumb opens correct tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Tab Root' },
      { title: 'Tab Child', parentTitle: 'Tab Root' },
    ]);
    const rootId = m.get('Tab Root')!;
    await selectDocumentById(window, m.get('Tab Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Tab Root' }).click();
    await window.waitForTimeout(400);

    // The active tab should now be Tab Root
    const selectedId = await getSelectedId(window);
    expect(selectedId).toBe(rootId);

    // Verify it's actually shown in the editor by checking the title
    await openSidebar(window);
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('Tab Root');
  });

  test('navigating via breadcrumb from different tree branches', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Branch A' },
      { title: 'Branch A Child', parentTitle: 'Branch A' },
      { title: 'Branch B' },
      { title: 'Branch B Child', parentTitle: 'Branch B' },
    ]);

    // Start on Branch A Child
    await selectDocumentById(window, m.get('Branch A Child')!);
    await closeSidebar(window);

    // Navigate to Branch A via breadcrumb
    await openBreadcrumb(window);
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Branch A' }).click();
    await window.waitForTimeout(400);
    expect(await getSelectedId(window)).toBe(m.get('Branch A')!);

    // Switch to Branch B Child
    await selectDocumentById(window, m.get('Branch B Child')!);
    await window.waitForTimeout(300);

    // Navigate to Branch B via breadcrumb
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Branch B' }).click();
    await window.waitForTimeout(400);
    expect(await getSelectedId(window)).toBe(m.get('Branch B')!);
  });

  test('multiple rapid navigations via breadcrumb work correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Rapid 0' },
      { title: 'Rapid 1', parentTitle: 'Rapid 0' },
      { title: 'Rapid 2', parentTitle: 'Rapid 1' },
      { title: 'Rapid 3', parentTitle: 'Rapid 2' },
    ]);

    await selectDocumentById(window, m.get('Rapid 3')!);
    await closeSidebar(window);

    // Navigate up one level at a time in quick succession
    for (const target of ['Rapid 2', 'Rapid 1', 'Rapid 0']) {
      await openBreadcrumb(window);
      const popover = window.locator('[data-radix-popper-content-wrapper]');
      await popover.locator('button', { hasText: target }).click();
      await window.waitForTimeout(400);
    }

    // Should end up at Rapid 0
    expect(await getSelectedId(window)).toBe(m.get('Rapid 0')!);
  });

  test('cmd-click opens breadcrumb target in a new tab without changing selection', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Cmd Parent' },
      { title: 'Cmd Child', parentTitle: 'Cmd Parent' },
    ]);
    const parentId = m.get('Cmd Parent')!;
    const childId = m.get('Cmd Child')!;

    await selectDocumentById(window, childId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const beforeTabs = await getOpenTabs(window);
    expect(beforeTabs).toEqual([childId]);

    await clickBreadcrumbWithModifier(window, 'Cmd Parent', 'meta');
    await window.waitForTimeout(300);

    const afterTabs = await getOpenTabs(window);
    expect(await getSelectedId(window)).toBe(childId);
    expect(afterTabs).toContain(childId);
    expect(afterTabs).toContain(parentId);
    expect(afterTabs.filter((id) => id === parentId)).toHaveLength(1);
    expect(afterTabs).toHaveLength(beforeTabs.length + 1);
  });

  test('cmd-click on already-open breadcrumb target opens in new tab (creating duplicate)', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'NoDup Parent' },
      { title: 'NoDup Child', parentTitle: 'NoDup Parent' },
    ]);
    const parentId = m.get('NoDup Parent')!;
    const childId = m.get('NoDup Child')!;

    await selectDocumentById(window, parentId);
    await window.evaluate((id) => {
      (window as any).__documentStore.getState().openTab(id);
    }, childId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const beforeTabs = await getOpenTabs(window);
    await clickBreadcrumbWithModifier(window, 'NoDup Child', 'meta');
    await window.waitForTimeout(300);
    const afterTabs = await getOpenTabs(window);

    expect(await getSelectedId(window)).toBe(parentId);
    expect(afterTabs.length).toBe(beforeTabs.length + 1);
    expect(afterTabs.filter((id: string) => id === childId)).toHaveLength(2);
  });

  test('repeated cmd-click on same breadcrumb target creates a new tab each time', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Repeat Parent' },
      { title: 'Repeat Child', parentTitle: 'Repeat Parent' },
    ]);
    const parentId = m.get('Repeat Parent')!;
    const childId = m.get('Repeat Child')!;

    await selectDocumentById(window, parentId);
    await closeSidebar(window);

    for (let i = 0; i < 5; i++) {
      await openBreadcrumb(window);
      await clickBreadcrumbWithModifier(window, 'Repeat Child', 'meta');
      await window.waitForTimeout(120);
    }

    const tabs = await getOpenTabs(window);
    expect(await getSelectedId(window)).toBe(parentId);
    expect(tabs).toContain(parentId);
    expect(tabs).toContain(childId);
    expect(tabs.filter((id: string) => id === childId)).toHaveLength(5);
  });

  test('rapid cmd-click across ancestors opens each once and keeps current note selected', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Stress A' },
      { title: 'Stress B', parentTitle: 'Stress A' },
      { title: 'Stress C', parentTitle: 'Stress B' },
      { title: 'Stress D', parentTitle: 'Stress C' },
    ]);
    const aId = m.get('Stress A')!;
    const bId = m.get('Stress B')!;
    const cId = m.get('Stress C')!;
    const dId = m.get('Stress D')!;

    await selectDocumentById(window, dId);
    await closeSidebar(window);

    for (const target of ['Stress C', 'Stress B', 'Stress A', 'Stress B', 'Stress C']) {
      await openBreadcrumb(window);
      await clickBreadcrumbWithModifier(window, target, 'meta');
      await window.waitForTimeout(100);
    }

    const tabs = await getOpenTabs(window);
    expect(await getSelectedId(window)).toBe(dId);
    expect(tabs).toContain(aId);
    expect(tabs).toContain(bId);
    expect(tabs).toContain(cId);
    expect(tabs).toContain(dId);
    // A clicked once, B clicked twice, C clicked twice → each creates a new tab
    expect(tabs.filter((id) => id === aId)).toHaveLength(1);
    expect(tabs.filter((id) => id === bId)).toHaveLength(2);
    expect(tabs.filter((id) => id === cId)).toHaveLength(2);
  });

  test('cmd-click does not close breadcrumb popover', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Popover Parent' },
      { title: 'Popover Child', parentTitle: 'Popover Parent' },
    ]);
    await selectDocumentById(window, m.get('Popover Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover).toBeVisible();

    await clickBreadcrumbWithModifier(window, 'Popover Parent', 'meta');
    await window.waitForTimeout(200);

    await expect(popover).toBeVisible();
  });

  test('middle-click opens breadcrumb target in a new tab without changing selection', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Middle Parent' },
      { title: 'Middle Child', parentTitle: 'Middle Parent' },
    ]);
    const parentId = m.get('Middle Parent')!;
    const childId = m.get('Middle Child')!;

    await selectDocumentById(window, childId);
    await closeSidebar(window);
    await openBreadcrumb(window);
    const beforeTabs = await getOpenTabs(window);

    await window
      .locator('[data-radix-popper-content-wrapper]')
      .locator('button', { hasText: 'Middle Parent' })
      .click({ button: 'middle' });
    await window.waitForTimeout(250);

    const afterTabs = await getOpenTabs(window);
    expect(await getSelectedId(window)).toBe(childId);
    expect(afterTabs).toContain(childId);
    expect(afterTabs).toContain(parentId);
    expect(afterTabs.filter((id) => id === parentId)).toHaveLength(1);
    expect(afterTabs).toHaveLength(beforeTabs.length + 1);
  });

  test('cmd+enter on focused breadcrumb row opens new tab and keeps selection', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Key Parent' },
      { title: 'Key Child', parentTitle: 'Key Parent' },
    ]);
    const parentId = m.get('Key Parent')!;
    const childId = m.get('Key Child')!;

    await selectDocumentById(window, childId);
    await closeSidebar(window);
    await openBreadcrumb(window);
    const row = window
      .locator('[data-radix-popper-content-wrapper]')
      .locator('button', { hasText: 'Key Parent' });
    await row.focus();
    await window.keyboard.down('Meta');
    await window.keyboard.press('Enter');
    await window.keyboard.up('Meta');
    await window.waitForTimeout(250);

    const tabs = await getOpenTabs(window);
    expect(await getSelectedId(window)).toBe(childId);
    expect(tabs).toContain(parentId);
    expect(tabs).toContain(childId);
  });

  test('close-active-tab race after cmd-click keeps tab state consistent', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Race Parent' },
      { title: 'Race Child', parentTitle: 'Race Parent' },
    ]);
    const parentId = m.get('Race Parent')!;
    const childId = m.get('Race Child')!;

    await selectDocumentById(window, childId);
    await closeSidebar(window);
    await openBreadcrumb(window);
    await clickBreadcrumbWithModifier(window, 'Race Parent', 'meta');
    await window.waitForTimeout(150);

    await window.evaluate((id) => {
      const store = (window as any).__documentStore;
      const tab = store.getState().openTabs.find((t: any) => t.docId === id);
      if (tab) store.getState().closeTab(tab.tabId);
    }, childId);
    await window.waitForTimeout(200);

    const tabs = await getOpenTabs(window);
    const selectedId = await getSelectedId(window);
    expect(tabs).toContain(parentId);
    expect(selectedId).toBe(parentId);
  });

  test('renaming breadcrumb target while popover is open still allows cmd-click on updated row', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Rename Parent' },
      { title: 'Rename Child', parentTitle: 'Rename Parent' },
    ]);
    const parentId = m.get('Rename Parent')!;
    const childId = m.get('Rename Child')!;

    await selectDocumentById(window, childId);
    await closeSidebar(window);
    await openBreadcrumb(window);
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, title: 'Renamed Parent' });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, parentId);
    await window.waitForTimeout(250);

    await clickBreadcrumbWithModifier(window, 'Renamed Parent', 'meta');
    await window.waitForTimeout(200);
    const tabs = await getOpenTabs(window);
    expect(await getSelectedId(window)).toBe(childId);
    expect(tabs).toContain(parentId);
  });

  test('deleting a breadcrumb target while popover is open removes stale row and keeps selection stable', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Delete Parent' },
      { title: 'Delete Child', parentTitle: 'Delete Parent' },
      { title: 'Delete Sibling', parentTitle: 'Delete Parent' },
    ]);
    const childId = m.get('Delete Child')!;
    const siblingId = m.get('Delete Sibling')!;

    await selectDocumentById(window, childId);
    await closeSidebar(window);
    await openBreadcrumb(window);
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.trash', { id });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, siblingId);
    await window.waitForTimeout(250);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Delete Sibling' })).toHaveCount(0);
    expect(await getSelectedId(window)).toBe(childId);
  });

  test('cmd-click on deep, scrollable breadcrumb list works for off-screen target', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [{ title: 'Scroll Root' }];
    for (let i = 1; i <= 14; i++) {
      specs.push({ title: `Scroll ${i}`, parentTitle: i === 1 ? 'Scroll Root' : `Scroll ${i - 1}` });
    }
    const m = await seedTree(window, specs);
    const deepestId = m.get('Scroll 14')!;
    const rootId = m.get('Scroll Root')!;

    await selectDocumentById(window, deepestId);
    await closeSidebar(window);
    await openBreadcrumb(window);
    await window.evaluate(() => {
      const el = document.querySelector('[data-radix-popper-content-wrapper] [data-radix-popover-content]');
      if (el) (el as HTMLElement).scrollTop = 0;
    });

    await clickBreadcrumbWithModifier(window, 'Scroll Root', 'meta');
    await window.waitForTimeout(250);

    const tabs = await getOpenTabs(window);
    expect(await getSelectedId(window)).toBe(deepestId);
    expect(tabs).toContain(rootId);
  });
});

// ── Weird Edge Cases ────────────────────────────────────────────────

test.describe('Breadcrumb Pill — Orphaned Chains & Trashed Ancestors', () => {
  test('trashing mid-chain ancestor orphans the descendant breadcrumb', async ({ window }) => {
    // A → B → C → D. Trash B. Now C still has parentId=B but B is gone from
    // the active docs list, so buildAncestors(C) returns []. If C has no
    // children, the breadcrumb should disappear entirely.
    const m = await seedTree(window, [
      { title: 'Chain A' },
      { title: 'Chain B', parentTitle: 'Chain A' },
      { title: 'Chain C', parentTitle: 'Chain B' },
    ]);
    const bId = m.get('Chain B')!;
    await selectDocumentById(window, m.get('Chain C')!);
    await closeSidebar(window);

    // Breadcrumb visible (ancestors: A, B)
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash B — this orphans C (parentId points to a trashed doc)
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.trash', { id });
      const store = (window as any).__documentStore;
      if (store) await store.getState().loadDocuments(true);
    }, bId);
    await window.waitForTimeout(400);

    // C has parentId=B but B is trashed. buildAncestors can't find B → empty chain.
    // C has no children either → breadcrumb vanishes.
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('trashing mid-chain ancestor cascade-trashes all descendants: breadcrumb vanishes', async ({ window }) => {
    // A → B → C → D. Select C, then trash B. App cascade-trashes B, C, and D.
    // Since C is removed from the active documents list, breadcrumb should vanish.
    const m = await seedTree(window, [
      { title: 'Orp A' },
      { title: 'Orp B', parentTitle: 'Orp A' },
      { title: 'Orp C', parentTitle: 'Orp B' },
      { title: 'Orp D', parentTitle: 'Orp C' },
    ]);
    await selectDocumentById(window, m.get('Orp C')!);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash B — cascades to C and D
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.trash', { id });
      const store = (window as any).__documentStore;
      if (store) await store.getState().loadDocuments(true);
    }, m.get('Orp B')!);
    await window.waitForTimeout(400);

    // C was cascade-trashed, currentDoc is gone from the store → breadcrumb vanishes
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Verify the cascade in the DB: C and D are both trashed
    const docC = await getDocumentFromDb(window, m.get('Orp C')!);
    const docD = await getDocumentFromDb(window, m.get('Orp D')!);
    expect(docC!.deletedAt).toBeTruthy();
    expect(docD!.deletedAt).toBeTruthy();
  });

  test('restoring a trashed ancestor re-links the breadcrumb chain', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Res A' },
      { title: 'Res B', parentTitle: 'Res A' },
      { title: 'Res C', parentTitle: 'Res B' },
    ]);
    await selectDocumentById(window, m.get('Res C')!);
    await closeSidebar(window);

    // Verify full chain
    await openBreadcrumb(window);
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Res A' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Res B' })).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash B
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.trash', { id });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Res B')!);
    await window.waitForTimeout(400);

    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Restore B
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.restore', { id });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Res B')!);
    await window.waitForTimeout(400);

    // Chain should be restored
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Res A' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Res B' })).toBeVisible();
  });

  test('trashing ALL children of current doc hides breadcrumb (root parent case)', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'All Trash Parent' },
      { title: 'Doomed A', parentTitle: 'All Trash Parent' },
      { title: 'Doomed B', parentTitle: 'All Trash Parent' },
    ]);
    await selectDocumentById(window, m.get('All Trash Parent')!);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash both children
    for (const title of ['Doomed A', 'Doomed B']) {
      await window.evaluate(async (id) => {
        await (window as any).lychee.invoke('documents.trash', { id });
      }, m.get(title)!);
    }
    await window.evaluate(async () => {
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    });
    await window.waitForTimeout(400);

    // No ancestors, no children → breadcrumb gone
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('permanently deleting current doc hides breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Delete Root' },
      { title: 'Delete Me', parentTitle: 'Delete Root' },
    ]);
    const deleteId = m.get('Delete Me')!;
    await selectDocumentById(window, deleteId);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash then permanently delete
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.trash', { id });
      await (window as any).lychee.invoke('documents.delete', { id });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, deleteId);
    await window.waitForTimeout(400);

    // currentDoc is gone from the store → component returns null
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });
});

test.describe('Breadcrumb Pill — Deletion, Creation & Restore Sequences', () => {
  /** Helper to trash a doc via IPC and reload the store. */
  async function trashDoc(window: Page, id: string) {
    await window.evaluate(async (docId) => {
      await (window as any).lychee.invoke('documents.trash', { id: docId });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, id);
    await window.waitForTimeout(400);
  }

  /** Helper to restore a doc via IPC and reload the store. */
  async function restoreDoc(window: Page, id: string) {
    await window.evaluate(async (docId) => {
      await (window as any).lychee.invoke('documents.restore', { id: docId });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, id);
    await window.waitForTimeout(400);
  }

  /** Single-row hard delete (no cascade). Deletes only the specified doc. */
  async function hardDeleteDoc(window: Page, id: string) {
    await window.evaluate(async (docId) => {
      await (window as any).lychee.invoke('documents.delete', { id: docId });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, id);
    await window.waitForTimeout(400);
  }

  /** Cascade permanent delete — removes the doc and ALL its descendants from the DB. */
  async function permanentDeleteDoc(window: Page, id: string) {
    await window.evaluate(async (docId) => {
      await (window as any).lychee.invoke('documents.permanentDelete', { id: docId });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, id);
    await window.waitForTimeout(400);
  }

  /** Helper to create a child doc via IPC and reload the store. Returns the new doc ID. */
  async function createChild(window: Page, parentId: string, title: string): Promise<string> {
    const newId = await window.evaluate(async ({ parentId, title }) => {
      const { document } = await (window as any).lychee.invoke('documents.create', { title, parentId });
      await (window as any).lychee.invoke('documents.update', { id: document.id, title });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
      return document.id;
    }, { parentId, title });
    await window.waitForTimeout(300);
    return newId;
  }

  test('trash the selected doc itself: breadcrumb vanishes', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Parent' },
      { title: 'Selected', parentTitle: 'Parent' },
      { title: 'Kid', parentTitle: 'Selected' },
    ]);
    await selectDocumentById(window, m.get('Selected')!);
    await closeSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash selected doc — cascade trashes Kid too
    await trashDoc(window, m.get('Selected')!);

    // Selected doc is gone from store → breadcrumb vanishes
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('trash selected doc then restore it: breadcrumb comes back with full chain', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'GP' },
      { title: 'P', parentTitle: 'GP' },
      { title: 'Me', parentTitle: 'P' },
      { title: 'Kid', parentTitle: 'Me' },
    ]);
    const meId = m.get('Me')!;
    await selectDocumentById(window, meId);
    await closeSidebar(window);

    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['GP', 'P', 'Kid']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash Me (cascades to Kid)
    await trashDoc(window, meId);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Restore Me (restores Kid too)
    await restoreDoc(window, meId);

    // Me is back in the store, re-select it
    await selectDocumentById(window, meId);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['GP', 'P', 'Kid']);
  });

  test('trash direct parent of selected doc: cascade removes selected too', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Direct Parent', parentTitle: 'Root' },
      { title: 'Viewing', parentTitle: 'Direct Parent' },
    ]);
    await selectDocumentById(window, m.get('Viewing')!);
    await closeSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash Viewing's direct parent — cascade trashes Viewing
    await trashDoc(window, m.get('Direct Parent')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Verify in DB
    const doc = await getDocumentFromDb(window, m.get('Viewing')!);
    expect(doc!.deletedAt).toBeTruthy();
  });

  test('permanently delete a child: child vanishes from breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Stable' },
      { title: 'Doomed', parentTitle: 'Stable' },
      { title: 'Survivor', parentTitle: 'Stable' },
    ]);
    await selectDocumentById(window, m.get('Stable')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Doomed' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Survivor' })).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash then hard-delete Doomed
    await trashDoc(window, m.get('Doomed')!);
    await hardDeleteDoc(window, m.get('Doomed')!);

    // Only Survivor should remain
    await openBreadcrumb(window);
    const updated = window.locator('[data-radix-popper-content-wrapper]');
    await expect(updated.locator('button', { hasText: 'Survivor' })).toBeVisible();
    await expect(updated.locator('button', { hasText: 'Doomed' })).not.toBeVisible();
  });

  test('permanently delete an ancestor: cascade wipes entire subtree from DB', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Mid', parentTitle: 'Root' },
      { title: 'Leaf', parentTitle: 'Mid' },
    ]);
    await selectDocumentById(window, m.get('Leaf')!);
    await closeSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash Root (cascades to Mid and Leaf), then permanently delete the whole subtree
    await trashDoc(window, m.get('Root')!);
    await permanentDeleteDoc(window, m.get('Root')!);

    // Everything is gone — cascade permanent delete wipes the entire tree
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
    const midDoc = await getDocumentFromDb(window, m.get('Mid')!);
    const leafDoc = await getDocumentFromDb(window, m.get('Leaf')!);
    expect(midDoc).toBeNull();
    expect(leafDoc).toBeNull();
  });

  test('create a new child under selected doc: breadcrumb updates to show it', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Ancestor' },
      { title: 'Current', parentTitle: 'Ancestor' },
    ]);
    await selectDocumentById(window, m.get('Current')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Initially: ancestor [Ancestor], no children
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Ancestor']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Create a child under Current
    await createChild(window, m.get('Current')!, 'Brand New Kid');

    // Breadcrumb should now show the new child
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toContain('Ancestor');
    expect(buttons).toContain('Brand New Kid');
  });

  test('trash parent then add child to orphaned selected: child shows, ancestors do not', async ({ window }) => {
    // A → B (selected). Trash A (cascades to B). Restore B only (manually).
    // B is now a root with parentId pointing to trashed A. Then add a child to B.
    const m = await seedTree(window, [
      { title: 'Grandpa' },
      { title: 'Orphan', parentTitle: 'Grandpa' },
    ]);
    const orphanId = m.get('Orphan')!;

    await selectDocumentById(window, orphanId);
    await closeSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash Grandpa (cascades to Orphan)
    await trashDoc(window, m.get('Grandpa')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Restore just Orphan
    await restoreDoc(window, orphanId);
    await selectDocumentById(window, orphanId);

    // Orphan's parentId still points to trashed Grandpa, but Grandpa is trashed
    // so buildAncestors returns []. No children either → breadcrumb hidden.
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Now create a child under Orphan
    await createChild(window, orphanId, 'New Kid');

    // Orphan now has a child → breadcrumb appears, but no ancestors
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'New Kid' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Grandpa' })).not.toBeVisible();
  });

  test('delete a child and replace it with a new one: breadcrumb swaps correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Host' },
      { title: 'Old Child', parentTitle: 'Host' },
    ]);
    const hostId = m.get('Host')!;

    await selectDocumentById(window, hostId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Old Child']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash and hard-delete Old Child
    await trashDoc(window, m.get('Old Child')!);
    await hardDeleteDoc(window, m.get('Old Child')!);

    // Breadcrumb should vanish (no children left)
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Create a replacement child
    await createChild(window, hostId, 'New Child');

    // Breadcrumb reappears with the replacement
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['New Child']);
  });

  test('rapid trash-restore-trash cycle on an ancestor: breadcrumb toggles correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Flaky Root' },
      { title: 'Flaky Mid', parentTitle: 'Flaky Root' },
      { title: 'Stable Leaf', parentTitle: 'Flaky Mid' },
    ]);
    const midId = m.get('Flaky Mid')!;

    await selectDocumentById(window, m.get('Stable Leaf')!);
    await closeSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash Mid (cascades to Stable Leaf)
    await trashDoc(window, midId);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Restore Mid (restores Stable Leaf too)
    await restoreDoc(window, midId);
    await selectDocumentById(window, m.get('Stable Leaf')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash again
    await trashDoc(window, midId);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Restore again — breadcrumb should come back with full chain
    await restoreDoc(window, midId);
    await selectDocumentById(window, m.get('Stable Leaf')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Flaky Root', 'Flaky Mid']);
  });

  test('hard-delete ancestor while popover is open: breadcrumb vanishes', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Doom Root' },
      { title: 'Doom Child', parentTitle: 'Doom Root' },
      { title: 'Doom Leaf', parentTitle: 'Doom Child' },
    ]);

    await selectDocumentById(window, m.get('Doom Leaf')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Doom Root' })).toBeVisible();

    // Trash then permanently delete Root while popover is open (cascades everything)
    await trashDoc(window, m.get('Doom Root')!);
    await permanentDeleteDoc(window, m.get('Doom Root')!);

    // Everything wiped — breadcrumb gone
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('trash children one by one then restore them all: breadcrumb rebuilds', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Stable Parent' },
      { title: 'C1', parentTitle: 'Stable Parent' },
      { title: 'C2', parentTitle: 'Stable Parent' },
      { title: 'C3', parentTitle: 'Stable Parent' },
    ]);
    const parentId = m.get('Stable Parent')!;
    await selectDocumentById(window, parentId);
    await closeSidebar(window);

    // Trash all children one by one
    await trashDoc(window, m.get('C1')!);
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(2);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    await trashDoc(window, m.get('C2')!);
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(1);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    await trashDoc(window, m.get('C3')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Restore them all
    await restoreDoc(window, m.get('C1')!);
    await restoreDoc(window, m.get('C2')!);
    await restoreDoc(window, m.get('C3')!);

    // Breadcrumb should be back with all 3 children
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(3);
  });

  test('create multiple children then trash some: breadcrumb shows only survivors', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Base' },
    ]);
    const baseId = m.get('Base')!;
    await selectDocumentById(window, baseId);
    await closeSidebar(window);

    // No children yet
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Create 4 children
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await createChild(window, baseId, `Child ${i}`));
    }

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(4);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash children 0 and 2
    await trashDoc(window, ids[0]);
    await trashDoc(window, ids[2]);

    // Only children 1 and 3 should remain
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(2);
    expect(buttons).toContain('Child 1');
    expect(buttons).toContain('Child 3');
    expect(buttons).not.toContain('Child 0');
    expect(buttons).not.toContain('Child 2');
  });

  test('restore a child whose parent was permanently deleted: child becomes orphaned root', async ({ window }) => {
    // Parent → Child → Grandkid. Trash parent (cascade), restore child, hard-delete parent.
    // Child's parentId points to a doc that no longer exists → orphaned.
    const m = await seedTree(window, [
      { title: 'Doomed Parent' },
      { title: 'Survivor Child', parentTitle: 'Doomed Parent' },
      { title: 'GK', parentTitle: 'Survivor Child' },
    ]);

    // Trash Doomed Parent (cascades to Survivor Child and GK)
    await trashDoc(window, m.get('Doomed Parent')!);

    // Restore Survivor Child (and GK comes back), but NOT Doomed Parent
    await restoreDoc(window, m.get('Survivor Child')!);

    // Hard-delete Doomed Parent (single-row — it's the only trashed doc left)
    await hardDeleteDoc(window, m.get('Doomed Parent')!);

    // Survivor Child is active but parentId points to deleted Doomed Parent → orphaned
    await selectDocumentById(window, m.get('Survivor Child')!);
    await closeSidebar(window);

    // Has child GK, so breadcrumb should be visible
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // No ancestors visible (Doomed Parent is gone from DB)
    await expect(popover.locator('button', { hasText: 'Doomed Parent' })).not.toBeVisible();
    // Child GK is present
    await expect(popover.locator('button', { hasText: 'GK' })).toBeVisible();
  });

  test('trash selected doc via store method: selection auto-moves to another tab', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Tab Root A' },
      { title: 'Tab Child A', parentTitle: 'Tab Root A' },
      { title: 'Tab Root B' },
      { title: 'Tab Child B', parentTitle: 'Tab Root B' },
    ]);

    // Open Tab Child A in first tab
    await selectDocumentById(window, m.get('Tab Child A')!);
    // Open Tab Child B in a *separate* tab (openTab adds a tab, unlike openOrSelectTab)
    await window.evaluate((id) => {
      (window as any).__documentStore.getState().openTab(id);
    }, m.get('Tab Child B')!);
    await window.waitForTimeout(300);
    // Select Tab Child A as the active doc
    await window.evaluate((id) => {
      (window as any).__documentStore.getState().selectDocument(id);
    }, m.get('Tab Child A')!);
    await window.waitForTimeout(300);

    await closeSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Use the store's trashDocument (not raw IPC) — it properly closes tab + moves selection
    await window.evaluate(async (docId) => {
      await (window as any).__documentStore.getState().trashDocument(docId);
    }, m.get('Tab Child A')!);
    await window.waitForTimeout(500);

    // Selection should auto-move to Tab Child B (the remaining tab)
    const newSelectedId = await getSelectedId(window);
    expect(newSelectedId).toBe(m.get('Tab Child B')!);

    // Breadcrumb should show Tab Child B's context
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Tab Root B' })).toBeVisible();
  });

  test('trash a sibling of the selected doc: breadcrumb is completely unaffected', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Shared Parent' },
      { title: 'Me', parentTitle: 'Shared Parent' },
      { title: 'Sibling', parentTitle: 'Shared Parent' },
      { title: 'My Kid', parentTitle: 'Me' },
    ]);

    await selectDocumentById(window, m.get('Me')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Shared Parent', 'My Kid']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash sibling — should not affect Me's breadcrumb at all
    await trashDoc(window, m.get('Sibling')!);

    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Shared Parent', 'My Kid']);
  });

  test('hard-delete the only ancestor: selected doc keeps children but loses all ancestors', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Only Ancestor' },
      { title: 'Middle', parentTitle: 'Only Ancestor' },
      { title: 'Kiddo', parentTitle: 'Middle' },
    ]);

    await selectDocumentById(window, m.get('Middle')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Only Ancestor', 'Kiddo']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash then hard-delete Only Ancestor (does NOT cascade to Middle since Middle isn't a descendant... wait, it IS)
    // Actually: Only Ancestor → Middle → Kiddo. Trashing Only Ancestor cascades to Middle and Kiddo.
    // So we can't hard-delete only the ancestor without losing Middle too.
    // Instead: just trash Only Ancestor. Middle's parentId points to trashed doc.
    // But cascade trashes Middle too! So let's restore Middle after.

    await trashDoc(window, m.get('Only Ancestor')!);
    // Restore just Middle (and Kiddo comes back)
    await restoreDoc(window, m.get('Middle')!);
    // Hard-delete Only Ancestor
    await hardDeleteDoc(window, m.get('Only Ancestor')!);

    await selectDocumentById(window, m.get('Middle')!);

    // Middle's parentId still points to deleted Only Ancestor → orphaned
    // But Middle has child Kiddo → breadcrumb shows children only
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Kiddo']);
  });

  test('build a deep chain via successive child creation: breadcrumb grows at each step', async ({ window }) => {
    const m = await seedTree(window, [{ title: 'Genesis' }]);
    const genesisId = m.get('Genesis')!;

    await selectDocumentById(window, genesisId);
    await closeSidebar(window);

    // No children yet
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Create child under Genesis
    const child1 = await createChild(window, genesisId, 'Gen 1');
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Create grandchild under Gen 1
    const child2 = await createChild(window, child1, 'Gen 2');
    // Create great-grandchild under Gen 2
    const child3 = await createChild(window, child2, 'Gen 3');

    // Select the deepest node — should have full chain
    await selectDocumentById(window, child3);
    await openBreadcrumb(window);
    const buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Genesis', 'Gen 1', 'Gen 2']);
  });

  test('restore ancestor while popover is open: chain re-links reactively', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Live Root' },
      { title: 'Live Mid', parentTitle: 'Live Root' },
      { title: 'Live Leaf', parentTitle: 'Live Mid' },
      { title: 'Live Kid', parentTitle: 'Live Leaf' },
    ]);

    await selectDocumentById(window, m.get('Live Leaf')!);
    await closeSidebar(window);

    // Trash Live Mid (cascades to Live Leaf and Live Kid)
    await trashDoc(window, m.get('Live Mid')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Restore Live Mid (restores Live Leaf and Live Kid)
    await restoreDoc(window, m.get('Live Mid')!);
    await selectDocumentById(window, m.get('Live Leaf')!);

    // Open breadcrumb — full chain should be back
    await openBreadcrumb(window);
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Live Root' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Live Mid' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Live Kid' })).toBeVisible();

    // Now trash Live Root while popover is still open (cascades everything)
    await trashDoc(window, m.get('Live Root')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Restore Live Root while breadcrumb is hidden
    await restoreDoc(window, m.get('Live Root')!);
    await selectDocumentById(window, m.get('Live Leaf')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
  });

  test('create child, immediately trash it, create replacement: no stale data', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Churn Parent' },
    ]);
    const parentId = m.get('Churn Parent')!;
    await selectDocumentById(window, parentId);
    await closeSidebar(window);

    for (let i = 0; i < 3; i++) {
      // Create a child
      const childId = await createChild(window, parentId, `Churn ${i}`);
      await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
      await openBreadcrumb(window);
      const popover = window.locator('[data-radix-popper-content-wrapper]');
      await expect(popover.locator('button', { hasText: `Churn ${i}` })).toBeVisible();
      await window.locator(BREADCRUMB_TRIGGER).click();
      await window.waitForTimeout(200);

      // Immediately trash it
      await trashDoc(window, childId);
      await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
    }

    // Final create — should show only the final child, no stale entries
    await createChild(window, parentId, 'Final Child');
    await openBreadcrumb(window);
    const buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Final Child']);
  });

  test('trash parent of selected, add child to now-orphaned selected, then restore parent: full chain + child', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Orig Root' },
      { title: 'Node', parentTitle: 'Orig Root' },
    ]);
    const nodeId = m.get('Node')!;

    await selectDocumentById(window, nodeId);
    await closeSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Trash Orig Root — cascades to Node
    await trashDoc(window, m.get('Orig Root')!);

    // Restore just Node (still orphaned, parentId → trashed Orig Root)
    await restoreDoc(window, nodeId);
    await selectDocumentById(window, nodeId);

    // No ancestors reachable, no children → breadcrumb hidden
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Add a child to orphaned Node
    await createChild(window, nodeId, 'Orphan Kid');
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Orphan Kid']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Restore Orig Root — Node's ancestor chain should re-link
    await restoreDoc(window, m.get('Orig Root')!);

    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toContain('Orig Root');
    expect(buttons).toContain('Orphan Kid');
  });

  test('permanently delete a mid-chain node: children below become orphaned', async ({ window }) => {
    // A → B → C → D. Trash B, restore C and D, then hard-delete B.
    // C's parentId points to deleted B → orphaned.
    const m = await seedTree(window, [
      { title: 'Anc' },
      { title: 'Bridge', parentTitle: 'Anc' },
      { title: 'Below', parentTitle: 'Bridge' },
      { title: 'Deep', parentTitle: 'Below' },
    ]);

    // Trash Bridge (cascades to Below and Deep)
    await trashDoc(window, m.get('Bridge')!);

    // Restore Below (brings back Below and Deep, but Bridge stays trashed)
    await restoreDoc(window, m.get('Below')!);

    // Hard-delete Bridge
    await hardDeleteDoc(window, m.get('Bridge')!);

    // Select Below — parentId points to deleted Bridge, so no ancestors reachable
    await selectDocumentById(window, m.get('Below')!);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const buttons = await getPopoverButtons(window);
    // No ancestors (Bridge is deleted, chain broken), only child Deep
    expect(buttons).toEqual(['Deep']);
  });

  test('restore deep leaf whose entire ancestry is still trashed: leaf is orphaned root', async ({ window }) => {
    // A → B → C → Leaf. Trash A (cascade). Restore only Leaf.
    // Leaf's parentId → C (trashed) → not in documents → orphan with no children → breadcrumb hidden.
    const m = await seedTree(window, [
      { title: 'Bury A' },
      { title: 'Bury B', parentTitle: 'Bury A' },
      { title: 'Bury C', parentTitle: 'Bury B' },
      { title: 'Bury Leaf', parentTitle: 'Bury C' },
    ]);

    await trashDoc(window, m.get('Bury A')!);
    await restoreDoc(window, m.get('Bury Leaf')!);
    await selectDocumentById(window, m.get('Bury Leaf')!);
    await closeSidebar(window);

    // Leaf is alone — parentId → Bury C (trashed, invisible), no children
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Verify Leaf is actually alive in the DB and parentId is stale
    const leaf = await getDocumentFromDb(window, m.get('Bury Leaf')!);
    expect(leaf).not.toBeNull();
    expect(leaf!.deletedAt).toBeFalsy();
    expect(leaf!.parentId).toBe(m.get('Bury C')!);

    // Now restore the full chain — breadcrumb should reappear
    await restoreDoc(window, m.get('Bury A')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Bury A', 'Bury B', 'Bury C']);
  });

  test('move orphaned child to a new parent after original parent is deleted: chain repairs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Old Home' },
      { title: 'Nomad', parentTitle: 'Old Home' },
      { title: 'New Home' },
      { title: 'Nomad Kid', parentTitle: 'Nomad' },
    ]);

    // Trash Old Home (cascade to Nomad and Nomad Kid)
    await trashDoc(window, m.get('Old Home')!);
    await restoreDoc(window, m.get('Nomad')!);
    await hardDeleteDoc(window, m.get('Old Home')!);

    // Nomad is orphaned, has child Nomad Kid
    await selectDocumentById(window, m.get('Nomad')!);
    await closeSidebar(window);
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Nomad Kid']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Move Nomad under New Home to repair the chain
    await window.evaluate(async ({ nomadId, newHomeId }) => {
      await (window as any).lychee.invoke('documents.move', {
        id: nomadId,
        parentId: newHomeId,
        sortOrder: 0,
      });
      await (window as any).__documentStore.getState().loadDocuments(true);
    }, { nomadId: m.get('Nomad')!, newHomeId: m.get('New Home')! });
    await window.waitForTimeout(400);

    // Chain should now show New Home as ancestor
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toContain('New Home');
    expect(buttons).toContain('Nomad Kid');
  });

  test('permanently delete selected doc with cascade: all descendants wiped from DB', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Wipe Root' },
      { title: 'Wipe A', parentTitle: 'Wipe Root' },
      { title: 'Wipe B', parentTitle: 'Wipe A' },
    ]);

    await selectDocumentById(window, m.get('Wipe A')!);
    await closeSidebar(window);

    // Trash then permanently delete Wipe A (cascades to Wipe B)
    await trashDoc(window, m.get('Wipe A')!);
    await permanentDeleteDoc(window, m.get('Wipe A')!);

    // Both Wipe A and Wipe B are gone from the DB
    const wipeA = await getDocumentFromDb(window, m.get('Wipe A')!);
    const wipeB = await getDocumentFromDb(window, m.get('Wipe B')!);
    expect(wipeA).toBeNull();
    expect(wipeB).toBeNull();

    // Wipe Root still exists and lost its children
    const root = await getDocumentFromDb(window, m.get('Wipe Root')!);
    expect(root).not.toBeNull();
    expect(root!.deletedAt).toBeFalsy();
  });

  test('trash doc with stale parentId still shows children correctly', async ({ window }) => {
    // Even if parentId points to a non-existent doc, the doc should still render
    // its children in the breadcrumb.
    const m = await seedTree(window, [
      { title: 'Phantom Parent' },
      { title: 'Stale Child', parentTitle: 'Phantom Parent' },
      { title: 'Grandchild', parentTitle: 'Stale Child' },
    ]);

    // Trash Phantom Parent (cascade), restore Stale Child and Grandchild
    await trashDoc(window, m.get('Phantom Parent')!);
    await restoreDoc(window, m.get('Stale Child')!);

    // Delete Phantom Parent entirely so the reference is truly stale
    await hardDeleteDoc(window, m.get('Phantom Parent')!);

    // Select Stale Child — parentId is stale but it has Grandchild
    await selectDocumentById(window, m.get('Stale Child')!);
    await closeSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Grandchild']);
    // Navigate to Grandchild — should work despite stale parentId on parent
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Grandchild' }).click();
    await window.waitForTimeout(500);
    const selectedId = await getSelectedId(window);
    expect(selectedId).toBe(m.get('Grandchild')!);
  });
});

test.describe('Breadcrumb Pill — Duplicate & Confusing Titles', () => {
  test('parent and child with identical titles: ancestor is navigable, current is not', async ({ window }) => {
    // seedTree's Map overwrites duplicate keys, so query the DB directly
    await seedTree(window, [
      { title: 'Notes' },
      { title: 'Notes', parentTitle: 'Notes' },
    ]);

    const ids = await window.evaluate(async () => {
      const { documents } = await (window as any).lychee.invoke('documents.list', { limit: 500, offset: 0 });
      return documents.map((d: any) => ({ id: d.id, title: d.title, parentId: d.parentId }));
    });
    const childDoc = ids.find((d: any) => d.title === 'Notes' && d.parentId !== null);
    const parentDoc = ids.find((d: any) => d.title === 'Notes' && d.parentId === null);
    expect(childDoc).toBeTruthy();
    expect(parentDoc).toBeTruthy();

    await selectDocumentById(window, childDoc!.id);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Exactly one "Notes" button (the ancestor) — clicking it should navigate to the parent
    const ancestorBtn = popover.locator('button', { hasText: 'Notes' });
    await expect(ancestorBtn).toHaveCount(1);
    await ancestorBtn.click();
    await window.waitForTimeout(400);

    // We should now be viewing the parent document
    expect(await getSelectedId(window)).toBe(parentDoc!.id);
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('Notes');
  });

  test('three levels all with empty titles: each shows "Untitled" and ancestors remain navigable', async ({ window }) => {
    await seedTree(window, [{ title: '' }]);
    const rootId = (await listDocumentsFromDb(window))[0].id;

    const childId = await window.evaluate(async (parentId) => {
      const { document } = await (window as any).lychee.invoke('documents.create', { title: '', parentId });
      return document.id;
    }, rootId);
    const grandchildId = await window.evaluate(async (parentId) => {
      const { document } = await (window as any).lychee.invoke('documents.create', { title: '', parentId });
      return document.id;
    }, childId);

    await window.evaluate(async () => {
      const store = (window as any).__documentStore;
      if (store) await store.getState().loadDocuments(true);
    });
    await window.waitForTimeout(300);

    await selectDocumentById(window, grandchildId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Two navigable "Untitled" ancestor buttons (root and child)
    const ancestorBtns = popover.locator('button', { hasText: 'Untitled' });
    await expect(ancestorBtns).toHaveCount(2);

    // Clicking the first "Untitled" button navigates to the root
    await ancestorBtns.first().click();
    await window.waitForTimeout(400);
    expect(await getSelectedId(window)).toBe(rootId);
  });
});

test.describe('Breadcrumb Pill — Special Characters & Unicode', () => {
  test('title with HTML-like content is safely escaped', async ({ window }) => {
    const m = await seedTree(window, [
      { title: '<b>Bold</b>' },
      { title: 'Safe Child', parentTitle: '<b>Bold</b>' },
    ]);
    await selectDocumentById(window, m.get('Safe Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Should render the literal text, not interpret as HTML
    const ancestorBtn = popover.locator('button').filter({ hasText: '<b>Bold</b>' });
    await expect(ancestorBtn).toBeVisible();
    // No actual bold element created by XSS
    await expect(popover.locator('b')).toHaveCount(0);
  });

  test('title with unicode characters (CJK, Arabic, Cyrillic)', async ({ window }) => {
    const m = await seedTree(window, [
      { title: '日本語ノート' },
      { title: 'Заметка', parentTitle: '日本語ノート' },
      { title: 'ملاحظة', parentTitle: 'Заметка' },
    ]);
    await selectDocumentById(window, m.get('ملاحظة')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Ancestors are navigable buttons
    await expect(popover.locator('button', { hasText: '日本語ノート' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Заметка' })).toBeVisible();
    // Current doc text is visible but not a button
    await expect(popover.getByText('ملاحظة')).toBeVisible();
    await expect(popover.locator('button', { hasText: 'ملاحظة' })).toHaveCount(0);
  });

  test('multi-codepoint emoji (ZWJ family) renders correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Family Note', emoji: '👨‍👩‍👧‍👦' },
      { title: 'Flag Note', emoji: '🏳️‍🌈', parentTitle: 'Family Note' },
    ]);
    await selectDocumentById(window, m.get('Flag Note')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    const ancestorBtn = popover.locator('button', { hasText: 'Family Note' });
    await expect(ancestorBtn).toContainText('👨‍👩‍👧‍👦');
  });

  test('title with ampersands, quotes, and angle brackets', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Q&A "Notes" <2024>' },
      { title: 'Child &amp;', parentTitle: 'Q&A "Notes" <2024>' },
    ]);
    await selectDocumentById(window, m.get('Child &amp;')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button').filter({ hasText: 'Q&A "Notes" <2024>' })).toBeVisible();
  });
});

test.describe('Breadcrumb Pill — Reactive Updates While Popover Open', () => {
  test('ancestor renamed while popover is open reflects immediately', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Live Ancestor' },
      { title: 'Live Child', parentTitle: 'Live Ancestor' },
    ]);
    await selectDocumentById(window, m.get('Live Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Live Ancestor' })).toBeVisible();

    // Rename the ancestor while popover is open
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, title: 'Renamed Live' });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Live Ancestor')!);
    await window.waitForTimeout(400);

    // Popover should reactively update
    await expect(popover.locator('button', { hasText: 'Renamed Live' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Live Ancestor' })).not.toBeVisible();
  });

  test('child trashed while popover is open disappears from the list', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Reactive Parent' },
      { title: 'Stay Child', parentTitle: 'Reactive Parent' },
      { title: 'Go Child', parentTitle: 'Reactive Parent' },
    ]);
    await selectDocumentById(window, m.get('Reactive Parent')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Go Child' })).toBeVisible();

    // Trash "Go Child" while popover is open
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.trash', { id });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Go Child')!);
    await window.waitForTimeout(400);

    await expect(popover.locator('button', { hasText: 'Go Child' })).not.toBeVisible();
    await expect(popover.locator('button', { hasText: 'Stay Child' })).toBeVisible();
  });

  test('new child added while popover is open appears in the list', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Dynamic Parent' },
      { title: 'Existing Kid', parentTitle: 'Dynamic Parent' },
    ]);
    await selectDocumentById(window, m.get('Dynamic Parent')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Existing Kid' })).toBeVisible();

    // Add a new child while popover is open
    await window.evaluate(async (parentId) => {
      const { document } = await (window as any).lychee.invoke('documents.create', {
        title: 'Hot Kid',
        parentId,
      });
      await (window as any).lychee.invoke('documents.update', { id: document.id, title: 'Hot Kid' });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Dynamic Parent')!);
    await window.waitForTimeout(400);

    await expect(popover.locator('button', { hasText: 'Hot Kid' })).toBeVisible();
  });

  test('switching selected document externally while popover is open updates content', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Ext Root A' },
      { title: 'Ext Child A', parentTitle: 'Ext Root A' },
      { title: 'Ext Root B' },
      { title: 'Ext Child B', parentTitle: 'Ext Root B' },
    ]);
    await selectDocumentById(window, m.get('Ext Child A')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Ext Root A' })).toBeVisible();

    // Switch to a completely different document via store while popover is open
    await selectDocumentById(window, m.get('Ext Child B')!);
    await window.waitForTimeout(400);

    // The popover (if still open) should now reflect the new document's context.
    // The component re-renders because selectedId changed.
    // If the popover closed (Radix behavior), reopen it.
    const isPopoverVisible = await popover.isVisible().catch(() => false);
    if (!isPopoverVisible) {
      await openBreadcrumb(window);
    }

    const updatedPopover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(updatedPopover.locator('button', { hasText: 'Ext Root B' })).toBeVisible();
    await expect(updatedPopover.locator('button', { hasText: 'Ext Root A' })).not.toBeVisible();
  });
});

test.describe('Breadcrumb Pill — Rapid & Stress Interactions', () => {
  test('double-click on ancestor does not break navigation', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'DblClick Root' },
      { title: 'DblClick Child', parentTitle: 'DblClick Root' },
    ]);
    await selectDocumentById(window, m.get('DblClick Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    const ancestorBtn = popover.locator('button', { hasText: 'DblClick Root' });
    await ancestorBtn.dblclick();
    await window.waitForTimeout(400);

    expect(await getSelectedId(window)).toBe(m.get('DblClick Root')!);
  });

  test('ping-pong navigation: child → parent → child via breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Pong Root' },
      { title: 'Pong Kid', parentTitle: 'Pong Root' },
    ]);
    const rootId = m.get('Pong Root')!;
    const kidId = m.get('Pong Kid')!;

    await selectDocumentById(window, kidId);
    await closeSidebar(window);

    // Go to parent
    await openBreadcrumb(window);
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Pong Root' }).click();
    await window.waitForTimeout(400);
    expect(await getSelectedId(window)).toBe(rootId);

    // Go back to child
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Pong Kid' }).click();
    await window.waitForTimeout(400);
    expect(await getSelectedId(window)).toBe(kidId);

    // And back to parent again
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Pong Root' }).click();
    await window.waitForTimeout(400);
    expect(await getSelectedId(window)).toBe(rootId);
  });

  test('rapidly opening and closing popover does not break state', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Flicker Root' },
      { title: 'Flicker Child', parentTitle: 'Flicker Root' },
    ]);
    await selectDocumentById(window, m.get('Flicker Child')!);
    await closeSidebar(window);

    // Toggle the popover 5 times rapidly
    for (let i = 0; i < 5; i++) {
      await window.locator(BREADCRUMB_TRIGGER).click();
      await window.waitForTimeout(100);
    }
    await window.waitForTimeout(400);

    // Should still be functional — open it cleanly
    // After 5 clicks (odd number), popover should be open
    // But timing may vary, so just verify we can open and read it
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    const isOpen = await popover.isVisible().catch(() => false);
    if (!isOpen) {
      await openBreadcrumb(window);
    }

    await expect(
      window.locator('[data-radix-popper-content-wrapper]').locator('button', { hasText: 'Flicker Root' }),
    ).toBeVisible();
  });

  test('8-level deep nesting: full ancestor chain renders without overflow', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 0; i < 8; i++) {
      specs.push({
        title: `Deep ${i}`,
        parentTitle: i > 0 ? `Deep ${i - 1}` : undefined,
      });
    }
    const m = await seedTree(window, specs);

    // Select the deepest node
    await selectDocumentById(window, m.get('Deep 7')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // All 7 ancestors (Deep 0 through Deep 6) should appear
    const buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(7);
    for (let i = 0; i < 7; i++) {
      expect(buttons[i]).toBe(`Deep ${i}`);
    }

    // Current doc "Deep 7" should be visible text but not a navigable button
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.getByText('Deep 7')).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Deep 7' })).toHaveCount(0);
  });

  test('navigate from deepest node to root in one jump: correct editor and breadcrumb context', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 0; i < 6; i++) {
      specs.push({
        title: `Jump ${i}`,
        parentTitle: i > 0 ? `Jump ${i - 1}` : undefined,
      });
    }
    const m = await seedTree(window, specs);

    await selectDocumentById(window, m.get('Jump 5')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Jump directly to root (skipping 4 intermediate levels)
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Jump 0' }).click();
    await window.waitForTimeout(400);

    // Editor should show the root document
    expect(await getSelectedId(window)).toBe(m.get('Jump 0')!);
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('Jump 0');

    // Breadcrumb now shows Jump 0's only direct child (Jump 1)
    await openBreadcrumb(window);
    const updatedButtons = await getPopoverButtons(window);
    expect(updatedButtons).toEqual(['Jump 1']);

    // And that child is navigable
    const newPopover = window.locator('[data-radix-popper-content-wrapper]');
    await newPopover.locator('button', { hasText: 'Jump 1' }).click();
    await window.waitForTimeout(400);
    expect(await getSelectedId(window)).toBe(m.get('Jump 1')!);
  });
});

test.describe('Breadcrumb Pill — Concurrent Sidebar & Breadcrumb Interactions', () => {
  test('opening sidebar while popover is open hides the breadcrumb entirely', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Sidebar Race Root' },
      { title: 'Sidebar Race Child', parentTitle: 'Sidebar Race Root' },
    ]);
    await selectDocumentById(window, m.get('Sidebar Race Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Popover is open
    await expect(
      window.locator('[data-radix-popper-content-wrapper]'),
    ).toBeVisible();

    // Now open the sidebar — breadcrumb should vanish
    await openSidebar(window);

    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
    await expect(
      window.locator('[data-radix-popper-content-wrapper]'),
    ).not.toBeVisible();
  });

  test('close sidebar → open breadcrumb → close breadcrumb → reopen sidebar → close sidebar again: breadcrumb still works', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Cycle Root' },
      { title: 'Cycle Child', parentTitle: 'Cycle Root' },
    ]);
    await selectDocumentById(window, m.get('Cycle Child')!);

    // Cycle 1: close sidebar, open breadcrumb, verify, close breadcrumb
    await closeSidebar(window);
    await openBreadcrumb(window);
    await expect(
      window.locator('[data-radix-popper-content-wrapper]').locator('button', { hasText: 'Cycle Root' }),
    ).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Cycle 2: open sidebar
    await openSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Cycle 3: close sidebar again — breadcrumb should be functional
    await closeSidebar(window);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    await expect(
      window.locator('[data-radix-popper-content-wrapper]').locator('button', { hasText: 'Cycle Root' }),
    ).toBeVisible();
  });
});

test.describe('Breadcrumb Pill — Data Mutation Sequences', () => {
  test('move current doc to a completely new subtree: breadcrumb reflects new ancestry', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Old Tree Root' },
      { title: 'Old Tree Mid', parentTitle: 'Old Tree Root' },
      { title: 'Traveler', parentTitle: 'Old Tree Mid' },
      { title: 'New Tree Root' },
      { title: 'New Tree Mid', parentTitle: 'New Tree Root' },
    ]);
    const travelerId = m.get('Traveler')!;
    const newMidId = m.get('New Tree Mid')!;

    await selectDocumentById(window, travelerId);
    await closeSidebar(window);

    // Initially: Old Tree Root → Old Tree Mid → Traveler
    await openBreadcrumb(window);
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Old Tree Root' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Old Tree Mid' })).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Move Traveler under New Tree Mid
    await window.evaluate(
      async ({ id, parentId }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
      },
      { id: travelerId, parentId: newMidId },
    );
    await window.waitForTimeout(400);

    // Now: New Tree Root → New Tree Mid → Traveler
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'New Tree Root' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'New Tree Mid' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Old Tree Root' })).not.toBeVisible();
    await expect(popover.locator('button', { hasText: 'Old Tree Mid' })).not.toBeVisible();
  });

  test('move a child away from current doc: child disappears from breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Losing Parent' },
      { title: 'Staying', parentTitle: 'Losing Parent' },
      { title: 'Leaving', parentTitle: 'Losing Parent' },
      { title: 'Other Root' },
    ]);
    const leavingId = m.get('Leaving')!;
    const otherRootId = m.get('Other Root')!;

    await selectDocumentById(window, m.get('Losing Parent')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Leaving' })).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Move "Leaving" to "Other Root"
    await window.evaluate(
      async ({ id, parentId }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
      },
      { id: leavingId, parentId: otherRootId },
    );
    await window.waitForTimeout(400);

    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Staying' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Leaving' })).not.toBeVisible();
  });

  test('move a new child INTO current doc: child appears in breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Gaining Root' },
      { title: 'Immigrant', parentTitle: 'Gaining Root' },
      { title: 'Destination' },
    ]);
    const immigrantId = m.get('Immigrant')!;
    const destId = m.get('Destination')!;

    await selectDocumentById(window, destId);
    await closeSidebar(window);

    // No children yet → breadcrumb hidden
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Move "Immigrant" under "Destination"
    await window.evaluate(
      async ({ id, parentId }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
      },
      { id: immigrantId, parentId: destId },
    );
    await window.waitForTimeout(400);

    // Now has a child → breadcrumb appears
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Immigrant' })).toBeVisible();
  });

  test('unnest selected doc that has children: ancestors vanish but children remain', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Top' },
      { title: 'Middle', parentTitle: 'Top' },
      { title: 'Leaf A', parentTitle: 'Middle' },
      { title: 'Leaf B', parentTitle: 'Middle' },
    ]);
    const middleId = m.get('Middle')!;

    await selectDocumentById(window, middleId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Top' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Leaf A' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Leaf B' })).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Unnest Middle to root
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.move', { id, parentId: null, sortOrder: 0 });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, middleId);
    await window.waitForTimeout(400);

    // Breadcrumb should still be visible — Middle still has children
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const updated = window.locator('[data-radix-popper-content-wrapper]');
    // No more ancestors
    await expect(updated.locator('button', { hasText: 'Top' })).not.toBeVisible();
    // Children still present
    await expect(updated.locator('button', { hasText: 'Leaf A' })).toBeVisible();
    await expect(updated.locator('button', { hasText: 'Leaf B' })).toBeVisible();
  });

  test('nest a root doc with children under another note: ancestors appear, children stay', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Soon Parent' },
      { title: 'Root With Kids' },
      { title: 'Kid 1', parentTitle: 'Root With Kids' },
      { title: 'Kid 2', parentTitle: 'Root With Kids' },
    ]);
    const rootId = m.get('Root With Kids')!;
    const soonParentId = m.get('Soon Parent')!;

    await selectDocumentById(window, rootId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Initially: no ancestors, just children
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    const initialButtons = await getPopoverButtons(window);
    expect(initialButtons).toEqual(expect.arrayContaining(['Kid 1', 'Kid 2']));
    expect(initialButtons).not.toContain('Soon Parent');
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Nest Root With Kids under Soon Parent
    await window.evaluate(
      async ({ id, parentId }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
      },
      { id: rootId, parentId: soonParentId },
    );
    await window.waitForTimeout(400);

    // Breadcrumb should now show Soon Parent as ancestor AND kids as children
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Soon Parent' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Kid 1' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Kid 2' })).toBeVisible();
  });

  test('unnest a mid-chain ancestor of the selected doc: ancestor chain shortens', async ({ window }) => {
    // A → B → C → D (selected). Unnest B to root. Now B → C → D, but A is no longer an ancestor.
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
      { title: 'D', parentTitle: 'C' },
    ]);

    await selectDocumentById(window, m.get('D')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Full chain: A, B, C are ancestors
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['A', 'B', 'C']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Unnest B to root (breaks B away from A)
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.move', { id, parentId: null, sortOrder: 0 });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('B')!);
    await window.waitForTimeout(400);

    // D's ancestors should now be B, C only — A is no longer in the chain
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['B', 'C']);
  });

  test('nest an ancestor deeper: selected doc gains more ancestors', async ({ window }) => {
    // Setup: R → S (selected, has child T). Nest R under a new Wrapper node.
    // S's ancestors should grow from [R] to [Wrapper, R].
    const m = await seedTree(window, [
      { title: 'Wrapper' },
      { title: 'R' },
      { title: 'S', parentTitle: 'R' },
      { title: 'T', parentTitle: 'S' },
    ]);

    await selectDocumentById(window, m.get('S')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Initially: ancestors [R], children [T]
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'R' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'T' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Wrapper' })).not.toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Nest R under Wrapper
    await window.evaluate(
      async ({ id, parentId }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
      },
      { id: m.get('R')!, parentId: m.get('Wrapper')! },
    );
    await window.waitForTimeout(400);

    // S's ancestor chain should now be [Wrapper, R], children still [T]
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    const buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Wrapper', 'R', 'T']);
  });

  test('emoji changed on ancestor while viewing breadcrumb', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Emoji Swap Root', emoji: '🔴' },
      { title: 'Emoji Swap Child', parentTitle: 'Emoji Swap Root' },
    ]);
    await selectDocumentById(window, m.get('Emoji Swap Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'Emoji Swap Root' })).toContainText('🔴');

    // Change the emoji via IPC
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, emoji: '🟢' });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Emoji Swap Root')!);
    await window.waitForTimeout(400);

    await expect(popover.locator('button', { hasText: 'Emoji Swap Root' })).toContainText('🟢');
  });

  test('clearing emoji on ancestor switches to FileText icon', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Clear Emoji Root', emoji: '💎' },
      { title: 'Clear Emoji Child', parentTitle: 'Clear Emoji Root' },
    ]);
    await selectDocumentById(window, m.get('Clear Emoji Child')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    const ancestorBtn = popover.locator('button', { hasText: 'Clear Emoji Root' });
    await expect(ancestorBtn).toContainText('💎');
    // No SVG icon when emoji is present
    await expect(ancestorBtn.locator('svg')).toHaveCount(0);

    // Clear the emoji
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.update', { id, emoji: null });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('Clear Emoji Root')!);
    await window.waitForTimeout(400);

    // Now should show SVG FileText icon instead
    const updatedBtn = popover.locator('button', { hasText: 'Clear Emoji Root' });
    await expect(updatedBtn.locator('svg')).toBeVisible();
  });
});

// ── Stress Tests — Nesting & Unnesting ──────────────────────────────

test.describe('Breadcrumb Pill — Stress: Nest & Unnest', () => {
  /** Helper to move a doc via IPC and reload the store. */
  async function moveDoc(window: Page, id: string, parentId: string | null, sortOrder = 0) {
    await window.evaluate(
      async ({ id, parentId, sortOrder }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
      },
      { id, parentId, sortOrder },
    );
    await window.waitForTimeout(400);
  }

  test('unnest children one by one: breadcrumb vanishes when last child leaves', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Lone Parent' },
      { title: 'C1', parentTitle: 'Lone Parent' },
      { title: 'C2', parentTitle: 'Lone Parent' },
      { title: 'C3', parentTitle: 'Lone Parent' },
    ]);
    const parentId = m.get('Lone Parent')!;
    await selectDocumentById(window, parentId);
    await closeSidebar(window);

    // 3 children → breadcrumb visible
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Unnest C1
    await moveDoc(window, m.get('C1')!, null);
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(2);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Unnest C2
    await moveDoc(window, m.get('C2')!, null);
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBe('C3');
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Unnest last child C3 — breadcrumb should vanish
    await moveDoc(window, m.get('C3')!, null);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('rapid nest-unnest-nest cycle: breadcrumb settles correctly', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Anchor' },
      { title: 'Bouncer' },
    ]);
    const bouncerId = m.get('Bouncer')!;
    const anchorId = m.get('Anchor')!;

    await selectDocumentById(window, bouncerId);
    await closeSidebar(window);

    // Initially root with no children → no breadcrumb
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Nest under Anchor
    await moveDoc(window, bouncerId, anchorId);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    await expect(window.locator('[data-radix-popper-content-wrapper]').locator('button', { hasText: 'Anchor' })).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Back to root
    await moveDoc(window, bouncerId, null);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Nest again
    await moveDoc(window, bouncerId, anchorId);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();

    // Immediately back to root
    await moveDoc(window, bouncerId, null);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Final nest — verify it sticks
    await moveDoc(window, bouncerId, anchorId);
    await openBreadcrumb(window);
    await expect(window.locator('[data-radix-popper-content-wrapper]').locator('button', { hasText: 'Anchor' })).toBeVisible();
  });

  test('swap parent and child: A→B becomes B→A', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Alpha' },
      { title: 'Beta', parentTitle: 'Alpha' },
    ]);
    const alphaId = m.get('Alpha')!;
    const betaId = m.get('Beta')!;

    await selectDocumentById(window, betaId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Initially: Alpha is ancestor of Beta
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Alpha']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Unnest Beta to root first (can't move Alpha under Beta while Beta is Alpha's child)
    await moveDoc(window, betaId, null);
    // Now move Alpha under Beta
    await moveDoc(window, alphaId, betaId);

    // Beta is now root with child Alpha — and we're viewing Beta
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Alpha']);
    // Alpha is now a child, not an ancestor
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.getByText('Beta')).toBeVisible();
    await expect(popover.locator('button', { hasText: 'Beta' })).toHaveCount(0);
  });

  test('unnest selected doc while popover is open: ancestors vanish reactively', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'GP' },
      { title: 'P', parentTitle: 'GP' },
      { title: 'Me', parentTitle: 'P' },
      { title: 'Kid', parentTitle: 'Me' },
    ]);
    const meId = m.get('Me')!;

    await selectDocumentById(window, meId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Initially: ancestors [GP, P], children [Kid]
    await expect(popover.getByRole('button', { name: 'GP', exact: true })).toBeVisible();
    await expect(popover.getByRole('button', { name: 'P', exact: true })).toBeVisible();
    await expect(popover.getByRole('button', { name: 'Kid', exact: true })).toBeVisible();

    // Unnest Me to root while popover is open
    await moveDoc(window, meId, null);

    // Popover should reactively update: ancestors gone, Kid remains
    await openBreadcrumb(window);
    const updated = window.locator('[data-radix-popper-content-wrapper]');
    await expect(updated.getByRole('button', { name: 'GP', exact: true })).not.toBeVisible();
    await expect(updated.getByRole('button', { name: 'P', exact: true })).not.toBeVisible();
    await expect(updated.locator('button', { hasText: 'Kid' })).toBeVisible();
  });

  test('nest selected doc while popover is open: ancestors appear reactively', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'New Home' },
      { title: 'Nomad' },
      { title: 'Nomad Kid', parentTitle: 'Nomad' },
    ]);
    const nomadId = m.get('Nomad')!;
    const newHomeId = m.get('New Home')!;

    await selectDocumentById(window, nomadId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Initially: no ancestors, child [Nomad Kid]
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Nomad Kid']);

    // Nest Nomad under New Home while popover is open
    await moveDoc(window, nomadId, newHomeId);

    // Popover should now show New Home as ancestor
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    buttons = await getPopoverButtons(window);
    expect(buttons).toContain('New Home');
    expect(buttons).toContain('Nomad Kid');
  });

  test('strip ancestors one by one from bottom up: chain progressively shortens', async ({ window }) => {
    // Chain: A → B → C → D → E (selected)
    const m = await seedTree(window, [
      { title: 'A' },
      { title: 'B', parentTitle: 'A' },
      { title: 'C', parentTitle: 'B' },
      { title: 'D', parentTitle: 'C' },
      { title: 'E', parentTitle: 'D' },
    ]);

    await selectDocumentById(window, m.get('E')!);
    await closeSidebar(window);

    // Full chain: [A, B, C, D]
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['A', 'B', 'C', 'D']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Unnest D to root → E's parent is D, D is now root
    await moveDoc(window, m.get('D')!, null);
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['D']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Unnest D's parent doesn't exist anymore (D is root), so unnest E itself
    await moveDoc(window, m.get('E')!, null);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('build a chain by successive nesting: flat docs become deeply nested', async ({ window }) => {
    // Start with 5 root docs, then nest them: N0 ← N1 ← N2 ← N3 ← N4
    const m = await seedTree(window, [
      { title: 'N0' },
      { title: 'N1' },
      { title: 'N2' },
      { title: 'N3' },
      { title: 'N4' },
    ]);

    // Nest N1 under N0
    await moveDoc(window, m.get('N1')!, m.get('N0')!);
    // Nest N2 under N1
    await moveDoc(window, m.get('N2')!, m.get('N1')!);
    // Nest N3 under N2
    await moveDoc(window, m.get('N3')!, m.get('N2')!);
    // Nest N4 under N3
    await moveDoc(window, m.get('N4')!, m.get('N3')!);

    // Select N4 — should have full ancestor chain
    await selectDocumentById(window, m.get('N4')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['N0', 'N1', 'N2', 'N3']);
  });

  test('reverse a chain: A→B→C becomes C→B→A by successive moves', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'X' },
      { title: 'Y', parentTitle: 'X' },
      { title: 'Z', parentTitle: 'Y' },
    ]);

    await selectDocumentById(window, m.get('Z')!);
    await closeSidebar(window);
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['X', 'Y']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Step 1: unnest Z to root
    await moveDoc(window, m.get('Z')!, null);
    // Step 2: unnest Y to root
    await moveDoc(window, m.get('Y')!, null);
    // Step 3: nest Y under Z
    await moveDoc(window, m.get('Y')!, m.get('Z')!);
    // Step 4: nest X under Y
    await moveDoc(window, m.get('X')!, m.get('Y')!);

    // Now: Z → Y → X. We're viewing Z (root with child Y).
    await openBreadcrumb(window);
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    // Z has no ancestors, child is Y
    await expect(popover.locator('button', { hasText: 'Y' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'X' })).not.toBeVisible();

    // Navigate to X (deepest) and verify reversed chain
    await popover.locator('button', { hasText: 'Y' }).click();
    await window.waitForTimeout(400);
    await openBreadcrumb(window);
    const yPopover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(yPopover.locator('button', { hasText: 'Z' })).toBeVisible();
    await expect(yPopover.locator('button', { hasText: 'X' })).toBeVisible();
  });

  test('move selected doc between two trees repeatedly: ancestry flips each time', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Tree A Root' },
      { title: 'Tree A Mid', parentTitle: 'Tree A Root' },
      { title: 'Tree B Root' },
      { title: 'Tree B Mid', parentTitle: 'Tree B Root' },
      { title: 'Traveler', parentTitle: 'Tree A Mid' },
    ]);
    const travelerId = m.get('Traveler')!;

    await selectDocumentById(window, travelerId);
    await closeSidebar(window);

    // Initially under Tree A
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Tree A Root', 'Tree A Mid']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Move to Tree B
    await moveDoc(window, travelerId, m.get('Tree B Mid')!);
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Tree B Root', 'Tree B Mid']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Move back to Tree A
    await moveDoc(window, travelerId, m.get('Tree A Mid')!);
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Tree A Root', 'Tree A Mid']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Move to root — no ancestors, no children, breadcrumb vanishes
    await moveDoc(window, travelerId, null);
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();
  });

  test('move parent of selected doc under a different grandparent: ancestor chain updates without moving selected doc', async ({ window }) => {
    // Initial: GP → P → Selected (with child K). Move P under NewGP.
    const m = await seedTree(window, [
      { title: 'GP' },
      { title: 'NewGP' },
      { title: 'P', parentTitle: 'GP' },
      { title: 'Selected', parentTitle: 'P' },
      { title: 'K', parentTitle: 'Selected' },
    ]);

    await selectDocumentById(window, m.get('Selected')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['GP', 'P', 'K']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Move P (selected doc's parent) under NewGP
    await moveDoc(window, m.get('P')!, m.get('NewGP')!);

    // Selected doc didn't move, but its ancestor chain changed
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['NewGP', 'P', 'K']);
  });

  test('deeply nested doc unnested straight to root: jumps 10 levels', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 0; i < 10; i++) {
      specs.push({ title: `Lv${i}`, parentTitle: i > 0 ? `Lv${i - 1}` : undefined });
    }
    const m = await seedTree(window, specs);

    await selectDocumentById(window, m.get('Lv9')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // 9 ancestors
    let buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(9);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Unnest Lv9 straight to root
    await moveDoc(window, m.get('Lv9')!, null);

    // No ancestors, no children → breadcrumb gone
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Nest it back at the bottom
    await moveDoc(window, m.get('Lv9')!, m.get('Lv8')!);
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(9);
  });

  test('circular move is rejected: doc cannot become its own descendant', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Root' },
      { title: 'Mid', parentTitle: 'Root' },
      { title: 'Leaf', parentTitle: 'Mid' },
    ]);

    await selectDocumentById(window, m.get('Leaf')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Root', 'Mid']);

    // Try to move Root under Leaf (circular) — should be rejected
    const threw = await window.evaluate(async ({ id, parentId }) => {
      try {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        return false;
      } catch {
        return true;
      }
    }, { id: m.get('Root')!, parentId: m.get('Leaf')! });
    expect(threw).toBe(true);

    // Reload and verify breadcrumb is unchanged
    await window.evaluate(async () => {
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    });
    await window.waitForTimeout(300);

    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Root', 'Mid']);
  });

  test('move doc into itself is rejected: breadcrumb stays intact', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'SelfRef' },
      { title: 'Child', parentTitle: 'SelfRef' },
    ]);

    await selectDocumentById(window, m.get('SelfRef')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Child']);

    const threw = await window.evaluate(async (id) => {
      try {
        await (window as any).lychee.invoke('documents.move', { id, parentId: id, sortOrder: 0 });
        return false;
      } catch {
        return true;
      }
    }, m.get('SelfRef')!);
    expect(threw).toBe(true);

    // Breadcrumb unchanged
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['Child']);
  });
});

// ── Stress Tests — Long Note Trees ──────────────────────────────────

test.describe('Breadcrumb Pill — Stress: Deep Trees', () => {
  test('15-level deep tree: all 14 ancestors render and the deepest is navigable', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 0; i < 15; i++) {
      specs.push({
        title: `D${i}`,
        parentTitle: i > 0 ? `D${i - 1}` : undefined,
      });
    }
    const m = await seedTree(window, specs);

    await selectDocumentById(window, m.get('D14')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // All 14 ancestors (D0..D13) should appear as navigable buttons
    const buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(14);
    for (let i = 0; i < 14; i++) {
      expect(buttons[i]).toBe(`D${i}`);
    }

    // Current doc D14 should be visible text, not a button
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.getByText('D14')).toBeVisible();
    await expect(popover.locator('button', { hasText: 'D14' })).toHaveCount(0);

    // Navigate to the root from the deepest point
    await popover.locator('button', { hasText: 'D0' }).click();
    await window.waitForTimeout(400);

    expect(await getSelectedId(window)).toBe(m.get('D0')!);
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('D0');
  });

  test('15-level deep tree: navigate up one level at a time, ancestor count shrinks each step', async ({ window }) => {
    const depth = 15;
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 0; i < depth; i++) {
      specs.push({
        title: `Step${i}`,
        parentTitle: i > 0 ? `Step${i - 1}` : undefined,
      });
    }
    const m = await seedTree(window, specs);

    await selectDocumentById(window, m.get(`Step${depth - 1}`)!);
    await closeSidebar(window);

    // Walk up from Step14 to Step0, verifying ancestor count at each level
    for (let level = depth - 2; level >= 0; level--) {
      await openBreadcrumb(window);
      const popover = window.locator('[data-radix-popper-content-wrapper]');

      // Click the immediate parent
      await popover.locator('button', { hasText: `Step${level}` }).click();
      await window.waitForTimeout(400);

      expect(await getSelectedId(window)).toBe(m.get(`Step${level}`)!);

      // Open breadcrumb again and verify ancestor count
      if (level > 0 || level < depth - 1) {
        // Should still have hierarchy (either ancestors above or a child below)
        await openBreadcrumb(window);
        const ancestorButtons = await getPopoverButtons(window);

        // At level N, there should be N ancestor buttons + 1 child button (StepN+1)
        const expectedAncestors = level;
        const expectedChildren = 1; // always has one child (the level below)
        expect(ancestorButtons).toHaveLength(expectedAncestors + expectedChildren);

        // Close the popover for next iteration
        await window.locator(BREADCRUMB_TRIGGER).click();
        await window.waitForTimeout(200);
      }
    }

    // At Step0 (root), breadcrumb should still be visible (has child Step1)
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
  });

  test('12-level deep tree with long titles: titles truncate without breaking navigation', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let i = 0; i < 12; i++) {
      const title = `Level ${i} — ${'This is a rather lengthy note title that should get truncated in the popover'}`;
      specs.push({
        title,
        parentTitle: i > 0 ? specs[i - 1].title : undefined,
      });
    }
    const m = await seedTree(window, specs);
    const deepestTitle = specs[11].title;
    const rootTitle = specs[0].title;

    await selectDocumentById(window, m.get(deepestTitle)!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // All 11 ancestors should be present
    const buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(11);

    // Navigate to the root by clicking the first ancestor
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button').first().click();
    await window.waitForTimeout(400);

    // Should have navigated to the root document
    expect(await getSelectedId(window)).toBe(m.get(rootTitle)!);
  });
});

test.describe('Breadcrumb Pill — Stress: Wide Trees', () => {
  test('parent with 25 children: all children are listed and navigable via scroll', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [
      { title: 'Big Parent' },
    ];
    for (let i = 0; i < 25; i++) {
      specs.push({ title: `Kid ${String(i).padStart(2, '0')}`, parentTitle: 'Big Parent' });
    }
    const m = await seedTree(window, specs);

    await selectDocumentById(window, m.get('Big Parent')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(25);

    // Navigate to the first, middle, and last child — popover scrolls to reach each
    for (const target of ['Kid 00', 'Kid 12', 'Kid 24']) {
      await openBreadcrumb(window);
      const popover = window.locator('[data-radix-popper-content-wrapper]');
      const btn = popover.locator('button', { hasText: target });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await window.waitForTimeout(400);

      expect(await getSelectedId(window)).toBe(m.get(target)!);
      const visibleTitle = window.locator('main:visible h1.editor-title');
      await expect(visibleTitle).toContainText(target);

      // Go back to the parent for the next check
      await openBreadcrumb(window);
      const backBtn = window.locator('[data-radix-popper-content-wrapper]').locator('button', { hasText: 'Big Parent' });
      await backBtn.scrollIntoViewIfNeeded();
      await backBtn.click();
      await window.waitForTimeout(400);
    }
  });

  test('25 children: trashing half updates the breadcrumb to show only survivors', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [
      { title: 'Prune Parent' },
    ];
    for (let i = 0; i < 20; i++) {
      specs.push({ title: `Prune ${String(i).padStart(2, '0')}`, parentTitle: 'Prune Parent' });
    }
    const m = await seedTree(window, specs);

    await selectDocumentById(window, m.get('Prune Parent')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(20);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash the even-numbered children
    const trashIds: string[] = [];
    for (let i = 0; i < 20; i += 2) {
      trashIds.push(m.get(`Prune ${String(i).padStart(2, '0')}`)!);
    }
    await window.evaluate(async (ids) => {
      for (const id of ids) {
        await (window as any).lychee.invoke('documents.trash', { id });
      }
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, trashIds);
    await window.waitForTimeout(500);

    // Reopen — should show exactly 10 surviving children
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(10);

    // Every surviving child should have an odd number
    for (const label of buttons) {
      const num = parseInt(label.replace('Prune ', ''), 10);
      expect(num % 2).toBe(1);
    }
  });

  test('25 children: sort order in breadcrumb matches DB sort order', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [
      { title: 'Order Parent' },
    ];
    for (let i = 0; i < 25; i++) {
      specs.push({ title: `Ord ${String(i).padStart(2, '0')}`, parentTitle: 'Order Parent' });
    }
    const m = await seedTree(window, specs);
    const parentId = m.get('Order Parent')!;

    // Get the expected order from the database
    const docs = await listDocumentsFromDb(window);
    const dbChildren = docs
      .filter((d) => d.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const expectedOrder = dbChildren.map((d) => d.title);

    await selectDocumentById(window, parentId);
    await closeSidebar(window);
    await openBreadcrumb(window);

    const popoverButtons = await getPopoverButtons(window);
    expect(popoverButtons).toEqual(expectedOrder);
  });
});

test.describe('Breadcrumb Pill — Stress: Deep + Wide Combined', () => {
  test('5-deep tree where each node has 3 children: correct breadcrumb at every level', async ({ window }) => {
    // Build a tree: R → A1,A2,A3 → B1 (under A2) → C1,C2 (under B1) → D1 (under C1)
    const m = await seedTree(window, [
      { title: 'R' },
      { title: 'A1', parentTitle: 'R' },
      { title: 'A2', parentTitle: 'R' },
      { title: 'A3', parentTitle: 'R' },
      { title: 'B1', parentTitle: 'A2' },
      { title: 'B2', parentTitle: 'A2' },
      { title: 'B3', parentTitle: 'A2' },
      { title: 'C1', parentTitle: 'B1' },
      { title: 'C2', parentTitle: 'B1' },
      { title: 'D1', parentTitle: 'C1' },
    ]);

    await closeSidebar(window);

    // At D1: ancestors=[R, A2, B1, C1], children=[]
    await selectDocumentById(window, m.get('D1')!);
    await window.waitForTimeout(200);
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['R', 'A2', 'B1', 'C1']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // At C1: ancestors=[R, A2, B1], children=[D1]
    await selectDocumentById(window, m.get('C1')!);
    await window.waitForTimeout(200);
    await openBreadcrumb(window);
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    const c1Ancestors = popover.locator('button');
    // 3 ancestor buttons + 1 child button = 4
    await expect(c1Ancestors).toHaveCount(4);
    await expect(popover.locator('button', { hasText: 'D1' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'B1' })).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // At B1: ancestors=[R, A2], children=[C1, C2]
    await selectDocumentById(window, m.get('B1')!);
    await window.waitForTimeout(200);
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'R' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'A2' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'C1' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'C2' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'B1' })).toHaveCount(0);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // At R: ancestors=[], children=[A1, A2, A3]
    await selectDocumentById(window, m.get('R')!);
    await window.waitForTimeout(200);
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(3);
    expect(buttons).toContain('A1');
    expect(buttons).toContain('A2');
    expect(buttons).toContain('A3');
  });

  test('navigate through a wide+deep tree: root → child → grandchild → back to root', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'Trunk' },
      { title: 'Branch 1', parentTitle: 'Trunk' },
      { title: 'Branch 2', parentTitle: 'Trunk' },
      { title: 'Branch 3', parentTitle: 'Trunk' },
      { title: 'Leaf 2a', parentTitle: 'Branch 2' },
      { title: 'Leaf 2b', parentTitle: 'Branch 2' },
      { title: 'Leaf 2c', parentTitle: 'Branch 2' },
      { title: 'Deep 2a', parentTitle: 'Leaf 2a' },
    ]);
    const visibleTitle = window.locator('main:visible h1.editor-title');

    await selectDocumentById(window, m.get('Trunk')!);
    await closeSidebar(window);

    // Trunk → Branch 2 (via children)
    await openBreadcrumb(window);
    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Branch 2' }).click();
    await window.waitForTimeout(400);
    await expect(visibleTitle).toContainText('Branch 2');

    // Branch 2 → Leaf 2a (via children)
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Leaf 2a' }).click();
    await window.waitForTimeout(400);
    await expect(visibleTitle).toContainText('Leaf 2a');

    // Leaf 2a → Deep 2a (via children)
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Deep 2a' }).click();
    await window.waitForTimeout(400);
    await expect(visibleTitle).toContainText('Deep 2a');

    // Now at the bottom: ancestors should be [Trunk, Branch 2, Leaf 2a]
    await openBreadcrumb(window);
    const deepButtons = await getPopoverButtons(window);
    expect(deepButtons).toEqual(['Trunk', 'Branch 2', 'Leaf 2a']);

    // Jump all the way back to root
    popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Trunk' }).click();
    await window.waitForTimeout(400);
    await expect(visibleTitle).toContainText('Trunk');
    expect(await getSelectedId(window)).toBe(m.get('Trunk')!);
  });

  test('10-deep chain with 5 siblings at each level: breadcrumb shows correct linear path', async ({ window }) => {
    // Build a chain where each node has 5 children, but we go down one path
    const specs: Array<{ title: string; parentTitle?: string }> = [];
    for (let depth = 0; depth < 10; depth++) {
      const parentTitle = depth > 0 ? `Main ${depth - 1}` : undefined;
      // The "main" child we'll descend into
      specs.push({ title: `Main ${depth}`, parentTitle });
      // 4 sibling children
      for (let s = 0; s < 4; s++) {
        specs.push({ title: `Sib ${depth}-${s}`, parentTitle: depth > 0 ? `Main ${depth - 1}` : `Main ${depth}` });
      }
    }
    // Fix: root siblings should be under Main 0, not have no parent
    // Actually let me restructure: Main 0 is root, has 4 siblings at root level,
    // Main 0 has child Main 1 + 4 siblings, etc.
    const cleanSpecs: Array<{ title: string; parentTitle?: string }> = [
      { title: 'Main 0' },
    ];
    for (let depth = 1; depth < 10; depth++) {
      cleanSpecs.push({ title: `Main ${depth}`, parentTitle: `Main ${depth - 1}` });
      for (let s = 0; s < 4; s++) {
        cleanSpecs.push({ title: `Sib ${depth}-${s}`, parentTitle: `Main ${depth - 1}` });
      }
    }
    const m = await seedTree(window, cleanSpecs);

    // Select the deepest main node
    await selectDocumentById(window, m.get('Main 9')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    // Should show 9 ancestors: Main 0 through Main 8
    const buttons = await getPopoverButtons(window);
    const ancestorButtons = buttons.filter((b) => b.startsWith('Main'));
    expect(ancestorButtons).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(ancestorButtons[i]).toBe(`Main ${i}`);
    }

    // Navigate to Main 5 (mid-chain)
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'Main 5' }).first().click();
    await window.waitForTimeout(400);

    expect(await getSelectedId(window)).toBe(m.get('Main 5')!);

    // At Main 5: ancestors = [Main 0..Main 4], children = [Main 6, Sib 6-0..Sib 6-3]
    await openBreadcrumb(window);
    const midButtons = await getPopoverButtons(window);
    // 5 ancestors + 5 children (Main 6 + 4 siblings)
    expect(midButtons).toHaveLength(10);
    expect(midButtons.slice(0, 5)).toEqual(['Main 0', 'Main 1', 'Main 2', 'Main 3', 'Main 4']);
    expect(midButtons).toContain('Main 6');
  });
});

test.describe('Breadcrumb Pill — Stress: Bulk Mutations on Large Trees', () => {
  test('move the deepest node across a 10-level tree to a different branch', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'T Root' },
      { title: 'T Branch A', parentTitle: 'T Root' },
      { title: 'T Branch B', parentTitle: 'T Root' },
      { title: 'T A1', parentTitle: 'T Branch A' },
      { title: 'T A2', parentTitle: 'T A1' },
      { title: 'T A3', parentTitle: 'T A2' },
      { title: 'T A4', parentTitle: 'T A3' },
      { title: 'T B1', parentTitle: 'T Branch B' },
      { title: 'T B2', parentTitle: 'T B1' },
    ]);
    const moverId = m.get('T A4')!;
    const newParentId = m.get('T B2')!;

    await selectDocumentById(window, moverId);
    await closeSidebar(window);

    // Before move: ancestors = [T Root, T Branch A, T A1, T A2, T A3]
    await openBreadcrumb(window);
    let buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['T Root', 'T Branch A', 'T A1', 'T A2', 'T A3']);
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Move T A4 under T B2
    await window.evaluate(
      async ({ id, parentId }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
      },
      { id: moverId, parentId: newParentId },
    );
    await window.waitForTimeout(400);

    // After move: ancestors = [T Root, T Branch B, T B1, T B2]
    await openBreadcrumb(window);
    buttons = await getPopoverButtons(window);
    expect(buttons).toEqual(['T Root', 'T Branch B', 'T B1', 'T B2']);

    // Navigate to the new branch root to verify the chain
    const popover = window.locator('[data-radix-popper-content-wrapper]');
    await popover.locator('button', { hasText: 'T Branch B' }).click();
    await window.waitForTimeout(400);

    expect(await getSelectedId(window)).toBe(m.get('T Branch B')!);
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await expect(visibleTitle).toContainText('T Branch B');
  });

  test('cascade-trash a mid-level node in a 10-node tree: children below it vanish from all breadcrumbs', async ({ window }) => {
    const m = await seedTree(window, [
      { title: 'CT Root' },
      { title: 'CT Mid', parentTitle: 'CT Root' },
      { title: 'CT Deep 1', parentTitle: 'CT Mid' },
      { title: 'CT Deep 2', parentTitle: 'CT Deep 1' },
      { title: 'CT Sibling', parentTitle: 'CT Root' },
    ]);

    // View from CT Root — children should include CT Mid and CT Sibling
    await selectDocumentById(window, m.get('CT Root')!);
    await closeSidebar(window);
    await openBreadcrumb(window);

    let popover = window.locator('[data-radix-popper-content-wrapper]');
    await expect(popover.locator('button', { hasText: 'CT Mid' })).toBeVisible();
    await expect(popover.locator('button', { hasText: 'CT Sibling' })).toBeVisible();
    await window.locator(BREADCRUMB_TRIGGER).click();
    await window.waitForTimeout(200);

    // Trash CT Mid (should cascade to CT Deep 1 and CT Deep 2)
    await window.evaluate(async (id) => {
      await (window as any).lychee.invoke('documents.trash', { id });
      const store = (window as any).__documentStore;
      await store.getState().loadDocuments(true);
    }, m.get('CT Mid')!);
    await window.waitForTimeout(400);

    // CT Root should now only show CT Sibling as a child
    await openBreadcrumb(window);
    popover = window.locator('[data-radix-popper-content-wrapper]');
    const remainingButtons = await getPopoverButtons(window);
    expect(remainingButtons).toEqual(['CT Sibling']);

    // Verify CT Deep 1 and CT Deep 2 are actually trashed in the DB
    const deep1 = await getDocumentFromDb(window, m.get('CT Deep 1')!);
    const deep2 = await getDocumentFromDb(window, m.get('CT Deep 2')!);
    expect(deep1!.deletedAt).toBeTruthy();
    expect(deep2!.deletedAt).toBeTruthy();
  });

  test('rapidly create children under a node and verify breadcrumb updates each time', async ({ window }) => {
    const m = await seedTree(window, [{ title: 'Rapid Parent' }]);
    const parentId = m.get('Rapid Parent')!;

    await selectDocumentById(window, parentId);
    await closeSidebar(window);

    // Initially no children — breadcrumb hidden
    await expect(window.locator(BREADCRUMB_TRIGGER)).not.toBeVisible();

    // Create 10 children one at a time and verify the breadcrumb updates
    for (let i = 0; i < 10; i++) {
      await window.evaluate(
        async ({ parentId, title }) => {
          const { document } = await (window as any).lychee.invoke('documents.create', { title, parentId });
          await (window as any).lychee.invoke('documents.update', { id: document.id, title });
          const store = (window as any).__documentStore;
          await store.getState().loadDocuments(true);
        },
        { parentId, title: `Rapid Kid ${i}` },
      );
      await window.waitForTimeout(300);
    }

    // After 10 children: breadcrumb should be visible with 10 children
    await expect(window.locator(BREADCRUMB_TRIGGER)).toBeVisible();
    await openBreadcrumb(window);
    const buttons = await getPopoverButtons(window);
    expect(buttons).toHaveLength(10);

    // The most recently created child should appear first (lowest sortOrder)
    // Verify by checking the DB order matches popover order
    const docs = await listDocumentsFromDb(window);
    const dbChildren = docs
      .filter((d) => d.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(buttons).toEqual(dbChildren.map((d) => d.title));
  });

  test('reorder children via moves and verify breadcrumb reflects the new order', async ({ window }) => {
    const specs: Array<{ title: string; parentTitle?: string }> = [
      { title: 'Reorder Parent' },
    ];
    for (let i = 0; i < 6; i++) {
      specs.push({ title: `R${i}`, parentTitle: 'Reorder Parent' });
    }
    const m = await seedTree(window, specs);
    const parentId = m.get('Reorder Parent')!;

    await selectDocumentById(window, parentId);
    await closeSidebar(window);

    // Get current order from DB
    let docs = await listDocumentsFromDb(window);
    let dbChildren = docs
      .filter((d) => d.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const originalOrder = dbChildren.map((d) => d.title);

    // Move the last child to position 0 (first)
    const lastChildId = dbChildren[dbChildren.length - 1].id;
    await window.evaluate(
      async ({ id, parentId }) => {
        await (window as any).lychee.invoke('documents.move', { id, parentId, sortOrder: 0 });
        const store = (window as any).__documentStore;
        await store.getState().loadDocuments(true);
      },
      { id: lastChildId, parentId },
    );
    await window.waitForTimeout(400);

    // Get new DB order
    docs = await listDocumentsFromDb(window);
    dbChildren = docs
      .filter((d) => d.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const newOrder = dbChildren.map((d) => d.title);

    // Order should have changed
    expect(newOrder).not.toEqual(originalOrder);
    expect(newOrder[0]).toBe(originalOrder[originalOrder.length - 1]);

    // Breadcrumb should match the new DB order
    await openBreadcrumb(window);
    const popoverButtons = await getPopoverButtons(window);
    expect(popoverButtons).toEqual(newOrder);
  });
});
