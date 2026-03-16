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

// ── Helpers ──────────────────────────────────────────────────────────

async function createNoteWithTitle(window: Page, title: string): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.type(title);
  await window.waitForTimeout(700);
  return window.evaluate(() =>
    (window as any).__documentStore.getState().selectedId as string,
  );
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

// ── Loading Placeholders ──────────────────────────────────────────────
// UI-driven: tests the async creation flow specifically.

test.describe('Bookmark Metadata — Loading Placeholders', () => {
  test('"Creating bookmark…" placeholder appears during Bookmark button fetch', async ({ window }) => {
    await createNoteWithTitle(window, 'Loading Placeholder Bookmark');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });

    const link = window.locator('.ContentEditable__root a').first();
    await link.hover();
    await window.waitForTimeout(400);
    await expect(window.locator('button[title="Convert to bookmark"]')).toBeVisible({ timeout: 3000 });
    await window.locator('button[title="Convert to bookmark"]').click();

    // Either the placeholder is briefly visible or has already resolved
    const placeholder = window.locator('.loading-placeholder-node');
    const card = window.locator('.bookmark-card');
    await expect(placeholder.or(card)).toBeVisible({ timeout: 10000 });
    await expect(card).toBeVisible({ timeout: 20000 });
  });

  test('"Embedding…" placeholder appears during Embed fetch on HTML URL', async ({ window }) => {
    await createNoteWithTitle(window, 'Loading Placeholder Embed');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });

    const link = window.locator('.ContentEditable__root a').first();
    await link.hover();
    await window.waitForTimeout(400);
    await expect(window.locator('button[title="Embed content"]')).toBeVisible({ timeout: 3000 });
    await window.locator('button[title="Embed content"]').click();

    const placeholder = window.locator('.loading-placeholder-node');
    const card = window.locator('.bookmark-card');
    await expect(placeholder.or(card)).toBeVisible({ timeout: 10000 });
    await expect(card).toBeVisible({ timeout: 20000 });
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
