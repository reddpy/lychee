import type { Locator, Page } from '@playwright/test';

import { expect, test } from './electron-app';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const LINK_INPUT_NAME = 'Search notes or enter URL';

type CreatedNote = {
  docId: string;
  tabId: string;
};

type TabSnapshot = {
  selectedId: string | null;
  selectedDocId: string | null;
  openTabs: Array<{ tabId: string; docId: string }>;
};

function activeTitle(window: Page) {
  return window.locator('main:visible h1.editor-title');
}

function activeEditor(window: Page) {
  return window.locator('main:visible .ContentEditable__root');
}

function linkInput(window: Page) {
  return window.getByRole('combobox', { name: LINK_INPUT_NAME });
}

function linkPopover(window: Page) {
  const input = linkInput(window);
  return window.locator('[data-slot="popover-content"]').filter({ has: input });
}

async function createNote(window: Page, title: string, body = ''): Promise<CreatedNote> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(300);
  await activeTitle(window).click();
  await window.keyboard.type(title);
  await window.keyboard.press('Enter');
  if (body) await window.keyboard.type(body);
  await window.waitForTimeout(750);

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
    const state = store.getState();
    for (const tab of state.openTabs.filter((entry: any) => entry.docId === id)) {
      store.getState().closeTab(tab.tabId);
    }
  }, docId);
  await window.waitForTimeout(100);
}

async function openLinkPopup(window: Page) {
  await window.keyboard.press(`${mod}+k`);
  const input = linkInput(window);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  return input;
}

async function chooseInternalTarget(window: Page, target: CreatedNote, query: string) {
  const input = linkInput(window);
  await input.fill(query);
  const result = window.locator(`[data-note-link-id="${target.docId}"]`);
  await expect(result).toBeVisible();
  await result.click();
}

async function createInternalLink(
  window: Page,
  target: CreatedNote,
  label: string,
  query: string,
) {
  await window.keyboard.press('Shift+Home');
  await openLinkPopup(window);
  await chooseInternalTarget(window, target, query);
  const link = activeEditor(window).locator(
    `a[href="https://note.lychee.invalid/${target.docId}"]`,
  );
  await expect(link).toHaveText(label);
  return link;
}

async function createWebLink(window: Page, title: string, label: string, url: string) {
  await createNote(window, title, label);
  await window.keyboard.press('Shift+Home');
  const input = await openLinkPopup(window);
  await input.fill(url);
  await linkPopover(window).getByRole('button', { name: 'Apply' }).click();
  const normalizedUrl = url.startsWith('http://') || url.startsWith('https://')
    ? url
    : `https://${url}`;
  const link = activeEditor(window).locator(`a[href="${normalizedUrl}"]`);
  await expect(link).toHaveText(label);
  return link;
}

async function hoverLinkPopover(window: Page, link: Locator) {
  await link.hover();
  const popover = window.locator('[data-link-hover-popover]');
  await expect(popover).toBeVisible();
  return popover;
}

async function hoverNoteCard(window: Page, link: Locator) {
  await hoverLinkPopover(window, link);
  const card = window.locator('[data-internal-note-hover-card]');
  await expect(card).toBeVisible();
  return card;
}

async function placeCaretInsideLink(link: Locator, offset: number) {
  await link.evaluate((element, caretOffset) => {
    const editable = element.closest('[contenteditable="true"]') as HTMLElement | null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (!editable || !(text instanceof Text)) throw new Error('Expected a text link');
    editable.focus();
    const range = document.createRange();
    range.setStart(text, Math.min(caretOffset, text.data.length));
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, offset);
  await link.page().waitForTimeout(75);
}

async function placeCaretInEditorText(window: Page, needle: string, offset: number) {
  await activeEditor(window).evaluate((editable, target) => {
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text) {
      if (text instanceof Text) {
        const start = text.data.indexOf(target.needle);
        if (start >= 0) {
          (editable as HTMLElement).focus();
          const range = document.createRange();
          range.setStart(text, start + Math.min(target.offset, target.needle.length));
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          return;
        }
      }
      text = walker.nextNode();
    }
    throw new Error(`Could not find text: ${target.needle}`);
  }, { needle, offset });
  await window.waitForTimeout(75);
}

