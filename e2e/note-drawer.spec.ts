/**
 * E2E coverage for the in-note drawer (the toolbar button that opens the
 * floating panel with Links / Highlights / Bookmarks tabs).
 *
 * Surface areas covered:
 *   - trigger + open/close/toggle behavior and exclusivity with other panels
 *   - positioning / sizing / resize behavior / scroll containment
 *   - Links tab: external links, internal note links, URL embeds
 *   - link filters (All / Links / Notes / Other)
 *   - copy + open actions (including the internal-note tab focus rules)
 *   - Highlights tab
 *   - Bookmarks placeholder
 *   - live content sync + footer stats
 *   - edge cases (missing notes, self-links, long text, duplicates)
 *   - stress (many rows, rapid toggling / filtering / tab switching)
 *
 * Most content is injected directly into the DB and reloaded rather than driven
 * through the editor UI. That keeps tests deterministic (no network, no
 * markdown timing) while still exercising the real deserialization + drawer
 * extraction path.
 */

import { test, expect } from './electron-app';
import type { Locator, Page } from '@playwright/test';
import { mockIpcResolve, clearIpcMocks } from './ipc-mock';

// ── Selectors ────────────────────────────────────────────────────────

const TRIGGER = '[aria-label="Open note drawer"]';
const DRAWER = '[data-testid="note-drawer"]';
const LINK_ROW = '[data-testid="drawer-link-row"]';
const HIGHLIGHT_ROW = '[data-testid="drawer-highlight-row"]';
const LINK_COPY = '[data-testid="drawer-link-copy"]';
const LINK_OPEN_INTERNAL = '[data-testid="drawer-link-open-internal"]';
const LINK_OPEN_EXTERNAL = '[data-testid="drawer-link-open-external"]';
const LINK_FILTER = '[data-testid="link-filter"]';

const HIGHLIGHT_FORMAT = 128;

// ── DOM helpers ──────────────────────────────────────────────────────

function activeMain(window: Page): Locator {
  return window.locator('main:visible');
}
function activeTitle(window: Page): Locator {
  return window.locator('main:visible h1.editor-title');
}
function activeEditor(window: Page): Locator {
  return window.locator('main:visible .ContentEditable__root');
}
/**
 * Focus the note body by clicking the left edge of the first paragraph. The
 * drawer floats over the right side of the editor, so centering a click on the
 * full-width editable would land underneath it.
 */
async function focusBody(window: Page) {
  await activeEditor(window).locator('p').first().click({ position: { x: 30, y: 10 } });
}
function drawer(window: Page): Locator {
  return window.locator(DRAWER);
}
function trigger(window: Page): Locator {
  return activeMain(window).locator(TRIGGER);
}

// ── Store helpers ────────────────────────────────────────────────────

type CreatedNote = { docId: string; tabId: string };
type TabSnapshot = {
  selectedId: string | null;
  selectedDocId: string | null;
  openTabs: Array<{ tabId: string; docId: string }>;
};

async function createNote(window: Page, title: string, body = ''): Promise<CreatedNote> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(300);
  await activeTitle(window).click();
  await window.keyboard.type(title);
  await window.keyboard.press('Enter');
  if (body) await window.keyboard.type(body);
  await window.waitForTimeout(600);
  return window.evaluate(() => {
    const state = (window as any).__documentStore.getState();
    const tab = state.openTabs.find((entry: any) => entry.tabId === state.selectedId);
    return { docId: tab.docId, tabId: tab.tabId };
  });
}

async function getTabSnapshot(window: Page): Promise<TabSnapshot> {
  return window.evaluate(() => {
    const state = (window as any).__documentStore.getState();
    const selectedTab = state.openTabs.find((tab: any) => tab.tabId === state.selectedId);
    return {
      selectedId: state.selectedId,
      selectedDocId: selectedTab?.docId ?? null,
      openTabs: state.openTabs.map((tab: any) => ({ tabId: tab.tabId, docId: tab.docId })),
    };
  });
}

async function closeTabsForDocument(window: Page, docId: string) {
  await window.evaluate((id) => {
    const store = (window as any).__documentStore;
    for (const tab of store.getState().openTabs.filter((entry: any) => entry.docId === id)) {
      store.getState().closeTab(tab.tabId);
    }
  }, docId);
  await window.waitForTimeout(150);
}

async function selectDocument(window: Page, docId: string) {
  await window.evaluate((id) => {
    (window as any).__documentStore.getState().openOrSelectTab(id);
  }, docId);
  await window.waitForTimeout(250);
}

async function trashDocument(window: Page, docId: string) {
  await window.evaluate((id) => {
    (window as any).__documentStore.getState().trashDocument(id);
  }, docId);
  await window.waitForTimeout(300);
}

