import { test, expect } from './electron-app';
import type { Page, Locator } from '@playwright/test';

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
    const s = store.getState();
    return s.openTabs.find((t: any) => t.tabId === s.selectedId)?.docId ?? null;
  });
  return docId;
}

/** Click into the body, type a URL + Space to trigger auto-link detection. */
async function typeUrlInBody(window: Page, url: string) {
  // Click directly into the first body paragraph. Going via the title and
  // pressing Enter is unsafe — Playwright's click lands on the middle of the
  // h1, and Enter mid-title splits the title (matches Notion behavior).
  await window.locator('main:visible .ContentEditable__root > p').first().click();
  await window.waitForTimeout(200);
  await window.keyboard.type(url, { delay: 10 });
  // Space triggers auto-link detection
  await window.keyboard.press('Space');
  // Leave a trailing empty paragraph after the URL so downstream tests can
  // ArrowDown past an embedded card without disturbing it.
  await window.keyboard.press('Enter');
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

  test('image container appears immediately and resolves to a local copy', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Loading Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');

    const link = window.locator('.ContentEditable__root a');
    await expect(link.first()).toBeVisible({ timeout: 5000 });

    await clickEmbed(window);

    // The image-container is inserted synchronously, so it should appear
    // almost immediately — the remote URL renders while the local download
    // finishes in the background.
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
      const imageNode = findNodeByType(content, 'reference');
      expect(imageNode).not.toBeNull();
      expect(imageNode.imageId).toBeTruthy();
      expect(imageNode.url).toContain('placehold.co');
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

  test('copying a converted image URL embeds the downloaded bytes', async ({ window, electronApp }) => {
    await createNoteWithTitle(window, 'URL Image Copy Test');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const editorRoot = window.locator('main:visible .ContentEditable__root');
    await expect(editorRoot.locator('.image-container img')).toBeVisible({ timeout: 15000 });
    await editorRoot.click();
    await window.keyboard.press('ControlOrMeta+a');
    await window.keyboard.press('ControlOrMeta+c');

    const clipboardHtml = await electronApp.evaluate(({ clipboard }) =>
      clipboard.readHTML(),
    );
    expect(clipboardHtml).toContain('src="data:image/png;base64,');
    expect(clipboardHtml).not.toContain('lychee-image://');
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
      const bookmarkNode = findNodeByType(content, 'reference');
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

    const bookmarkBtn = window.locator('button[title="Convert to bookmark"]');
    const embedBtn = window.locator('button[title="Embed content"]');
    const openBtn = window.locator('button[title="Open in browser"]');

    // Retry hover up to 3 times — the popover can be flaky if the link rerenders
    for (let attempt = 0; attempt < 3; attempt++) {
      await link.hover();
      await window.waitForTimeout(400);
      try {
        await expect(bookmarkBtn).toBeVisible({ timeout: 3000 });
        await expect(embedBtn).toBeVisible({ timeout: 1000 });
        await expect(openBtn).toBeVisible({ timeout: 1000 });
        return;
      } catch {
        if (attempt === 2) throw new Error('popover buttons never appeared after 3 hover attempts');
        await window.waitForTimeout(200);
      }
    }
  });

  test('popover dismisses after embed completes', async ({ window }) => {
    await createNoteWithTitle(window, 'Popover Dismiss Test');
    await typeUrlInBody(window, 'https://example.com');

    const link = window.locator('.ContentEditable__root a').first();
    await expect(link).toBeVisible({ timeout: 5000 });

    await clickEmbed(window);

    // Popover should dismiss immediately after clicking Embed
    const embedBtn = window.locator('button[title="Embed content"]');
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

  test('multiple images in the same note', async ({ window, electronApp }) => {
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

    // Select-all copy exports every local image, preserving each MIME type.
    const editorRoot = window.locator('main:visible .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press('ControlOrMeta+a');
    await window.keyboard.press('ControlOrMeta+c');
    const clipboardHtml = await electronApp.evaluate(({ clipboard }) =>
      clipboard.readHTML(),
    );
    expect(clipboardHtml.match(/src="data:image\//g)).toHaveLength(2);
    expect(clipboardHtml).toContain('src="data:image/png;base64,');
    expect(clipboardHtml).toContain('src="data:image/jpeg;base64,');
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
    await window.keyboard.press('ControlOrMeta+z');
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
      const imageNode = findNodeByType(content, 'reference');
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
    await window.keyboard.press('ControlOrMeta+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container')).not.toBeVisible();

    // Redo (Cmd+Shift+Z)
    await window.keyboard.press('ControlOrMeta+Shift+z');
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

    // Wait for hydration to complete before capturing the baseline — under
    // the Notion-style flow the card appears synchronously with a hostname
    // fallback ("example.com"), then morphs to the fetched title once
    // url.fetchMetadata returns ("Example Domain"). Capturing before that
    // settles makes titleBefore !== titleAfter spuriously.
    await expect(bookmarkCard.locator('.bookmark-title')).toContainText('Example Domain', { timeout: 15000 });
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
    await window.keyboard.press('ControlOrMeta+z');
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
    await window.keyboard.press('ControlOrMeta+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container')).not.toBeVisible();
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible();

    // Redo → image
    await window.keyboard.press('ControlOrMeta+Shift+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 5000 });

    // Undo again → link
    await window.keyboard.press('ControlOrMeta+z');
    await window.waitForTimeout(500);
    await expect(window.locator('.image-container')).not.toBeVisible();
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible();

    // Redo again → image
    await window.keyboard.press('ControlOrMeta+Shift+z');
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

// ── Reference → Link conversion ──────────────────────────────────────
// The canonical URL must always be recoverable as a plain inline link —
// converting an embed back to a link is lossless.

test.describe('Reference → Link conversion', () => {
  function convertedLink(window: Page) {
    return window.locator('.ContentEditable__root a').first();
  }

  function linkButton(window: Page) {
    return window
      .getByRole('toolbar', { name: 'Text formatting' })
      .getByRole('button', { name: 'Link' });
  }

  /** Paste a URL → convert to bookmark → convert back to a link. */
  async function convertBookmarkBackToLink(
    window: Page,
    title: string,
    url = 'https://example.com',
  ) {
    await createNoteWithTitle(window, title);
    await typeUrlInBody(window, url);
    await expect(convertedLink(window)).toBeVisible({ timeout: 5000 });
    await clickBookmark(window);

    const card = window.locator('.bookmark-card');
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.hover();
    await window.waitForTimeout(300);
    await card.locator('button[aria-label="Convert to link"]').click();

    const link = convertedLink(window);
    await expect(link).toBeVisible({ timeout: 5000 });
    return link;
  }

  async function dragAcross(window: Page, locator: Locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('missing element bounds');
    await window.mouse.move(box.x + 1, box.y + box.height / 2);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
    await window.mouse.up();
    await window.waitForTimeout(200);
  }

  test('converting an embedded image back to a link preserves the URL', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Image To Link');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Hover to reveal the toolbar, then click "Convert to link".
    await imageContainer.hover();
    await window.waitForTimeout(300);
    await window.locator('.image-toolbar .image-toolbar-convert').click();

    // The image is gone; a plain link carrying the canonical URL remains.
    await expect(window.locator('.image-container')).toHaveCount(0);
    const link = window.locator('.ContentEditable__root a').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await expect(link).toHaveAttribute('href', /placehold\.co\/100x100\.png/);

    // Persisted node is a plain link, not a reference.
    const content = await saveAndReadContent(window, docId);
    expect(findNodeByType(content, 'reference')).toBeNull();
    const linkNode = findNodeByType(content, 'link');
    expect(linkNode).not.toBeNull();
    expect(linkNode.url).toContain('placehold.co/100x100.png');
  });

  test('converting a bookmark card back to a link preserves the URL', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Card To Link');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmark(window);

    const card = window.locator('.bookmark-card');
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.hover();
    await window.waitForTimeout(300);
    await card.locator('button[aria-label="Convert to link"]').click();

    await expect(window.locator('.bookmark-card')).toHaveCount(0);
    const link = window.locator('.ContentEditable__root a').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await expect(link).toHaveAttribute('href', /example\.com/);

    const content = await saveAndReadContent(window, docId);
    expect(findNodeByType(content, 'reference')).toBeNull();
    const linkNode = findNodeByType(content, 'link');
    expect(linkNode).not.toBeNull();
    expect(linkNode.url).toContain('example.com');
  });

  test('a bookmark converted back to a link shows the raw URL as its text', async ({ window }) => {
    const link = await convertBookmarkBackToLink(window, 'Converted Raw URL');
    await expect(link).toHaveText('https://example.com');
    await expect(link).toHaveAttribute('href', 'https://example.com');
  });

  test('double-clicking a converted link marks the Link toolbar button active', async ({ window }) => {
    const link = await convertBookmarkBackToLink(window, 'Converted Link Double Click');
    await link.dblclick();
    await expect(linkButton(window)).toHaveClass(/bg-primary/);
  });

  test('drag-selecting a converted link marks the Link toolbar button active', async ({ window }) => {
    const link = await convertBookmarkBackToLink(window, 'Converted Link Drag');
    await dragAcross(window, link);
    await expect(linkButton(window)).toHaveClass(/bg-primary/);
  });

  test('triple-clicking a converted link marks the Link toolbar button active', async ({ window }) => {
    // Regression: a whole-line selection anchors on the paragraph, not the link.
    const link = await convertBookmarkBackToLink(window, 'Converted Link Triple Click');
    await link.click({ clickCount: 3 });
    await expect(linkButton(window)).toHaveClass(/bg-primary/);
  });

  test('opening the link editor for a converted link pre-fills the URL', async ({ window }) => {
    const link = await convertBookmarkBackToLink(window, 'Converted Link Editor');
    await link.dblclick();
    await expect(linkButton(window)).toHaveClass(/bg-primary/);

    await linkButton(window).click();
    await expect(
      window.locator('input[aria-label="Search notes or enter URL"]'),
    ).toHaveValue('https://example.com');
  });

  test('a pasted image with no source URL does not offer Convert to link', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Pasted Image No URL');
    await window.locator('main:visible .ContentEditable__root > p').first().click();
    await window.waitForTimeout(200);

    // Synthesize an image-file paste so the test is isolated from the shared OS
    // clipboard (parallel workers would otherwise race on it).
    const PNG_B64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await window.evaluate(async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'pasted.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      const target =
        (document.activeElement as HTMLElement | null) ??
        document.querySelector<HTMLElement>('.ContentEditable__root');
      if (!target) throw new Error('no paste target focused');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      target.dispatchEvent(event);
    }, PNG_B64);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Toolbar still has the 3 alignment buttons, but no Convert to link —
    // there is no canonical URL to revert to.
    await imageContainer.hover();
    await window.waitForTimeout(300);
    await expect(window.locator('.image-toolbar')).toBeVisible();
    await expect(window.locator('.image-toolbar .image-toolbar-btn')).toHaveCount(3);
    await expect(window.locator('.image-toolbar .image-toolbar-convert')).toHaveCount(0);
    await expect(window.locator('.image-toolbar .image-toolbar-copy')).toHaveCount(0);

    // Persisted reference has an empty canonical URL.
    const content = await saveAndReadContent(window, docId);
    const node = findNodeByType(content, 'reference');
    expect(node).not.toBeNull();
    expect(node.displayMode).toBe('image');
    expect(node.url).toBe('');
  });

  test('copy link writes the canonical URL to the clipboard', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Copy Link');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Spy on the clipboard (does not touch the shared OS clipboard).
    await window.evaluate(() => {
      ;(window as any).__copied = [] as string[];
      const clipboard = {
        writeText: (text: string) => {
          ;(window as any).__copied.push(text);
          return Promise.resolve();
        },
        readText: () => Promise.resolve(''),
      };
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        get: () => clipboard,
      });
    });

    await imageContainer.hover();
    await window.waitForTimeout(300);
    await window.locator('.image-toolbar .image-toolbar-copy').click();

    await expect
      .poll(() => window.evaluate(() => (window as any).__copied))
      .toContain('https://placehold.co/100x100.png');
  });
});

// ── Reference context menu ───────────────────────────────────────────

test.describe('Reference context menu', () => {
  async function installClipboardSpy(window: Page) {
    await window.evaluate(() => {
      ;(window as any).__copied = [] as string[];
      const clipboard = {
        writeText: (text: string) => {
          ;(window as any).__copied.push(text);
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

  async function pasteSyntheticImage(window: Page) {
    const PNG_B64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await window.evaluate(async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'pasted.png', { type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(file);
      const target =
        (document.activeElement as HTMLElement | null) ??
        document.querySelector<HTMLElement>('.ContentEditable__root');
      if (!target) throw new Error('no paste target focused');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      target.dispatchEvent(event);
    }, PNG_B64);
  }

  function menu(window: Page) {
    return window.locator('[data-slot="context-menu-content"]');
  }

  function textParagraph(window: Page) {
    return window
      .locator('main:visible .ContentEditable__root p')
      .filter({ hasText: 'select this text' })
      .first();
  }

  async function expectFormattingToolbar(window: Page, visible: boolean) {
    const toolbar = window.getByRole('toolbar', { name: 'Text formatting' });
    if (visible) await expect(toolbar).toBeVisible({ timeout: 5000 });
    else await expect(toolbar).not.toBeVisible();
  }

  /** Note with a "select this text" paragraph followed by an embedded reference. */
  async function createNoteWithTextAndEmbed(
    window: Page,
    title: string,
    kind: 'image' | 'card',
  ) {
    await createNoteWithTitle(window, title);
    await window.locator('main:visible .ContentEditable__root > p').first().click();
    await window.waitForTimeout(200);
    await window.keyboard.type('select this text');
    await window.keyboard.press('Enter');
    await window.keyboard.type(
      kind === 'image' ? 'https://placehold.co/100x100.png' : 'https://example.com',
      { delay: 10 },
    );
    await window.keyboard.press('Space');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });

    if (kind === 'image') {
      await clickEmbed(window);
      await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });
    } else {
      await clickBookmark(window);
      await expect(window.locator('.bookmark-card')).toBeVisible({ timeout: 15000 });
    }
  }

  /** Note with a "select this text" paragraph followed by a locally-pasted image. */
  async function createNoteWithTextAndPastedImage(window: Page, title: string) {
    await createNoteWithTitle(window, title);
    await window.locator('main:visible .ContentEditable__root > p').first().click();
    await window.waitForTimeout(200);
    await window.keyboard.type('select this text');
    await window.keyboard.press('Enter');
    await pasteSyntheticImage(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });
  }

  test('right-clicking an embedded image offers labeled link and image actions', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Context Menu');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    await imageContainer.click({ button: 'right' });
    await expect(menu(window)).toBeVisible();
    for (const label of ['Open', 'Copy link', 'Copy image', 'Save image as…', 'Convert to link', 'Remove']) {
      await expect(menu(window).getByRole('menuitem', { name: label })).toBeVisible();
    }
    // Two dividers: after the Open group and before Convert to link / Remove.
    await expect(
      menu(window).locator(':scope > [data-slot="context-menu-separator"]'),
    ).toHaveCount(2);
  });

  test('context menu Copy link writes the canonical URL', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Menu Copy Link');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    await installClipboardSpy(window);
    await window.locator('.image-container').click({ button: 'right' });
    await menu(window).getByRole('menuitem', { name: 'Copy link' }).click();

    await expect
      .poll(() => window.evaluate(() => (window as any).__copied))
      .toContain('https://placehold.co/100x100.png');
  });

  test('context menu Convert to link restores a plain link', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Menu Convert');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    await window.locator('.image-container').click({ button: 'right' });
    await menu(window).getByRole('menuitem', { name: 'Convert to link' }).click();

    await expect(window.locator('.image-container')).toHaveCount(0);
    await expect(window.locator('.ContentEditable__root a').first()).toHaveAttribute(
      'href',
      /placehold\.co\/100x100\.png/,
    );
  });

  test('context menu Remove deletes the reference', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Menu Remove');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);
    await expect(window.locator('.image-container img')).toBeVisible({ timeout: 15000 });

    await window.locator('.image-container').click({ button: 'right' });
    await menu(window).getByRole('menuitem', { name: 'Remove' }).click();

    await expect(window.locator('.image-container')).toHaveCount(0);
  });

  test('a pasted image without a URL hides the link actions', async ({ window }) => {
    await createNoteWithTitle(window, 'Pasted Image Menu');
    await window.locator('main:visible .ContentEditable__root > p').first().click();
    await window.waitForTimeout(200);
    await pasteSyntheticImage(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    await imageContainer.click({ button: 'right' });
    await expect(menu(window)).toBeVisible();
    await expect(menu(window).getByRole('menuitem', { name: 'Copy image' })).toBeVisible();
    await expect(menu(window).getByRole('menuitem', { name: 'Save image as…' })).toBeVisible();
    await expect(menu(window).getByRole('menuitem', { name: 'Open' })).toHaveCount(0);
    await expect(menu(window).getByRole('menuitem', { name: 'Copy link' })).toHaveCount(0);
    await expect(menu(window).getByRole('menuitem', { name: 'Convert to link' })).toHaveCount(0);

    // No orphan leading separator: the menu opens on an item, and has exactly
    // one divider (between the image actions and Remove).
    await expect(
      menu(window).locator(':scope > [data-slot="context-menu-item"]').first(),
    ).toContainText('Copy image');
    await expect(
      menu(window).locator(':scope > [data-slot="context-menu-separator"]'),
    ).toHaveCount(1);
  });

  test('right-clicking a bookmark card offers its link actions', async ({ window }) => {
    await createNoteWithTitle(window, 'Card Context Menu');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmark(window);

    const card = window.locator('.bookmark-card');
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.click({ button: 'right' });
    await expect(menu(window)).toBeVisible();
    await expect(menu(window).getByRole('menuitem', { name: 'Open' })).toBeVisible();
    await expect(menu(window).getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    await expect(menu(window).getByRole('menuitem', { name: 'Convert to link' })).toBeVisible();
    await expect(menu(window).getByRole('menuitem', { name: 'Remove' })).toBeVisible();
    await expect(menu(window).getByRole('menuitem', { name: 'Copy image' })).toHaveCount(0);
    await expect(
      menu(window).locator(':scope > [data-slot="context-menu-separator"]'),
    ).toHaveCount(2);
  });

  test('the formatting toolbar still appears after right-clicking an image', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Menu Toolbar');

    // Body: a text paragraph, then an image URL we embed below it.
    await window.locator('main:visible .ContentEditable__root > p').first().click();
    await window.waitForTimeout(200);
    await window.keyboard.type('select this text');
    await window.keyboard.press('Enter');
    await window.keyboard.type('https://placehold.co/100x100.png', { delay: 10 });
    await window.keyboard.press('Space');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });

    // Open and dismiss the reference context menu.
    await imageContainer.click({ button: 'right' });
    await expect(menu(window)).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(menu(window)).not.toBeVisible();

    // Selecting text must reveal the floating formatting toolbar again.
    const paragraph = window
      .locator('main:visible .ContentEditable__root p')
      .filter({ hasText: 'select this text' })
      .first();
    await paragraph.dblclick();
    await expect(window.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible({
      timeout: 5000,
    });
  });

  test('closing the menu by clicking away re-enables the formatting toolbar', async ({ window }) => {
    await createNoteWithTextAndEmbed(window, 'Menu Click Away', 'image');
    await window.locator('.image-container').click({ button: 'right' });
    await expect(menu(window)).toBeVisible();

    // Plain click outside the menu (on the text) closes the renderer menu.
    // Raw mouse click: the modal menu overlays the page, so a locator click
    // would fail the "intercepts pointer events" actionability check.
    const box = await textParagraph(window).boundingBox();
    if (!box) throw new Error('missing text paragraph bounds');
    await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(menu(window)).not.toBeVisible();

    await textParagraph(window).dblclick();
    await expectFormattingToolbar(window, true);
  });

  test('closing the menu through an action re-enables the formatting toolbar', async ({ window }) => {
    await createNoteWithTextAndEmbed(window, 'Menu Action Close', 'image');
    await window.locator('.image-container').click({ button: 'right' });
    await menu(window).getByRole('menuitem', { name: 'Copy image' }).click();
    await expect(menu(window)).not.toBeVisible();

    await textParagraph(window).dblclick();
    await expectFormattingToolbar(window, true);
  });

  test('the formatting toolbar survives repeated menu open/close cycles', async ({ window }) => {
    await createNoteWithTextAndEmbed(window, 'Menu Repeat Cycles', 'image');
    const image = window.locator('.image-container');
    for (let i = 0; i < 2; i++) {
      await image.click({ button: 'right' });
      await expect(menu(window)).toBeVisible();
      await window.keyboard.press('Escape');
      await expect(menu(window)).not.toBeVisible();
    }

    await textParagraph(window).dblclick();
    await expectFormattingToolbar(window, true);
  });

  test('closing a card menu does not suppress the formatting toolbar', async ({ window }) => {
    await createNoteWithTextAndEmbed(window, 'Card Menu Toolbar', 'card');
    await window.locator('.bookmark-card').click({ button: 'right' });
    await expect(menu(window)).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(menu(window)).not.toBeVisible();

    await textParagraph(window).dblclick();
    await expectFormattingToolbar(window, true);
  });

  test('a pasted image menu does not suppress the formatting toolbar', async ({ window }) => {
    await createNoteWithTextAndPastedImage(window, 'Pasted Menu Toolbar');
    await window.locator('.image-container').click({ button: 'right' });
    await expect(menu(window)).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(menu(window)).not.toBeVisible();

    await textParagraph(window).dblclick();
    await expectFormattingToolbar(window, true);
  });

  test('closing the menu with no selection keeps the toolbar hidden and the reference', async ({ window }) => {
    await createNoteWithTextAndEmbed(window, 'Menu No Selection', 'image');
    await window.locator('.image-container').click({ button: 'right' });
    await expect(menu(window)).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(menu(window)).not.toBeVisible();

    await expect(window.locator('.image-container')).toHaveCount(1);
    await expectFormattingToolbar(window, false);
  });

  test('closing the menu restores the toolbar when text was already selected', async ({ window }) => {
    await createNoteWithTextAndEmbed(window, 'Menu Restore Selection', 'image');
    await textParagraph(window).dblclick();
    await expectFormattingToolbar(window, true);

    await window.locator('.image-container').click({ button: 'right' });
    await expect(menu(window)).toBeVisible();
    await expectFormattingToolbar(window, false);

    await window.keyboard.press('Escape');
    await expectFormattingToolbar(window, true);
  });
});

