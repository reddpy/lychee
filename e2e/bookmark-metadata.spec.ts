/**
 * E2E tests for content-level BookmarkNode metadata completeness,
 * display edge cases, and DB field validation.
 *
 * Backend vs UI setup strategy
 * ─────────────────────────────
 *  BACKEND injection (`injectBookmarkNodeAndReload`) — tests that verify *how the
 *    card renders given specific metadata*: title fallback, description present/absent,
 *    thumbnail present/absent, hostname, tooltip.
 *    Real network calls can't guarantee exact OG tag values; injecting known data lets
 *    us test rendering logic precisely and independently of network state.
 *
 *  UI setup (hover → Embed/Bookmark) — tests that verify the *creation flow*:
 *    all 5 DB fields written, loading placeholders, undo/redo, coexistence,
 *    stress tests. These test the full round-trip including metadata fetching.
 *
 * Complements image-bookmark-embed.spec.ts, which already covers:
 *   basic creation, selection state, favicon/globe fallback, delete/enter/click
 *   key interactions, multiple bookmarks, tab switch, single undo.
 */

import { test, expect } from './electron-app';
import type { Page } from '@playwright/test';
import { mockIpcResolve, mockIpcReject, clearIpcMocks } from './ipc-mock';

// ── Helpers ──────────────────────────────────────────────────────────

async function createNoteWithTitle(window: Page, title: string): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.type(title);
  await window.waitForTimeout(700);
  return window.evaluate(() => {
    const s = (window as any).__documentStore.getState();
    return s.openTabs.find((t: any) => t.tabId === s.selectedId)?.docId as string;
  });
}

async function typeUrlInBody(window: Page, url: string) {
  await window.locator('main:visible h1.editor-title').click();
  await window.keyboard.press('Enter');
  await window.waitForTimeout(200);
  await window.keyboard.type(url, { delay: 10 });
  await window.keyboard.press('Space');
  await window.waitForTimeout(500);
}

async function clickPopoverButton(window: Page, buttonTitle: string) {
  const link = window.locator('.ContentEditable__root a').first();
  const btn = window.locator(`button[title="${buttonTitle}"]`);
  for (let attempt = 0; attempt < 3; attempt++) {
    await link.hover();
    await window.waitForTimeout(400);
    try {
      await expect(btn).toBeVisible({ timeout: 3000 });
      await btn.click({ timeout: 2000 });
      return;
    } catch {
      await window.waitForTimeout(200);
    }
  }
  await link.hover();
  await window.waitForTimeout(600);
  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.click();
}

async function clickEmbed(window: Page) {
  return clickPopoverButton(window, 'Embed content');
}

async function clickBookmarkBtn(window: Page) {
  return clickPopoverButton(window, 'Convert to bookmark');
}

/**
 * Inject a BookmarkNode with known metadata directly into the document via IPC,
 * then close and reopen the tab so Lexical deserializes the new state from DB.
 *
 * This lets display tests assert exact rendering behavior without depending on
 * what a live URL happens to return in its OG tags.
 */
async function injectBookmarkNodeAndReload(
  window: Page,
  docId: string,
  tabTitle: string,
  bookmark: {
    url: string;
    title: string;
    description: string;
    imageUrl: string;
    faviconUrl: string;
    /** Defaults to `true` so the injected metadata is treated as the final
     *  state and the component doesn't refetch on mount. Pass `false` when
     *  the test specifically wants to exercise the "unhydrated bookmark"
     *  retry-on-mount code path. */
    hydrationAttempted?: boolean;
  },
): Promise<void> {
  const content = JSON.stringify({
    root: {
      children: [
        // Keep an empty paragraph before the bookmark so Lexical is happy
        { children: [], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 },
        {
          type: 'bookmark',
          url: bookmark.url,
          title: bookmark.title,
          description: bookmark.description,
          imageUrl: bookmark.imageUrl,
          faviconUrl: bookmark.faviconUrl,
          hydrationAttempted: bookmark.hydrationAttempted ?? true,
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  });

  // Persist new content to DB
  await window.evaluate(
    ({ id, c }: { id: string; c: string }) =>
      (window as any).lychee.invoke('documents.update', { id, content: c }),
    { id: docId, c: content },
  );
  await window.evaluate(() => (window as any).__documentStore.getState().loadDocuments(true));
  await window.waitForTimeout(200);

  // Close the tab so Lexical discards in-memory state
  await window
    .locator('[data-tab-id]')
    .filter({ hasText: tabTitle })
    .locator('[aria-label="Close tab"]')
    .click({ force: true });
  await window.waitForTimeout(300);

  // Reopen by clicking in sidebar — Lexical will deserialize the injected content
  await window.locator(`[data-note-id="${docId}"]`).first().click();
  await window.waitForTimeout(400);
}

/**
 * Trigger a debounce save, then read the bookmark node from the DB.
 */
async function getBookmarkNodeFromDb(
  window: Page,
  docId: string,
): Promise<{
  type: string;
  url: string;
  title: string;
  description: string;
  imageUrl: string;
  faviconUrl: string;
  version: number;
  [key: string]: unknown;
}> {
  // Nudge the editor to trigger a save
  await window.keyboard.press('ArrowDown');
  await window.keyboard.press('Enter');
  await window.keyboard.type(' ');
  await window.waitForTimeout(1500);

  let node: any;
  await expect(async () => {
    const doc = await window.evaluate(
      (id: string) => (window as any).lychee.invoke('documents.get', { id }),
      docId,
    );
    const parsed = JSON.parse(doc.document.content);
    node = findNodeByType(parsed, 'bookmark');
    expect(node).not.toBeNull();
  }).toPass({ timeout: 6000 });

  return node;
}

function findNodeByType(obj: any, type: string): any {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.type === type) return obj;
  if (Array.isArray(obj.children)) {
    for (const child of obj.children) {
      const found = findNodeByType(child, type);
      if (found) return found;
    }
  }
  if (obj.root) return findNodeByType(obj.root, type);
  return null;
}

function findAllNodesByType(obj: any, type: string): any[] {
  const results: any[] = [];
  function walk(node: any) {
    if (!node || typeof node !== 'object') return;
    if (node.type === type) results.push(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
    if (node.root) walk(node.root);
  }
  walk(obj);
  return results;
}

// ── DB Field Completeness ─────────────────────────────────────────────
// UI-driven: verify the complete creation-flow writes all fields correctly.

test.describe('Bookmark Metadata — DB Field Completeness', () => {
  test('all 5 fields stored in DB after Embed (url, title, description, imageUrl, faviconUrl)', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB All Fields Embed');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node).toMatchObject({
      type: 'bookmark',
      url: expect.stringContaining('example.com'),
      title: expect.any(String),
      description: expect.any(String),
      imageUrl: expect.any(String),
      faviconUrl: expect.any(String),
      version: 1,
    });
  });

  test('all 5 fields stored in DB after Bookmark button path', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB All Fields Bookmark Path');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmarkBtn(window);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node).toMatchObject({
      type: 'bookmark',
      url: expect.stringContaining('example.com'),
      title: expect.any(String),
      description: expect.any(String),
      imageUrl: expect.any(String),
      faviconUrl: expect.any(String),
      version: 1,
    });
  });

  test('url field contains the original URL', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB url Field');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node.url).toContain('example.com');
  });

  test('serialized node has version: 1', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB Node Version');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node.version).toBe(1);
  });
});