async function renameDocumentInStore(window: Page, docId: string, title: string) {
  await window.evaluate(
    ({ id, t }) => {
      (window as any).__documentStore.getState().updateDocumentInStore(id, { title: t });
    },
    { id: docId, t: title },
  );
  await window.waitForTimeout(150);
}

// ── IPC / clipboard spies ────────────────────────────────────────────

async function invokeCalls(window: Page, channel: string) {
  return window.evaluate(
    (ch) => (window as any).lychee.__mocks.calls().filter((call: any) => call.channel === ch),
    channel,
  );
}

async function clearInvokeCalls(window: Page) {
  await window.evaluate(() => (window as any).lychee.__mocks.clearCalls());
}

async function installClipboardSpy(window: Page) {
  await window.evaluate(() => {
    (window as any).__copiedTexts = [] as string[];
    const clipboard = {
      writeText: (text: string) => {
        (window as any).__copiedTexts.push(text);
        return Promise.resolve();
      },
      readText: () => Promise.resolve(''),
    };
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      get: () => clipboard,
    });
  });
}

async function copiedTexts(window: Page): Promise<string[]> {
  return window.evaluate(() => (window as any).__copiedTexts ?? []);
}

// ── Content injection ────────────────────────────────────────────────

type InjectedBookmark = {
  url: string;
  title: string;
  description?: string;
  faviconUrl?: string;
};

function textNode(text: string, format = 0) {
  return { detail: 0, format, mode: 'normal', style: '', text, type: 'text', version: 1 };
}

function paragraph(children: unknown[]) {
  return { children, direction: null, format: '', indent: 0, type: 'paragraph', version: 1 };
}

function linkNode(label: string, url: string) {
  return {
    children: [textNode(label)],
    direction: null,
    format: '',
    indent: 0,
    type: 'link',
    version: 1,
    rel: null,
    target: null,
    title: null,
    url,
  };
}

function bookmarkNode(bookmark: InjectedBookmark) {
  return {
    type: 'bookmark',
    url: bookmark.url,
    title: bookmark.title,
    description: bookmark.description ?? '',
    imageUrl: '',
    faviconUrl: bookmark.faviconUrl ?? '',
    hydrationAttempted: true,
    version: 1,
  };
}

function internalUrl(docId: string) {
  return `https://note.lychee.invalid/${docId}`;
}

/**
 * Replace a note's content with generated children, then close + reopen the tab
 * so Lexical deserializes the injected state. The note's title is preserved.
 */
async function injectContentAndReload(
  window: Page,
  docId: string,
  title: string,
  children: unknown[],
) {
  const content = JSON.stringify({
    root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
  });
  await window.evaluate(
    ({ id, c }: { id: string; c: string }) =>
      (window as any).lychee.invoke('documents.update', { id, content: c }),
    { id: docId, c: content },
  );
  await window.evaluate(() => (window as any).__documentStore.getState().loadDocuments(true));
  await window.waitForTimeout(200);

  const closeBtn = window
    .locator('[data-tab-id]')
    .filter({ hasText: title })
    .locator('[aria-label="Close tab"]');
  if (await closeBtn.count()) {
    await closeBtn.click({ force: true });
    await window.waitForTimeout(300);
  }
  await window.locator(`[data-note-id="${docId}"]`).first().click();
  await window.waitForTimeout(400);
}

// ── Drawer helpers ───────────────────────────────────────────────────

async function openDrawer(window: Page) {
  await trigger(window).click();
  await expect(drawer(window)).toBeVisible();
  // Let the slide-in keyframe finish so geometry assertions are stable.
  await window.waitForTimeout(250);
}

async function selectTab(window: Page, name: 'Links' | 'Highlights' | 'Bookmarks') {
  await drawer(window).getByRole('tab', { name }).click();
}

async function selectFilter(window: Page, id: 'all' | 'links' | 'notes' | 'other') {
  await drawer(window).locator(`${LINK_FILTER}[data-filter="${id}"]`).click();
}

function linkRows(window: Page): Locator {
  return drawer(window).locator(LINK_ROW);
}

async function classTokens(locator: Locator): Promise<string[]> {
  return ((await locator.getAttribute('class')) ?? '').split(/\s+/).filter(Boolean);
}

// ── Suite ────────────────────────────────────────────────────────────

test.afterEach(async ({ window }) => {
  await clearIpcMocks(window);
});

