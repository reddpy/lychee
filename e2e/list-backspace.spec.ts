import { test, expect, getLatestDocumentFromDb } from './electron-app';
import type { Page } from '@playwright/test';

/**
 * E2E coverage for issue #222 — Backspace at the start of a list item should
 * convert it to a paragraph *in place* (Notion-style), not merge it up into the
 * previous item.
 *
 * The pure node transformation is unit-tested in
 * src/components/editor/plugins/__tests__/list-backspace.test.ts. These tests
 * cover the parts unit tests can't reach: the real keystroke → command path
 * (preempting Lexical's default merge), caret landing, and interactions with
 * nested lists, the title, undo, checklists, and selection state.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Put the caret into the body. A fresh note already has one empty paragraph, so
 * we click into it directly — pressing Enter from the title would leave a
 * spurious trailing empty paragraph that pollutes structure assertions.
 */
async function gotoBody(window: Page): Promise<void> {
  await window.locator('.ContentEditable__root p').first().click();
}

/**
 * Compact, deterministic snapshot of the body blocks (the title is skipped).
 * Lists are labelled by their Lexical list type and show each item's own text
 * (nested sub-list text excluded), e.g. `BULLET[A] | P("B") | NUMBER[x]`.
 */
function bodyStructure(window: Page): Promise<string> {
  return window.evaluate(() => {
    const root = document.querySelector('.ContentEditable__root');
    if (!root) return '(no editor root)';

    const ownText = (li: Element): string => {
      let text = '';
      for (const node of Array.from(li.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent ?? '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = (node as Element).tagName;
          if (tag !== 'UL' && tag !== 'OL') text += (node as Element).textContent ?? '';
        }
      }
      return text;
    };

    const parts: string[] = [];
    for (const el of Array.from(root.children)) {
      if (el.classList.contains('editor-title')) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listType = ((el as any).__lexicalListType ?? 'bullet') as string;
        const label = listType.toUpperCase();
        const items = Array.from(el.children)
          .filter((c) => c.tagName === 'LI')
          .map((li) => ownText(li));
        parts.push(`${label}[${items.join(',')}]`);
      } else if (tag === 'p') {
        parts.push(`P("${el.textContent ?? ''}")`);
      } else {
        parts.push(`${tag.toUpperCase()}("${el.textContent ?? ''}")`);
      }
    }
    return parts.join(' | ');
  });
}

/** Assert the body structure, polling so we don't race DOM reconciliation. */
async function expectStructure(window: Page, expected: string): Promise<void> {
  await expect.poll(() => bodyStructure(window), { timeout: 4000 }).toBe(expected);
}

/** Build a flat list by typing a markdown marker then items separated by Enter. */
async function buildList(window: Page, marker: string, items: string[]): Promise<void> {
  await window.keyboard.type(marker); // e.g. "- " or "1. "
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await window.keyboard.press('Enter');
    await window.keyboard.type(items[i]);
  }
}

/**
 * Put the caret at the very start of the Nth (0-based) list item. The short
 * settle wait lets the `Home` selection sync into Lexical before the next
 * keystroke — without it, a follow-up Backspace can race and read a stale
 * caret offset.
 */
async function caretToItemStart(window: Page, index: number): Promise<void> {
  await window.locator('.ContentEditable__root li').nth(index).click();
  await window.keyboard.press('Home');
  await window.waitForTimeout(60);
}

function bodyParagraphCount(window: Page): Promise<number> {
  return window.locator('.ContentEditable__root > p').count();
}

/** Insert a table at the caret via the slash command. */
async function insertTable(window: Page): Promise<void> {
  await window.keyboard.type('/');
  await window.waitForTimeout(200);
  await window.keyboard.type('table');
  await window.waitForTimeout(150);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(400);
}

/**
 * Compact structure of the block children of the first non-empty table cell —
 * the one we built our list in. Same labelling as `bodyStructure`.
 */
