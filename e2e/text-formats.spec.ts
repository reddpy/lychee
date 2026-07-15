import {
  test,
  expect,
  getLatestDocumentFromDb,
  findPackagedBinary,
  hasDevBuild,
  PROJECT_ROOT,
} from './electron-app';
import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Mirrors Lexical's IS_* bitmask values for TextNode.format
// (see node_modules/lexical/Lexical.dev.mjs)
const FORMAT_BIT = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
  highlight: 128,
} as const;

type FormatName = keyof typeof FORMAT_BIT;

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

interface FormatCase {
  name: FormatName;
  shortcut: string;
  /** Tag(s) that should wrap the formatted text in the rendered DOM. */
  domSelector: string;
}

const FORMATS: FormatCase[] = [
  { name: 'bold',          shortcut: `${mod}+b`,       domSelector: 'strong, .font-bold' },
  { name: 'italic',        shortcut: `${mod}+i`,       domSelector: 'em, .italic' },
  { name: 'underline',     shortcut: `${mod}+u`,       domSelector: 'u, .underline' },
  { name: 'strikethrough', shortcut: `${mod}+Shift+s`, domSelector: 's, del, .line-through' },
  { name: 'code',          shortcut: `${mod}+e`,       domSelector: 'code' },
  { name: 'highlight',     shortcut: `${mod}+Shift+h`, domSelector: 'mark' },
];

/**
 * Walk a Lexical JSON tree and collect every text-bearing leaf's text + format bitmask.
 * Includes both `text` nodes (regular TextNode) and `code-highlight` nodes (Lexical's
 * syntax-highlight tokens inside code blocks); both extend TextNode and serialize the
 * same `{ text, format, ... }` shape.
 */
function findTextNodes(node: any): Array<{ text: string; format: number }> {
  const results: Array<{ text: string; format: number }> = [];
  if (typeof node?.text === 'string') {
    results.push({ text: node.text, format: node.format ?? 0 });
  }
  if (Array.isArray(node?.children)) {
    for (const child of node.children) {
      results.push(...findTextNodes(child));
    }
  }
  return results;
}

/**
 * Find the first node of `type` (anywhere in the tree) whose descendant text nodes
 * include `expectedText`. Returns the node itself, or null if not found. Used to
 * verify that text really lives *inside* a specific structural container — not just
 * that both happen to coexist somewhere in the JSON.
 */
function findNodeContainingText(
  node: any,
  type: string | string[],
  expectedText: string,
): any | null {
  const types = Array.isArray(type) ? type : [type];
  if (types.includes(node?.type)) {
    if (findTextNodes(node).some((n) => n.text === expectedText)) return node;
  }
  if (Array.isArray(node?.children)) {
    for (const child of node.children) {
      const result = findNodeContainingText(child, type, expectedText);
      if (result) return result;
    }
  }
  return null;
}

test.describe('Text formats — DOM + DB persistence', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  for (const fmt of FORMATS) {
    test(`${fmt.name}: keyboard shortcut applies format and persists to DB`, async ({ window }) => {
      const title = window.locator('h1.editor-title');
      await title.click();
      await window.keyboard.press('Enter');

      // Plain "before " → toggle format on → typed word gets format → toggle off → " after"
      await window.keyboard.type('before ');
      await window.keyboard.press(fmt.shortcut);
      await window.keyboard.type(fmt.name);
      await window.keyboard.press(fmt.shortcut);
      await window.keyboard.type(' after');

      // DOM: the format's wrapper element exists and contains the formatted word
      const editorRoot = window.locator('.ContentEditable__root');
      await expect(editorRoot.locator(fmt.domSelector).first()).toContainText(fmt.name);

      // DB: the Lexical JSON has a text node with the right format bit set
      await window.waitForTimeout(1000);
      const doc = await getLatestDocumentFromDb(window);
      expect(doc?.content).toBeTruthy();
      const content = JSON.parse(doc!.content);
      const textNodes = findTextNodes(content.root);
      const bit = FORMAT_BIT[fmt.name];

      const formatted = textNodes.find((n) => n.text === fmt.name);
      expect(formatted, `text node "${fmt.name}" not found in DB JSON`).toBeDefined();
      expect(
        (formatted!.format & bit) !== 0,
        `text "${fmt.name}" missing format bit ${bit} (got ${formatted!.format})`,
      ).toBe(true);

      // Surrounding plain text must NOT carry the same bit
      const before = textNodes.find((n) => n.text === 'before ');
      const after = textNodes.find((n) => n.text === ' after');
      expect((before?.format ?? 0) & bit).toBe(0);
      expect((after?.format ?? 0) & bit).toBe(0);
    });
  }

  test('highlight: ==text== markdown shortcut applies highlight format', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('Highlight Markdown');
    await window.keyboard.press('Enter');

    // Type the markdown — trailing space commits the closing == transformer
    await window.keyboard.type('==marked== tail');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('mark').first()).toContainText('marked');
    await expect(editorRoot).not.toContainText('==');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const marked = findTextNodes(content.root).find((n) => n.text === 'marked');
    expect(marked, 'highlighted text node "marked" not found in DB JSON').toBeDefined();
    expect((marked!.format & FORMAT_BIT.highlight) !== 0).toBe(true);
  });

  test('all six formats survive close + reopen from sidebar', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('All Formats');
    await window.keyboard.press('Enter');

    // Apply each format on its own word, separated by spaces
    for (const fmt of FORMATS) {
      await window.keyboard.press(fmt.shortcut);
      await window.keyboard.type(fmt.name);
      await window.keyboard.press(fmt.shortcut);
      await window.keyboard.type(' ');
    }
    await window.waitForTimeout(1000);

    // DB has every format bit set on its respective text node, before reopen
    const docBefore = await getLatestDocumentFromDb(window);
    const nodesBefore = findTextNodes(JSON.parse(docBefore!.content).root);
    for (const fmt of FORMATS) {
      const node = nodesBefore.find((n) => n.text === fmt.name);
      expect(node, `"${fmt.name}" text node missing pre-reopen`).toBeDefined();
      expect(
        (node!.format & FORMAT_BIT[fmt.name]) !== 0,
        `"${fmt.name}" missing format bit ${FORMAT_BIT[fmt.name]} pre-reopen`,
      ).toBe(true);
    }

    // Close the active tab — unmounts the editor, forcing a fresh deserialize on reopen
    const activeTab = window.locator('[data-tab-id]').first();
    await activeTab.hover();
    await activeTab.locator('[aria-label="Close tab"]').click();
    await window.waitForTimeout(400);

    // Reopen the note from the sidebar
    await window.locator('[data-note-id]').filter({ hasText: 'All Formats' }).click();
    await window.waitForTimeout(800);

    // Every format's DOM wrapper still wraps its word after the reload
    const editorRoot = window.locator('.ContentEditable__root');
    for (const fmt of FORMATS) {
      await expect(
        editorRoot.locator(fmt.domSelector).filter({ hasText: fmt.name }).first(),
        `${fmt.name} wrapper missing post-reopen`,
      ).toBeVisible();
    }
  });
});

