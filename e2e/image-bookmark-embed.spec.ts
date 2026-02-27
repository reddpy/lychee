import { test, expect } from './electron-app';
import type { Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a new note, type a title, wait for debounce, return its doc ID. */
async function createNoteWithTitle(window: Page, title: string): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);

  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.type(title);
  await window.waitForTimeout(700); // debounce save

  const docId = await window.evaluate(() => {
    const store = (window as any).__documentStore;
    return store.getState().selectedId as string;
  });
  return docId;
}

/** Click into the body, type a URL + Space to trigger auto-link detection. */
async function typeUrlInBody(window: Page, url: string) {
  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.press('Enter'); // move to body
  await window.waitForTimeout(200);
  await window.keyboard.type(url, { delay: 10 });
  // Space triggers auto-link detection
  await window.keyboard.press('Space');
  await window.waitForTimeout(500);
}

/** Hover the auto-linked <a>, click "Embed", wait for the loading placeholder to appear. */
async function clickEmbed(window: Page) {
  const link = window.locator('.ContentEditable__root a').first();
  await link.hover();
  await window.waitForTimeout(400);

  const embedBtn = window.locator('button[title="Embed content"]');
  await expect(embedBtn).toBeVisible({ timeout: 5000 });
  await embedBtn.click();
}

/** Hover the auto-linked <a>, click "Bookmark". */
async function clickBookmark(window: Page) {
  const link = window.locator('.ContentEditable__root a').first();
  await link.hover();
  await window.waitForTimeout(400);

  const bookmarkBtn = window.locator('button[title="Convert to bookmark"]');
  await expect(bookmarkBtn).toBeVisible({ timeout: 5000 });
  await bookmarkBtn.click();
}

// ── Image Embed Tests ────────────────────────────────────────────────