async function hasSavedSelectionHighlight(window: Page) {
  return window.evaluate(() =>
    Boolean((CSS as any).highlights?.has('lychee-link-selection')) ||
    Boolean(document.querySelector('[data-link-selection-overlay]')),
  );
}

async function textEndX(line: Locator) {
  return line.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    let lastText: Text | null = null;
    while (text) {
      if (text instanceof Text && text.data.length > 0) lastText = text;
      text = walker.nextNode();
    }
    if (!lastText) throw new Error('Expected line text');
    const range = document.createRange();
    range.setStart(lastText, lastText.data.length - 1);
    range.setEnd(lastText, lastText.data.length);
    return range.getBoundingClientRect().right;
  });
}

async function textStartX(line: Locator) {
  return line.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && (!(text instanceof Text) || text.data.length === 0)) {
      text = walker.nextNode();
    }
    if (!(text instanceof Text)) throw new Error('Expected line text');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    return range.getBoundingClientRect().left;
  });
}

test.describe('Cmd+K links — ergonomics, edge cases, and stress', () => {
  test('collapsed caret opens one focused input centered below the current text line', async ({ window }) => {
    const label = 'Place the cursor here';
    await createNote(window, 'Caret Position', label);
    const line = activeEditor(window).locator('p').filter({ hasText: label });
    await placeCaretInEditorText(window, label, label.length);
    const lineBox = await line.boundingBox();
    const caretX = await textEndX(line);
    expect(lineBox).not.toBeNull();

    const input = await openLinkPopup(window);
    await expect(linkPopover(window).locator('input')).toHaveCount(1);
    const inputBox = await input.boundingBox();
    const popoverBox = await linkPopover(window).boundingBox();
    expect(inputBox).not.toBeNull();
    expect(popoverBox).not.toBeNull();
    expect(inputBox!.y).toBeGreaterThanOrEqual(lineBox!.y + lineBox!.height + 4);
    expect(Math.abs(popoverBox!.x + popoverBox!.width / 2 - caretX)).toBeLessThanOrEqual(2);
  });

  test('far-right caret keeps the centered popup fully inside the viewport', async ({ window }) => {
    const label = 'Right edge caret';
    await createNote(window, 'Right Edge Position', label);
    const line = activeEditor(window).locator('p').filter({ hasText: label });
    await line.evaluate((element) => { (element as HTMLElement).style.textAlign = 'right'; });
    await placeCaretInEditorText(window, label, label.length);
    const lineBox = await line.boundingBox();
    const caretX = await textEndX(line);
    expect(lineBox).not.toBeNull();

    await openLinkPopup(window);
    const popoverBox = await linkPopover(window).boundingBox();
    const viewportWidth = await window.evaluate(() => innerWidth);
    expect(popoverBox).not.toBeNull();
    expect(popoverBox!.x).toBeGreaterThanOrEqual(16);
    expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(viewportWidth - 16);
    expect(caretX).toBeGreaterThanOrEqual(popoverBox!.x);
    expect(caretX).toBeLessThanOrEqual(popoverBox!.x + popoverBox!.width);
    expect(popoverBox!.y).toBeGreaterThanOrEqual(lineBox!.y + lineBox!.height + 4);
  });

  test('far-left caret clamps the centered popup to the viewport gutter', async ({ window }) => {
    const label = 'Left edge caret';
    await createNote(window, 'Left Edge Position', label);
    const line = activeEditor(window).locator('p').filter({ hasText: label });
    await line.evaluate((element) => {
      const style = (element as HTMLElement).style;
      style.position = 'fixed';
      style.left = '20px';
      style.top = '220px';
      style.width = 'max-content';
    });
    await placeCaretInEditorText(window, label, 0);
    const caretX = await textStartX(line);

    await openLinkPopup(window);
    const popoverBox = await linkPopover(window).boundingBox();
    const viewportWidth = await window.evaluate(() => innerWidth);
    expect(popoverBox).not.toBeNull();
    expect(Math.abs(popoverBox!.x - 16)).toBeLessThanOrEqual(1);
    expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(viewportWidth - 16);
    expect(caretX).toBeGreaterThanOrEqual(popoverBox!.x);
  });

  test('bottom-edge caret places the popup above without overlapping the caret line', async ({ window }) => {
    const label = 'Bottom edge caret';
    await createNote(window, 'Bottom Edge Position', label);
    const line = activeEditor(window).locator('p').filter({ hasText: label });
    await line.evaluate((element) => {
      const style = (element as HTMLElement).style;
      style.position = 'fixed';
      style.left = '50%';
      style.bottom = '8px';
      style.width = 'max-content';
    });
    await placeCaretInEditorText(window, label, label.length);
    const lineBox = await line.boundingBox();
    expect(lineBox).not.toBeNull();

    await openLinkPopup(window);
    const popoverBox = await linkPopover(window).boundingBox();
    expect(popoverBox).not.toBeNull();
    expect(popoverBox!.y).toBeGreaterThanOrEqual(16);
    expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(lineBox!.y - 12);
  });

  test('open popup reanchors and remains fully visible when the window is resized', async ({ electronApp, window }) => {
    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.getContentSize() ?? [1200, 800]
    ));
    const label = 'Resize-aware caret';

    try {
      await createNote(window, 'Responsive Popup', label);
      const line = activeEditor(window).locator('p').filter({ hasText: label });
      await line.evaluate((element) => { (element as HTMLElement).style.textAlign = 'right'; });
      await placeCaretInEditorText(window, label, label.length);
      await openLinkPopup(window);

      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(680, 480);
      });
      await expect.poll(() => window.evaluate(() => ({ width: innerWidth, height: innerHeight })))
        .toEqual({ width: 680, height: 480 });

      const popoverBox = await linkPopover(window).boundingBox();
      const resizedLineBox = await line.boundingBox();
      expect(popoverBox).not.toBeNull();
      expect(resizedLineBox).not.toBeNull();
      expect(popoverBox!.x).toBeGreaterThanOrEqual(16);
      expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(680 - 16);
      expect(popoverBox!.y).toBeGreaterThanOrEqual(16);
      expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(480 - 16);

      const isBelow = popoverBox!.y >= resizedLineBox!.y + resizedLineBox!.height;
      const isAbove = popoverBox!.y + popoverBox!.height <= resizedLineBox!.y;
      expect(isBelow || isAbove).toBe(true);
    } finally {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]);
      }, originalSize);
    }
  });

  test('small-window candidate list remains in bounds and scrolls independently', async ({ electronApp, window }) => {
    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.getContentSize() ?? [1200, 800]
    ));

    try {
      await window.evaluate(async () => {
        const store = (window as any).__documentStore;
        for (let index = 0; index < 9; index += 1) {
          await store.getState().createDocument();
        }
      });
      await createNote(window, 'Small Candidate Source', 'candidate anchor');
      const line = activeEditor(window).locator('p').filter({ hasText: 'candidate anchor' });
      await line.evaluate((element) => {
        const style = (element as HTMLElement).style;
        style.position = 'fixed';
        style.left = '50%';
        style.bottom = '8px';
      });
      await placeCaretInEditorText(window, 'candidate anchor', 'candidate anchor'.length);

      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(680, 480);
      });
      await expect.poll(() => window.evaluate(() => ({ width: innerWidth, height: innerHeight })))
        .toEqual({ width: 680, height: 480 });

      await openLinkPopup(window);
      const popover = linkPopover(window);
      const results = popover.getByRole('listbox');
      // Candidate ranking deliberately caps the recent-note list at eight.
      await expect(results.getByRole('option')).toHaveCount(8);
      const popoverBox = await popover.boundingBox();
      expect(popoverBox).not.toBeNull();
      expect(popoverBox!.x).toBeGreaterThanOrEqual(16);
      expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(680 - 16);
      expect(popoverBox!.y).toBeGreaterThanOrEqual(16);
      expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(480 - 16);
      expect(await results.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    } finally {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]);
      }, originalSize);
    }
  });

  test('explicit selection stays visibly selected while input owns focus and clears on Escape', async ({ window }) => {
    await createNote(window, 'Selection Feedback', 'selected words stay visible');
    await window.keyboard.press('Shift+Home');

    const input = await openLinkPopup(window);
    await expect.poll(() => hasSavedSelectionHighlight(window)).toBe(true);
    await input.press('Escape');

    await expect(input).toHaveCount(0);
    await expect.poll(() => hasSavedSelectionHighlight(window)).toBe(false);
    await expect(activeEditor(window)).toContainText('selected words stay visible');
    await expect(activeEditor(window).locator('a')).toHaveCount(0);
  });

  test('outside dismissal preserves selected text without applying a link', async ({ window }) => {
    await createNote(window, 'Outside Dismiss', 'do not mutate this selection');
    await window.keyboard.press('Shift+Home');
    await openLinkPopup(window);
    await expect.poll(() => hasSavedSelectionHighlight(window)).toBe(true);

    await window.locator('aside').click({ position: { x: 10, y: 80 } });
    await expect(linkInput(window)).toHaveCount(0);
    await expect.poll(() => hasSavedSelectionHighlight(window)).toBe(false);
    await expect(activeEditor(window).locator('a')).toHaveCount(0);
    await expect(activeEditor(window)).toContainText('do not mutate this selection');
  });

  test('web URL wraps an explicit multi-word selection including spaces as one link', async ({ window }) => {
    const label = 'link these exact words';
    await createNote(window, 'Web Selection', label);
    await window.keyboard.press('Shift+Home');
    const input = await openLinkPopup(window);
    await input.fill('example.com/path');
    await linkPopover(window).getByRole('button', { name: 'Apply' }).click();

    const links = activeEditor(window).locator('a[href="https://example.com/path"]');
    await expect(links).toHaveCount(1);
    await expect(links).toHaveText(label);
    await expect(activeEditor(window)).toHaveText(new RegExp(label));
  });

  test('internal target preserves explicit custom multi-word label instead of inserting title', async ({ window }) => {
    const target = await createNote(window, 'Canonical Target');
    const label = 'custom words with spaces';
    await createNote(window, 'Custom Label Source', label);

    const link = await createInternalLink(window, target, label, 'Canonical Target');
    await expect(link).toHaveCount(1);
    await expect(activeEditor(window)).not.toContainText('Canonical Target');
  });

  test('collapsed caret strictly inside a word links that whole word to a web URL', async ({ window }) => {
    await createNote(window, 'Word Inference Web', 'Read reference later');
    await placeCaretInEditorText(window, 'reference', 4);

    const input = await openLinkPopup(window);
    await input.fill('example.com/reference');
    await linkPopover(window).getByRole('button', { name: 'Apply' }).click();

    const link = activeEditor(window).locator('a[href="https://example.com/reference"]');
    await expect(link).toHaveText('reference');
    await expect(activeEditor(window)).toContainText('Read reference later');
  });

  test('collapsed caret strictly inside a word uses that word as an internal-link label', async ({ window }) => {
    const target = await createNote(window, 'Long Internal Target Title');
    await createNote(window, 'Word Inference Internal', 'Read reference later');
    await placeCaretInEditorText(window, 'reference', 4);

    await openLinkPopup(window);
    await chooseInternalTarget(window, target, 'Long Internal Target');

    const link = activeEditor(window).locator(
      `a[href="https://note.lychee.invalid/${target.docId}"]`,
    );
    await expect(link).toHaveText('reference');
    await expect(activeEditor(window)).not.toContainText('Long Internal Target Title');
  });

  test('caret at whitespace inserts URL text rather than linking the preceding word', async ({ window }) => {
    await createNote(window, 'Boundary Web', 'Visit ');
    const input = await openLinkPopup(window);
    await input.fill('example.com');
    await linkPopover(window).getByRole('button', { name: 'Apply' }).click();

    await expect(activeEditor(window).locator('a[href="https://example.com"]')).toHaveText('example.com');
    await expect(activeEditor(window)).toContainText('Visit example.com');
  });

  test('caret at whitespace inserts the internal note title', async ({ window }) => {
    const target = await createNote(window, 'Inserted Note Title');
    await createNote(window, 'Boundary Internal', 'See ');

    await openLinkPopup(window);
    await chooseInternalTarget(window, target, 'Inserted Note');

    const link = activeEditor(window).locator(
      `a[href="https://note.lychee.invalid/${target.docId}"]`,
    );
    await expect(link).toHaveText('Inserted Note Title');
    await expect(activeEditor(window)).toContainText('See Inserted Note Title');
  });

  test('empty line inserts entered URL as linked text and anchors popup below the line', async ({ window }) => {
    await createNote(window, 'Empty Line');
    const line = activeEditor(window).locator('p').last();
    const lineBox = await line.boundingBox();
    const input = await openLinkPopup(window);
    const inputBox = await input.boundingBox();
    expect(lineBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(inputBox!.y).toBeGreaterThanOrEqual(lineBox!.y + lineBox!.height + 4);

    await input.fill('empty.example');
    await linkPopover(window).getByRole('button', { name: 'Apply' }).click();
    await expect(activeEditor(window).locator('a[href="https://empty.example"]')).toHaveText('empty.example');
  });

  test('Arrow keys choose note candidates, Enter applies the active option, and source is excluded', async ({ window }) => {
    await createNote(window, 'Candidate Alpha');
    await createNote(window, 'Candidate Beta');
    const source = await createNote(window, 'Candidate Source', 'keyboard choice');
    await window.keyboard.press('Shift+Home');

    const input = await openLinkPopup(window);
    await input.fill('Candidate');
    const popover = linkPopover(window);
    await expect(popover.locator(`[data-note-link-id="${source.docId}"]`)).toHaveCount(0);
    await expect(popover.getByRole('option')).toHaveCount(2);
    await input.press('ArrowDown');
    const activeOption = popover.locator('[role="option"][aria-selected="true"]');
    const activeId = await activeOption.getAttribute('data-note-link-id');
    expect(activeId).toBeTruthy();
    await input.press('Enter');

    await expect(activeEditor(window).locator(
      `a[href="https://note.lychee.invalid/${activeId}"]`,
    )).toHaveText('keyboard choice');
  });

  test('editing and removing from the middle of a multi-word link affects the whole link', async ({ window }) => {
    const label = 'whole linked phrase with spaces';
    await createNote(window, 'Whole Link Editing', label);
    await window.keyboard.press('Shift+Home');
    let input = await openLinkPopup(window);
    await input.fill('first.example');
    await linkPopover(window).getByRole('button', { name: 'Apply' }).click();

    let link = activeEditor(window).locator('a[href="https://first.example"]');
    await expect(link).toHaveText(label);
    await placeCaretInsideLink(link, 10);
    input = await openLinkPopup(window);
    await expect(input).toHaveValue('https://first.example');
    await input.fill('https://second.example');
    await linkPopover(window).getByRole('button', { name: 'Apply' }).click();

    link = activeEditor(window).locator('a[href="https://second.example"]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(label);
    await placeCaretInsideLink(link, 10);
    await openLinkPopup(window);
    await linkPopover(window).getByRole('button', { name: 'Remove link' }).click();

    await expect(activeEditor(window).locator('a')).toHaveCount(0);
    await expect(activeEditor(window)).toContainText(label);
  });

  test('repeated Cmd+K and Escape cycles leave no stale popup or highlight and preserve final selection', async ({ window }) => {
    const label = 'stress selected phrase';
    await createNote(window, 'Popup Stress', label);
    await window.keyboard.press('Shift+Home');

    for (let i = 0; i < 8; i += 1) {
      const input = await openLinkPopup(window);
      await expect.poll(() => hasSavedSelectionHighlight(window)).toBe(true);
      await input.press('Escape');
      await expect(linkInput(window)).toHaveCount(0);
      await expect.poll(() => hasSavedSelectionHighlight(window)).toBe(false);
      await expect.poll(() => activeEditor(window).evaluate((editable) => (
        editable === document.activeElement || editable.contains(document.activeElement)
      ))).toBe(true);
    }

    const input = await openLinkPopup(window);
    await input.fill('stress.example');
    await linkPopover(window).getByRole('button', { name: 'Apply' }).click();
    await expect(activeEditor(window).locator('a[href="https://stress.example"]')).toHaveText(label);
  });
});