// ─── Helpers for selection-based tests ──────────────────────────────

/**
 * Programmatically set a DOM selection inside one paragraph of the editor.
 * Bypasses Playwright keyboard-arrow quirks under Lexical/macOS — Lexical
 * picks up the change via its `selectionchange` listener.
 *
 * `paragraphIndex` is 0-based among <p> elements inside the editor body
 * (negative values index from the end, so -1 = last paragraph).
 */
async function selectInParagraph(
  window: any,
  paragraphIndex: number,
  start: number,
  end: number,
) {
  // Wait for Lexical to flush typed text into the target paragraph
  await window.waitForFunction(
    ({ pIdx, minLen }: { pIdx: number; minLen: number }) => {
      const visibleMain = Array.from(document.querySelectorAll('main')).find(
        (m) => (m as HTMLElement).style.display !== 'none',
      );
      const root = visibleMain?.querySelector('.ContentEditable__root');
      if (!root) return false;
      // Lexical inserts a trailing empty <p> as a cursor placeholder — skip it
      // so indexes refer to actual content paragraphs.
      const paragraphs = Array.from(root.querySelectorAll('p')).filter(
        (p) => (p.textContent?.length ?? 0) > 0,
      );
      const idx = pIdx < 0 ? paragraphs.length + pIdx : pIdx;
      const p = paragraphs[idx];
      return !!(p && (p.textContent?.length ?? 0) >= minLen);
    },
    { pIdx: paragraphIndex, minLen: end },
    { timeout: 5000 },
  );
  await window.evaluate(
    ({ pIdx, s, e }: { pIdx: number; s: number; e: number }) => {
      const visibleMain = Array.from(document.querySelectorAll('main')).find(
        (m) => (m as HTMLElement).style.display !== 'none',
      );
      const root = visibleMain?.querySelector('.ContentEditable__root') as HTMLElement | null;
      if (!root) throw new Error('editor root not found');
      // Focus the editor before setting the selection — under parallel-workers
      // CPU contention, focus occasionally drifts elsewhere and Lexical then
      // ignores the resulting selectionchange.
      root.focus();
      const paragraphs = Array.from(root.querySelectorAll('p')).filter(
        (p) => (p.textContent?.length ?? 0) > 0,
      );
      const idx = pIdx < 0 ? paragraphs.length + pIdx : pIdx;
      const p = paragraphs[idx] as HTMLElement | undefined;
      if (!p) throw new Error(`paragraph ${pIdx} not found (have ${paragraphs.length})`);

      const findPos = (offset: number): { node: Text; pos: number } => {
        const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let acc = 0;
        let n = w.nextNode() as Text | null;
        while (n) {
          if (offset <= acc + n.data.length) return { node: n, pos: offset - acc };
          acc += n.data.length;
          n = w.nextNode() as Text | null;
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
      }
    },
    { pIdx: paragraphIndex, s: start, e: end },
  );
  // Poll until the DOM selection is actually non-collapsed inside the visible
  // editor. A fixed sleep was racy under parallel-workers CPU contention —
  // Lexical's selectionchange handler hadn't yet committed the range.
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
  // Lexical's internal selection state syncs via an editor.update queued from
  // the selectionchange listener — give that update cycle a tick to flush
  // before the next command reads it.
  await window.waitForTimeout(150);
}

/**
 * Programmatically set a selection that spans from one paragraph into another.
 */
async function selectAcrossParagraphs(
  window: any,
  startPIdx: number,
  startOffset: number,
  endPIdx: number,
  endOffset: number,
) {
  // Wait until both target paragraphs have rendered the typed text
  await window.waitForFunction(
    ({ sP, sO, eP, eO }: { sP: number; sO: number; eP: number; eO: number }) => {
      const visibleMain = Array.from(document.querySelectorAll('main')).find(
        (m) => (m as HTMLElement).style.display !== 'none',
      );
      const root = visibleMain?.querySelector('.ContentEditable__root');
      if (!root) return false;
      // Lexical inserts a trailing empty <p> as a cursor placeholder — skip it
      // so indexes refer to actual content paragraphs.
      const paragraphs = Array.from(root.querySelectorAll('p')).filter(
        (p) => (p.textContent?.length ?? 0) > 0,
      );
      const idx = (i: number) => (i < 0 ? paragraphs.length + i : i);
      const p1 = paragraphs[idx(sP)];
      const p2 = paragraphs[idx(eP)];
      if (!p1 || !p2) return false;
      return (
        (p1.textContent?.length ?? 0) >= sO &&
        (p2.textContent?.length ?? 0) >= eO
      );
    },
    { sP: startPIdx, sO: startOffset, eP: endPIdx, eO: endOffset },
    { timeout: 5000 },
  );
  await window.evaluate(
    ({ sP, sO, eP, eO }: { sP: number; sO: number; eP: number; eO: number }) => {
      const visibleMain = Array.from(document.querySelectorAll('main')).find(
        (m) => (m as HTMLElement).style.display !== 'none',
      );
      const root = visibleMain?.querySelector('.ContentEditable__root') as HTMLElement | null;
      if (!root) throw new Error('editor root not found');
      root.focus();
      const paragraphs = Array.from(root.querySelectorAll('p')).filter(
        (p) => (p.textContent?.length ?? 0) > 0,
      );

      const resolve = (pIdx: number, offset: number) => {
        const idx = pIdx < 0 ? paragraphs.length + pIdx : pIdx;
        const p = paragraphs[idx] as HTMLElement | undefined;
        if (!p) throw new Error(`paragraph ${pIdx} not found`);
        const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let acc = 0;
        let n = w.nextNode() as Text | null;
        while (n) {
          if (offset <= acc + n.data.length) return { node: n, pos: offset - acc };
          acc += n.data.length;
          n = w.nextNode() as Text | null;
        }
        throw new Error(`offset ${offset} out of range in paragraph ${pIdx}`);
      };

      const startPos = resolve(sP, sO);
      const endPos = resolve(eP, eO);
      const range = document.createRange();
      range.setStart(startPos.node, startPos.pos);
      range.setEnd(endPos.node, endPos.pos);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    { sP: startPIdx, sO: startOffset, eP: endPIdx, eO: endOffset },
  );
  // Same poll-then-flush as selectInParagraph — see comments there.
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
  await window.waitForTimeout(150);
}

// ─── Tier 1: Selection-based application, toggle, combinations, code-block exclusion ──

test.describe('Text formats — Selection-based application', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  for (const fmt of FORMATS) {
    test(`${fmt.name}: applying format to an existing selection only formats selected text`, async ({ window }) => {
      const title = window.locator('h1.editor-title');
      await title.click();
      await window.keyboard.press('Enter');
      await window.keyboard.type('left middle right');

      // Select "middle" (offsets 5..11 in "left middle right")
      await selectInParagraph(window, -1, 5, 11);

      // Apply format via keyboard shortcut
      await window.keyboard.press(fmt.shortcut);

      const editorRoot = window.locator('.ContentEditable__root');
      await expect(editorRoot.locator(fmt.domSelector).filter({ hasText: 'middle' }).first()).toBeVisible();

      await window.waitForTimeout(1000);
      const doc = await getLatestDocumentFromDb(window);
      const nodes = findTextNodes(JSON.parse(doc!.content).root);
      const bit = FORMAT_BIT[fmt.name];

      const middle = nodes.find((n) => n.text === 'middle');
      expect(middle, '"middle" text node missing in DB JSON').toBeDefined();
      expect((middle!.format & bit) !== 0, `"middle" missing bit ${bit}`).toBe(true);

      // Neighbours must NOT carry the bit
      const left = nodes.find((n) => n.text === 'left ');
      const right = nodes.find((n) => n.text === ' right');
      expect((left?.format ?? 0) & bit, '"left " unexpectedly got the format bit').toBe(0);
      expect((right?.format ?? 0) & bit, '" right" unexpectedly got the format bit').toBe(0);
    });
  }

  test('toggle off: applying the same format twice to a selection clears the bit', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Apply highlight while typing
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.type('marked');
    await window.keyboard.press(`${mod}+Shift+h`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('mark')).toHaveText('marked');

    // Select "marked" (6 chars) and toggle highlight off
    await selectInParagraph(window, -1, 0, 'marked'.length);
    await window.keyboard.press(`${mod}+Shift+h`);

    await expect(editorRoot.locator('mark')).toHaveCount(0);

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const nodes = findTextNodes(JSON.parse(doc!.content).root);
    const marked = nodes.find((n) => n.text === 'marked');
    expect(marked, '"marked" text node missing').toBeDefined();
    expect(marked!.format & FORMAT_BIT.highlight, 'highlight bit should be cleared').toBe(0);
  });

  test('combined: highlight + bold + italic stack on the same word', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('combined');

    await selectInParagraph(window, -1, 0, 'combined'.length);

    // Apply all three formats in sequence
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.press(`${mod}+b`);
    await window.keyboard.press(`${mod}+i`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('mark').filter({ hasText: 'combined' })).toBeVisible();
    await expect(editorRoot.locator('strong, .font-bold').filter({ hasText: 'combined' }).first()).toBeVisible();
    await expect(editorRoot.locator('em, .italic').filter({ hasText: 'combined' }).first()).toBeVisible();

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const nodes = findTextNodes(JSON.parse(doc!.content).root);
    const combined = nodes.find((n) => n.text === 'combined');
    expect(combined).toBeDefined();
    const expected = FORMAT_BIT.bold | FORMAT_BIT.italic | FORMAT_BIT.highlight;
    expect(combined!.format & expected, `expected combined bitmask ${expected}, got ${combined!.format}`).toBe(expected);
  });

  test('markdown ==text== inside a code block is NOT transformed to highlight', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Open a fenced code block via slash command
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Code Block' }).click();
    await window.waitForTimeout(200);

    // Type the highlight markdown syntax inside the code block
    await window.keyboard.type('==literal== suffix');

    const editorRoot = window.locator('.ContentEditable__root');
    // No <mark> should be produced inside the code block
    await expect(editorRoot.locator('mark')).toHaveCount(0);
    // The literal `==` chars are still in the rendered text
    await expect(editorRoot).toContainText('==literal==');

    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const nodes = findTextNodes(JSON.parse(doc!.content).root);
    // Positive guard: make sure findTextNodes actually returned the code block's text.
    // Without this, the negative assertion below would pass trivially if the walker
    // returned an empty array. Code blocks tokenize for syntax highlighting, so the
    // typed content is split across multiple text nodes — concatenate before checking.
    const concatenated = nodes.map((n) => n.text).join('');
    expect(concatenated, 'expected typed text "==literal==" in DB JSON').toContain('==literal==');
    const anyHighlighted = nodes.find((n) => (n.format & FORMAT_BIT.highlight) !== 0);
    expect(anyHighlighted, 'no text node should have the highlight bit inside a code block').toBeUndefined();
  });
});

