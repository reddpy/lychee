import { test, expect } from './electron-app';
import { type Page } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const YELLOW = 'rgb(253, 224, 71)';

async function newNote(window: Page, title: string, text: string) {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  await window.locator('main:visible h1.editor-title').click();
  await window.keyboard.type(title);
  await window.keyboard.press('Enter');
  await window.keyboard.type(text);
  await window.waitForTimeout(300);
}

/** The themed highlight span rendered inside the `<mark>`. */
function highlightSpans(window: Page) {
  return window.locator('main:visible .ContentEditable__root mark span');
}

function highlightMarks(window: Page) {
  return window.locator('main:visible .ContentEditable__root mark');
}

function backgroundColor(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/**
 * Programmatically select a range in the last content paragraph. Mirrors the
 * helper in text-formats.spec.ts — Playwright/Lexical arrow-key selection is
 * unreliable under parallel workers.
 */
async function selectInLastParagraph(window: Page, start: number, end: number) {
  await window.waitForFunction(
    ({ minLen }: { minLen: number }) => {
      const visibleMain = Array.from(document.querySelectorAll('main')).find(
        (m) => (m as HTMLElement).style.display !== 'none',
      );
      const root = visibleMain?.querySelector('.ContentEditable__root');
      if (!root) return false;
      const paragraphs = Array.from(root.querySelectorAll('p')).filter(
        (p) => (p.textContent?.length ?? 0) > 0,
      );
      const p = paragraphs[paragraphs.length - 1];
      return !!(p && (p.textContent?.length ?? 0) >= minLen);
    },
    { minLen: end },
    { timeout: 5000 },
  );
  await window.evaluate(
    ({ s, e }: { s: number; e: number }) => {
      const visibleMain = Array.from(document.querySelectorAll('main')).find(
        (m) => (m as HTMLElement).style.display !== 'none',
      );
      const root = visibleMain?.querySelector('.ContentEditable__root') as HTMLElement | null;
      if (!root) throw new Error('editor root not found');
      root.focus();
      const paragraphs = Array.from(root.querySelectorAll('p')).filter(
        (p) => (p.textContent?.length ?? 0) > 0,
      );
      const p = paragraphs[paragraphs.length - 1] as HTMLElement | undefined;
      if (!p) throw new Error('paragraph not found');

      const findPos = (offset: number): { node: Text; pos: number } => {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let acc = 0;
        let n = walker.nextNode() as Text | null;
        while (n) {
          if (offset <= acc + n.data.length) return { node: n, pos: offset - acc };
          acc += n.data.length;
          n = walker.nextNode() as Text | null;
        }
        throw new Error(`offset ${offset} out of range (max ${acc})`);
      };

      const startPos = findPos(s);
      const endPos = findPos(e);
      const range = document.createRange();
      range.setStart(startPos.node, startPos.pos);
      range.setEnd(endPos.node, endPos.pos);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      }
    },
    { s: start, e: end },
  );
  await window.waitForFunction(
    () => {
      const sel = getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const range = sel.getRangeAt(0);
      if (range.collapsed) return false;
      const visibleMain = Array.from(document.querySelectorAll('main')).find(
        (m) => (m as HTMLElement).style.display !== 'none',
      );
      const root = visibleMain?.querySelector('.ContentEditable__root');
      return !!root && root.contains(range.startContainer) && root.contains(range.endContainer);
    },
    null,
    { timeout: 3000 },
  );
  await expect(window.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible();
}

test.describe('Highlight color', () => {
  test('applies the bright yellow background and neutralizes the outer <mark>', async ({ window }) => {
    await newNote(window, 'Highlight Apply', 'hello highlighted world');
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+Shift+h`);

    const span = highlightSpans(window).first();
    await expect(span).toBeVisible();
    expect(await backgroundColor(span)).toBe(YELLOW);

    // The outer <mark> must not show the browser's default yellow.
    const mark = highlightMarks(window).first();
    expect(await backgroundColor(mark)).toBe('rgba(0, 0, 0, 0)');
  });

  test('toggles the highlight off when applied again', async ({ window }) => {
    await newNote(window, 'Highlight Toggle', 'toggle me');
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+Shift+h`);
    await expect(highlightSpans(window).first()).toBeVisible();

    await window.keyboard.press(`${mod}+Shift+h`);
    await expect(highlightMarks(window)).toHaveCount(0);
  });

  test('highlight only covers the selected range', async ({ window }) => {
    await newNote(window, 'Highlight Range', 'one two three');
    // Select "two" (offsets 4..7).
    await selectInLastParagraph(window, 4, 7);
    await window.keyboard.press(`${mod}+Shift+h`);

    const span = highlightSpans(window).first();
    await expect(span).toHaveText('two');
    expect(await backgroundColor(span)).toBe(YELLOW);
    // Neighbours stay unhighlighted.
    await expect(highlightMarks(window)).toHaveCount(1);
  });

  test('multiple separate ranges can each be highlighted', async ({ window }) => {
    await newNote(window, 'Highlight Multi', 'alpha beta gamma');
    await selectInLastParagraph(window, 0, 5);
    await window.keyboard.press(`${mod}+Shift+h`);

    await selectInLastParagraph(window, 11, 16);
    await window.keyboard.press(`${mod}+Shift+h`);

    const spans = highlightSpans(window);
    await expect(spans).toHaveCount(2);
    await expect(spans.nth(0)).toHaveText('alpha');
    await expect(spans.nth(1)).toHaveText('gamma');
    expect(await backgroundColor(spans.nth(1))).toBe(YELLOW);
  });

  test('survives close + reopen and still renders yellow', async ({ window }) => {
    await newNote(window, 'Highlight Persist', 'keep this yellow');
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.waitForTimeout(1000);

    // Close the tab (unmounts the editor) then reopen from the sidebar.
    const activeTab = window.locator('[data-tab-id]').first();
    await activeTab.hover();
    await activeTab.locator('[aria-label="Close tab"]').click();
    await window.waitForTimeout(400);
    await window.locator('[data-note-id]').filter({ hasText: 'Highlight Persist' }).click();
    await window.waitForTimeout(800);

    const span = highlightSpans(window).first();
    await expect(span).toBeVisible();
    expect(await backgroundColor(span)).toBe(YELLOW);
  });

  test('stays yellow after the accent color changes', async ({ window }) => {
    await newNote(window, 'Highlight Accent', 'independent color');
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+Shift+h`);
    await expect(highlightSpans(window).first()).toBeVisible();

    // Change the accent via Settings.
    await window.locator('aside[data-state="expanded"]').getByText('Settings').click();
    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('nav').getByRole('button', { name: 'Appearance' }).click();
    await dialog.locator('[data-testid="accent-preset"][data-accent="#0ea5e9"]').click();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // The highlight is a fixed yellow, not accent-tinted.
    expect(await backgroundColor(highlightSpans(window).first())).toBe(YELLOW);
  });
});