// ── Display Correctness ───────────────────────────────────────────────
// BACKEND injection: inject known metadata, reload tab, assert rendering.
// This lets us test exact UI behavior (fallbacks, conditional elements)
// independently of what any live URL returns in its OG tags.

test.describe('Bookmark Metadata — Display Correctness', () => {
  test('title fallback: shows hostname when title is empty string', async ({ window }) => {
    const title = 'Title Fallback Hostname';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: '',           // empty → component should fall back to hostname
      description: 'Some description',
      imageUrl: '',
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-title')).toContainText('example.com');
  });

  test('title renders the OG value when present', async ({ window }) => {
    const title = 'Title Renders OG Value';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'My Custom Title',
      description: '',
      imageUrl: '',
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-title')).toContainText('My Custom Title');
  });

  test('description element is hidden when description is empty string', async ({ window }) => {
    const title = 'Description Absent Empty';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'No Description',
      description: '',    // empty → .bookmark-description must not be rendered
      imageUrl: '',
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-description')).not.toBeVisible();
  });

  test('description element is visible and contains text when present', async ({ window }) => {
    const title = 'Description Present';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'With Description',
      description: 'This is the description text.',
      imageUrl: '',
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-description')).toBeVisible();
    await expect(card.locator('.bookmark-description')).toContainText('This is the description text.');
  });

  test('thumbnail .bookmark-image rendered when imageUrl is set', async ({ window }) => {
    const title = 'Thumbnail Present';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'Has Thumbnail',
      description: '',
      imageUrl: 'https://placehold.co/300x200.png',  // known URL that can render
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-image')).toBeAttached();
    await expect(card.locator('.bookmark-image img')).toBeAttached();
  });

  test('.bookmark-image wrapper absent when imageUrl is empty string', async ({ window }) => {
    const title = 'Thumbnail Absent Empty';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'No Thumbnail',
      description: '',
      imageUrl: '',       // empty → .bookmark-image must not be rendered
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-image')).not.toBeAttached();
  });

  test('hostname appears in .bookmark-url span regardless of title', async ({ window }) => {
    const title = 'Hostname In Url Span';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'Any Title',
      description: '',
      imageUrl: '',
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-url span')).toContainText('example.com');
  });

  test('favicon img rendered when faviconUrl is set', async ({ window }) => {
    const title = 'Favicon Img Present';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'With Favicon',
      description: '',
      imageUrl: '',
      faviconUrl: 'https://example.com/favicon.ico',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-favicon')).toBeAttached();
    // Globe fallback should NOT appear when favicon is set
    await expect(card.locator('.bookmark-favicon-fallback')).not.toBeAttached();
  });

  test('globe fallback icon rendered when faviconUrl is empty', async ({ window }) => {
    const title = 'Globe Fallback Empty Favicon';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'No Favicon',
      description: '',
      imageUrl: '',
      faviconUrl: '',  // empty → Globe icon rendered
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-favicon-fallback')).toBeAttached();
    await expect(card.locator('.bookmark-favicon')).not.toBeAttached();
  });

  test('double-click tooltip title attribute contains the URL', async ({ window }) => {
    const title = 'Tooltip Title Attr';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'Tooltip Test',
      description: '',
      imageUrl: '',
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    const titleAttr = await card.getAttribute('title');
    expect(titleAttr).toContain('example.com');
    expect(titleAttr).toMatch(/double-click/i);
  });

  test('card renders all injected fields simultaneously (full card)', async ({ window }) => {
    const title = 'Full Card Render';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'Full Title',
      description: 'Full description here.',
      imageUrl: 'https://placehold.co/300x200.png',
      faviconUrl: 'https://example.com/favicon.ico',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-title')).toContainText('Full Title');
    await expect(card.locator('.bookmark-description')).toContainText('Full description here.');
    await expect(card.locator('.bookmark-url span')).toContainText('example.com');
    await expect(card.locator('.bookmark-image')).toBeAttached();
    await expect(card.locator('.bookmark-favicon')).toBeAttached();
  });

  test('card with only URL (all other fields empty) renders without crashing', async ({ window }) => {
    const title = 'Minimal Bookmark';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: '',
      description: '',
      imageUrl: '',
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    // Title falls back to hostname
    await expect(card.locator('.bookmark-title')).toContainText('example.com');
    // No description element
    await expect(card.locator('.bookmark-description')).not.toBeVisible();
    // No thumbnail
    await expect(card.locator('.bookmark-image')).not.toBeAttached();
    // Globe fallback
    await expect(card.locator('.bookmark-favicon-fallback')).toBeAttached();
  });
});