// ─── Tier 2: Cross-cutting interactions ────────────────────────────

test.describe('Text formats — Cross-cutting edge cases', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('Cmd+F search hits text inside a <mark> — both layers render', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Highlight "searchable"
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.type('searchable');
    await window.keyboard.press(`${mod}+Shift+h`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('mark')).toHaveText('searchable');

    // Open find UI
    await window.keyboard.press(`${mod}+f`);
    await window.waitForTimeout(200);
    await window.getByPlaceholder('Find...').fill('search');
    await window.waitForTimeout(500);

    // The <mark> still renders (format layer is independent of search-highlight layer)
    await expect(editorRoot.locator('mark')).toHaveText('searchable');

    // The CSS Custom Highlights API has at least one actual match range
    // (just verifying `has(name)` is too loose — the highlight could be registered with zero ranges)
    const searchMatchRangeCount = await window.evaluate(() => {
      const highlights = (CSS as any).highlights;
      if (!highlights) return 0;
      let total = 0;
      for (const name of ['lychee-find-all', 'lychee-find-transient-all']) {
        const h = highlights.get(name);
        if (h && typeof h.size === 'number') total += h.size;
      }
      return total;
    });
    expect(
      searchMatchRangeCount,
      'expected the search-highlight layer to contain at least one match range',
    ).toBeGreaterThan(0);
  });

  test('format applied across block boundaries lands in each block', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('first paragraph');
    await window.keyboard.press('Enter');
    await window.keyboard.type('second paragraph');

    // Select from start of paragraph 0 to end of paragraph 1
    await selectAcrossParagraphs(window, -2, 0, -1, 'second paragraph'.length);

    await window.keyboard.press(`${mod}+Shift+h`);

    const editorRoot = window.locator('.ContentEditable__root');
    // Each paragraph should have at least one <mark> child
    const markCount = await editorRoot.locator('p mark').count();
    expect(markCount, 'expected <mark> in each of the two paragraphs').toBeGreaterThanOrEqual(2);

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const root = JSON.parse(doc!.content).root;
    // Each paragraph (block-level child) should have at least one text node with highlight bit
    // Skip the trailing empty paragraph Lexical appends as a cursor placeholder
    const contentBlocks = (root.children ?? [])
      .filter((c: any) => c.type === 'paragraph')
      .filter((c: any) => findTextNodes(c).some((n) => n.text.length > 0));
    expect(contentBlocks.length, 'expected at least 2 content paragraph blocks').toBeGreaterThanOrEqual(2);
    for (const block of contentBlocks) {
      const blockNodes = findTextNodes(block);
      const hasHighlight = blockNodes.some((n) => (n.format & FORMAT_BIT.highlight) !== 0);
      expect(hasHighlight, `paragraph "${JSON.stringify(block)}" should contain a highlighted text node`).toBe(true);
    }
  });

  test('mixed selection: applying highlight to partially-highlighted text normalizes to all-highlighted', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // "plain " is plain, "highlighted" is highlighted
    await window.keyboard.type('plain ');
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.type('highlighted');
    await window.keyboard.press(`${mod}+Shift+h`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('mark')).toHaveText('highlighted');

    // Select the whole line — anchor lands in "plain " (no highlight bit)
    await selectInParagraph(window, -1, 0, 'plain highlighted'.length);

    // Apply highlight — Lexical inspects the anchor's format; anchor is plain so highlight is ADDED to all
    await window.keyboard.press(`${mod}+Shift+h`);

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const nodes = findTextNodes(JSON.parse(doc!.content).root).filter((n) => n.text.length > 0);
    expect(nodes.length).toBeGreaterThan(0);
    const allHighlighted = nodes.every((n) => (n.format & FORMAT_BIT.highlight) !== 0);
    expect(
      allHighlighted,
      `expected all text nodes to be highlighted after normalize; got ${JSON.stringify(nodes)}`,
    ).toBe(true);
  });

  test('stress: highlight applied to 30 paragraphs in a single command', async ({ window }) => {
    test.setTimeout(60_000);

    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    const N = 30;
    for (let i = 0; i < N; i++) {
      await window.keyboard.type(`paragraph ${i}`);
      if (i < N - 1) await window.keyboard.press('Enter');
    }

    // Select everything in the body. Cmd+A in Lexical selects the current block on first press,
    // and the entire editor on second press.
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+a`);

    await window.keyboard.press(`${mod}+Shift+h`);

    // Wait for re-render and save
    await window.waitForTimeout(2000);

    const editorRoot = window.locator('.ContentEditable__root');
    const markCount = await editorRoot.locator('mark').count();
    expect(markCount, `expected at least ${N} <mark> elements`).toBeGreaterThanOrEqual(N);

    const doc = await getLatestDocumentFromDb(window);
    const nodes = findTextNodes(JSON.parse(doc!.content).root);
    const highlighted = nodes.filter((n) => (n.format & FORMAT_BIT.highlight) !== 0);
    expect(
      highlighted.length,
      `expected at least ${N} highlighted text nodes; got ${highlighted.length}`,
    ).toBeGreaterThanOrEqual(N);
  });
});

// ─── Tier 3: Stress, undo/redo, viewport ─────────────────────────────

test.describe('Text formats — Stress and recovery', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('rapid toggle: 10 consecutive highlight toggles end in the correct state', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('togglestate');

    await selectInParagraph(window, -1, 0, 'togglestate'.length);

    const editorRoot = window.locator('.ContentEditable__root');

    // Verify alternation at intermediate steps — rules out "all no-ops + final hit"
    // producing the same observed end state as a real run.
    await window.keyboard.press(`${mod}+Shift+h`);
    await expect(editorRoot.locator('mark'), 'after 1 toggle, ON').toHaveText('togglestate');

    await window.keyboard.press(`${mod}+Shift+h`);
    await expect(editorRoot.locator('mark'), 'after 2 toggles, OFF').toHaveCount(0);

    // Toggle 8 more times — alternating, ending OFF after 10 total
    for (let i = 0; i < 8; i++) {
      await window.keyboard.press(`${mod}+Shift+h`);
    }
    // After 10 toggles (even), back to OFF
    await expect(editorRoot.locator('mark'), 'after 10 toggles, OFF').toHaveCount(0);

    // 11th toggle (odd) → ON
    await window.keyboard.press(`${mod}+Shift+h`);
    await expect(editorRoot.locator('mark'), 'after 11 toggles, ON').toHaveText('togglestate');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const nodes = findTextNodes(JSON.parse(doc!.content).root);
    const marked = nodes.find((n) => n.text === 'togglestate');
    expect(marked).toBeDefined();
    expect((marked!.format & FORMAT_BIT.highlight) !== 0, 'final state should have highlight bit').toBe(true);
  });

  test('undo/redo: highlight state is preserved across the history stack', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('before ');
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.type('marked');
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.type(' after');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('mark')).toHaveText('marked');

    // Undo to clear all edits — at some point the <mark> disappears
    for (let i = 0; i < 40; i++) {
      await window.keyboard.press(`${mod}+z`);
    }
    await window.waitForTimeout(200);
    await expect(editorRoot.locator('mark'), 'undo to empty state should remove all marks').toHaveCount(0);

    // Redo all the way back
    for (let i = 0; i < 40; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
    }
    await window.waitForTimeout(200);
    await expect(editorRoot.locator('mark'), 'redo should restore the mark').toHaveText('marked');
  });

  test('floating toolbar format buttons apply and toggle every configured format', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('text to format');

    await selectInParagraph(window, -1, 0, 'text to format'.length);
    await window.locator('.ContentEditable__root p').filter({ hasText: 'text to format' }).click({ button: 'right' });

    const toolbar = window.getByRole('toolbar', { name: 'Text formatting' });
    await expect(toolbar).toBeVisible();

    const editorRoot = window.locator('.ContentEditable__root');
    const formats = [
      { label: 'Bold', selector: '.font-bold, strong' },
      { label: 'Italic', selector: '.italic, em' },
      { label: 'Underline', selector: '.underline, u' },
      { label: 'Strikethrough', selector: '.line-through, s, del' },
      { label: 'Inline code', selector: 'code' },
      { label: 'Highlight', selector: 'mark' },
    ];

    for (const { label, selector } of formats) {
      const button = toolbar.getByRole('button', { name: label });
      await expect(button).toHaveAttribute('aria-pressed', 'false');

      await button.click();
      await expect(editorRoot.locator(selector).filter({ hasText: 'text to format' }).first()).toBeVisible();
      await expect(button).toHaveAttribute('aria-pressed', 'true');

      await button.click();
      await expect(editorRoot.locator(selector)).toHaveCount(0);
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('floating toolbar fits within a narrow viewport', async ({ electronApp, window }) => {
    // Shrink the BrowserWindow to 500×800 — the toolbar is 420px, so the left
    // clamp in floating-toolbar-plugin must actually engage to keep it on-screen.
    // (700px was trivially satisfied — 280px of slack meant clamping never ran.)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setContentSize(500, 800);
    });
    await window.waitForTimeout(300);

    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('text to format');

    // Select something so the toolbar can show
    await selectInParagraph(window, -1, 0, 'text to format'.length);

    // Right-click on the text itself — right-clicking the editor padding clears
    // the programmatic selection before contextmenu fires.
    await window.locator('.ContentEditable__root p').filter({ hasText: 'text to format' }).click({ button: 'right' });
    await window.waitForTimeout(300);

    const toolbar = window.locator('.floating-toolbar');
    await expect(toolbar).toBeVisible();

    const box = await toolbar.boundingBox();
    expect(box, 'toolbar should have a measurable bounding box').toBeTruthy();

    const viewportWidth = await window.evaluate(() => innerWidth);
    expect(box!.x, 'toolbar left edge should be on-screen').toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `toolbar right edge (${box!.x + box!.width}) should not overflow viewport (${viewportWidth})`,
    ).toBeLessThanOrEqual(viewportWidth);
  });

  test('floating toolbar: right-side selection in a narrow viewport does not overflow right edge', async ({ electronApp, window }) => {
    // 500px viewport — toolbar is 420px, so a selection near the right edge
    // forces the right-side clamp to engage (without it, the toolbar overflows).
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setContentSize(500, 800);
    });
    await window.waitForTimeout(300);

    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    // Long line that fills most of the editor width — last word "edge" lands far right
    const longLine = 'this is a single line of text near the right edge';
    await window.keyboard.type(longLine);

    // Select only the last word — selection rect is on the right side of the viewport
    const tailStart = longLine.length - 'edge'.length;
    await selectInParagraph(window, -1, tailStart, longLine.length);

    // Right-click at the center of the selection rect — keeps the selection
    // intact (clicking inside a selection preserves it across browsers).
    const clickPos = await window.evaluate(() => {
      const sel = getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      };
    });
    expect(clickPos, 'expected to read selection rect').toBeTruthy();
    await window.mouse.click(clickPos!.x, clickPos!.y, { button: 'right' });
    await window.waitForTimeout(300);

    const toolbar = window.locator('.floating-toolbar');
    await expect(toolbar).toBeVisible();

    const box = await toolbar.boundingBox();
    expect(box, 'toolbar should have a measurable bounding box').toBeTruthy();

    const viewportWidth = await window.evaluate(() => innerWidth);

    // Selection rect's center is > viewportWidth - TOOLBAR_WIDTH/2, so without the
    // right clamp the toolbar would extend past viewportWidth. Verify both edges fit.
    expect(box!.x, 'toolbar left edge on-screen').toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `toolbar right edge (${box!.x + box!.width}) overflowed viewport (${viewportWidth}) — right clamp missing or broken`,
    ).toBeLessThanOrEqual(viewportWidth);

    // Sanity: assert the selection center actually sits in the right half — otherwise
    // the right clamp never engaged and this test would be silently weak.
    expect(
      clickPos!.x,
      `selection center (x=${clickPos!.x}) should be in the right half of the viewport (>${viewportWidth / 2}) to actually stress the right clamp`,
    ).toBeGreaterThan(viewportWidth / 2);
  });
});

// ─── Interaction with other Lychee features: tables, tabs, links ───

test.describe('Text formats — Interactions with other features', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('highlight inside a table cell renders <mark> and persists with format bit', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Insert a 3x3 table via the slash command
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Table' }).click();
    await window.waitForTimeout(500);

    // Cursor lands in the first cell — type some text
    await window.keyboard.type('celltext');

    // Cmd+A inside a table cell selects only that cell's content (see
    // table-action-menu-plugin.tsx). Then apply highlight to the selection.
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+Shift+h`);

    // <mark> renders inside a cell (the inserted table has a header row, so the first
    // cell is <th>, not <td>; accept either).
    const editorRoot = window.locator('.ContentEditable__root');
    await expect(
      editorRoot.locator('th mark, td mark').filter({ hasText: 'celltext' }),
    ).toBeVisible();

    // DB: the text node "celltext" lives somewhere inside a cell node and has the highlight bit
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const cellText = findTextNodes(content.root).find((n) => n.text === 'celltext');
    expect(cellText, '"celltext" text node missing in DB JSON').toBeDefined();
    expect((cellText!.format & FORMAT_BIT.highlight) !== 0, 'celltext should carry highlight bit').toBe(true);

    // Structural check: "celltext" must live *inside* a tablecell node — not just
    // coexist with one somewhere in the JSON.
    const cell = findNodeContainingText(content.root, ['tablecell', 'table-cell'], 'celltext');
    expect(cell, '"celltext" should be a descendant of a tablecell node').toBeTruthy();
  });

  test('highlight survives switching to another tab and back', async ({ window }) => {
    // Note A: highlight some text
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('NoteA');
    await window.keyboard.press('Enter');
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.type('hiA');
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.waitForTimeout(500);

    const visibleEditor = window.locator('main:visible .ContentEditable__root');
    await expect(visibleEditor.locator('mark')).toHaveText('hiA');

    // Note B: opens in a new tab, switches focus away from Note A
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('NoteB');
    await window.waitForTimeout(500);

    // Confirm we're on Note B (the visible editor's title is "NoteB")
    await expect(window.locator('main:visible h1.editor-title')).toHaveText('NoteB');

    // Switch back to Note A's tab — editors stay mounted via display:none,
    // so the <mark> should still be in the DOM without a reload
    await window.locator('[data-tab-id]').filter({ hasText: 'NoteA' }).click();
    await window.waitForTimeout(400);

    await expect(window.locator('main:visible h1.editor-title')).toHaveText('NoteA');
    await expect(
      window.locator('main:visible .ContentEditable__root mark'),
      'highlight should still render after switching tabs back',
    ).toHaveText('hiA');
  });

  test('highlight applied to text inside a link — both wrappers render, both bits persist', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('check linked');

    // Select "linked" (last 6 chars) and turn it into a link
    const fullText = 'check linked';
    await selectInParagraph(window, -1, fullText.length - 'linked'.length, fullText.length);
    await window.keyboard.press(`${mod}+k`);
    await window.waitForTimeout(300);
    await window.getByPlaceholder('Search notes or enter URL...').fill('https://example.com');
    await window.getByRole('button', { name: 'Apply' }).click();
    await window.waitForTimeout(500);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('a[href*="example.com"]')).toContainText('linked');

    // Re-select the same range — now wrapped in an <a> — and apply highlight
    await selectInParagraph(window, -1, fullText.length - 'linked'.length, fullText.length);
    await window.keyboard.press(`${mod}+Shift+h`);

    // DOM: both wrappers exist on the same "linked" text
    await expect(editorRoot.locator('mark').filter({ hasText: 'linked' })).toBeVisible();
    await expect(editorRoot.locator('a[href*="example.com"] mark, mark a[href*="example.com"]'))
      .toContainText('linked');

    // DB: the linked text carries the highlight bit, AND the URL belongs to the
    // link node that actually contains "linked" (not just anywhere in the JSON).
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const linkedText = findTextNodes(content.root).find((n) => n.text === 'linked');
    expect(linkedText, '"linked" text node missing in DB JSON').toBeDefined();
    expect(
      (linkedText!.format & FORMAT_BIT.highlight) !== 0,
      'linked text should carry the highlight bit',
    ).toBe(true);
    const linkNode = findNodeContainingText(content.root, 'link', 'linked');
    expect(linkNode, 'expected a link node containing the text "linked"').toBeTruthy();
    expect(
      linkNode.url,
      'the link wrapping "linked" should carry the example.com URL',
    ).toBe('https://example.com');
  });

  // ── Image (decorator) boundary ─────────────────────────────────────

  const PNG_1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /** Paste a 1×1 PNG into the editor from the clipboard. */
  async function pasteImage(window: any) {
    await window.evaluate(async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }, PNG_1x1);
    await window.keyboard.press(`${mod}+v`);
    await window.waitForTimeout(2000);
  }

  test('pasted image cannot itself be highlighted — NodeSelection is a no-op for FORMAT_TEXT_COMMAND', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    await pasteImage(window);

    const editorRoot = window.locator('.ContentEditable__root');
    const imageContainer = editorRoot.locator('.image-container').first();
    await expect(imageContainer).toBeVisible();

    // Click the image to select it — produces a NodeSelection (see
    // src/components/editor/nodes/use-decorator-block.ts).
    await imageContainer.click();
    await window.waitForTimeout(200);

    // Apply highlight — should be a no-op against a NodeSelection on a DecoratorNode
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.waitForTimeout(300);

    // The image is still rendered, and no <mark> wraps it
    await expect(imageContainer).toBeVisible();
    await expect(editorRoot.locator('mark')).toHaveCount(0);

    // DB: an image node exists, and NO text node in the document has the highlight bit
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    expect(
      JSON.stringify(content).includes('"type":"image"'),
      'expected an image node in the saved JSON',
    ).toBe(true);
    const textNodes = findTextNodes(content.root);
    const anyHighlighted = textNodes.find((n) => (n.format & FORMAT_BIT.highlight) !== 0);
    expect(
      anyHighlighted,
      'no text node anywhere should carry the highlight bit after Cmd+Shift+H on a NodeSelection',
    ).toBeUndefined();
  });

  test('text adjacent to an image can be highlighted while the image itself is untouched', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Paste image, drop to a new paragraph below, type a caption
    await pasteImage(window);
    await window.keyboard.press('Enter');
    await window.keyboard.type('caption');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('.image-container').first()).toBeVisible();

    // Select the caption text and apply highlight
    await selectInParagraph(window, -1, 0, 'caption'.length);
    await window.keyboard.press(`${mod}+Shift+h`);

    // DOM: <mark>caption</mark> in the paragraph; image is still rendered
    await expect(editorRoot.locator('mark').filter({ hasText: 'caption' })).toBeVisible();
    await expect(editorRoot.locator('.image-container').first()).toBeVisible();

    // DB: both an image node AND a text node "caption" with the highlight bit
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    expect(
      JSON.stringify(content).includes('"type":"image"'),
      'expected the image node to still be in the saved JSON',
    ).toBe(true);
    const caption = findTextNodes(content.root).find((n) => n.text === 'caption');
    expect(caption, '"caption" text node missing in DB JSON').toBeDefined();
    expect(
      (caption!.format & FORMAT_BIT.highlight) !== 0,
      'caption should carry the highlight bit',
    ).toBe(true);
  });

  // ── More table scenarios ───────────────────────────────────────────

  test('highlight in a body (non-header) cell renders <td><mark>… and persists', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Insert a 3×3 table with a header row — row 0 is <th>, rows 1-2 are <td>
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Table' }).click();
    await window.waitForTimeout(500);

    // Tab from header cell 0 → header cell 1 → header cell 2 → body cell 0 (row 1, col 0).
    // Cursor lands in first header cell after insertion; tab three times to land in a <td>.
    await window.keyboard.press('Tab');
    await window.keyboard.press('Tab');
    await window.keyboard.press('Tab');

    await window.keyboard.type('body');
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+Shift+h`);

    // DOM: <mark>body</mark> is inside a <td> (not a <th>)
    const editorRoot = window.locator('.ContentEditable__root');
    await expect(
      editorRoot.locator('td mark').filter({ hasText: 'body' }),
      'highlight should render inside a <td>, not a <th>',
    ).toBeVisible();
    await expect(
      editorRoot.locator('th mark').filter({ hasText: 'body' }),
      'highlight should NOT be inside a <th> — that\'s the header cell test',
    ).toHaveCount(0);

    // DB: the cell containing "body" is a tablecell with headerState 0
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const cell = findNodeContainingText(content.root, ['tablecell', 'table-cell'], 'body');
    expect(cell, '"body" should live inside a tablecell node').toBeTruthy();
    expect(
      cell.headerState,
      `expected a body cell (headerState 0); got headerState=${cell.headerState}`,
    ).toBe(0);

    const bodyText = findTextNodes(content.root).find((n) => n.text === 'body');
    expect(bodyText).toBeDefined();
    expect((bodyText!.format & FORMAT_BIT.highlight) !== 0).toBe(true);
  });

  test('format does not leak between table cells when moving with Tab', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Table' }).click();
    await window.waitForTimeout(500);

    // Cell 0: type "alpha" with the highlight format active (toggle-then-type
    // pattern — Cmd+A in a table cell behaves unexpectedly so we don't rely on it).
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.type('alpha');
    await window.keyboard.press(`${mod}+Shift+h`);

    // Tab to the next cell. The question this test asks: does Lexical's "pending
    // format on cursor" state persist across Tab into a different cell?
    await window.keyboard.press('Tab');
    await window.waitForTimeout(200);

    // Cell 1: type "beta" — should land *without* highlight if the format
    // correctly resets at the cell boundary.
    await window.keyboard.type('beta');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);

    const nodes = findTextNodes(content.root);
    const alpha = nodes.find((n) => n.text === 'alpha');
    const beta = nodes.find((n) => n.text === 'beta');
    expect(alpha, '"alpha" text node missing').toBeDefined();
    expect(beta, '"beta" text node missing').toBeDefined();
    expect(
      (alpha!.format & FORMAT_BIT.highlight) !== 0,
      'alpha should keep its highlight bit',
    ).toBe(true);
    expect(
      beta!.format & FORMAT_BIT.highlight,
      'beta should NOT have the highlight bit — format must not leak across Tab',
    ).toBe(0);

    // DOM sanity: no <mark> wraps "beta"
    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('mark').filter({ hasText: 'beta' })).toHaveCount(0);
  });

  test('highlight + bold combined inside a table cell — both bits persist', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Table' }).click();
    await window.waitForTimeout(500);

    await window.keyboard.type('combo');
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+Shift+h`);
    await window.keyboard.press(`${mod}+b`);

    // DOM: both wrappers exist on "combo" inside the cell
    const editorRoot = window.locator('.ContentEditable__root');
    await expect(
      editorRoot.locator('th mark, td mark').filter({ hasText: 'combo' }),
    ).toBeVisible();
    await expect(
      editorRoot.locator('th strong, td strong, th .font-bold, td .font-bold').filter({ hasText: 'combo' }),
    ).toBeVisible();

    // DB: text node has both bits set
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const combo = findTextNodes(content.root).find((n) => n.text === 'combo');
    expect(combo).toBeDefined();
    const expected = FORMAT_BIT.bold | FORMAT_BIT.highlight;
    expect(
      combo!.format & expected,
      `expected bold+highlight bitmask ${expected} on "combo"; got ${combo!.format}`,
    ).toBe(expected);

    // Structural: "combo" lives inside a tablecell
    const cell = findNodeContainingText(content.root, ['tablecell', 'table-cell'], 'combo');
    expect(cell, '"combo" should live inside a tablecell node').toBeTruthy();
  });

  // ── Regression pin: Cmd+A → Cmd+Shift+H → Tab deletes cell content ──
  //
  // While writing the table tests we discovered that the sequence
  //   1. Type "alpha" in a table cell
  //   2. Cmd+A   (selects cell content)
  //   3. Cmd+Shift+H  (apply highlight)
  //   4. Tab     (advance to next cell)
  // leaves cell 0's paragraph empty with `textFormat: 128` set on it — "alpha"
  // is gone. The other table tests sidestep this by using toggle-then-type.
  //
  // Tracked in https://github.com/reddpy/lychee/issues/140 — remove the `.fixme`
  // once fixed to convert this into an active regression assertion.
  // Activated (was test.fixme) to confirm whether issue #140 still reproduces.
  // Asserts the CORRECT behaviour, so: passes ⇒ fixed, fails ⇒ still a bug.
  test(
    'regression: Cmd+A → Cmd+Shift+H → Tab in a table cell deletes the cell text (BUG)',
    async ({ window }) => {
      const title = window.locator('h1.editor-title');
      await title.click();
      await window.keyboard.press('Enter');

      await window.keyboard.type('/');
      await window.waitForTimeout(200);
      await window.getByRole('option', { name: 'Table' }).click();
      await window.waitForTimeout(500);

      // The exact failing sequence
      await window.keyboard.type('alpha');
      await window.keyboard.press(`${mod}+a`);
      await window.keyboard.press(`${mod}+Shift+h`);
      await window.keyboard.press('Tab');
      await window.waitForTimeout(200);
      await window.keyboard.type('beta');

      await window.waitForTimeout(1000);
      const doc = await getLatestDocumentFromDb(window);
      const content = JSON.parse(doc!.content);

      // Once fixed: both alpha and beta survive; only alpha carries highlight.
      const nodes = findTextNodes(content.root);
      const alpha = nodes.find((n) => n.text === 'alpha');
      const beta = nodes.find((n) => n.text === 'beta');
      expect(alpha, '"alpha" text node must survive Cmd+A → highlight → Tab').toBeDefined();
      expect(beta, '"beta" text node must exist in the next cell').toBeDefined();
      expect((alpha!.format & FORMAT_BIT.highlight) !== 0).toBe(true);
      expect(beta!.format & FORMAT_BIT.highlight).toBe(0);
    },
  );
});

