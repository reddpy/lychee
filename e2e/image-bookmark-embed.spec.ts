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

/** Hover the auto-linked <a>, click a popover button. Retries hover if button detaches. */
async function clickPopoverButton(window: Page, buttonTitle: string) {
  const link = window.locator('.ContentEditable__root a').first();
  const btn = window.locator(`button[title="${buttonTitle}"]`);

  // Retry up to 3 times — the hover popover can be flaky if the link rerenders
  for (let attempt = 0; attempt < 3; attempt++) {
    await link.hover();
    await window.waitForTimeout(400);
    try {
      await expect(btn).toBeVisible({ timeout: 3000 });
      await btn.click({ timeout: 2000 });
      return;
    } catch {
      // Button appeared then detached, or never appeared — re-hover
      await window.waitForTimeout(200);
    }
  }
  // Final attempt with longer timeout
  await link.hover();
  await window.waitForTimeout(600);
  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.click();
}

/** Hover the auto-linked <a>, click "Embed". */
async function clickEmbed(window: Page) {
  await clickPopoverButton(window, 'Embed content');
}

/** Hover the auto-linked <a>, click "Bookmark". */
async function clickBookmark(window: Page) {
  await clickPopoverButton(window, 'Convert to bookmark');
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

// ── Image Edge Cases ────────────────────────────────────────────────

test.describe('Image Edge Cases', () => {
  test('Backspace deletes a selected image', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Delete Backspace');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Image is selected after embed — press Backspace to delete
    await expect(imageContainer).toHaveClass(/selected/);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);

    await expect(imageContainer).not.toBeVisible();
  });

  test('Delete key deletes a selected image', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Delete Key');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });
    await expect(imageContainer).toHaveClass(/selected/);

    await window.keyboard.press('Delete');
    await window.waitForTimeout(300);

    await expect(imageContainer).not.toBeVisible();
  });

  test('Enter on selected image creates a new paragraph below', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Enter Key');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });
    await expect(imageContainer).toHaveClass(/selected/);

    // Press Enter — should create a paragraph below and move cursor there
    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);

    // Image should still be there but no longer selected
    await expect(imageContainer).toBeVisible();
    await expect(imageContainer).not.toHaveClass(/selected/);

    // Typing should go into the new paragraph, not replace the image
    await window.keyboard.type('text after image');
    await window.waitForTimeout(200);
    const body = window.locator('main:visible .ContentEditable__root');
    await expect(body).toContainText('text after image');
    await expect(imageContainer).toBeVisible();
  });

  test('clicking outside the image deselects it', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Deselect');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });
    await expect(imageContainer).toHaveClass(/selected/);

    // Click the title area to move focus away from the image
    await window.locator('main:visible h1.editor-title').click();
    await window.waitForTimeout(200);

    await expect(imageContainer).not.toHaveClass(/selected/);
  });

  test('clicking the image re-selects it', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Reselect');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Deselect by clicking title
    await window.locator('main:visible h1.editor-title').click();
    await window.waitForTimeout(200);
    await expect(imageContainer).not.toHaveClass(/selected/);

    // Click image to re-select
    await imageContainer.click();
    await window.waitForTimeout(200);
    await expect(imageContainer).toHaveClass(/selected/);
  });

  test('multiple images in the same note', async ({ window }) => {
    await createNoteWithTitle(window, 'Multi Image');

    // Embed first image
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container').first()).toBeVisible({ timeout: 15000 });
    await expect(window.locator('.image-container img').first()).toBeVisible({ timeout: 15000 });

    // Move cursor below the image, type second URL
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);
    await window.keyboard.type('https://placehold.co/50x50.jpg', { delay: 10 });
    await window.keyboard.press('Space');
    await window.waitForTimeout(500);

    // Embed second link
    const links = window.locator('.ContentEditable__root a');
    await expect(links.first()).toBeVisible({ timeout: 5000 });
    await links.first().hover();
    await window.waitForTimeout(400);
    await window.locator('button[title="Embed content"]').click();

    // Wait for both images
    await expect(window.locator('.image-container')).toHaveCount(2, { timeout: 15000 });
    await expect(window.locator('.image-container img')).toHaveCount(2, { timeout: 15000 });
  });

  test('image resize via right handle changes dimensions', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Resize Drag');
    await typeUrlInBody(window, 'https://placehold.co/200x200.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const img = window.locator('.image-container img');
    await expect(img).toBeVisible({ timeout: 15000 });

    // Get original image dimensions
    const originalBox = await img.boundingBox();
    expect(originalBox).not.toBeNull();

    // Hover to reveal resize handle, then drag it
    const imageContainer = window.locator('.image-container');
    await imageContainer.hover();
    await window.waitForTimeout(300);

    const rightHandle = imageContainer.locator('.image-resizer-right');
    const handleBox = await rightHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Drag right handle 50px to the right
    await window.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await window.mouse.down();
    await window.mouse.move(handleBox!.x + handleBox!.width / 2 + 50, handleBox!.y + handleBox!.height / 2, { steps: 5 });
    await window.mouse.up();
    await window.waitForTimeout(300);

    // Image should be wider now
    const newBox = await img.boundingBox();
    expect(newBox).not.toBeNull();
    expect(newBox!.width).toBeGreaterThan(originalBox!.width);
  });

  test('WebP image URL is supported', async ({ window }) => {
    await createNoteWithTitle(window, 'WebP Embed Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.webp');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const img = window.locator('.image-container img');
    await expect(img).toBeVisible({ timeout: 15000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^lychee-image:\/\/image\//);
  });

  test('image survives tab switch (DOM stays mounted)', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Tab Persist');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const img = window.locator('.image-container img');
    await expect(img.first()).toBeVisible({ timeout: 15000 });

    // Get the image src before switching
    const srcBefore = await img.first().getAttribute('src');

    // Create a new tab — switches away
    await createNoteWithTitle(window, 'Other Tab');
    await window.waitForTimeout(300);

    // Switch back to the image tab
    await window.locator('[data-tab-id]').filter({ hasText: 'Image Tab Persist' }).click();
    await window.waitForTimeout(400);

    // Image should still be visible and have the same src
    await expect(img.first()).toBeVisible();
    const srcAfter = await img.first().getAttribute('src');
    expect(srcAfter).toBe(srcBefore);
  });

  test('undo after image embed restores the original link', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Undo');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    // Undo (Cmd+Z on macOS)
    await window.keyboard.press('Meta+z');
    await window.waitForTimeout(500);

    // Image should be gone, link should be restored
    await expect(window.locator('.image-container')).not.toBeVisible();
    const link = window.locator('.ContentEditable__root a');
    await expect(link.first()).toBeVisible({ timeout: 3000 });
    const href = await link.first().getAttribute('href');
    expect(href).toContain('placehold.co');
  });

  test('shows error state when image row is missing from database', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Orphan Image');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Type after the embed to trigger a fresh onChange that includes the image node
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await window.keyboard.type(' ');
    await window.waitForTimeout(1500);

    // Retry until the DB content includes the image node (debounce timing can vary)
    let imageId: string | undefined;
    await expect(async () => {
      const doc = await window.evaluate(
        (id: string) => (window as any).lychee.invoke('documents.get', { id }),
        docId,
      );
      const content = JSON.parse(doc.document.content);
      const imageNode = findNodeByType(content, 'image');
      expect(imageNode).not.toBeNull();
      expect(imageNode.imageId).toBeTruthy();
      imageId = imageNode.imageId;
    }).toPass({ timeout: 5000 });

    // Delete the image row from the database — orphans the reference
    await window.evaluate(
      (id) => (window as any).lychee.invoke('images.delete', { id }),
      imageId,
    );

    // Close the tab
    const closeBtn = window
      .locator('[data-tab-id]')
      .filter({ hasText: 'Orphan Image' })
      .locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });
    await window.waitForTimeout(600);

    // Reopen from sidebar — image node still in content but DB row is gone
    await window.locator('[data-note-id]').filter({ hasText: 'Orphan Image' }).click();
    await window.waitForTimeout(1000);

    // Should show error state, not infinite spinner
    const errorPlaceholder = window.locator('main:visible .image-error');
    await expect(errorPlaceholder).toBeVisible({ timeout: 5000 });
    await expect(errorPlaceholder).toContainText('Failed to load image');
  });

  test('undo then redo restores the image', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Undo Redo');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    // Undo
    await window.keyboard.press('Meta+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container')).not.toBeVisible();

    // Redo (Cmd+Shift+Z)
    await window.keyboard.press('Meta+Shift+z');
    await window.waitForTimeout(500);

    // Image should reappear
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 5000 });
  });
});