test.describe('Note Drawer — trigger & lifecycle', () => {
  test('trigger is present on a fresh note and drawer is closed initially', async ({ window }) => {
    await createNote(window, 'Fresh Trigger');
    await expect(trigger(window)).toBeVisible();
    await expect(trigger(window)).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer(window)).toHaveCount(0);
  });

  test('opens on click, defaults to the Links tab, and toggles closed', async ({ window }) => {
    await createNote(window, 'Toggle Basics');
    await openDrawer(window);

    await expect(trigger(window)).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer(window).getByRole('tab', { name: 'Links' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(window.getByText('No links yet')).toBeVisible();

    await trigger(window).click();
    await expect(trigger(window)).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer(window)).toHaveCount(0);
  });

  test('closes on Escape', async ({ window }) => {
    await createNote(window, 'Escape Close');
    await openDrawer(window);
    await window.keyboard.press('Escape');
    await expect(drawer(window)).toHaveCount(0);
    await expect(trigger(window)).toHaveAttribute('aria-expanded', 'false');
  });

  test('closes via the header close button', async ({ window }) => {
    await createNote(window, 'Button Close');
    await openDrawer(window);
    await window.getByRole('button', { name: 'Close note drawer' }).click();
    await expect(drawer(window)).toHaveCount(0);
  });

  test('opening another toolbar panel (Cmd+K link editor) closes the drawer', async ({ window }) => {
    await createNote(window, 'Exclusive Close', 'some text');
    await openDrawer(window);
    // The editor must own focus for Cmd+K to reach the shortcut plugin.
    await focusBody(window);
    await window.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+k`);
    await expect(drawer(window)).toHaveCount(0);
  });

  test('clicking inside the editor does NOT close the drawer', async ({ window }) => {
    await createNote(window, 'Outside Click', 'keep me open');
    await openDrawer(window);
    await focusBody(window);
    await window.waitForTimeout(150);
    await expect(drawer(window)).toBeVisible();
  });

  test('rapid toggling always settles on the correct final state', async ({ window }) => {
    await createNote(window, 'Rapid Toggle');
    for (let i = 0; i < 5; i += 1) {
      await trigger(window).click();
      await window.waitForTimeout(40);
      await trigger(window).click();
      await window.waitForTimeout(40);
    }
    // Even number of toggles → closed.
    await expect(drawer(window)).toHaveCount(0);
    await expect(trigger(window)).toHaveAttribute('aria-expanded', 'false');
  });

  test('drawer state resets when switching away and back to a note', async ({ window }) => {
    const { docId } = await createNote(window, 'Tab Switch Reset');
    const other = await createNote(window, 'Other Note');
    await openDrawer(window);
    await expect(drawer(window)).toBeVisible();

    await selectDocument(window, docId);
    await expect(drawer(window)).toHaveCount(0);
    await expect(trigger(window)).toHaveAttribute('aria-expanded', 'false');

    await selectDocument(window, other.docId);
    await openDrawer(window);
    await expect(drawer(window)).toBeVisible();
  });
});

test.describe('Note Drawer — layout & resize', () => {
  test('sits below the sticky toolbar and never covers the trigger', async ({ window }) => {
    const { docId } = await createNote(window, 'Layout Anchor');
    await injectContentAndReload(window, docId, 'Layout Anchor', [
      paragraph([textNode('body text')]),
    ]);
    await openDrawer(window);

    const triggerBox = await trigger(window).boundingBox();
    const drawerBox = await drawer(window).boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);
  });

  test('panel stays within the viewport on the right and bottom edges', async ({ window }) => {
    const { docId } = await createNote(window, 'Layout Bounds');
    await injectContentAndReload(window, docId, 'Layout Bounds', [
      paragraph([textNode('body text')]),
    ]);
    await openDrawer(window);

    const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const box = (await drawer(window).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  test('a very tall list is capped and scrolls internally instead of overflowing', async ({ window }) => {
    const { docId } = await createNote(window, 'Layout Long List');
    const links = Array.from({ length: 40 }, (_, i) => ({
      label: `Link number ${i + 1}`,
      url: `https://example.com/page-${i + 1}`,
    }));
    await injectContentAndReload(
      window,
      docId,
      'Layout Long List',
      links.map((link) => paragraph([linkNode(link.label, link.url)])),
    );
    await openDrawer(window);

    const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const box = (await drawer(window).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);

    const panel = drawer(window).locator('[role="tabpanel"]');
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(linkRows(window)).toHaveCount(40);
  });

  test('recomputes position after a window resize without leaving the viewport', async ({
    electronApp,
    window,
  }) => {
    const originalSize = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getContentSize() ?? [1200, 800],
    );
    try {
      const { docId } = await createNote(window, 'Layout Resize');
      await injectContentAndReload(window, docId, 'Layout Resize', [
        paragraph([textNode('body text')]),
      ]);
      await openDrawer(window);

      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(680, 480);
      });
      await expect
        .poll(() => window.evaluate(() => ({ width: innerWidth, height: innerHeight })))
        .toEqual({ width: 680, height: 480 });
      await window.waitForTimeout(200);

      const box = (await drawer(window).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(680 + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(480 + 1);
    } finally {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]);
      }, originalSize);
    }
  });
});