test.describe('Internal-link hover card, preview, and tab flows', () => {
  test('Cmd+K suppresses an unpinned external-link card until outside dismissal moves the pointer away', async ({ window }) => {
    const link = await createWebLink(
      window,
      'External Exclusivity',
      'external exclusivity link',
      'external.example/path',
    );
    const hover = await hoverLinkPopover(window, link);

    await placeCaretInsideLink(link, 5);
    await openLinkPopup(window);
    await expect(hover).toHaveCount(0);

    await link.hover();
    await window.waitForTimeout(250);
    await expect(window.locator('[data-link-hover-popover]')).toHaveCount(0);

    await window.locator('aside').click({ position: { x: 10, y: 80 } });
    await expect(linkInput(window)).toHaveCount(0);
    await link.hover();
    await expect(window.locator('[data-link-hover-popover]')).toBeVisible();
  });

  test('applying an edited destination clears hover suppression for the updated link', async ({ window }) => {
    const target = await createNote(window, 'Apply Exclusivity Target');
    await createNote(window, 'Apply Exclusivity Source', 'apply exclusivity link');
    let link = await createInternalLink(
      window,
      target,
      'apply exclusivity link',
      'Apply Exclusivity Target',
    );
    await hoverNoteCard(window, link);

    await placeCaretInsideLink(link, 5);
    const input = await openLinkPopup(window);
    await expect(window.locator('[data-link-hover-popover]')).toHaveCount(0);
    await input.fill('updated-destination.example');
    await linkPopover(window).getByRole('button', { name: 'Apply' }).click();

    link = activeEditor(window).locator('a[href="https://updated-destination.example"]');
    await expect(link).toHaveText('apply exclusivity link');
    await window.mouse.move(5, 5);
    await hoverLinkPopover(window, link);
    await expect(linkInput(window)).toHaveCount(0);
  });

  test('switching tabs while Cmd+K is open clears global suppression in the source editor', async ({ window }) => {
    const target = await createNote(window, 'Tab Cleanup Target');
    const source = await createNote(window, 'Tab Cleanup Source', 'tab cleanup link');
    let link = await createInternalLink(window, target, 'tab cleanup link', 'Tab Cleanup Target');
    await placeCaretInsideLink(link, 4);
    await openLinkPopup(window);

    await window.evaluate((id) => {
      (window as any).__documentStore.getState().openOrSelectTab(id);
    }, target.docId);
    await expect(activeTitle(window)).toHaveText('Tab Cleanup Target');
    await expect(linkInput(window)).toHaveCount(0);

    await window.evaluate((id) => {
      (window as any).__documentStore.getState().openOrSelectTab(id);
    }, source.docId);
    await expect(activeTitle(window)).toHaveText('Tab Cleanup Source');
    link = activeEditor(window).locator(
      `a[href="https://note.lychee.invalid/${target.docId}"]`,
    );
    await window.mouse.move(5, 5);
    await hoverNoteCard(window, link);
  });

  test('repeated hover-to-Cmd+K transitions never render both overlays', async ({ window }) => {
    const target = await createNote(window, 'Exclusive Stress Target', 'Stress preview');
    await createNote(window, 'Exclusive Stress Source', 'exclusive stress link');
    const link = await createInternalLink(
      window,
      target,
      'exclusive stress link',
      'Exclusive Stress Target',
    );

    for (let index = 0; index < 5; index += 1) {
      await hoverNoteCard(window, link);
      await placeCaretInsideLink(link, 4);
      const input = await openLinkPopup(window);
      await expect(window.locator('[data-link-hover-popover]')).toHaveCount(0);
      await expect(linkPopover(window)).toBeVisible();

      await input.press('Escape');
      await expect(linkPopover(window)).toHaveCount(0);
      await expect(window.locator('[data-link-hover-popover]')).toHaveCount(0);
      await window.mouse.move(5, 5);
    }

    await hoverNoteCard(window, link);
  });

  test('Cmd+K dismisses and suppresses a pinned hover preview until the pointer re-enters', async ({ window }) => {
    const target = await createNote(window, 'Exclusive Target', 'Preview content');
    await createNote(window, 'Exclusive Source', 'exclusive link');
    const link = await createInternalLink(window, target, 'exclusive link', 'Exclusive Target');

    const card = await hoverNoteCard(window, link);
    await card.getByRole('button', { name: 'Preview' }).click();
    await expect(card.locator('[data-note-link-preview]')).toBeVisible();

    await placeCaretInsideLink(link, 4);
    const input = await openLinkPopup(window);
    await expect(card).toHaveCount(0);

    await link.hover();
    await window.waitForTimeout(250);
    await expect(window.locator('[data-internal-note-hover-card]')).toHaveCount(0);

    await input.press('Escape');
    await window.waitForTimeout(250);
    await expect(window.locator('[data-internal-note-hover-card]')).toHaveCount(0);

    await window.mouse.move(5, 5);
    await link.hover();
    await expect(window.locator('[data-internal-note-hover-card]')).toBeVisible();
  });

  test('preview remains stable in a small window when mouseout has a non-Node related target', async ({ electronApp, window }) => {
    const originalSize = await electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.getContentSize() ?? [1200, 800]
    ));
    const pageErrors: string[] = [];
    window.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      const target = await createNote(
        window,
        'Small Window Preview',
        'Preview content that remains readable and stable in a constrained window.',
      );
      await createNote(window, 'Small Preview Source', 'small preview link');
      const link = await createInternalLink(window, target, 'small preview link', 'Small Window Preview');

      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(680, 480);
      });
      await expect.poll(() => window.evaluate(() => ({ width: innerWidth, height: innerHeight })))
        .toEqual({ width: 680, height: 480 });

      const card = await hoverNoteCard(window, link);
      await card.getByRole('button', { name: 'Preview' }).click();
      const preview = card.locator('[data-note-link-preview]');
      await expect(preview).toBeVisible();

      const cardBox = await card.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(cardBox!.x).toBeGreaterThanOrEqual(16);
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(680 - 16);
      expect(cardBox!.y).toBeGreaterThanOrEqual(16);
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(480 - 16);

      // Chromium can report Window as relatedTarget when expanding content
      // changes what is underneath the pointer. It is an EventTarget, but not a
      // Node, so hover dismissal must not pass it to Node.contains().
      await link.evaluate((element) => {
        element.dispatchEvent(new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: window,
        }));
      });
      await window.locator('[data-link-hover-popover]').evaluate((element) => {
        element.dispatchEvent(new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: window,
        }));
      });
      await window.waitForTimeout(200);

      await expect(card).toBeVisible();
      expect(pageErrors).toEqual([]);
    } finally {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]);
      }, originalSize);
    }
  });

  test('long current note title truncates, preview pins, Hide preserves card, and close dismisses it', async ({ window }) => {
    const longTitle = `A deliberately long linked note title ${'with context '.repeat(8)}`.trim();
    const target = await createNote(window, longTitle, 'Preview body with enough context to identify the linked note.');
    await createNote(window, 'Preview Source', 'preview label');
    const link = await createInternalLink(window, target, 'preview label', 'A deliberately long');

    const card = await hoverNoteCard(window, link);
    const title = card.getByTitle(longTitle);
    await expect(title).toBeVisible();
    expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(card.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Open in new tab' })).toBeVisible();

    await card.getByRole('button', { name: 'Preview' }).click();
    const preview = card.locator('[data-note-link-preview]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Preview body with enough context');
    await expect(card.getByRole('button', { name: 'Close note card' })).toBeVisible();

    await card.getByRole('button', { name: 'Hide' }).click();
    await expect(preview).toHaveCount(0);
    await window.mouse.move(5, 5);
    await window.waitForTimeout(250);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Close note card' }).click();
    await expect(card).toHaveCount(0);
  });

  test('scrolling inside an expanded preview does not dismiss the pinned card', async ({ window }) => {
    const body = Array.from({ length: 18 }, (_, index) => `Preview line ${index + 1}`).join('\n');
    const target = await createNote(window, 'Scrollable Preview', body);
    await createNote(window, 'Scrollable Preview Source', 'scroll preview');
    const link = await createInternalLink(window, target, 'scroll preview', 'Scrollable Preview');
    const card = await hoverNoteCard(window, link);
    await card.getByRole('button', { name: 'Preview' }).click();
    const preview = card.locator('[data-note-link-preview]');
    await expect(preview).toBeVisible();
    await preview.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await window.waitForTimeout(250);
    await expect(card).toBeVisible();
    expect(await preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test('renaming a target updates hover-card context without changing the stable link target', async ({ window }) => {
    const target = await createNote(window, 'Original Target');
    const source = await createNote(window, 'Rename Source', 'renamed label');
    const link = await createInternalLink(window, target, 'renamed label', 'Original Target');

    await window.evaluate((id) => (window as any).__documentStore.getState().openOrSelectTab(id), target.docId);
    await expect(activeTitle(window)).toHaveText('Original Target');
    await activeTitle(window).fill('Renamed Target');
    await window.waitForTimeout(800);
    await window.evaluate((id) => (window as any).__documentStore.getState().openOrSelectTab(id), source.docId);
    await expect(activeTitle(window)).toHaveText('Rename Source');

    await expect(link).toHaveAttribute('href', `https://note.lychee.invalid/${target.docId}`);
    const card = await hoverNoteCard(window, link);
    await expect(card.getByText('Renamed Target', { exact: true })).toBeVisible();
  });

  test('missing internal target shows context but disables Preview, Open, and new-tab actions', async ({ window }) => {
    const target = await createNote(window, 'Soon Missing');
    await createNote(window, 'Missing Source', 'missing label');
    const link = await createInternalLink(window, target, 'missing label', 'Soon Missing');

    await window.evaluate(async (id) => {
      await (window as any).__documentStore.getState().trashDocument(id);
    }, target.docId);
    await window.waitForTimeout(250);

    await link.hover();
    const card = window.locator('[data-slot="popover-content"]').filter({ hasText: 'Missing note' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Preview' })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Open in new tab' })).toBeDisabled();
  });

  test('primary Open reuses an existing target tab without creating a duplicate', async ({ window }) => {
    const target = await createNote(window, 'Existing Target');
    await createNote(window, 'Existing Source', 'existing link');
    const link = await createInternalLink(window, target, 'existing link', 'Existing Target');
    const before = await getTabSnapshot(window);
    const beforeCount = before.openTabs.filter((tab) => tab.docId === target.docId).length;

    const card = await hoverNoteCard(window, link);
    await card.getByRole('button', { name: 'Open', exact: true }).click();
    const after = await getTabSnapshot(window);
    expect(after.selectedDocId).toBe(target.docId);
    expect(after.openTabs.filter((tab) => tab.docId === target.docId)).toHaveLength(beforeCount);
  });

  test('primary Open navigates the current tab when no target tab exists', async ({ window }) => {
    const target = await createNote(window, 'Closed Target');
    const source = await createNote(window, 'Current Source', 'closed target link');
    const link = await createInternalLink(window, target, 'closed target link', 'Closed Target');
    await closeTabsForDocument(window, target.docId);
    const before = await getTabSnapshot(window);
    expect(before.selectedDocId).toBe(source.docId);

    const card = await hoverNoteCard(window, link);
    await card.getByRole('button', { name: 'Open', exact: true }).click();
    const after = await getTabSnapshot(window);
    expect(after.selectedDocId).toBe(target.docId);
    expect(after.openTabs).toHaveLength(before.openTabs.length);
    expect(after.openTabs.some((tab) => tab.docId === source.docId)).toBe(false);
  });

  test('explicit new-tab action always creates background duplicates and keeps source active', async ({ window }) => {
    const target = await createNote(window, 'Duplicate Target');
    const source = await createNote(window, 'Duplicate Source', 'duplicate link');
    const link = await createInternalLink(window, target, 'duplicate link', 'Duplicate Target');
    const initial = await getTabSnapshot(window);
    const initialTargetCount = initial.openTabs.filter((tab) => tab.docId === target.docId).length;

    for (let i = 0; i < 3; i += 1) {
      const card = await hoverNoteCard(window, link);
      await card.getByRole('button', { name: 'Open in new tab' }).click();
      const state = await getTabSnapshot(window);
      expect(state.selectedDocId).toBe(source.docId);
      expect(state.openTabs.filter((tab) => tab.docId === target.docId)).toHaveLength(
        initialTargetCount + i + 1,
      );
    }

    const final = await getTabSnapshot(window);
    const targetTabIds = final.openTabs
      .filter((tab) => tab.docId === target.docId)
      .map((tab) => tab.tabId);
    expect(new Set(targetTabIds).size).toBe(targetTabIds.length);
  });

  test('Cmd/Ctrl-click creates a background duplicate instead of selecting an existing target tab', async ({ window }) => {
    const target = await createNote(window, 'Modifier Target');
    const source = await createNote(window, 'Modifier Source', 'modifier link');
    const link = await createInternalLink(window, target, 'modifier link', 'Modifier Target');
    const before = await getTabSnapshot(window);
    const beforeCount = before.openTabs.filter((tab) => tab.docId === target.docId).length;

    await link.click({ modifiers: [mod] });
    const after = await getTabSnapshot(window);
    expect(after.selectedDocId).toBe(source.docId);
    expect(after.openTabs.filter((tab) => tab.docId === target.docId)).toHaveLength(beforeCount + 1);
  });
});