// ── Skeleton hydration ────────────────────────────────────────────────
// UI-driven: the bookmark card is inserted synchronously in a skeleton state
// (URL only) and metadata fills in from the background fetch.

test.describe('Bookmark Metadata — Skeleton Hydration', () => {
  test('Bookmark button inserts a card immediately, then fills metadata', async ({ window }) => {
    await createNoteWithTitle(window, 'Skeleton Bookmark');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });

    const link = window.locator('.ContentEditable__root a').first();
    await link.hover();
    await window.waitForTimeout(400);
    await expect(window.locator('button[title="Convert to bookmark"]')).toBeVisible({ timeout: 3000 });
    await window.locator('button[title="Convert to bookmark"]').click();

    const card = window.locator('.bookmark-card');
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.bookmark-title')).toContainText(/example/i, { timeout: 20000 });
  });

  test('Embed on HTML URL inserts a bookmark card immediately', async ({ window }) => {
    await createNoteWithTitle(window, 'Skeleton Embed');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });

    const link = window.locator('.ContentEditable__root a').first();
    await link.hover();
    await window.waitForTimeout(400);
    await expect(window.locator('button[title="Embed content"]')).toBeVisible({ timeout: 3000 });
    await window.locator('button[title="Embed content"]').click();

    const card = window.locator('.bookmark-card');
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.bookmark-title')).toContainText(/example/i, { timeout: 20000 });
  });
});

// ── Undo / Redo ───────────────────────────────────────────────────────
// UI-driven: tests Lexical editor history behavior.

test.describe('Bookmark Metadata — Undo / Redo', () => {
  test('undo after "Bookmark" button restores original link', async ({ window }) => {
    await createNoteWithTitle(window, 'Undo Bookmark Button');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmarkBtn(window);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    await window.keyboard.press('ControlOrMeta+z');
    await window.waitForTimeout(500);

    await expect(window.locator('.bookmark-card')).not.toBeVisible();
    const link = window.locator('.ContentEditable__root a').first();
    await expect(link).toBeVisible({ timeout: 3000 });
    expect(await link.getAttribute('href')).toContain('example.com');
  });

  test('redo after undo restores the bookmark card', async ({ window }) => {
    await createNoteWithTitle(window, 'Redo Bookmark');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    await window.keyboard.press('ControlOrMeta+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.bookmark-card')).not.toBeVisible();

    await window.keyboard.press('ControlOrMeta+Shift+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 5000 });
  });

  test('three undo/redo cycles stay consistent', async ({ window }) => {
    await createNoteWithTitle(window, 'Multi Undo Redo Bookmark');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    for (let cycle = 0; cycle < 3; cycle++) {
      await window.keyboard.press('ControlOrMeta+z');
      await window.waitForTimeout(400);
      await expect(window.locator('.bookmark-card')).not.toBeVisible();
      await expect(window.locator('.ContentEditable__root a').first()).toBeVisible();

      await window.keyboard.press('ControlOrMeta+Shift+z');
      await window.waitForTimeout(400);
      await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 5000 });
    }
  });
});

// ── Coexistence ───────────────────────────────────────────────────────

test.describe('Bookmark Metadata — Coexistence', () => {
  test('content-level bookmark card AND document-level star both work on same note', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Dual Bookmark');

    // Content-level: embed a URL
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    // Document-level: star the note via toolbar
    const toolbarBtn = window.locator('main:visible').getByRole('button', {
      name: /bookmark this note/i,
    });
    await expect(toolbarBtn).toBeVisible({ timeout: 5000 });
    await toolbarBtn.click();
    await window.waitForTimeout(500);

    // Content card still visible
    await expect(window.locator('.bookmark-card')).toBeVisible();
    // Toolbar shows bookmarked state
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Remove bookmark' }),
    ).toBeVisible({ timeout: 3000 });

    // Refocus the editor before triggering the DB save
    await window.locator('main:visible .ContentEditable__root').click();
    await window.waitForTimeout(200);

    // Both persisted to DB
    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node.url).toContain('example.com');
    await expect(async () => {
      const result = await window.evaluate(
        (id: string) => (window as any).lychee.invoke('documents.get', { id }),
        docId,
      );
      expect(result.document.metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('two content-level bookmarks both persist all fields in DB', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Two Bookmarks DB');

    // First
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card').first()).toBeVisible({ timeout: 15000 });

    // Second
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);
    await window.keyboard.type('https://www.iana.org', { delay: 10 });
    await window.keyboard.press('Space');
    await window.waitForTimeout(500);
    await window.locator('.ContentEditable__root a').first().hover();
    await window.waitForTimeout(400);
    await window.locator('button[title="Embed content"]').click();
    await expect(window.locator('.bookmark-card')).toHaveCount(2, { timeout: 20000 });

    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);

    await expect(async () => {
      const doc = await window.evaluate(
        (id: string) => (window as any).lychee.invoke('documents.get', { id }),
        docId,
      );
      const content = JSON.parse(doc.document.content);
      const nodes = findAllNodesByType(content, 'bookmark');
      expect(nodes).toHaveLength(2);
      for (const n of nodes) {
        expect(typeof n.url).toBe('string');
        expect(n.url).toBeTruthy();
        expect(typeof n.title).toBe('string');
        expect(typeof n.description).toBe('string');
        expect(typeof n.imageUrl).toBe('string');
        expect(typeof n.faviconUrl).toBe('string');
        expect(n.version).toBe(1);
      }
    }).toPass({ timeout: 8000 });
  });
});