test.describe('Note Drawer — links tab content', () => {
  test('lists external links with label and pretty URL', async ({ window }) => {
    const { docId } = await createNote(window, 'Web Links List');
    await injectContentAndReload(window, docId, 'Web Links List', [
      paragraph([linkNode('Example site', 'https://example.com/path')]),
    ]);
    await openDrawer(window);

    const row = linkRows(window).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Example site');
    await expect(row).toContainText('example.com');
    await expect(row).toHaveAttribute('data-link-url', 'https://example.com/path');
    await expect(row).toHaveAttribute('data-internal', '');
  });

  test('URL with query/hash still renders the path in the subtitle', async ({ window }) => {
    const { docId } = await createNote(window, 'Query URL');
    await injectContentAndReload(window, docId, 'Query URL', [
      paragraph([linkNode('Query link', 'https://example.com/search?q=lychee#top')]),
    ]);
    await openDrawer(window);
    await expect(linkRows(window).first()).toContainText('/search');
  });

  test('two identical external links render as two rows', async ({ window }) => {
    const { docId } = await createNote(window, 'Duplicate Links');
    await injectContentAndReload(window, docId, 'Duplicate Links', [
      paragraph([linkNode('Dup one', 'https://example.com')]),
      paragraph([linkNode('Dup two', 'https://example.com')]),
    ]);
    await openDrawer(window);
    await expect(linkRows(window)).toHaveCount(2);
  });

  test('empty state appears when there are no links', async ({ window }) => {
    await createNote(window, 'No Links');
    await openDrawer(window);
    await expect(window.getByText('No links yet')).toBeVisible();
    await expect(linkRows(window)).toHaveCount(0);
  });
});