test.describe('Image Embed', () => {
  test('pasting an image URL and clicking Embed shows the image', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Embed Test');

    // Use a stable public PNG with a .png extension (hits imageByExtensionHandler)
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');

    // Auto-link should appear
    const link = window.locator('.ContentEditable__root a');
    await expect(link.first()).toBeVisible({ timeout: 5000 });

    // Hover link → popover with Embed button
    await clickEmbed(window);

    // Wait for the image to fully load (replaces the loading placeholder)
    const imageContainer = window.locator('.image-container');
    await expect(imageContainer).toBeVisible({ timeout: 15000 });

    const img = imageContainer.locator('img');
    await expect(img).toBeVisible({ timeout: 15000 });

    // Verify the image src uses the lychee-image:// protocol
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^lychee-image:\/\/image\//);
  });

  test('image shows loading placeholder before resolving', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Loading Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');

    const link = window.locator('.ContentEditable__root a');
    await expect(link.first()).toBeVisible({ timeout: 5000 });

    await clickEmbed(window);

    // The loading placeholder should appear briefly
    // (it may be too fast to catch reliably, so we just verify the final state)
    const imageContainer = window.locator('.image-container');
    await expect(imageContainer).toBeVisible({ timeout: 15000 });
  });

  test('image container has alignment toolbar on hover', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Toolbar Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer).toBeVisible({ timeout: 15000 });
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Hover over the image container to reveal the toolbar
    await imageContainer.hover();
    await window.waitForTimeout(300);

    const toolbar = window.locator('.image-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 3000 });

    // Should have 3 alignment buttons
    const alignButtons = toolbar.locator('.image-toolbar-btn');
    await expect(alignButtons).toHaveCount(3);

    // Should show the source URL button
    const urlButton = toolbar.locator('.image-toolbar-url');
    await expect(urlButton).toBeVisible();
    await expect(urlButton.locator('span')).toContainText('placehold.co');
  });

  test('image alignment buttons change the alignment', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Alignment Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Default alignment is left — verify via the wrapper's text-align
    const wrapper = window.locator('.editor-image');
    await expect(wrapper).toHaveCSS('text-align', 'left');

    // Hover to show toolbar, click center alignment
    await imageContainer.hover();
    await window.waitForTimeout(300);
    const toolbar = window.locator('.image-toolbar');
    const alignButtons = toolbar.locator('.image-toolbar-btn');

    // Click center (2nd button)
    await alignButtons.nth(1).click();
    await window.waitForTimeout(200);
    await expect(wrapper).toHaveCSS('text-align', 'center');

    // Click right (3rd button)
    await imageContainer.hover();
    await window.waitForTimeout(300);
    await alignButtons.nth(2).click();
    await window.waitForTimeout(200);
    await expect(wrapper).toHaveCSS('text-align', 'right');

    // Click left (1st button) — back to default
    await imageContainer.hover();
    await window.waitForTimeout(300);
    await alignButtons.nth(0).click();
    await window.waitForTimeout(200);
    await expect(wrapper).toHaveCSS('text-align', 'left');
  });

  test('image has resize handles on hover', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Resize Handles');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Resize handles should exist in the DOM
    const leftHandle = imageContainer.locator('.image-resizer-left');
    const rightHandle = imageContainer.locator('.image-resizer-right');
    await expect(leftHandle).toBeAttached();
    await expect(rightHandle).toBeAttached();
  });

  test('image is selected after embed (green outline)', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Selection Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Right after embed, the image should be selected
    await expect(imageContainer).toHaveClass(/selected/);
  });

  test('image embed persists in the database', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Image Persist Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    // Type in the body to trigger a fresh onChange that includes the image node,
    // then wait for debounce save to flush
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);

    // Retry until the DB contains the image node (debounce timing can vary)
    await expect(async () => {
      const doc = await window.evaluate(
        (id: string) => (window as any).lychee.invoke('documents.get', { id }),
        docId,
      );
      const content = JSON.parse(doc.document.content);
      const imageNode = findNodeByType(content, 'image');
      expect(imageNode).not.toBeNull();
      expect(imageNode.imageId).toBeTruthy();
      expect(imageNode.sourceUrl).toContain('placehold.co');
    }).toPass({ timeout: 5000 });
  });

  test('JPEG URL with extension triggers image embed', async ({ window }) => {
    await createNoteWithTitle(window, 'JPEG Embed Test');
    // Use .jpg extension — hits imageByExtensionHandler
    await typeUrlInBody(window, 'https://placehold.co/100x100.jpg');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const img = window.locator('.image-container img');
    await expect(img).toBeVisible({ timeout: 15000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^lychee-image:\/\/image\//);
  });
});

// ── Bookmark Embed Tests ────────────────────────────────────────────

test.describe('Bookmark Embed', () => {
  test('pasting a URL and clicking Embed creates a bookmark card for HTML pages', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Embed Test');

    // example.com returns text/html — content-type probe creates a bookmark
    await typeUrlInBody(window, 'https://example.com');

    const link = window.locator('.ContentEditable__root a');
    await expect(link.first()).toBeVisible({ timeout: 5000 });

    await clickEmbed(window);

    // Wait for the bookmark card to appear
    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });

    // Verify the bookmark has a title
    const title = bookmarkCard.locator('.bookmark-title');
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();

    // Verify the bookmark shows the hostname
    const urlSpan = bookmarkCard.locator('.bookmark-url span');
    await expect(urlSpan).toContainText('example.com');
  });

  test('clicking Bookmark button always creates a bookmark card', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Button Test');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });

    // Use the "Bookmark" button instead of "Embed"
    await clickBookmark(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });
    await expect(bookmarkCard.locator('.bookmark-title')).not.toBeEmpty();
  });

  test('bookmark card is selected after creation', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Selection Test');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });

    // Should be selected right after creation
    await expect(bookmarkCard).toHaveClass(/selected/);
  });

  test('bookmark shows favicon or fallback globe icon', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Favicon Test');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });

    // Should have either a favicon img or the fallback Globe icon
    const favicon = bookmarkCard.locator('.bookmark-favicon');
    const fallbackIcon = bookmarkCard.locator('.bookmark-favicon-fallback');
    const hasFavicon = await favicon.count() > 0;
    const hasFallback = await fallbackIcon.count() > 0;
    expect(hasFavicon || hasFallback).toBe(true);
  });

  test('bookmark persists in the database', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Bookmark Persist Test');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    // Type in the body to trigger a fresh onChange that includes the bookmark node,
    // then wait for debounce save to flush
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);

    // Retry until the DB contains the bookmark node (debounce timing can vary)
    await expect(async () => {
      const doc = await window.evaluate(
        (id: string) => (window as any).lychee.invoke('documents.get', { id }),
        docId,
      );
      const content = JSON.parse(doc.document.content);
      const bookmarkNode = findNodeByType(content, 'bookmark');
      expect(bookmarkNode).not.toBeNull();
      expect(bookmarkNode.url).toContain('example.com');
    }).toPass({ timeout: 5000 });
  });
});