// ─── Tier 1.5: Full app restart (manual lifecycle, separate from auto fixture) ───

function buildLaunchOpts(tmpDir: string) {
  const packagedBinary = findPackagedBinary();
  const opts: Parameters<typeof _electron.launch>[0] = {
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30_000,
  };
  const extraArgs = process.env.CI ? ['--no-sandbox'] : [];
  if (packagedBinary) {
    opts.executablePath = packagedBinary;
    opts.args = [`--user-data-dir=${tmpDir}`, ...extraArgs];
  } else if (hasDevBuild()) {
    opts.args = [PROJECT_ROOT, `--user-data-dir=${tmpDir}`, ...extraArgs];
  } else {
    throw new Error('No Electron build found.');
  }
  return opts;
}

async function launchAndGetWindow(tmpDir: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await _electron.launch(buildLaunchOpts(tmpDir));
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
  return { app, window };
}

base.describe('Text formats — Persistence across full app restart', () => {
  let tmpDir: string;

  base.beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-text-formats-persist-'));
  });

  base.afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  base('all six formats survive closing and relaunching the Electron app', async () => {
    // ── Session 1: create a note with all six formats ──
    let { app, window } = await launchAndGetWindow(tmpDir);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Restart Formats');
    await window.keyboard.press('Enter');

    for (const fmt of FORMATS) {
      await window.keyboard.press(fmt.shortcut);
      await window.keyboard.type(fmt.name);
      await window.keyboard.press(fmt.shortcut);
      await window.keyboard.type(' ');
    }
    await window.waitForTimeout(1500);

    await app.close();

    // ── Session 2: fresh process, open the note from the sidebar, verify ──
    ({ app, window } = await launchAndGetWindow(tmpDir));

    await window.locator('[data-note-id]').filter({ hasText: 'Restart Formats' }).click();
    await window.waitForTimeout(800);

    const editorRoot = window.locator('main:visible .ContentEditable__root');
    for (const fmt of FORMATS) {
      await expect(
        editorRoot.locator(fmt.domSelector).filter({ hasText: fmt.name }).first(),
        `${fmt.name} wrapper missing after app restart`,
      ).toBeVisible();
    }

    await app.close();
  });
});