function cellStructure(window: Page): Promise<string> {
  return window.evaluate(() => {
    const root = document.querySelector('.ContentEditable__root');
    if (!root) return '(no editor root)';
    const cells = Array.from(root.querySelectorAll('td, th'));
    const cell = cells.find((c) => (c.textContent ?? '').trim().length > 0);
    if (!cell) return '(no non-empty cell)';

    const ownText = (li: Element): string => {
      let text = '';
      for (const node of Array.from(li.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
        else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = (node as Element).tagName;
          if (tag !== 'UL' && tag !== 'OL') text += (node as Element).textContent ?? '';
        }
      }
      return text;
    };

    const parts: string[] = [];
    for (const el of Array.from(cell.children)) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listType = ((el as any).__lexicalListType ?? 'bullet') as string;
        const items = Array.from(el.children)
          .filter((c) => c.tagName === 'LI')
          .map((li) => ownText(li));
        parts.push(`${listType.toUpperCase()}[${items.join(',')}]`);
      } else if (tag === 'p') {
        parts.push(`P("${el.textContent ?? ''}")`);
      } else {
        parts.push(`${tag.toUpperCase()}("${el.textContent ?? ''}")`);
      }
    }
    return parts.join(' | ');
  });
}

test.describe('List backspace → paragraph in place (#222)', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await gotoBody(window);
  });

  test('bullet middle item converts in place and the caret lands at its start', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B', 'C']);
    await expectStructure(window, 'BULLET[A,B,C]');

    await caretToItemStart(window, 1); // start of "B"
    await window.keyboard.press('Backspace');

    // B becomes a paragraph between the two list halves — no jump up.
    await expectStructure(window, 'BULLET[A] | P("B") | BULLET[C]');

    // Caret must be at the START of the new paragraph (proves no merge-up and
    // correct caret placement): typing prepends to "B".
    await window.keyboard.type('X');
    await expectStructure(window, 'BULLET[A] | P("XB") | BULLET[C]');
  });

  test('does NOT merge the item up into the previous one (core regression)', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B']);
    await caretToItemStart(window, 1);
    await window.keyboard.press('Backspace');

    // The previous item "A" is untouched; default Lexical would have made "AB".
    await expectStructure(window, 'BULLET[A] | P("B")');
  });

  test('first item converts, list continues below', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B', 'C']);
    await caretToItemStart(window, 0);
    await window.keyboard.press('Backspace');
    await expectStructure(window, 'P("A") | BULLET[B,C]');
  });

  test('last item converts below the list', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B', 'C']);
    await caretToItemStart(window, 2);
    await window.keyboard.press('Backspace');
    await expectStructure(window, 'BULLET[A,B] | P("C")');
  });

  test('only item: the list disappears, leaving a lone paragraph', async ({ window }) => {
    await buildList(window, '- ', ['A']);
    await caretToItemStart(window, 0);
    await window.keyboard.press('Backspace');
    await expectStructure(window, 'P("A")');
  });

  test('all following items move to the continuation, in order', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B', 'C', 'D', 'E']);
    await caretToItemStart(window, 2); // start of "C"
    await window.keyboard.press('Backspace');
    await expectStructure(window, 'BULLET[A,B] | P("C") | BULLET[D,E]');
  });

  test('empty middle item converts to an empty paragraph', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B', 'C']);
    // Empty out "B" in place: select its text and delete it.
    await caretToItemStart(window, 1);
    await window.keyboard.press(`Shift+End`);
    await window.waitForTimeout(60);
    await window.keyboard.press('Delete');
    await expectStructure(window, 'BULLET[A,,C]');

    // Now the caret is at the start of the empty item — convert it.
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');
    await expectStructure(window, 'BULLET[A] | P("") | BULLET[C]');
  });

  test('ordered list: continuation keeps numbering (start = 3)', async ({ window }) => {
    await buildList(window, '1. ', ['one', 'two', 'three']);
    await expectStructure(window, 'NUMBER[one,two,three]');

    await caretToItemStart(window, 1); // start of "two"
    await window.keyboard.press('Backspace');
    await expectStructure(window, 'NUMBER[one] | P("two") | NUMBER[three]');

    // The continuation <ol> must visually continue at 3.
    const ols = window.locator('.ContentEditable__root > ol');
    await expect(ols).toHaveCount(2);
    await expect(ols.nth(1)).toHaveAttribute('start', '3');
  });

  test('checklist: converts an item to a paragraph; continuation stays a checklist', async ({ window }) => {
    // Build a check list via the slash command.
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('A');
    await window.keyboard.press('Enter');
    await window.keyboard.type('B');
    await window.keyboard.press('Enter');
    await window.keyboard.type('C');
    await expectStructure(window, 'CHECK[A,B,C]');

    await caretToItemStart(window, 1); // start of "B"
    await window.keyboard.press('Backspace');

    // B is now a plain paragraph (no checkbox <li>); A and C remain check items.
    await expectStructure(window, 'CHECK[A] | P("B") | CHECK[C]');

    // Both halves are still genuine checklists (not plain bullets).
    const checkLists = window.locator('.ContentEditable__root > ul');
    await expect(checkLists).toHaveCount(2);
    const types = await checkLists.evaluateAll((els) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      els.map((e) => (e as any).__lexicalListType),
    );
    expect(types).toEqual(['check', 'check']);

    // The converted block is a paragraph — it carries no check-item classes.
    await expect(window.locator('.ContentEditable__root > p')).toHaveCount(1);
    await expect(
      window.locator('.ContentEditable__root > p.editor-list-item-checked, .ContentEditable__root > p.editor-list-item-unchecked'),
    ).toHaveCount(0);
  });

  test('checklist: Enter at the start preserves a checked task state, while Enter at its end starts unchecked (#240)', async ({ window }) => {
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Done');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Next');

    // Complete the first task through the real checklist click path.
    const items = window.locator('.ContentEditable__root li[role="checkbox"]');
    await items.nth(0).click({ position: { x: 10, y: 10 } });
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);

    // Splitting at its start creates a checked blank task above the checked
    // content, which is how Notion preserves the task state.
    await caretToItemStart(window, 0);
    await window.keyboard.press('Enter');
    await expectStructure(window, 'CHECK[,Done,Next]');
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);
    await expect(items.nth(1)).toHaveClass(/editor-list-item-checked/);
    await expect(items.nth(2)).toHaveClass(/editor-list-item-unchecked/);

    // A normal split at the end instead creates a fresh unchecked task.
    await items.nth(1).click();
    await window.keyboard.press('End');
    await window.waitForTimeout(60);
    await window.keyboard.press('Enter');
    await expectStructure(window, 'CHECK[,Done,,Next]');
    await expect(items.nth(2)).toHaveClass(/editor-list-item-unchecked/);
  });

  for (const splitIndex of [0, 1, 2]) {
    test(`checklist: splitting checked item ${splitIndex + 1} of 3 at its start preserves all task states (#240)`, async ({ window }) => {
      await window.keyboard.type('/');
      await window.waitForTimeout(200);
      await window.getByRole('option', { name: 'Check List' }).click();
      await window.waitForTimeout(200);
      await window.keyboard.type('A');
      await window.keyboard.press('Enter');
      await window.keyboard.type('B');
      await window.keyboard.press('Enter');
      await window.keyboard.type('C');

      const items = window.locator('.ContentEditable__root li[role="checkbox"]');
      await items.nth(splitIndex).click({ position: { x: 10, y: 10 } });
      await expect(items.nth(splitIndex)).toHaveClass(/editor-list-item-checked/);

      await caretToItemStart(window, splitIndex);
      await window.keyboard.press('Enter');

      const expectedItems = ['A', 'B', 'C'];
      expectedItems.splice(splitIndex, 0, '');
      await expectStructure(window, `CHECK[${expectedItems.join(',')}]`);
      await expect(items).toHaveCount(4);
      for (let index = 0; index < 4; index++) {
        const shouldBeChecked = index === splitIndex || index === splitIndex + 1;
        await expect(items.nth(index)).toHaveClass(
          shouldBeChecked ? /editor-list-item-checked/ : /editor-list-item-unchecked/,
        );
      }
    });
  }

  test('checklist: splitting an unchecked item at its start leaves both items unchecked (#240)', async ({ window }) => {
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('A');
    await window.keyboard.press('Enter');
    await window.keyboard.type('B');

    await caretToItemStart(window, 1);
    await window.keyboard.press('Enter');

    const items = window.locator('.ContentEditable__root li[role="checkbox"]');
    await expectStructure(window, 'CHECK[A,,B]');
    await expect(items).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      await expect(items.nth(index)).toHaveClass(/editor-list-item-unchecked/);
    }
  });

  test('checklist: splitting a checked nested item keeps the new item nested and checked (#240)', async ({ window }) => {
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Parent');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Nested task');
    await caretToItemStart(window, 1);
    await window.keyboard.press('Tab');
    await expect(window.locator('.ContentEditable__root li.editor-nested-list-item')).toHaveCount(1);

    const items = window.locator('.ContentEditable__root li[role="checkbox"]');
    await items.nth(1).click({ position: { x: 10, y: 10 } });
    await expect(items.nth(1)).toHaveClass(/editor-list-item-checked/);

    await caretToItemStart(window, 1);
    await window.keyboard.press('Enter');

    await expect(items).toHaveCount(3);
    // Lexical keeps a wrapper list item for the nested <ul>, alongside the
    // visible parent task at the outer level.
    await expect(window.locator('.ContentEditable__root > ul > li')).toHaveCount(2);
    await expect(window.locator('.ContentEditable__root > ul > li > ul > li')).toHaveCount(2);
    await expect(items.nth(0)).toHaveClass(/editor-list-item-unchecked/);
    await expect(items.nth(1)).toHaveClass(/editor-list-item-checked/);
    await expect(items.nth(2)).toHaveClass(/editor-list-item-checked/);
  });

  test('checklist: a mid-text split uses the normal unchecked continuation (#240)', async ({ window }) => {
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Done');

    const items = window.locator('.ContentEditable__root li[role="checkbox"]');
    await items.nth(0).click({ position: { x: 10, y: 10 } });
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);

    await caretToItemStart(window, 0);
    await window.keyboard.press('ArrowRight');
    await window.waitForTimeout(60);
    await window.keyboard.press('ArrowRight');
    await window.waitForTimeout(60);
    await window.keyboard.press('Enter');

    await expectStructure(window, 'CHECK[Do,ne]');
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);
    await expect(items.nth(1)).toHaveClass(/editor-list-item-unchecked/);
  });

  test('checklist: repeated start-splits keep every created task checked (#240)', async ({ window }) => {
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Done');

    const items = window.locator('.ContentEditable__root li[role="checkbox"]');
    await items.nth(0).click({ position: { x: 10, y: 10 } });
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);

    await caretToItemStart(window, 0);
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');

    await expectStructure(window, 'CHECK[,,Done]');
    await expect(items).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      await expect(items.nth(index)).toHaveClass(/editor-list-item-checked/);
    }
  });

  test('checklist: undo and redo restore a start-split and both checked states (#240)', async ({ window }) => {
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Done');

    const items = window.locator('.ContentEditable__root li[role="checkbox"]');
    await items.nth(0).click({ position: { x: 10, y: 10 } });
    await caretToItemStart(window, 0);
    await window.keyboard.press('Enter');
    await expectStructure(window, 'CHECK[,Done]');

    await window.keyboard.press(`${MOD}+z`);
    await expectStructure(window, 'CHECK[Done]');
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);

    await window.keyboard.press(`${MOD}+Shift+z`);
    await expectStructure(window, 'CHECK[,Done]');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);
    await expect(items.nth(1)).toHaveClass(/editor-list-item-checked/);
  });

  test('checklist: undo and redo preserve nesting and checked states after a nested start-split (#240)', async ({ window }) => {
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Parent');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Nested task');
    await caretToItemStart(window, 1);
    await window.keyboard.press('Tab');
    await expect(window.locator('.ContentEditable__root li.editor-nested-list-item')).toHaveCount(1);

    const items = window.locator('.ContentEditable__root li[role="checkbox"]');
    await items.nth(1).click({ position: { x: 10, y: 10 } });
    await caretToItemStart(window, 1);
    await window.keyboard.press('Enter');
    await expect(items).toHaveCount(3);
    await expect(items.nth(1)).toHaveClass(/editor-list-item-checked/);
    await expect(items.nth(2)).toHaveClass(/editor-list-item-checked/);

    await window.keyboard.press(`${MOD}+z`);
    await expect(items).toHaveCount(2);
    await expect(window.locator('.ContentEditable__root > ul > li > ul > li')).toHaveCount(1);
    await expect(items.nth(0)).toHaveClass(/editor-list-item-unchecked/);
    await expect(items.nth(1)).toHaveClass(/editor-list-item-checked/);

    await window.keyboard.press(`${MOD}+Shift+z`);
    await expect(items).toHaveCount(3);
    await expect(window.locator('.ContentEditable__root > ul > li > ul > li')).toHaveCount(2);
    await expect(items.nth(0)).toHaveClass(/editor-list-item-unchecked/);
    await expect(items.nth(1)).toHaveClass(/editor-list-item-checked/);
    await expect(items.nth(2)).toHaveClass(/editor-list-item-checked/);
  });

  test('checklist: a checked task in a table cell splits in place and stays checked (#240)', async ({ window }) => {
    await insertTable(window);
    const cell = window.locator('table.EditorTheme__table td').first();
    await cell.click();
    await window.keyboard.type('[ ] Done');

    const items = cell.locator('li[role="checkbox"]');
    await expect(items).toHaveCount(1);
    await items.nth(0).click({ position: { x: 10, y: 10 } });
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);

    await items.nth(0).click();
    await window.keyboard.press('Home');
    await window.waitForTimeout(60);
    await window.keyboard.press('Enter');

    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('CHECK[,Done]');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveClass(/editor-list-item-checked/);
    await expect(items.nth(1)).toHaveClass(/editor-list-item-checked/);
    await expect(window.locator('table.EditorTheme__table')).toHaveCount(1);
  });

  test('indented item: Backspace OUTDENTS (default), it does NOT convert to a paragraph', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B']);

    // Indent "B" so it becomes a nested list item under "A".
    await caretToItemStart(window, 1);
    await window.keyboard.press('Tab');
    await expect(window.locator('.ContentEditable__root li.editor-nested-list-item')).toHaveCount(1);

    // Backspace at the start of the nested item should outdent it back to a
    // top-level list item — Lexical's default — and must NOT create a paragraph.
    await caretToItemStart(window, 1);
    await window.keyboard.press('Backspace');

    await expect(window.locator('.ContentEditable__root li.editor-nested-list-item')).toHaveCount(0);
    expect(await bodyParagraphCount(window)).toBe(0);
    await expectStructure(window, 'BULLET[A,B]');
  });

  test('list as the first block: first Backspace converts to a paragraph, not into the title', async ({ window }) => {
    // The "- " shortcut converts the first (empty) body paragraph into a list,
    // so the list is the very first body block, right under the title.
    await buildList(window, '- ', ['A']);
    await expectStructure(window, 'BULLET[A]');

    await caretToItemStart(window, 0);
    await window.keyboard.press('Backspace');

    // Converted to a paragraph in place; the title is left empty (no merge).
    await expectStructure(window, 'P("A")');
    await expect(window.locator('h1.editor-title')).toHaveText('');

    // A *second* Backspace at the start of the first paragraph is the point at
    // which Notion-style title-merge kicks in (existing behavior).
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');
    await expect(window.locator('h1.editor-title')).toHaveText('A');
    await expectStructure(window, '');
  });

  test('undo restores the original list in a single step', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B', 'C']);
    await caretToItemStart(window, 1);
    await window.keyboard.press('Backspace');
    await expectStructure(window, 'BULLET[A] | P("B") | BULLET[C]');

    await window.keyboard.press(`${MOD}+z`);
    await expectStructure(window, 'BULLET[A,B,C]');
  });

  test('non-collapsed selection: Backspace deletes the selection, no conversion', async ({ window }) => {
    await buildList(window, '- ', ['Apple', 'Banana', 'Cherry']);

    // Select the whole text of the middle item (anchor at offset 0, but NOT
    // collapsed) — the handler must defer to the default delete.
    await caretToItemStart(window, 1);
    await window.keyboard.press('Shift+End');
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');

    await expectStructure(window, 'BULLET[Apple,,Cherry]');
    expect(await bodyParagraphCount(window)).toBe(0);
  });

  test('mid-text Backspace deletes a character (offset > 0, no conversion)', async ({ window }) => {
    await buildList(window, '- ', ['Apple', 'Banana', 'Cherry']);

    // Caret at the END of "Banana" — backspace should just delete one char.
    await window.locator('.ContentEditable__root li').nth(1).click();
    await window.keyboard.press('End');
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');

    await expectStructure(window, 'BULLET[Apple,Banan,Cherry]');
    expect(await bodyParagraphCount(window)).toBe(0);
  });

  test('converted structure is persisted to the database', async ({ window }) => {
    await buildList(window, '- ', ['A', 'B', 'C']);
    await caretToItemStart(window, 1);
    await window.keyboard.press('Backspace');
    await expectStructure(window, 'BULLET[A] | P("B") | BULLET[C]');

    // Wait for the debounced content save, then inspect the persisted JSON.
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyTypes = content.root.children
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => c.type)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((t: string) => t !== 'title');
    expect(bodyTypes).toEqual(['list', 'paragraph', 'list']);
  });

  test('inside a table cell: converts in place, the split stays within the cell', async ({ window }) => {
    await insertTable(window);

    // Build a bullet list inside the first data cell.
    const cell = window.locator('table.EditorTheme__table td').first();
    await cell.click();
    await window.keyboard.type('- A');
    await window.keyboard.press('Enter');
    await window.keyboard.type('B');
    await window.keyboard.press('Enter');
    await window.keyboard.type('C');
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('BULLET[A,B,C]');

    // Caret to the start of "B" (within the cell) and convert.
    await cell.locator('li').nth(1).click();
    await window.keyboard.press('Home');
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');

    // The split happens entirely inside the cell.
    await expect
      .poll(() => cellStructure(window), { timeout: 4000 })
      .toBe('BULLET[A] | P("B") | BULLET[C]');

    // The table is intact and nothing leaked out to the top level.
    await expect(window.locator('table.EditorTheme__table')).toHaveCount(1);
    await expect(window.locator('.ContentEditable__root > ul, .ContentEditable__root > ol')).toHaveCount(0);
  });

  test('inside a table cell: only item converts, list removed, paragraph stays in the cell', async ({ window }) => {
    await insertTable(window);

    const cell = window.locator('table.EditorTheme__table td').first();
    await cell.click();
    await window.keyboard.type('- solo');
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('BULLET[solo]');

    await cell.locator('li').first().click();
    await window.keyboard.press('Home');
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');

    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('P("solo")');
    await expect(window.locator('table.EditorTheme__table')).toHaveCount(1);
  });

  test('inside a table cell: the caret lands at the start of the converted paragraph', async ({ window }) => {
    await insertTable(window);
    const cell = window.locator('table.EditorTheme__table td').first();
    await cell.click();
    await window.keyboard.type('- A');
    await window.keyboard.press('Enter');
    await window.keyboard.type('B');
    await window.keyboard.press('Enter');
    await window.keyboard.type('C');

    await cell.locator('li').nth(1).click();
    await window.keyboard.press('Home');
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('BULLET[A] | P("B") | BULLET[C]');

    // Caret is at the start of the new paragraph → typing prepends to "B".
    await window.waitForTimeout(60);
    await window.keyboard.type('X');
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('BULLET[A] | P("XB") | BULLET[C]');
  });

  test('inside a table cell: Tab navigates cells and does NOT nest the list', async ({ window }) => {
    await insertTable(window);
    const cell = window.locator('table.EditorTheme__table td').first();
    await cell.click();
    await window.keyboard.type('- A');
    await window.keyboard.press('Enter');
    await window.keyboard.type('B');
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('BULLET[A,B]');

    // Tab inside a table is owned by the table (cell navigation), so it must
    // NOT indent the list into a nested structure.
    await cell.locator('li').nth(1).click();
    await window.keyboard.press('Home');
    await window.waitForTimeout(60);
    await window.keyboard.press('Tab');
    await window.waitForTimeout(100);
    await expect(window.locator('.ContentEditable__root li.editor-nested-list-item')).toHaveCount(0);
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('BULLET[A,B]');
  });

  test('inside a table cell: undo restores the list', async ({ window }) => {
    await insertTable(window);
    const cell = window.locator('table.EditorTheme__table td').first();
    await cell.click();
    await window.keyboard.type('- A');
    await window.keyboard.press('Enter');
    await window.keyboard.type('B');
    await window.keyboard.press('Enter');
    await window.keyboard.type('C');

    await cell.locator('li').nth(1).click();
    await window.keyboard.press('Home');
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('BULLET[A] | P("B") | BULLET[C]');

    await window.keyboard.press(`${MOD}+z`);
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('BULLET[A,B,C]');
  });

  test('inside a table cell: non-collapsed selection deletes, no conversion', async ({ window }) => {
    await insertTable(window);
    const cell = window.locator('table.EditorTheme__table td').first();
    await cell.click();
    await window.keyboard.type('- Apple');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Banana');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Cherry');

    // Select part of the middle item, then Backspace → default delete, NOT a
    // conversion. (We assert the invariant rather than the exact remaining text,
    // which depends on the precise caret start.)
    await cell.locator('li').nth(1).click();
    await window.keyboard.press('Home');
    await window.waitForTimeout(60);
    await window.keyboard.press('Shift+End');
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);

    const s = await cellStructure(window);
    // No paragraph was created (the handler deferred to the default delete)…
    expect(s).not.toContain('P(');
    // …it's still a single bullet list with the outer items intact.
    expect(s).toMatch(/^BULLET\[Apple,.*,Cherry\]$/);
  });

  test('inside a table cell: ordered list converts with numbering continuation', async ({ window }) => {
    await insertTable(window);
    const cell = window.locator('table.EditorTheme__table td').first();
    await cell.click();
    await window.keyboard.type('1. one');
    await window.keyboard.press('Enter');
    await window.keyboard.type('two');
    await window.keyboard.press('Enter');
    await window.keyboard.type('three');
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('NUMBER[one,two,three]');

    await cell.locator('li').nth(1).click();
    await window.keyboard.press('Home');
    await window.waitForTimeout(60);
    await window.keyboard.press('Backspace');
    await expect.poll(() => cellStructure(window), { timeout: 4000 }).toBe('NUMBER[one] | P("two") | NUMBER[three]');

    // The continuation list continues at 3.
    const ols = cell.locator('ol');
    await expect(ols).toHaveCount(2);
    await expect(ols.nth(1)).toHaveAttribute('start', '3');
  });
});