// ── Edge Cases & Stress ───────────────────────────────────────────────

test.describe('Bookmark Metadata — Edge Cases & Stress', () => {
  test('injected bookmark card does not overflow editor container width', async ({ window }) => {
    // BACKEND: inject bookmark with a very long title to exercise layout
    const title = 'Long Title No Overflow';
    const docId = await createNoteWithTitle(window, title);

    await injectBookmarkNodeAndReload(window, docId, title, {
      url: 'https://example.com',
      title: 'A'.repeat(300), // 300-character title
      description: 'B'.repeat(300),
      imageUrl: '',
      faviconUrl: '',
    });

    const card = window.locator('.bookmark-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });

    const editorBox = await window.locator('main:visible .ContentEditable__root').boundingBox();
    const cardBox = await card.boundingBox();
    expect(editorBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.width).toBeLessThanOrEqual(editorBox!.width + 4); // 4px border tolerance
  });

  test('two injected bookmarks show different hostnames in .bookmark-url span', async ({ window }) => {
    // BACKEND: inject 2 known nodes; test hostname rendering for each
    // Using separate notes to keep injection simple
    const title1 = 'Hostname Test Alpha';
    const docId1 = await createNoteWithTitle(window, title1);
    await injectBookmarkNodeAndReload(window, docId1, title1, {
      url: 'https://example.com',
      title: 'Alpha',
      description: '',
      imageUrl: '',
      faviconUrl: '',
    });
    const hostname1 = await window.locator('.bookmark-card .bookmark-url span').first().textContent();

    const title2 = 'Hostname Test Beta';
    const docId2 = await createNoteWithTitle(window, title2);
    await injectBookmarkNodeAndReload(window, docId2, title2, {
      url: 'https://www.iana.org',
      title: 'Beta',
      description: '',
      imageUrl: '',
      faviconUrl: '',
    });
    const hostname2 = await window.locator('.bookmark-card .bookmark-url span').first().textContent();

    expect(hostname1?.trim()).toBe('example.com');
    expect(hostname2?.trim()).toBe('www.iana.org');
  });

  test('deleting bookmark node removes it from DB on next save', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Delete From DB');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card').first()).toBeVisible({ timeout: 15000 });
    await expect(window.locator('.bookmark-card').first()).toHaveClass(/selected/);

    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);
    await expect(window.locator('.bookmark-card').first()).not.toBeVisible();

    // Trigger save
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);

    await expect(async () => {
      const doc = await window.evaluate(
        (id: string) => (window as any).lychee.invoke('documents.get', { id }),
        docId,
      );
      expect(findNodeByType(JSON.parse(doc.document.content), 'bookmark')).toBeNull();
    }).toPass({ timeout: 5000 });
  });

  test('five sequential bookmarks — all 5 nodes in DB with correct fields', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Five Bookmarks DB Stress');
    const urls = [
      'https://example.com',
      'https://www.iana.org',
      'https://httpbin.org',
      'https://example.org',
      'https://www.example.net',
    ];

    for (let i = 0; i < urls.length; i++) {
      if (i === 0) {
        await window.locator('main:visible h1.editor-title').click();
        await window.keyboard.press('Enter');
      } else {
        await window.keyboard.press('Enter');
      }
      await window.waitForTimeout(200);
      await window.keyboard.type(urls[i], { delay: 10 });
      await window.keyboard.press('Space');
      await window.waitForTimeout(500);

      const link = window.locator('.ContentEditable__root a').first();
      await expect(link).toBeVisible({ timeout: 5000 });
      await link.hover();
      await window.waitForTimeout(400);
      await window.locator('button[title="Embed content"]').click();
      await expect(window.locator('.bookmark-card').nth(i)).toBeVisible({ timeout: 20000 });
    }

    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(2000);

    await expect(async () => {
      const doc = await window.evaluate(
        (id: string) => (window as any).lychee.invoke('documents.get', { id }),
        docId,
      );
      const nodes = findAllNodesByType(JSON.parse(doc.document.content), 'bookmark');
      expect(nodes).toHaveLength(5);
      for (const n of nodes) {
        expect(n.url).toBeTruthy();
        expect(n.version).toBe(1);
        expect(typeof n.title).toBe('string');
        expect(typeof n.description).toBe('string');
        expect(typeof n.imageUrl).toBe('string');
        expect(typeof n.faviconUrl).toBe('string');
      }
    }).toPass({ timeout: 10000 });
  });
});

// ── Embed Flow Persistence (Issue #162) ───────────────────────────────
// Verifies that the Notion-style synchronous insert + mount-driven hydration
// keeps the URL durable even if the note is closed mid-hydration, and that
// the persistence flags (autoResolve, hydrationAttempted) round-trip correctly.