// ── Reference hover tooltips ─────────────────────────────────────────

test.describe('Reference hover tooltips', () => {
  function tooltip(window: Page, label: string) {
    return window.getByRole('tooltip').filter({ hasText: label });
  }

  test('image toolbar options show tooltips on hover', async ({ window }) => {
    await createNoteWithTitle(window, 'Image Toolbar Tooltips');
    await typeUrlInBody(window, 'https://placehold.co/100x100.png');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickEmbed(window);

    const imageContainer = window.locator('.image-container');
    await expect(imageContainer.locator('img')).toBeVisible({ timeout: 15000 });
    await imageContainer.hover();
    await window.waitForTimeout(300);

    const toolbar = window.locator('.image-toolbar');
    await expect(toolbar).toBeVisible();

    await toolbar.locator('.image-toolbar-btn').nth(1).hover();
    await expect(tooltip(window, 'Align center')).toBeVisible({ timeout: 3000 });

    await toolbar.locator('.image-toolbar-url').hover();
    await expect(tooltip(window, 'Open in browser')).toBeVisible({ timeout: 3000 });

    await toolbar.locator('.image-toolbar-copy').hover();
    await expect(tooltip(window, 'Copy link')).toBeVisible({ timeout: 3000 });

    await toolbar.locator('.image-toolbar-convert').hover();
    await expect(tooltip(window, 'Convert to link')).toBeVisible({ timeout: 3000 });
  });

  test('bookmark card actions show tooltips on hover', async ({ window }) => {
    await createNoteWithTitle(window, 'Card Action Tooltips');
    await typeUrlInBody(window, 'https://example.com');
    await expect(window.locator('.ContentEditable__root a').first()).toBeVisible({ timeout: 5000 });
    await clickBookmark(window);

    const card = window.locator('.bookmark-card');
    await expect(card).toBeVisible({ timeout: 15000 });

    await card.locator('button[aria-label="Copy link"]').hover();
    await expect(tooltip(window, 'Copy link')).toBeVisible({ timeout: 3000 });

    await card.locator('button[aria-label="Convert to link"]').hover();
    await expect(tooltip(window, 'Convert to link')).toBeVisible({ timeout: 3000 });
  });
});

// ── Utility ─────────────────────────────────────────────────────────

/** Nudge a debounce save, then return the parsed persisted editor JSON. */
async function saveAndReadContent(window: Page, docId: string): Promise<any> {
  await window.keyboard.press('ArrowDown');
  await window.keyboard.press('Enter');
  await window.keyboard.type(' ');
  await window.waitForTimeout(1500);
  const doc = await window.evaluate(
    (id: string) => (window as any).lychee.invoke('documents.get', { id }),
    docId,
  );
  return JSON.parse(doc.document.content);
}

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