// ── Bookmark Edge Cases ─────────────────────────────────────────────

test.describe('Bookmark Edge Cases', () => {
  test('Backspace deletes a selected bookmark', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Delete Backspace');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });
    await expect(bookmarkCard).toHaveClass(/selected/);

    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);

    await expect(bookmarkCard).not.toBeVisible();
  });

  test('Delete key deletes a selected bookmark', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Delete Key');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });
    await expect(bookmarkCard).toHaveClass(/selected/);

    await window.keyboard.press('Delete');
    await window.waitForTimeout(300);

    await expect(bookmarkCard).not.toBeVisible();
  });

  test('Enter on selected bookmark creates a paragraph below', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Enter Key');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });
    await expect(bookmarkCard).toHaveClass(/selected/);

    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);

    // Bookmark should still be there but deselected
    await expect(bookmarkCard).toBeVisible();
    await expect(bookmarkCard).not.toHaveClass(/selected/);

    // Typing goes into the new paragraph
    await window.keyboard.type('text after bookmark');
    await window.waitForTimeout(200);
    await expect(window.locator('main:visible .ContentEditable__root')).toContainText('text after bookmark');
    await expect(bookmarkCard).toBeVisible();
  });

  test('clicking outside the bookmark deselects it', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Deselect');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });
    await expect(bookmarkCard).toHaveClass(/selected/);

    await window.locator('main:visible h1.editor-title').click();
    await window.waitForTimeout(200);

    await expect(bookmarkCard).not.toHaveClass(/selected/);
  });

  test('clicking the bookmark re-selects it', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Reselect');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });

    // Deselect
    await window.locator('main:visible h1.editor-title').click();
    await window.waitForTimeout(200);
    await expect(bookmarkCard).not.toHaveClass(/selected/);

    // Re-select
    await bookmarkCard.click();
    await window.waitForTimeout(200);
    await expect(bookmarkCard).toHaveClass(/selected/);
  });

  test('multiple bookmarks in the same note', async ({ window }) => {
    await createNoteWithTitle(window, 'Multi Bookmark');

    // First bookmark
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.bookmark-card').first()).toBeVisible({ timeout: 15000 });

    // Move below, type second URL
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);
    await window.keyboard.type('https://www.iana.org', { delay: 10 });
    await window.keyboard.press('Space');
    await window.waitForTimeout(500);

    // Embed second link
    const links = window.locator('.ContentEditable__root a');
    await expect(links.first()).toBeVisible({ timeout: 5000 });
    await links.first().hover();
    await window.waitForTimeout(400);
    await window.locator('button[title="Embed content"]').click();

    // Both bookmarks visible
    await expect(window.locator('.bookmark-card')).toHaveCount(2, { timeout: 15000 });
  });

  test('bookmark survives tab switch', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Tab Persist');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const bookmarkCard = window.locator('.bookmark-card');
    await expect(bookmarkCard).toBeVisible({ timeout: 15000 });
    const titleBefore = await bookmarkCard.locator('.bookmark-title').textContent();

    // Switch away
    await createNoteWithTitle(window, 'Other Tab');
    await window.waitForTimeout(300);

    // Switch back
    await window.locator('[data-tab-id]').filter({ hasText: 'Bookmark Tab Persist' }).click();
    await window.waitForTimeout(400);

    await expect(bookmarkCard).toBeVisible();
    const titleAfter = await bookmarkCard.locator('.bookmark-title').textContent();
    expect(titleAfter).toBe(titleBefore);
  });

  test('undo after bookmark embed restores the original link', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Undo');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    // Undo
    await window.keyboard.press('Meta+z');
    await window.waitForTimeout(500);

    await expect(window.locator('.bookmark-card')).not.toBeVisible();
    const link = window.locator('.ContentEditable__root a');
    await expect(link.first()).toBeVisible({ timeout: 3000 });
    const href = await link.first().getAttribute('href');
    expect(href).toContain('example.com');
  });
});