test.describe('Bookmark Metadata — Embed Flow Persistence', () => {
  test('URL survives a close immediately after clicking Embed (issue #162)', async ({ window }) => {
    // Stall url.resolve for 10s so the IPC is GUARANTEED to still be in flight
    // when we close the tab. Without this, a fast happy-path resolve would
    // complete and (under the old placeholder flow) swap to a real bookmark
    // before the close ever fired — the test would pass on luck rather than
    // verifying the moment-zero-insert invariant. With the stall, the only
    // thing in editor state at close time is whatever clickEmbed inserted
    // synchronously. If that's a placeholder (old code) it gets stripped by
    // the save filter and the test fails; if it's a real bookmark (new code,
    // Notion-style sync insert) it persists.
    await mockIpcResolve(
      window,
      'url.resolve',
      {
        type: 'bookmark',
        url: 'https://example.com',
        title: 'should not arrive',
        description: '',
        imageUrl: '',
        faviconUrl: '',
      },
      10_000,
    );

    const docId = await createNoteWithTitle(window, 'Issue 162 Repro');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });

    // Click Embed — the bookmark node is inserted synchronously, before the
    // url.resolve IPC even starts.
    await clickEmbed(window);

    // Close the tab. With the 10s stall the IPC is still in flight; under the
    // old placeholder flow this would save a placeholder which the filter
    // would strip, losing the URL entirely.
    await window
      .locator('[data-tab-id]')
      .filter({ hasText: 'Issue 162 Repro' })
      .locator('[aria-label="Close tab"]')
      .click({ force: true });

    // Reopen via the sidebar — Lexical deserializes from DB.
    await window.locator(`[data-note-id="${docId}"]`).first().click();
    await window.waitForTimeout(400);

    // The bookmark card should be present, carrying the URL.
    const card = window.locator('.bookmark-card');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText('example.com');

    // Clean up the still-pending mock so it doesn't dangle across tests.
    // (Each test gets a fresh Electron app, so this is belt-and-suspenders.)
    await clearIpcMocks(window);
  });

  test('Embed sets autoResolve=true in saved JSON; Bookmark button does not', async ({ window }) => {
    // Embed-created bookmark
    const embedDocId = await createNoteWithTitle(window, 'Embed AutoResolve Flag');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('main:visible .bookmark-card')).toBeVisible({ timeout: 15000 });
    const embedNode = await getBookmarkNodeFromDb(window, embedDocId);
    expect(embedNode.autoResolve).toBe(true);

    // Bookmark-button-created bookmark
    const bookmarkDocId = await createNoteWithTitle(window, 'Bookmark No AutoResolve');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmarkBtn(window);
    await expect(window.locator('main:visible .bookmark-card')).toBeVisible({ timeout: 15000 });
    const bookmarkNode = await getBookmarkNodeFromDb(window, bookmarkDocId);
    // autoResolve should be absent (serialized as `|| undefined`, so dropped from JSON).
    expect(bookmarkNode.autoResolve).toBeUndefined();
  });

  test('hydrationAttempted=true persists after successful hydration', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Hydration Attempted Flag');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    // Wait for the HYDRATED title — the card appears immediately with the
    // hostname fallback ("example.com"), so /example/i matches before
    // hydration completes. Wait for the real fetched title to ensure
    // hydrationAttempted has actually flipped before we read the DB.
    const card = window.locator('.bookmark-card');
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('.bookmark-title')).toContainText('Example Domain', { timeout: 20000 });

    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node.hydrationAttempted).toBe(true);
  });

  // Verifies the retry-on-reopen pattern that the .catch fix enables.
  //
  // We inject the "post-transient-failure" state directly into the DB:
  // a bookmark with empty metadata and no hydrationAttempted flag (which is
  // exactly the state the fix leaves the node in when an IPC rejects). On
  // reopen the BookmarkComponent should re-fire url.fetchMetadata and
  // populate the card.
  test('Bookmark with no hydrationAttempted flag refetches metadata on mount', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Retry On Reopen');
    await injectBookmarkNodeAndReload(window, docId, 'Retry On Reopen', {
      url: 'https://example.com',
      title: '',
      description: '',
      imageUrl: '',
      faviconUrl: '',
      hydrationAttempted: false, // opt out — this test specifically exercises retry-on-mount
    });

    // On mount, the component should detect needsHydration and re-fire
    // url.fetchMetadata, eventually populating the card. Wait for the real
    // fetched title (not the hostname fallback) to know hydration completed.
    const card = window.locator('main:visible .bookmark-card');
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.bookmark-title')).toContainText('Example Domain', { timeout: 20000 });

    // The retry result is persisted with hydrationAttempted=true so we don't
    // refetch on the next reopen.
    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node.hydrationAttempted).toBe(true);
  });
});

// ── IPC mock-driven hydration tests ───────────────────────────────────
// These exercise the `.catch` and the `url.resolve` discriminator paths in
// BookmarkComponent's hydration effect by intercepting the IPC layer via the
// preload `__mocks` hook (gated behind E2E=1, see src/preload.ts).
//
// Coverage note: the rejection tests below assert that hydrationAttempted /
// loading remain in their initial state when the IPC rejects. They catch
// catch-handler regressions in isolation (e.g. `markAttempted()` re-added)
// because the OnChangePlugin filter is off, so any errant catch-side save
// would land in the DB and break the assertion. A simultaneous regression
// in both the catch AND the OnChangePlugin `ignoreHistoryMergeTagChange`
// setting would mask itself — but each piece is caught separately:
// `OnChangePlugin` regressions are caught by the refetch-on-reopen tests
// in the "Embed Flow Persistence" describe and by the image retry test
// in "Image Embed — Mock-driven hydration paths".