test.describe('Note Drawer — internal note links', () => {
  test('renders title + "Note link" subtitle and hides the copy action', async ({ window }) => {
    const target = await createNote(window, 'Internal Target Alpha');
    const { docId } = await createNote(window, 'Internal Source Alpha');
    await injectContentAndReload(window, docId, 'Internal Source Alpha', [
      paragraph([linkNode('See the target', internalUrl(target.docId))]),
    ]);
    await openDrawer(window);

    const row = linkRows(window).first();
    await expect(row).toContainText('Internal Target Alpha');
    await expect(row).toContainText('Note link');
    await expect(row).toHaveAttribute('data-internal', target.docId);
    await expect(row.locator(LINK_COPY)).toHaveCount(0);
    await expect(row.locator(LINK_OPEN_INTERNAL)).toHaveCount(1);
    await expect(row.locator(LINK_OPEN_EXTERNAL)).toHaveCount(0);
  });

  test('opening focuses the existing target tab instead of creating a duplicate', async ({ window }) => {
    const target = await createNote(window, 'Focus Existing Target');
    const { docId } = await createNote(window, 'Focus Existing Source');
    await injectContentAndReload(window, docId, 'Focus Existing Source', [
      paragraph([linkNode('target', internalUrl(target.docId))]),
    ]);
    // New-note creation reuses the active tab, so give the target its own
    // background tab before we assert that opening reuses it.
    await window.evaluate((id) => {
      (window as any).__documentStore.getState().openTab(id);
    }, target.docId);
    await window.waitForTimeout(150);

    const before = await getTabSnapshot(window);
    const beforeCount = before.openTabs.filter((t) => t.docId === target.docId).length;
    expect(beforeCount).toBe(1);

    await openDrawer(window);
    await linkRows(window).first().locator(LINK_OPEN_INTERNAL).click();
    await window.waitForTimeout(300);

    const after = await getTabSnapshot(window);
    expect(after.selectedDocId).toBe(target.docId);
    expect(after.openTabs.filter((t) => t.docId === target.docId)).toHaveLength(beforeCount);
    await expect(drawer(window)).toHaveCount(0);
  });

  test('opening creates and focuses a new tab when the target is not already open', async ({ window }) => {
    const target = await createNote(window, 'New Tab Target');
    const source = await createNote(window, 'New Tab Source');
    await injectContentAndReload(window, source.docId, 'New Tab Source', [
      paragraph([linkNode('target', internalUrl(target.docId))]),
    ]);
    await closeTabsForDocument(window, target.docId);
    const before = await getTabSnapshot(window);
    expect(before.selectedDocId).toBe(source.docId);
    expect(before.openTabs.some((t) => t.docId === target.docId)).toBe(false);

    await openDrawer(window);
    await linkRows(window).first().locator(LINK_OPEN_INTERNAL).click();
    await window.waitForTimeout(300);

    const after = await getTabSnapshot(window);
    expect(after.selectedDocId).toBe(target.docId);
    expect(after.openTabs).toHaveLength(before.openTabs.length + 1);
    expect(after.openTabs.some((t) => t.docId === source.docId)).toBe(true);
  });

  test('trashing the target turns the row into "Missing note" and removes the open action', async ({ window }) => {
    const target = await createNote(window, 'Soon Missing Target');
    const { docId } = await createNote(window, 'Missing Link Source');
    await injectContentAndReload(window, docId, 'Missing Link Source', [
      paragraph([linkNode('gone', internalUrl(target.docId))]),
    ]);
    await trashDocument(window, target.docId);

    await openDrawer(window);
    const row = linkRows(window).first();
    await expect(row).toContainText('Missing note');
    await expect(row.locator(LINK_OPEN_INTERNAL)).toHaveCount(0);
  });

  test('renaming the target updates the drawer label live', async ({ window }) => {
    const target = await createNote(window, 'Original Link Name');
    const { docId } = await createNote(window, 'Rename Link Source');
    await injectContentAndReload(window, docId, 'Rename Link Source', [
      paragraph([linkNode('target', internalUrl(target.docId))]),
    ]);
    await openDrawer(window);
    await expect(linkRows(window).first()).toContainText('Original Link Name');

    await renameDocumentInStore(window, target.docId, 'Renamed Live Target');
    await expect(linkRows(window).first()).toContainText('Renamed Live Target');
  });

  test('a self-referential note link is treated as an internal note', async ({ window }) => {
    const source = await createNote(window, 'Self Link Source');
    await injectContentAndReload(window, source.docId, 'Self Link Source', [
      paragraph([linkNode('myself', internalUrl(source.docId))]),
    ]);
    await openDrawer(window);
    const row = linkRows(window).first();
    await expect(row).toHaveAttribute('data-internal', source.docId);
    await expect(row.locator(LINK_OPEN_INTERNAL)).toHaveCount(1);
  });

  test('multiple internal links to different notes each resolve independently', async ({ window }) => {
    const targetA = await createNote(window, 'Multi Target A');
    const targetB = await createNote(window, 'Multi Target B');
    const { docId } = await createNote(window, 'Multi Link Source');
    await injectContentAndReload(window, docId, 'Multi Link Source', [
      paragraph([linkNode('alpha', internalUrl(targetA.docId))]),
      paragraph([linkNode('beta', internalUrl(targetB.docId))]),
    ]);
    await openDrawer(window);
    const rows = linkRows(window);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Multi Target A');
    await expect(rows.nth(1)).toContainText('Multi Target B');
  });
});

test.describe('Note Drawer — URL embeds (Other)', () => {
  test('a bookmark embed appears as a link row with an external open action', async ({ window }) => {
    const { docId } = await createNote(window, 'Embed Row');
    await injectContentAndReload(window, docId, 'Embed Row', [
      paragraph([textNode('intro')]),
      bookmarkNode({ url: 'https://example.com/article', title: 'Great Article' }),
    ]);
    await openDrawer(window);

    const row = linkRows(window).first();
    await expect(row).toContainText('Great Article');
    await expect(row).toHaveAttribute('data-internal', '');
    await expect(row.locator(LINK_COPY)).toHaveCount(1);
    await expect(row.locator(LINK_OPEN_EXTERNAL)).toHaveCount(1);
  });
});