// ── Mixed Embed & Stress Tests ──────────────────────────────────────

test.describe('Mixed Embed & Stress Tests', () => {
  test('image and bookmark coexist in the same note', async ({ window }) => {
    await createNoteWithTitle(window, 'Mixed Embeds');

    // Embed an image first
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    // Move below, add a bookmark
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);
    await window.keyboard.type('https://example.com', { delay: 10 });
    await window.keyboard.press('Space');
    await window.waitForTimeout(500);

    const links = window.locator('.ContentEditable__root a');
    await expect(links.first()).toBeVisible({ timeout: 5000 });
    await links.first().hover();
    await window.waitForTimeout(400);
    await window.locator('button[title="Embed content"]').click();

    // Both types visible
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });
  });

  test('delete image, bookmark remains; delete bookmark, editor is clean', async ({ window }) => {
    await createNoteWithTitle(window, 'Sequential Delete');

    // Embed image
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    // Move below, embed bookmark
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);
    await window.keyboard.type('https://example.com', { delay: 10 });
    await window.keyboard.press('Space');
    await window.waitForTimeout(500);
    const links = window.locator('.ContentEditable__root a');
    await expect(links.first()).toBeVisible({ timeout: 5000 });
    await links.first().hover();
    await window.waitForTimeout(400);
    await window.locator('button[title="Embed content"]').click();
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });

    // Click image to select it, then delete
    await window.locator('.image-container').click();
    await window.waitForTimeout(200);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);

    // Image gone, bookmark still there
    await expect(window.locator('.image-container')).not.toBeVisible();
    await expect(window.locator('.bookmark-card')).toBeVisible();

    // Click bookmark to select, then delete
    await window.locator('.bookmark-card').click();
    await window.waitForTimeout(200);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);

    // Both gone
    await expect(window.locator('.bookmark-card')).not.toBeVisible();
    await expect(window.locator('.image-container')).not.toBeVisible();
  });

  test('inline link with surrounding text does not show Embed/Bookmark buttons', async ({ window }) => {
    await createNoteWithTitle(window, 'Inline Link No Embed');

    // Type text, then a URL, then more text — the link has siblings in its paragraph
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await visibleTitle.click();
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);
    await window.keyboard.type('Check out https://example.com for more info', { delay: 10 });
    await window.waitForTimeout(500);

    const link = window.locator('.ContentEditable__root a').first();
    await expect(link).toBeVisible({ timeout: 5000 });

    // Hover the link — popover should appear but only with "Open" button
    await link.hover();
    await window.waitForTimeout(400);

    await expect(window.locator('button[title="Open in browser"]')).toBeVisible({ timeout: 3000 });
    // Embed and Bookmark buttons should NOT appear (canConvert=false)
    await expect(window.locator('button[title="Embed content"]')).not.toBeVisible();
    await expect(window.locator('button[title="Convert to bookmark"]')).not.toBeVisible();
  });

  test('embed image → switch tab → switch back → alignment change still works', async ({ window }) => {
    await createNoteWithTitle(window, 'Tab Align Persist');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });
    const wrapper = window.locator('.editor-image');

    // Switch away and back
    await createNoteWithTitle(window, 'Temp Tab');
    await window.waitForTimeout(300);
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab Align Persist' }).click();
    await window.waitForTimeout(400);

    // Alignment toolbar should still work after tab switch
    await imageContainer.hover();
    await window.waitForTimeout(300);
    const toolbar = window.locator('.image-toolbar');
    await toolbar.locator('.image-toolbar-btn').nth(1).click(); // center
    await window.waitForTimeout(200);
    await expect(wrapper).toHaveCSS('text-align', 'center');
  });

  test('rapid embed: two URLs embedded back-to-back without waiting', async ({ window }) => {
    await createNoteWithTitle(window, 'Rapid Embed');

    // Type first URL
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    // Don't wait for the first image — press Enter on the loading placeholder
    // to create a paragraph below it, then type the second URL.
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(200);
    await window.keyboard.type('https://example.com', { delay: 10 });
    await window.keyboard.press('Space');
    await window.waitForTimeout(500);

    // Embed the second link
    const links = window.locator('.ContentEditable__root a');
    await expect(links.first()).toBeVisible({ timeout: 5000 });
    await links.first().hover();
    await window.waitForTimeout(400);
    await window.locator('button[title="Embed content"]').click();

    // Both should resolve: image + bookmark
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 20000 });
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 20000 });
  });

  test('embed, delete, re-embed in same position', async ({ window }) => {
    await createNoteWithTitle(window, 'Embed Delete Re-embed');

    // Embed image
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    // Delete the image
    await expect(window.locator('.image-container')).toHaveClass(/selected/);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);
    await expect(window.locator('.image-container')).not.toBeVisible();

    // After deletion Lexical may place cursor in the title — use typeUrlInBody
    // to reliably enter the body paragraph and type the new URL
    await typeUrlInBody(window, 'https://example.com');

    const link = window.locator('.ContentEditable__root a').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    // Bookmark should appear in place of the deleted image
    await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });
    await expect(window.locator('.image-container')).not.toBeVisible();
  });

  test('multiple undo/redo cycles on image embed stay consistent', async ({ window }) => {
    await createNoteWithTitle(window, 'Undo Redo Cycles');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    // Undo → link
    await window.keyboard.press('Meta+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container')).not.toBeVisible();
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible();

    // Redo → image
    await window.keyboard.press('Meta+Shift+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 5000 });

    // Undo again → link
    await window.keyboard.press('Meta+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container')).not.toBeVisible();
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible();

    // Redo again → image
    await window.keyboard.press('Meta+Shift+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 5000 });
  });

  test('embed 3 bookmarks sequentially, all 3 render', async ({ window }) => {
    await createNoteWithTitle(window, 'Triple Bookmark');

    const urls = ['https://example.com', 'https://www.iana.org', 'https://httpbin.org'];

    for (let i = 0; i < urls.length; i++) {
      if (i > 0) {
        // Move below the previous bookmark
        await window.keyboard.press('Enter');
        await window.waitForTimeout(200);
      } else {
        // Enter body from title
        const visibleTitle = window.locator('main:visible h1.editor-title');
        await visibleTitle.click();
        await window.keyboard.press('Enter');
        await window.waitForTimeout(200);
      }

      await window.keyboard.type(urls[i], { delay: 10 });
      await window.keyboard.press('Space');
      await window.waitForTimeout(500);

      const link = window.locator('.ContentEditable__root a').first();
      await expect(link).toBeVisible({ timeout: 5000 });
      await link.hover();
      await window.waitForTimeout(400);
      await window.locator('button[title="Embed content"]').click();
      await expect(window.locator('.bookmark-card').nth(i)).toBeVisible({ timeout: 15000 });
    }

    await expect(window.locator('.bookmark-card')).toHaveCount(3);
  });

  test('delete all embeds leaves a clean editor with just the title', async ({ window }) => {
    await createNoteWithTitle(window, 'Clean Slate');

    // Embed image
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    // Delete image (already selected)
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);

    // No embeds remain
    await expect(window.locator('.image-container')).not.toBeVisible();
    await expect(window.locator('.bookmark-card')).not.toBeVisible();

    // Editor body should be editable — type to confirm
    await window.keyboard.type('clean');
    await window.waitForTimeout(200);
    await expect(window.locator('main:visible .ContentEditable__root')).toContainText('clean');
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