test.describe('Bookmark Metadata — Mock-driven hydration paths', () => {
  test.afterEach(async ({ window }) => {
    await clearIpcMocks(window);
  });

  test('url.fetchMetadata rejection leaves hydrationAttempted unset (retryable on reopen)', async ({ window }) => {
    await mockIpcReject(window, 'url.fetchMetadata', 'simulated network failure');

    const docId = await createNoteWithTitle(window, 'fetchMetadata Reject');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmarkBtn(window);

    // Card appears immediately (synchronous insert).
    await expect(window.locator('main:visible .bookmark-card')).toBeVisible({ timeout: 5000 });

    // Give the rejected promise + finally a chance to flush.
    await window.waitForTimeout(1000);

    const node = await getBookmarkNodeFromDb(window, docId);
    // Critical assertion: the catch path must NOT have marked attempted —
    // otherwise a user who created the bookmark offline would be permanently
    // stuck on a bare card even after coming back online.
    expect(node.hydrationAttempted).toBeUndefined();
    expect(node.title).toBe('');
  });

  test('url.resolve rejection leaves hydrationAttempted unset (retryable on reopen)', async ({ window }) => {
    await mockIpcReject(window, 'url.resolve', 'simulated network failure');

    const docId = await createNoteWithTitle(window, 'url.resolve Reject');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    // Embed (not Bookmark) goes through url.resolve via autoResolve.
    await clickEmbed(window);

    await expect(window.locator('main:visible .bookmark-card')).toBeVisible({ timeout: 5000 });
    await window.waitForTimeout(1000);

    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node.hydrationAttempted).toBeUndefined();
    expect(node.autoResolve).toBe(true); // still flagged for retry next mount
  });

  test('url.resolve returning "unsupported" marks hydrationAttempted=true (definitive answer)', async ({ window }) => {
    await mockIpcResolve(window, 'url.resolve', {
      type: 'unsupported',
      url: 'https://example.com/something',
      reason: 'simulated unsupported content type',
    });

    const docId = await createNoteWithTitle(window, 'url.resolve Unsupported');
    await typeUrlInBody(window, 'https://example.com/something');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    await expect(window.locator('main:visible .bookmark-card')).toBeVisible({ timeout: 5000 });
    await window.waitForTimeout(1000);

    const node = await getBookmarkNodeFromDb(window, docId);
    // The backend gave us a definitive answer about the resource type, so
    // the node should NOT retry on reopen.
    expect(node.hydrationAttempted).toBe(true);
    expect(node.title).toBe(''); // still bare — no metadata populated
  });

  test('url.resolve returning "image" swaps BookmarkNode for ImageNode', async ({ window }) => {
    // Simulates a Uploadcare-style extensionless image URL where the backend
    // probes content-type, downloads the bytes, and returns an image result.
    await mockIpcResolve(window, 'url.resolve', {
      type: 'image',
      id: 'mock-image-id',
      filePath: '/mock/path/foo.jpg',
      sourceUrl: 'https://cdn.example.com/extensionless-image',
    });

    const docId = await createNoteWithTitle(window, 'url.resolve Image Swap');
    await typeUrlInBody(window, 'https://cdn.example.com/extensionless-image');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    // First a bookmark card appears (sync insert), then it should swap to
    // an image container as url.resolve resolves with type: 'image'.
    const imageContainer = window.locator('main:visible .image-container');
    await expect(imageContainer).toBeVisible({ timeout: 5000 });

    // The bookmark card should be gone after the swap.
    await expect(window.locator('main:visible .bookmark-card')).toHaveCount(0);

    // Verify persisted JSON is now an image node, not a bookmark.
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);
    const doc = await window.evaluate(
      (id: string) => (window as unknown as { lychee: { invoke: (c: string, p: unknown) => Promise<{ document: { content: string } }> } }).lychee.invoke('documents.get', { id }),
      docId,
    );
    const parsed = JSON.parse(doc.document.content);
    const imageNode = findNodeByType(parsed, 'image');
    expect(imageNode).not.toBeNull();
    expect(imageNode.imageId).toBe('mock-image-id');
    const bookmarkNode = findNodeByType(parsed, 'bookmark');
    expect(bookmarkNode).toBeNull();
  });

  // ── Hydration gate ──
  // Verifies the hydrationAttempted=true short-circuit ISOLATED from the
  // needsHydration check. Critically, we inject EMPTY metadata fields — that
  // way `needsHydration` would be true if it were the only gate. If the
  // `hydrationAttempted` gate is removed, the effect would fire, the mock
  // would run, and title would change to "SHOULD NOT APPEAR". Asserting the
  // card stays in its hostname-fallback state proves the flag itself blocked.
  test('hydrationAttempted=true blocks the hydration effect even when needsHydration would otherwise fire', async ({ window }) => {
    await mockIpcResolve(window, 'url.fetchMetadata', {
      title: 'SHOULD NOT APPEAR',
      description: 'effect should not fire',
      imageUrl: '',
      faviconUrl: '',
      url: 'https://example.com',
    });

    const docId = await createNoteWithTitle(window, 'Hydration Gate');
    // Inject empty metadata + hydrationAttempted=true. Empty metadata means
    // needsHydration would normally return true (all four fields are ""), so
    // ONLY the hydrationAttempted gate keeps the effect from firing.
    const content = JSON.stringify({
      root: {
        children: [
          { children: [], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 },
          {
            type: 'bookmark',
            url: 'https://example.com',
            title: '',
            description: '',
            imageUrl: '',
            faviconUrl: '',
            hydrationAttempted: true,
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    });
    await window.evaluate(
      ({ id, c }: { id: string; c: string }) =>
        (window as unknown as { lychee: { invoke: (ch: string, p: unknown) => Promise<unknown> } }).lychee.invoke('documents.update', { id, content: c }),
      { id: docId, c: content },
    );
    await window.evaluate(() => (window as unknown as { __documentStore: { getState: () => { loadDocuments: (force: boolean) => void } } }).__documentStore.getState().loadDocuments(true));
    await window.waitForTimeout(200);
    await window
      .locator('[data-tab-id]')
      .filter({ hasText: 'Hydration Gate' })
      .locator('[aria-label="Close tab"]')
      .click({ force: true });
    await window.waitForTimeout(300);
    await window.locator(`[data-note-id="${docId}"]`).first().click();
    await window.waitForTimeout(1500); // give the (suppressed) effect a chance to misfire

    // Card should still show the hostname fallback ("example.com"), not the
    // mock's "SHOULD NOT APPEAR". The displayTitle fallback (`title ||
    // getHostname(url)`) means empty title → hostname.
    const card = window.locator('main:visible .bookmark-card');
    await expect(card.locator('.bookmark-title')).toHaveText('example.com');
    await expect(card.locator('.bookmark-title')).not.toContainText('SHOULD NOT APPEAR');

    // Belt-and-suspenders: the persisted JSON should also show empty title —
    // proving setMetadata was never called.
    const node = await getBookmarkNodeFromDb(window, docId);
    expect(node.title).toBe('');
    expect(node.hydrationAttempted).toBe(true);
  });

  // ── Cleanup safety ──
  // Verifies that deleting a bookmark while its hydration IPC is still in
  // flight doesn't crash and doesn't leak the result back onto a dead node.
  // The mock is delayed so the delete reliably races ahead of resolution.
  test('Deleting a bookmark mid-hydration is safe (no crash, no ghost state)', async ({ window }) => {
    await mockIpcResolve(
      window,
      'url.fetchMetadata',
      {
        title: 'Should be discarded',
        description: 'node is gone before this arrives',
        imageUrl: '',
        faviconUrl: '',
        url: 'https://example.com',
      },
      2000, // delay so we have time to delete first
    );

    const docId = await createNoteWithTitle(window, 'Delete Mid Hydration');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmarkBtn(window);

    const card = window.locator('main:visible .bookmark-card');
    await expect(card).toBeVisible({ timeout: 3000 });

    // Select and delete the bookmark before the mocked metadata resolves.
    await card.click();
    await window.keyboard.press('Backspace');
    await expect(window.locator('main:visible .bookmark-card')).toHaveCount(0, { timeout: 3000 });

    // Wait past the mock's resolution time — the in-flight promise will
    // settle into an editor.update where $isBookmarkNode(null) is false, so
    // the setMetadata call is skipped. Should not crash.
    await window.waitForTimeout(2500);

    // Trigger a save and verify there's no bookmark node in the persisted JSON.
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);
    const doc = await window.evaluate(
      (id: string) => (window as unknown as { lychee: { invoke: (c: string, p: unknown) => Promise<{ document: { content: string } }> } }).lychee.invoke('documents.get', { id }),
      docId,
    );
    const bookmarkNode = findNodeByType(JSON.parse(doc.document.content), 'bookmark');
    expect(bookmarkNode).toBeNull();
  });
});