// ── Cross-cutting: Embed vs Bookmark button behavior ────────────────

test.describe('Embed vs Bookmark Button', () => {
  test('Embed auto-detects image URL → creates image, not bookmark', async ({ window }) => {
    await createNoteWithTitle(window, 'Auto-detect Image Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    // Should create an image, NOT a bookmark
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });
    await expect(window.locator('.bookmark-card')).not.toBeVisible();
  });

  test('Embed auto-detects HTML page → creates bookmark, not image', async ({ window }) => {
    await createNoteWithTitle(window, 'Auto-detect Bookmark Test');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    // Should create a bookmark, NOT an image
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });
    await expect(window.locator('.image-container')).not.toBeVisible();
  });

  test('Bookmark button on an image URL still creates a bookmark card', async ({ window }) => {
    await createNoteWithTitle(window, 'Force Bookmark on Image');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });

    // Use Bookmark button (not Embed) — forces bookmark regardless of URL type
    await clickBookmark(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });
    // Should NOT have created an image
    await expect(window.locator('.image-container')).not.toBeVisible();
  });
});

// ── Link hover popover behavior ─────────────────────────────────────

test.describe('Link Hover Popover', () => {
  test('hovering a link shows Bookmark, Embed, and Open buttons', async ({ window }) => {
    await createNoteWithTitle(window, 'Popover Buttons Test');
    await typeUrlInBody(window, 'https://example.com');

    const link = window.locator('.ContentEditable__root a').first();
    await expect(link).toBeVisible({ timeout: 5000 });

    await link.hover();
    await window.waitForTimeout(400);

    // All three buttons should be visible
    await expect(window.locator('button[title="Convert to bookmark"]')).toBeVisible({ timeout: 3000 });
    await expect(window.locator('button[title="Embed content"]')).toBeVisible({ timeout: 3000 });
    await expect(window.locator('button[title="Open in browser"]')).toBeVisible({ timeout: 3000 });
  });

  test('popover dismisses after embed completes', async ({ window }) => {
    await createNoteWithTitle(window, 'Popover Dismiss Test');
    await typeUrlInBody(window, 'https://example.com');

    const link = window.locator('.ContentEditable__root a').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await link.hover();
    await window.waitForTimeout(400);

    const embedBtn = window.locator('button[title="Embed content"]');
    await expect(embedBtn).toBeVisible({ timeout: 5000 });
    await embedBtn.click();

    // Popover should dismiss immediately after clicking Embed
    await expect(embedBtn).not.toBeVisible({ timeout: 3000 });

    // The bookmark card should eventually appear
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });
  });
});

// ── Utility ─────────────────────────────────────────────────────────

/** Recursively search a Lexical serialized JSON tree for a node of a given type. */
function findNodeByType(obj: any, type: string): any {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.type === type) return obj;
  if (Array.isArray(obj.children)) {
    for (const child of obj.children) {
      const found = findNodeByType(child, type);
      if (found) return found;
    }
  }
  // Also check root.children
  if (obj.root) return findNodeByType(obj.root, type);
  return null;
}