test.describe('Note Drawer — link filters', () => {
  async function buildFilteredNote(window: Page) {
    const target = await createNote(window, 'Filter Target Note');
    const source = await createNote(window, 'Filter Source Note');
    await injectContentAndReload(window, source.docId, 'Filter Source Note', [
      paragraph([linkNode('Web link', 'https://example.com')]),
      paragraph([linkNode('Note link', internalUrl(target.docId))]),
      paragraph([textNode('intro')]),
      bookmarkNode({ url: 'https://example.org/embed', title: 'Embedded Thing' }),
    ]);
    return { target, source };
  }

  test('All / Links / Notes / Other partition the rows', async ({ window }) => {
    await buildFilteredNote(window);
    await openDrawer(window);

    await expect(linkRows(window)).toHaveCount(3);

    await selectFilter(window, 'links');
    await expect(linkRows(window)).toHaveCount(1);
    await expect(linkRows(window).first()).toContainText('Web link');

    await selectFilter(window, 'notes');
    await expect(linkRows(window)).toHaveCount(1);
    await expect(linkRows(window).first()).toContainText('Note link');

    await selectFilter(window, 'other');
    await expect(linkRows(window)).toHaveCount(1);
    await expect(linkRows(window).first()).toContainText('Embedded Thing');

    await selectFilter(window, 'all');
    await expect(linkRows(window)).toHaveCount(3);
  });

  test('a filter with no matches shows the empty state', async ({ window }) => {
    const { docId } = await createNote(window, 'No Notes Filter');
    await injectContentAndReload(window, docId, 'No Notes Filter', [
      paragraph([linkNode('only web', 'https://example.com')]),
    ]);
    await openDrawer(window);
    await selectFilter(window, 'notes');
    await expect(window.getByText('Nothing here')).toBeVisible();
    await expect(linkRows(window)).toHaveCount(0);
  });

  test('the active filter is reflected via aria-pressed', async ({ window }) => {
    await createNote(window, 'Filter Pressed');
    await openDrawer(window);
    const all = drawer(window).locator(`${LINK_FILTER}[data-filter="all"]`);
    const notes = drawer(window).locator(`${LINK_FILTER}[data-filter="notes"]`);
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await selectFilter(window, 'notes');
    await expect(notes).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  test('filter selection survives switching tabs and back', async ({ window }) => {
    await createNote(window, 'Filter Persist');
    await openDrawer(window);
    await selectFilter(window, 'other');
    await selectTab(window, 'Highlights');
    await selectTab(window, 'Links');
    await expect(drawer(window).locator(`${LINK_FILTER}[data-filter="other"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('rapid filter switching ends on the last selected filter', async ({ window }) => {
    await createNote(window, 'Filter Rapid');
    await openDrawer(window);
    for (const id of ['links', 'notes', 'other', 'all', 'notes'] as const) {
      await selectFilter(window, id);
    }
    await expect(drawer(window).locator(`${LINK_FILTER}[data-filter="notes"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('Note Drawer — link actions', () => {
  test('copy writes the URL to the clipboard and shows transient confirmation', async ({ window }) => {
    const { docId } = await createNote(window, 'Copy Action');
    await injectContentAndReload(window, docId, 'Copy Action', [
      paragraph([linkNode('copy me', 'https://example.com/copy-target')]),
    ]);
    await installClipboardSpy(window);
    await openDrawer(window);

    const copyBtn = linkRows(window).first().locator(LINK_COPY);
    await copyBtn.click();
    await expect.poll(() => copiedTexts(window)).toContain('https://example.com/copy-target');
    await expect.poll(async () => (await classTokens(copyBtn)).includes('text-brand')).toBe(true);

    // Confirmation reverts after the timeout.
    await window.waitForTimeout(1600);
    await expect.poll(async () => (await classTokens(copyBtn)).includes('text-brand')).toBe(false);
  });

  test('external open invokes shell.openExternal with the exact URL', async ({ window }) => {
    await mockIpcResolve(window, 'shell.openExternal', {});
    const { docId } = await createNote(window, 'External Open');
    await injectContentAndReload(window, docId, 'External Open', [
      paragraph([linkNode('open me', 'https://example.com/open-target')]),
    ]);
    await clearInvokeCalls(window);
    await openDrawer(window);

    await linkRows(window).first().locator(LINK_OPEN_EXTERNAL).click();
    await expect
      .poll(async () => invokeCalls(window, 'shell.openExternal'))
      .toContainEqual({ channel: 'shell.openExternal', payload: { url: 'https://example.com/open-target' } });
  });

  test('clicking a link row highlights the linked block in the note', async ({ window }) => {
    const { docId } = await createNote(window, 'Jump To Link');
    await injectContentAndReload(window, docId, 'Jump To Link', [
      paragraph([textNode('filler')]),
      paragraph([linkNode('jump target', 'https://example.com/jump')]),
    ]);
    await openDrawer(window);
    await linkRows(window).first().click();

    await expect(activeEditor(window).locator('a.heading-highlight')).toHaveText('jump target');
  });

  test('clicking an internal row highlights the block without leaving the note', async ({ window }) => {
    const target = await createNote(window, 'Internal Jump Target');
    const source = await createNote(window, 'Internal Jump Source');
    await injectContentAndReload(window, source.docId, 'Internal Jump Source', [
      paragraph([linkNode('note jump', internalUrl(target.docId))]),
    ]);
    await openDrawer(window);
    await linkRows(window).first().click();
    await window.waitForTimeout(200);

    await expect(activeTitle(window)).toHaveText('Internal Jump Source');
    await expect(activeEditor(window).locator(`a[href="${internalUrl(target.docId)}"]`)).toHaveClass(
      /heading-highlight/,
    );
  });
});

test.describe('Note Drawer — highlights tab', () => {
  test('lists highlighted text and shows the empty state when none exist', async ({ window }) => {
    const { docId } = await createNote(window, 'Highlights List');
    await injectContentAndReload(window, docId, 'Highlights List', [
      paragraph([textNode('plain intro')]),
      paragraph([
        textNode('before '),
        textNode('a highlighted phrase', HIGHLIGHT_FORMAT),
        textNode(' after'),
      ]),
    ]);
    await openDrawer(window);
    await selectTab(window, 'Highlights');

    await expect(drawer(window).locator(HIGHLIGHT_ROW)).toHaveCount(1);
    await expect(drawer(window).locator(HIGHLIGHT_ROW).first()).toHaveText('a highlighted phrase');
  });

  test('multiple highlights render in document order', async ({ window }) => {
    const { docId } = await createNote(window, 'Highlights Order');
    await injectContentAndReload(window, docId, 'Highlights Order', [
      paragraph([textNode('first highlight', HIGHLIGHT_FORMAT)]),
      paragraph([textNode('second highlight', HIGHLIGHT_FORMAT)]),
      paragraph([textNode('third highlight', HIGHLIGHT_FORMAT)]),
    ]);
    await openDrawer(window);
    await selectTab(window, 'Highlights');

    const rows = drawer(window).locator(HIGHLIGHT_ROW);
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveText('first highlight');
    await expect(rows.nth(1)).toHaveText('second highlight');
    await expect(rows.nth(2)).toHaveText('third highlight');
  });

  test('clicking a highlight highlights and selects it in the note', async ({ window }) => {
    const { docId } = await createNote(window, 'Highlight Jump');
    await injectContentAndReload(window, docId, 'Highlight Jump', [
      paragraph([textNode('jump highlight target', HIGHLIGHT_FORMAT)]),
    ]);
    await openDrawer(window);
    await selectTab(window, 'Highlights');
    await drawer(window).locator(HIGHLIGHT_ROW).first().click();
    await window.waitForTimeout(200);

    await expect(activeEditor(window).locator('.heading-highlight')).toHaveText(
      'jump highlight target',
    );
  });

  test('empty highlights tab shows its empty state', async ({ window }) => {
    await createNote(window, 'No Highlights');
    await openDrawer(window);
    await selectTab(window, 'Highlights');
    await expect(window.getByText('No highlights yet')).toBeVisible();
  });
});

test.describe('Note Drawer — bookmarks tab placeholder', () => {
  test('always shows the coming-soon placeholder', async ({ window }) => {
    await createNote(window, 'Bookmarks Placeholder');
    await openDrawer(window);
    await selectTab(window, 'Bookmarks');
    await expect(window.getByText('In-note bookmarks')).toBeVisible();
    await expect(window.getByText(/Coming soon/i)).toBeVisible();
  });
});

function parseWordCount(text: string | null): number {
  const match = (text ?? '').match(/(\d+)\s+words/);
  return match ? Number(match[1]) : NaN;
}

test.describe('Note Drawer — live sync & stats', () => {
  test('footer stats show word and character counts', async ({ window }) => {
    await createNote(window, 'Stats Footer');
    await openDrawer(window);
    const stats = drawer(window).locator('[data-testid="drawer-stats"]');
    await expect(stats).toContainText('words');
    await expect(stats).toContainText('characters');
    expect(Number.isFinite(parseWordCount(await stats.textContent()))).toBe(true);
  });

  test('stats update live as the note is edited', async ({ window }) => {
    await createNote(window, 'Stats Live');
    await openDrawer(window);
    const stats = drawer(window).locator('[data-testid="drawer-stats"]');
    const before = parseWordCount(await stats.textContent());

    await focusBody(window);
    await window.keyboard.type('five more words here now');
    await expect
      .poll(async () => parseWordCount(await stats.textContent()))
      .toBe(before + 5);
  });

  test('a newly typed highlight appears while the drawer is open', async ({ window }) => {
    await createNote(window, 'Live Highlight');
    await openDrawer(window);
    await selectTab(window, 'Highlights');
    await expect(window.getByText('No highlights yet')).toBeVisible();

    await focusBody(window);
    await window.keyboard.type('==live highlight==');
    await window.keyboard.press('Space');
    await expect(drawer(window).locator(HIGHLIGHT_ROW)).toHaveCount(1);
    await expect(drawer(window).locator(HIGHLIGHT_ROW).first()).toHaveText('live highlight');
  });
});

test.describe('Note Drawer — edge cases', () => {
  test('very long labels and URLs do not overflow the panel width', async ({ window }) => {
    const { docId } = await createNote(window, 'Long Text Edge');
    await injectContentAndReload(window, docId, 'Long Text Edge', [
      paragraph([
        linkNode('L'.repeat(400), `https://example.com/${'segment/'.repeat(40)}`),
      ]),
    ]);
    await openDrawer(window);

    const drawerBox = (await drawer(window).boundingBox())!;
    const rowBox = (await linkRows(window).first().boundingBox())!;
    expect(rowBox.width).toBeLessThanOrEqual(drawerBox.width + 1);
  });

  test('a note link to a note with an empty title falls back gracefully', async ({ window }) => {
    const target = await createNote(window, 'Temp Title');
    // Clear the title through the real title field so the store + DB agree.
    await activeTitle(window).fill('');
    await window.waitForTimeout(900);

    const { docId } = await createNote(window, 'Empty Title Source');
    await injectContentAndReload(window, docId, 'Empty Title Source', [
      paragraph([linkNode('target', internalUrl(target.docId))]),
    ]);
    await openDrawer(window);
    // New-note placeholder fallback rather than a crash or blank row.
    await expect(linkRows(window).first()).toContainText(/New Note/);
  });

  test('filtering then trashing a target keeps the panel stable', async ({ window }) => {
    const target = await createNote(window, 'Filter Trash Target');
    const { docId } = await createNote(window, 'Filter Trash Source');
    await injectContentAndReload(window, docId, 'Filter Trash Source', [
      paragraph([linkNode('note', internalUrl(target.docId))]),
      paragraph([linkNode('web', 'https://example.com')]),
    ]);
    await openDrawer(window);
    await selectFilter(window, 'notes');
    await expect(linkRows(window)).toHaveCount(1);

    await trashDocument(window, target.docId);
    await expect(linkRows(window).first()).toContainText('Missing note');

    await selectFilter(window, 'all');
    await expect(linkRows(window)).toHaveCount(2);
  });
});

test.describe('Note Drawer — stress', () => {
  test('renders 40 mixed rows and can filter them repeatedly', async ({ window }) => {
    const target = await createNote(window, 'Stress Target Note');
    const { docId } = await createNote(window, 'Stress Mixed Source');
    const children: unknown[] = [];
    for (let i = 0; i < 14; i += 1) {
      children.push(paragraph([linkNode(`web ${i}`, `https://example.com/${i}`)]));
    }
    for (let i = 0; i < 14; i += 1) {
      children.push(paragraph([linkNode(`note ${i}`, internalUrl(target.docId))]));
    }
    for (let i = 0; i < 12; i += 1) {
      children.push(paragraph([textNode(`highlight ${i}`, HIGHLIGHT_FORMAT)]));
    }
    await injectContentAndReload(window, docId, 'Stress Mixed Source', children);
    await openDrawer(window);

    await expect(linkRows(window)).toHaveCount(28);
    await selectFilter(window, 'links');
    await expect(linkRows(window)).toHaveCount(14);
    await selectFilter(window, 'notes');
    await expect(linkRows(window)).toHaveCount(14);
    await selectFilter(window, 'other');
    await expect(window.getByText('Nothing here')).toBeVisible();
    await selectFilter(window, 'all');
    await selectTab(window, 'Highlights');
    await expect(drawer(window).locator(HIGHLIGHT_ROW)).toHaveCount(12);
  });

  test('opening and closing repeatedly leaves no lingering panel', async ({ window }) => {
    await createNote(window, 'Stress Open Close');
    for (let i = 0; i < 10; i += 1) {
      await trigger(window).click();
      await expect(drawer(window)).toBeVisible();
      await trigger(window).click();
      await expect(drawer(window)).toHaveCount(0);
    }
  });

  test('switching tabs repeatedly keeps the correct panel mounted', async ({ window }) => {
    await createNote(window, 'Stress Tabs');
    await openDrawer(window);
    const sequence: Array<'Links' | 'Highlights' | 'Bookmarks'> = [
      'Highlights',
      'Links',
      'Bookmarks',
      'Highlights',
      'Links',
    ];
    for (const tab of sequence) {
      await selectTab(window, tab);
      await expect(drawer(window).getByRole('tab', { name: tab })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await expect(window.getByText('No links yet')).toBeVisible();
  });

  test('drawer survives rapid note switching between two documents', async ({ window }) => {
    const a = await createNote(window, 'Rapid Switch A');
    const b = await createNote(window, 'Rapid Switch B');
    for (let i = 0; i < 6; i += 1) {
      await selectDocument(window, a.docId);
      await selectDocument(window, b.docId);
    }
    await selectDocument(window, a.docId);
    await expect(drawer(window)).toHaveCount(0);
    await openDrawer(window);
    await expect(drawer(window)).toBeVisible();
  });
});