// ── Image hydration mock tests ────────────────────────────────────────
// Parallel set for images.download — verifies the catch path leaves loading=true
// (retryable), the success path swaps to a local copy, and reopen with a
// loading-state image re-fires the download.

test.describe('Image Embed — Mock-driven hydration paths', () => {
  test.afterEach(async ({ window }) => {
    await clearIpcMocks(window);
  });

  test('images.download rejection leaves loading=true (retryable on reopen)', async ({ window }) => {
    await mockIpcReject(window, 'images.download', 'simulated download failure');

    // Title must avoid dot-containing strings (e.g. "images.download") because
    // the autolink plugin would turn them into <a> elements in the H1, and
    // clickEmbed's `.first()` link locator would grab those instead of the
    // body URL we actually want to embed.
    const docId = await createNoteWithTitle(window, 'Image Download Reject');
    await typeUrlInBody(window, 'https://example.com/photo.png');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    // Image container appears immediately (sync insert, rendering remote URL).
    await expect(window.locator('main:visible .image-container')).toBeVisible({ timeout: 5000 });
    await window.waitForTimeout(1000);

    // Persisted state should still be "loading from remote" — no markDownloadFailed.
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);
    const doc = await window.evaluate(
      (id: string) => (window as unknown as { lychee: { invoke: (c: string, p: unknown) => Promise<{ document: { content: string } }> } }).lychee.invoke('documents.get', { id }),
      docId,
    );
    const imageNode = findNodeByType(JSON.parse(doc.document.content), 'image');
    expect(imageNode).not.toBeNull();
    // Critical assertion: loading must remain true so the next mount retries.
    expect(imageNode.loading).toBe(true);
    expect(imageNode.imageId).toBe('');
    expect(imageNode.sourceUrl).toBe('https://example.com/photo.png');
  });

  test('images.download success swaps src from remote URL to local file', async ({ window }) => {
    await mockIpcResolve(window, 'images.download', {
      id: 'mock-img-abc',
      filePath: '/mock/storage/abc.png',
    });

    const docId = await createNoteWithTitle(window, 'Image Download Success');
    await typeUrlInBody(window, 'https://example.com/photo.png');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    await expect(window.locator('main:visible .image-container')).toBeVisible({ timeout: 5000 });
    await window.waitForTimeout(1500);

    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);
    const doc = await window.evaluate(
      (id: string) => (window as unknown as { lychee: { invoke: (c: string, p: unknown) => Promise<{ document: { content: string } }> } }).lychee.invoke('documents.get', { id }),
      docId,
    );
    const imageNode = findNodeByType(JSON.parse(doc.document.content), 'image');
    expect(imageNode).not.toBeNull();
    expect(imageNode.imageId).toBe('mock-img-abc');
    // loading should now be false (omitted from JSON via `|| undefined`).
    expect(imageNode.loading).toBeUndefined();
  });

  test('Embed in a doc with duplicate tabs: card and hydration are shared (single editor)', async ({ window }) => {
    // Lychee shares a single Lexical editor per docId across duplicate tabs
    // (see e2e/duplicate-tabs.spec.ts). To prove SHARED editor — not just
    // "each tab independently happens to hydrate the same way" — we use a
    // slow mock and inspect both tabs BEFORE hydration completes. If editors
    // were per-tab, only the active tab would have the bookmark when the
    // other is inspected. With shared editor, the insert appears in both.
    await mockIpcResolve(
      window,
      'url.fetchMetadata',
      {
        title: 'Shared Embed Title',
        description: 'visible in both tabs',
        imageUrl: '',
        faviconUrl: '',
        url: 'https://example.com',
      },
      3000, // delay so we can catch the pre-hydration state in tab 2
    );

    const docId = await createNoteWithTitle(window, 'Dup Tabs Embed');

    // Open a second tab for the same doc BEFORE clicking Bookmark.
    const secondTabId = await window.evaluate((id: string) => {
      const store = (window as unknown as { __documentStore: { getState: () => { openTab: (d: string) => void; openTabs: { tabId: string; docId: string }[] } } }).__documentStore;
      const before = new Set(store.getState().openTabs.map((t) => t.tabId));
      store.getState().openTab(id);
      const after = store.getState().openTabs;
      return after.find((t) => !before.has(t.tabId) && t.docId === id)?.tabId as string;
    }, docId);
    await window.waitForTimeout(200);

    // Insert the bookmark in the currently-active (duplicate) tab. The mock's
    // 3s delay keeps the hydration in-flight; the card should appear in the
    // hostname-fallback state.
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('main:visible .ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmarkBtn(window);

    await expect(window.locator('main:visible .bookmark-card')).toBeVisible({ timeout: 3000 });

    // CRITICAL: switch to the OTHER tab while hydration is still in flight.
    // If editors are per-tab, the other tab's editor wouldn't have seen the
    // insert at all — no card would be present.
    const firstTabId = await window.evaluate((dupId: string) => {
      const store = (window as unknown as { __documentStore: { getState: () => { openTabs: { tabId: string; docId: string }[] } } }).__documentStore;
      const tabs = store.getState().openTabs;
      return tabs.find((t) => t.tabId !== dupId)?.tabId as string;
    }, secondTabId);
    await window.evaluate(
      (id: string) => (window as unknown as { __documentStore: { getState: () => { selectDocument: (i: string) => void } } }).__documentStore.getState().selectDocument(id),
      firstTabId,
    );
    await window.waitForTimeout(300);

    // Tab 1 must already show the bookmark card (shared editor confirmed).
    const cardInTab1 = window.locator('main:visible .bookmark-card');
    await expect(cardInTab1).toBeVisible({ timeout: 2000 });

    // Wait for hydration to complete. Both tabs see the same hydrated title
    // via the shared underlying node — flip between them to verify.
    await expect(cardInTab1.locator('.bookmark-title')).toContainText('Shared Embed Title', { timeout: 10000 });
    await window.evaluate(
      (id: string) => (window as unknown as { __documentStore: { getState: () => { selectDocument: (i: string) => void } } }).__documentStore.getState().selectDocument(id),
      secondTabId,
    );
    await window.waitForTimeout(300);
    const cardInTab2 = window.locator('main:visible .bookmark-card');
    await expect(cardInTab2.locator('.bookmark-title')).toContainText('Shared Embed Title');
  });

  test('Image with loading=true on reopen re-fires images.download', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Image Retry On Reopen');

    // Inject an image node in post-failed-download state: loading=true,
    // imageId="", sourceUrl set. This mirrors what a tab closed mid-download
    // (or a previous catch with our retry-friendly semantics) would persist.
    const content = JSON.stringify({
      root: {
        children: [
          { children: [], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 },
          {
            type: 'image',
            imageId: '',
            altText: '',
            sourceUrl: 'https://example.com/photo.png',
            loading: true,
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    });
    await window.evaluate(
      ({ id, c }: { id: string; c: string }) =>
        (window as unknown as { lychee: { invoke: (ch: string, p: unknown) => Promise<unknown> } }).lychee.invoke('documents.update', { id, content: c }),
      { id: docId, c: content },
    );
    await window.evaluate(() => (window as unknown as { __documentStore: { getState: () => { loadDocuments: (force: boolean) => void } } }).__documentStore.getState().loadDocuments(true));
    await window.waitForTimeout(200);
    await window
      .locator('[data-tab-id]')
      .filter({ hasText: 'Image Retry On Reopen' })
      .locator('[aria-label="Close tab"]')
      .click({ force: true });
    await window.waitForTimeout(300);

    // Mock the retry to succeed, then reopen.
    await mockIpcResolve(window, 'images.download', {
      id: 'mock-img-retry',
      filePath: '/mock/storage/retry.png',
    });
    await window.locator(`[data-note-id="${docId}"]`).first().click();
    await window.waitForTimeout(1500);

    // After remount, the hydration effect should have fired and the node
    // should now reference the local file.
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);
    const doc = await window.evaluate(
      (id: string) => (window as unknown as { lychee: { invoke: (c: string, p: unknown) => Promise<{ document: { content: string } }> } }).lychee.invoke('documents.get', { id }),
      docId,
    );
    const imageNode = findNodeByType(JSON.parse(doc.document.content), 'image');
    expect(imageNode).not.toBeNull();
    expect(imageNode.imageId).toBe('mock-img-retry');
    expect(imageNode.loading).toBeUndefined();
  });
});
