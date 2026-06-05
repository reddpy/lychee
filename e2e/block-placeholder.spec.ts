import { test, expect, getLatestDocumentFromDb } from './electron-app';
import type { Page } from '@playwright/test';

/**
 * Tests for BlockPlaceholderPlugin — specifically the blur/focus fix:
 * Lexical selection survives blur, so the update listener alone never
 * cleared the paragraph placeholder when focus left the editor (e.g.
 * Escape, which @lexical/rich-text maps to editor.blur()). The plugin
 * now clears on BLUR_COMMAND and re-syncs on FOCUS_COMMAND.
 *
 * The plugin mutates the DOM directly (class + data-placeholder attr)
 * outside Lexical's reconciler, so undo/redo — which can recreate block
 * DOM nodes wholesale — is the main consistency risk: stale placeholders
 * on recreated nodes, duplicated placeholders, or class/attr mismatches.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const PARAGRAPH_PLACEHOLDER = "Type something, or press '/' for commands...";

/** Focus-driven paragraph placeholders in any editor body (title excluded by tag). */
function paragraphPlaceholders(window: Page) {
  return window.locator('.ContentEditable__root p.is-placeholder');
}

/** The visible (non-hidden) <main> — editors for other tabs stay mounted with display:none. */
function visibleMain(window: Page) {
  return window.locator('main:not([style*="display: none"])').first();
}

/**
 * Cross-cutting invariants that must hold after ANY sequence of edits,
 * undos, redos, blurs, and focuses:
 *  - at most one focus-driven paragraph placeholder exists at a time
 *  - the class and the data attribute are always applied/removed together
 *    (a mismatch means a stale DOM mutation survived reconciliation)
 */
async function checkInvariants(
  window: Page,
): Promise<{ paragraphCount: number; mismatched: string[]; pollutedStates: number }> {
  return window.evaluate(() => {
    const mismatched: string[] = [];
    let paragraphCount = 0;
    let pollutedStates = 0;
    for (const root of Array.from(document.querySelectorAll('.ContentEditable__root'))) {
      // The placeholder is a DOM-only decoration. The serialized editor
      // state — which is exactly what history entries and saves snapshot —
      // must NEVER contain it, in any editor, hidden tabs included.
      const editor = (root as any).__lexicalEditor;
      if (editor) {
        const json = JSON.stringify(editor.getEditorState().toJSON());
        if (json.includes('is-placeholder') || json.includes('data-placeholder')) {
          pollutedStates++;
        }
      }
      const candidates = new Set([
        ...Array.from(root.querySelectorAll('.is-placeholder')),
        ...Array.from(root.querySelectorAll('[data-placeholder]')),
      ]);
      for (const el of candidates) {
        if (el.classList.contains('editor-title')) continue; // title has its own placeholder
        const hasClass = el.classList.contains('is-placeholder');
        const hasAttr = el.hasAttribute('data-placeholder');
        if (hasClass !== hasAttr) {
          mismatched.push(`${el.tagName}: class=${hasClass} attr=${hasAttr}`);
        }
        if (el.tagName === 'P' && hasClass) paragraphCount++;
      }
    }
    return { paragraphCount, mismatched, pollutedStates };
  });
}

async function expectInvariants(window: Page) {
  const { paragraphCount, mismatched, pollutedStates } = await checkInvariants(window);
  expect(mismatched).toEqual([]);
  expect(paragraphCount).toBeLessThanOrEqual(1);
  expect(pollutedStates, 'placeholder artifacts leaked into a Lexical editor state').toBe(0);
}

/** Create a new note and place the caret in the (empty) first body paragraph. */
async function enterEmptyBody(window: Page, title?: string) {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  await visibleMain(window).locator('h1.editor-title').click();
  if (title) await window.keyboard.type(title);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(200);
}

test.describe('Block placeholder — visibility basics', () => {
  test('empty focused paragraph shows the placeholder', async ({ window }) => {
    await enterEmptyBody(window);

    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expect(paragraphPlaceholders(window).first()).toHaveAttribute(
      'data-placeholder',
      PARAGRAPH_PLACEHOLDER,
    );
    await expectInvariants(window);
  });

  test('typing hides the placeholder, deleting the text restores it', async ({ window }) => {
    await enterEmptyBody(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.type('a');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    // attribute must be gone too, not just the class
    await expect(window.locator('.ContentEditable__root p[data-placeholder]')).toHaveCount(0);

    await window.keyboard.press('Backspace');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('placeholder follows the caret across empty paragraphs, never duplicating', async ({ window }) => {
    await enterEmptyBody(window);
    // Three empty paragraphs, caret ends on the last
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Move the caret up — the placeholder must move with it, not multiply
    await window.keyboard.press('ArrowUp');
    await window.waitForTimeout(100);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.press('ArrowUp');
    await window.waitForTimeout(100);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('non-collapsed selection (select-all) hides the placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('hello');
    await window.keyboard.press('Enter');
    // caret on empty second paragraph → placeholder visible
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.press(`${mod}+a`);
    await window.waitForTimeout(100);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });
});

test.describe('Block placeholder — Escape and blur (the fix)', () => {
  test('Escape clears the paragraph placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // @lexical/rich-text maps Escape → editor.blur(); selection survives,
    // so only the BLUR_COMMAND handler can clear this.
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expect(window.locator('.ContentEditable__root p[data-placeholder]')).toHaveCount(0);
    await expectInvariants(window);
  });

  test('clicking back into the same empty paragraph restores the placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // clearPlaceholder() reset prevKey, so re-focusing the SAME paragraph
    // must re-apply (the skip-if-same-key fast path must not eat this).
    await visibleMain(window).locator('.ContentEditable__root p').last().click();
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expect(paragraphPlaceholders(window).first()).toHaveAttribute(
      'data-placeholder',
      PARAGRAPH_PLACEHOLDER,
    );
    await expectInvariants(window);
  });

  test('clicking outside the editor (sidebar) clears the placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.locator('aside[data-state]').click({ position: { x: 10, y: 400 } });
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });

  test('repeated focus/Escape cycles stay consistent', async ({ window }) => {
    await enterEmptyBody(window);

    for (let i = 0; i < 3; i++) {
      await expect(paragraphPlaceholders(window)).toHaveCount(1);
      await window.keyboard.press('Escape');
      await window.waitForTimeout(150);
      await expect(paragraphPlaceholders(window)).toHaveCount(0);
      await visibleMain(window).locator('.ContentEditable__root p').last().click();
      await window.waitForTimeout(150);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('Escape with text in the paragraph leaves no placeholder anywhere', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('some text');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });

  test('persistent heading placeholder survives Escape (paragraph placeholder does not)', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Heading 2' }).click();
    await window.waitForTimeout(300);

    // Empty heading gets a mutation-listener placeholder — persistent by design
    const h2 = window.locator('.ContentEditable__root h2.is-placeholder');
    await expect(h2).toHaveCount(1);
    await expect(h2.first()).toHaveAttribute('data-placeholder', 'Heading 2');

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    // Heading placeholder stays (it marks an empty block, not the caret)…
    await expect(h2).toHaveCount(1);
    // …but no focus-driven paragraph placeholder may remain
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
  });

  test('first Escape closes the slash menu and keeps focus; second Escape blurs', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await expect(window.getByRole('option', { name: 'Text' })).toBeVisible();
    // '/' is text content → no placeholder while the menu is open
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // Escape #1: typeahead menu consumes it, editor keeps focus
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(window.getByRole('option', { name: 'Text' })).not.toBeVisible();

    // Focus was retained: deleting the '/' brings the placeholder back
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Escape #2: now the editor blurs and the placeholder clears
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });
});

test.describe('Block placeholder — undo/redo consistency', () => {
  test('undo of typing restores the placeholder; redo hides it again', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('Hello world');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await window.waitForTimeout(300);

    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    // Paragraph is empty again and the editor is still focused → placeholder back
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expect(paragraphPlaceholders(window).first()).toHaveAttribute(
      'data-placeholder',
      PARAGRAPH_PLACEHOLDER,
    );

    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(window.locator('.ContentEditable__root')).toContainText('Hello world');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });

  test('undo/redo of a markdown heading transform leaves no stale heading placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('## ');
    await window.waitForTimeout(300);
    const h2 = window.locator('.ContentEditable__root h2:not(.editor-title)');
    await expect(h2).toHaveCount(1);
    await expect(window.locator('.ContentEditable__root h2.is-placeholder').first()).toHaveAttribute(
      'data-placeholder',
      'Heading 2',
    );

    // Undo until the heading reverts to a paragraph (transform + text may be
    // separate history entries depending on merge timing)
    for (let i = 0; i < 4 && (await h2.count()) > 0; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(200);
    }
    await expect(h2).toHaveCount(0);
    // No detached/stale "Heading 2" placeholder may survive the undo
    await expect(window.locator('.ContentEditable__root [data-placeholder="Heading 2"]')).toHaveCount(0);
    await expectInvariants(window);

    // Redo until the heading is back — its DOM node is recreated by the
    // reconciler, so the mutation listener must re-apply the placeholder
    for (let i = 0; i < 4 && (await h2.count()) === 0; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(200);
    }
    await expect(h2).toHaveCount(1);
    await expect(window.locator('.ContentEditable__root h2.is-placeholder').first()).toHaveAttribute(
      'data-placeholder',
      'Heading 2',
    );
    await expectInvariants(window);
  });

  test('undo/redo of a checklist transform re-applies the To-do placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('[ ] ');
    await window.waitForTimeout(300);
    const item = window.locator('.ContentEditable__root li.is-placeholder');
    await expect(item).toHaveCount(1);
    await expect(item.first()).toHaveAttribute('data-placeholder', 'To-do');

    const li = window.locator('.ContentEditable__root li');
    for (let i = 0; i < 4 && (await li.count()) > 0; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(200);
    }
    await expect(li).toHaveCount(0);
    await expect(window.locator('.ContentEditable__root [data-placeholder="To-do"]')).toHaveCount(0);
    await expectInvariants(window);

    for (let i = 0; i < 4 && (await li.count()) === 0; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(200);
    }
    await expect(item).toHaveCount(1);
    await expect(item.first()).toHaveAttribute('data-placeholder', 'To-do');
    await expectInvariants(window);
  });

  test('invariants hold at every step of a multi-paragraph undo/redo walk', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('One');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Two');
    await window.keyboard.press('Enter');
    // caret on a trailing empty paragraph
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await window.waitForTimeout(300);

    // Walk all the way back…
    for (let i = 0; i < 6; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(150);
      await expectInvariants(window);
    }
    // …and all the way forward. Reconciler recreates paragraph DOM nodes;
    // the plugin's cached prevParagraphDom must never produce duplicates.
    for (let i = 0; i < 6; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(150);
      await expectInvariants(window);
    }

    // Fully redone state: text restored, placeholder on the trailing empty paragraph
    await expect(window.locator('.ContentEditable__root')).toContainText('One');
    await expect(window.locator('.ContentEditable__root')).toContainText('Two');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
  });

  test('rapid undo/redo alternation does not desync the placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('flicker');
    await window.waitForTimeout(300);

    for (let i = 0; i < 4; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.keyboard.press(`${mod}+Shift+z`);
    }
    await window.waitForTimeout(300);
    await expectInvariants(window);

    // Net effect of equal undo/redo pairs: text present, no placeholder
    await expect(window.locator('.ContentEditable__root')).toContainText('flicker');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // One final undo: empty + focused → exactly one placeholder
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('undo after an Escape/refocus round-trip restores the placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('temporary');
    await window.waitForTimeout(300);

    // Blur via Escape, then come back — BLUR/FOCUS handlers ran in between
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await visibleMain(window).locator('.ContentEditable__root p').first().click();
    await window.waitForTimeout(200);
    // text present → still no placeholder
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });
});

/**
 * Lexical's HistoryPlugin coalesces edits within its merge window — the
 * default delay is 1000ms (verified in @lexical/react/LexicalHistoryPlugin).
 * Pausing longer than that between typed chunks forces separate history
 * entries, making undo step counts deterministic.
 */
const HISTORY_PAUSE = 1200;

/**
 * The consistency oracle: at any instant, a paragraph placeholder must exist
 * if and only if the editor is focused AND the caret sits collapsed in an
 * empty top-level paragraph — and then it must be on exactly that paragraph.
 * Checking this after every undo/redo keystroke verifies all intermediate
 * states, not just endpoints, regardless of how history entries coalesced.
 */
async function expectPlaceholderMatchesCaret(window: Page) {
  const r = await window.evaluate(() => {
    const active = document.activeElement;
    const roots = Array.from(document.querySelectorAll('.ContentEditable__root'));
    const focusedRoot = roots.find((rt) => rt === active || rt.contains(active)) ?? null;
    const sel = document.getSelection();
    // The caret's placeholder-eligible paragraph: the nearest ancestor <p>
    // that is either a top-level block (direct child of the root) or a
    // table-cell paragraph (cells are Lexical shadow roots, so the plugin's
    // getTopLevelElement() resolves to the cell paragraph itself).
    let caretParagraph: Element | null = null;
    if (focusedRoot && sel && sel.rangeCount > 0 && sel.isCollapsed) {
      let node: Node | null = sel.anchorNode;
      while (node && node !== focusedRoot) {
        const parentTag = (node.parentNode as Element | null)?.tagName ?? '';
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          (node as Element).tagName === 'P' &&
          (node.parentNode === focusedRoot || parentTag === 'TD' || parentTag === 'TH')
        ) {
          caretParagraph = node as Element;
          break;
        }
        node = node.parentNode;
      }
    }
    const expected = caretParagraph !== null && (caretParagraph.textContent ?? '') === '';
    const actual = roots.flatMap((rt) => Array.from(rt.querySelectorAll('p.is-placeholder')));
    // State purity: at every step of every undo/redo walk, no editor state
    // (= what history snapshots) may carry placeholder artifacts
    const statePure = roots.every((rt) => {
      const editor = (rt as any).__lexicalEditor;
      if (!editor) return true;
      const json = JSON.stringify(editor.getEditorState().toJSON());
      return !json.includes('is-placeholder') && !json.includes('data-placeholder');
    });
    const ok =
      statePure &&
      (expected ? actual.length === 1 && actual[0] === caretParagraph : actual.length === 0);
    return {
      ok,
      expected,
      statePure,
      actualCount: actual.length,
      caret: caretParagraph ? `${caretParagraph.tagName}:"${caretParagraph.textContent}"` : 'none',
    };
  });
  expect(r.ok, `placeholder/caret oracle: ${JSON.stringify(r)}`).toBe(true);
}

/** Serialize every body block's tag, text, and placeholder state for deep-equality checks. */
async function snapshotEditorState(window: Page) {
  return window.evaluate(() => {
    const main = Array.from(document.querySelectorAll('main')).find(
      (m) => (m as HTMLElement).style.display !== 'none',
    );
    const root = main?.querySelector('.ContentEditable__root');
    if (!root) return null;
    return Array.from(root.children)
      .filter((el) => !el.classList.contains('editor-title'))
      .map((el) => ({
        tag: el.tagName,
        text: el.textContent,
        placeholder: el.classList.contains('is-placeholder'),
        attr: el.getAttribute('data-placeholder'),
      }));
  });
}

async function undoStep(window: Page) {
  await window.keyboard.press(`${mod}+z`);
  await window.waitForTimeout(200);
}

async function redoStep(window: Page) {
  await window.keyboard.press(`${mod}+Shift+z`);
  await window.waitForTimeout(200);
}

test.describe('Block placeholder — typing undo/redo round-trips', () => {
  test('full undo/redo round-trip reproduces the exact DOM state — idempotent over two cycles', async ({ window }) => {
    await enterEmptyBody(window);
    // Mixed content: paragraph, heading transform, quote transform, trailing empty paragraph
    await window.keyboard.type('First paragraph');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter');
    await window.keyboard.type('## ');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.type('Section');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter');
    await window.keyboard.type('> ');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.type('Quote');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter'); // exits quote to a trailing empty paragraph
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    const original = await snapshotEditorState(window);
    expect(original).not.toBeNull();

    for (let cycle = 0; cycle < 2; cycle++) {
      // Walk to the history floor and back. Extra presses past floor/top are
      // no-ops, so equal counts always return to the top regardless of how
      // entries coalesced.
      for (let i = 0; i < 15; i++) await undoStep(window);
      for (let i = 0; i < 15; i++) await redoStep(window);
      await window.waitForTimeout(300);

      const after = await snapshotEditorState(window);
      expect(after, `round-trip cycle ${cycle + 1}`).toEqual(original);
      await expectPlaceholderMatchesCaret(window);
      await expectInvariants(window);
    }
  });

  test('stepwise undo of word-by-word typing: placeholder appears only at the empty state', async ({ window }) => {
    await enterEmptyBody(window);
    for (const word of ['one', ' two', ' three']) {
      await window.keyboard.type(word);
      await window.waitForTimeout(HISTORY_PAUSE);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    let undos = 0;
    while (undos < 6 && (await paragraphPlaceholders(window).count()) === 0) {
      await undoStep(window);
      undos++;
      await expectPlaceholderMatchesCaret(window); // intermediate "one two", "one" states included
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    for (let i = 0; i < undos; i++) {
      await redoStep(window);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(window.locator('.ContentEditable__root')).toContainText('one two three');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
  });

  test('retyping after undo behaves identically on every cycle', async ({ window }) => {
    await enterEmptyBody(window);
    for (let i = 0; i < 3; i++) {
      await window.keyboard.type('hello');
      await window.waitForTimeout(HISTORY_PAUSE);
      await expect(paragraphPlaceholders(window)).toHaveCount(0);

      await undoStep(window);
      await expect(paragraphPlaceholders(window)).toHaveCount(1);
      await expect(paragraphPlaceholders(window).first()).toHaveAttribute(
        'data-placeholder',
        PARAGRAPH_PLACEHOLDER,
      );
      await expectPlaceholderMatchesCaret(window);
    }
    await redoStep(window);
    await expect(window.locator('.ContentEditable__root')).toContainText('hello');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
  });

  test('typing after undo discards the redo branch without placeholder side effects', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('alpha');
    await window.waitForTimeout(HISTORY_PAUSE);
    await undoStep(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.type('beta');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // Redo is now a no-op — "alpha" must not resurface and no placeholder may flicker in
    await redoStep(window);
    const editor = window.locator('.ContentEditable__root');
    await expect(editor).toContainText('beta');
    await expect(editor).not.toContainText('alpha');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);
  });

  test('select-line + delete: undo restores text, redo re-empties with placeholder', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('wipe me');
    await window.waitForTimeout(HISTORY_PAUSE);

    // Shift+Home selects just this paragraph's text (Cmd+A would include the
    // title node — deleting that lands the caret in the title, not a paragraph).
    // Lexical ingests selectionchange asynchronously — let it settle before
    // deleting, or Backspace races the stale collapsed selection.
    await window.keyboard.press('Shift+Home');
    await window.waitForTimeout(200);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await undoStep(window);
    await expect(window.locator('.ContentEditable__root')).toContainText('wipe me');
    await expectPlaceholderMatchesCaret(window);

    await redoStep(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });

  test('select-line + overtype: undo/redo across the replace', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('old');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Shift+Home');
    await window.waitForTimeout(200);
    await window.keyboard.type('new');
    await window.waitForTimeout(HISTORY_PAUSE);
    const editor = window.locator('.ContentEditable__root');
    await expect(editor).toContainText('new');

    // Replace may be one or two history entries (delete + insert)
    for (let i = 0; i < 3 && !(await editor.textContent())?.includes('old'); i++) {
      await undoStep(window);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor).toContainText('old');
    await expect(editor).not.toContainText('new');

    for (let i = 0; i < 3 && !(await editor.textContent())?.includes('new'); i++) {
      await redoStep(window);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor).toContainText('new');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
  });

  test('character deletion then undo/redo of the deletions', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('abc');
    await window.waitForTimeout(HISTORY_PAUSE);
    for (let i = 0; i < 3; i++) {
      await window.keyboard.press('Backspace');
      await window.waitForTimeout(50);
    }
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    const editor = window.locator('.ContentEditable__root');
    for (let i = 0; i < 4 && !(await editor.textContent())?.includes('abc'); i++) {
      await undoStep(window);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor).toContainText('abc');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    for (let i = 0; i < 4 && (await paragraphPlaceholders(window).count()) === 0; i++) {
      await redoStep(window);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('typing in a heading: undo restores the persistent Heading placeholder, redo clears it', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('## ');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.type('Hi');
    await window.waitForTimeout(HISTORY_PAUSE);
    const h2Placeholder = window.locator('.ContentEditable__root h2.is-placeholder');
    await expect(h2Placeholder).toHaveCount(0);

    // Undo only the typing — the transform stays (separate history entry)
    await undoStep(window);
    await expect(window.locator('.ContentEditable__root h2:not(.editor-title)')).toHaveCount(1);
    await expect(h2Placeholder).toHaveCount(1);
    await expect(h2Placeholder.first()).toHaveAttribute('data-placeholder', 'Heading 2');
    await expectPlaceholderMatchesCaret(window); // and no paragraph placeholder anywhere

    await redoStep(window);
    await expect(window.locator('.ContentEditable__root h2:not(.editor-title)')).toContainText('Hi');
    await expect(h2Placeholder).toHaveCount(0);
    await expectInvariants(window);
  });

  test('typing in a quote: undo restores the quote placeholder, redo clears it', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('> ');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.type('Wisdom');
    await window.waitForTimeout(HISTORY_PAUSE);
    const quotePlaceholder = window.locator('.ContentEditable__root blockquote.is-placeholder');
    await expect(quotePlaceholder).toHaveCount(0);

    await undoStep(window);
    await expect(quotePlaceholder).toHaveCount(1);
    await expect(quotePlaceholder.first()).toHaveAttribute('data-placeholder', 'Enter a quote...');
    await expectPlaceholderMatchesCaret(window);

    await redoStep(window);
    await expect(window.locator('.ContentEditable__root blockquote')).toContainText('Wisdom');
    await expect(quotePlaceholder).toHaveCount(0);
    await expectInvariants(window);
  });

  test('typing in a checklist item: undo restores To-do, redo clears it', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('[ ] ');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.type('task');
    await window.waitForTimeout(HISTORY_PAUSE);
    const itemPlaceholder = window.locator('.ContentEditable__root li.is-placeholder');
    await expect(itemPlaceholder).toHaveCount(0);

    await undoStep(window);
    await expect(itemPlaceholder).toHaveCount(1);
    await expect(itemPlaceholder.first()).toHaveAttribute('data-placeholder', 'To-do');
    await expectPlaceholderMatchesCaret(window);

    await redoStep(window);
    await expect(window.locator('.ContentEditable__root li')).toContainText('task');
    await expect(itemPlaceholder).toHaveCount(0);
    await expectInvariants(window);
  });

  test('paste then undo restores the placeholder (paste is a separate insertion path)', async ({ electronApp, window }) => {
    await enterEmptyBody(window);
    await electronApp.evaluate(({ clipboard }) => {
      clipboard.writeText('Pasted body text');
    });
    await window.keyboard.press(`${mod}+v`);
    await window.waitForTimeout(400);
    const editor = window.locator('.ContentEditable__root');
    await expect(editor).toContainText('Pasted body text');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    for (let i = 0; i < 3 && (await paragraphPlaceholders(window).count()) === 0; i++) {
      await undoStep(window);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await redoStep(window);
    await expect(editor).toContainText('Pasted body text');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
  });

  test('deep undo past the paragraph creation and back — oracle holds at every step', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('x');
    await window.waitForTimeout(HISTORY_PAUSE);

    // 5 undos overshoot the floor: this also undoes the Enter-from-title that
    // created the paragraph (caret returns to the title — no placeholder).
    for (let i = 0; i < 5; i++) {
      await undoStep(window);
      await expectPlaceholderMatchesCaret(window);
      await expectInvariants(window);
    }
    // Equal redos restore everything.
    for (let i = 0; i < 5; i++) {
      await redoStep(window);
      await expectPlaceholderMatchesCaret(window);
      await expectInvariants(window);
    }
    await expect(window.locator('.ContentEditable__root')).toContainText('x');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
  });

  test('undo on a second paragraph re-shows the placeholder on that paragraph, not the first', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('filled');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await window.keyboard.type('second');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await undoStep(window);
    // Oracle verifies the placeholder is on the caret's (second) paragraph
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);
    await expect(window.locator('.ContentEditable__root')).toContainText('filled');

    await redoStep(window);
    await expect(window.locator('.ContentEditable__root')).toContainText('second');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
  });

  test('undo of title typing never produces a body paragraph placeholder', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('My Note');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await undoStep(window);
    // Caret is in the (now empty) title — the body paragraph plugin must stay silent
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);

    await redoStep(window);
    await expect(visibleMain(window).locator('h1.editor-title')).toContainText('My Note');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
  });

  test('formatting interleaved with typing: undo to empty and redo back, oracle at every step', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('ab');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press(`${mod}+b`);
    await window.keyboard.type('cd');
    await window.waitForTimeout(HISTORY_PAUSE);
    const editor = window.locator('.ContentEditable__root');
    await expect(editor.locator('strong, .font-bold').first()).toContainText('cd');

    let undos = 0;
    while (undos < 6 && (await paragraphPlaceholders(window).count()) === 0) {
      await undoStep(window);
      undos++;
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    for (let i = 0; i < undos; i++) {
      await redoStep(window);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor).toContainText('abcd');
    await expect(editor.locator('strong, .font-bold').first()).toContainText('cd');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });
});

test.describe('Block placeholder — hidden editors (tab switching)', () => {
  test('creating a second note clears the placeholder in the now-hidden editor', async ({ window }) => {
    await enterEmptyBody(window, 'Note A');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Editors stay mounted behind display:none — a stale placeholder in the
    // hidden editor would reappear the instant the tab is shown again.
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);

    const hiddenCount = await window.evaluate(() =>
      Array.from(document.querySelectorAll('main'))
        .filter((m) => (m as HTMLElement).style.display === 'none')
        .reduce((n, m) => n + m.querySelectorAll('p.is-placeholder').length, 0),
    );
    expect(hiddenCount).toBe(0);
    await expectInvariants(window);
  });

  test('switching back to a tab shows no placeholder until the editor is clicked', async ({ window }) => {
    await enterEmptyBody(window, 'Note A');
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('Note B');
    await window.waitForTimeout(300);

    await window.locator('[data-tab-id]').filter({ hasText: 'Note A' }).click();
    await window.waitForTimeout(400);

    // Tab activation must not resurrect the placeholder — the editor is not focused
    await expect(visibleMain(window).locator('p.is-placeholder')).toHaveCount(0);

    await visibleMain(window).locator('.ContentEditable__root p').last().click();
    await window.waitForTimeout(200);
    await expect(visibleMain(window).locator('p.is-placeholder')).toHaveCount(1);
    await expectInvariants(window);
  });
});

// ════════════════════════════════════════════════════════════════════
// Document-scale tests: the plugin must coexist with everything else —
// long documents, decorator nodes (images, dividers), tables, DB
// hydration, shared editors — without interfering or leaking state.
// ════════════════════════════════════════════════════════════════════

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Paste a 1×1 PNG into the editor from the clipboard. */
async function pasteImage(window: Page) {
  await window.evaluate(async (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, PNG_1x1);
  await window.keyboard.press(`${mod}+v`);
  await window.waitForTimeout(2000);
}

/** Close the active tab (unmounts the editor; reopening deserializes from DB). */
async function closeActiveTab(window: Page) {
  const activeTab = window.locator('[data-tab-id]').first();
  await activeTab.hover();
  await activeTab.locator('[aria-label="Close tab"]').click();
  await window.waitForTimeout(400);
}

test.describe('Block placeholder — document scale & interference', () => {
  test('natural writing session: long mixed document, edits, escape breaks, round-trip, clean serialization', async ({ window }) => {
    test.setTimeout(120_000);
    await enterEmptyBody(window, 'Meeting Notes 2026');

    // ── Write a realistic document ──
    await window.keyboard.type('# ');
    await window.keyboard.type('Q2 Planning');
    await window.keyboard.press('Enter');
    await window.keyboard.type('We met on Thursday to review the quarter ahead and divide ownership.');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Attendance was full; notes follow in rough order of discussion.');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.type('## ');
    await window.keyboard.type('Agenda');
    await window.keyboard.press('Enter');
    await window.keyboard.type('- ');
    await window.keyboard.type('Budget review');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Hiring plan');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Launch timeline');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter'); // exit list
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.type('> ');
    await window.keyboard.type('Ship early, ship often.');
    await window.keyboard.press('Enter'); // exit quote
    await window.waitForTimeout(HISTORY_PAUSE);

    // Natural typo + fix
    await window.keyboard.type('Discussion focused on teh plan');
    for (let i = 0; i < 8; i++) await window.keyboard.press('Backspace');
    await window.keyboard.type('the plan for launch.');
    await window.keyboard.press('Enter');
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.type('### ');
    await window.keyboard.type('Action items');
    await window.keyboard.press('Enter');
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('Email the team');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Book the room');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter'); // exit checklist
    await window.waitForTimeout(HISTORY_PAUSE);

    // Divider via slash command
    await window.keyboard.type('/div');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);
    await window.keyboard.type('Wrap-up.');
    await window.waitForTimeout(HISTORY_PAUSE);

    // ── Mid-session escape break, then resume ──
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);

    const editor = visibleMain(window).locator('.ContentEditable__root');
    await editor.locator('p').filter({ hasText: 'Wrap-up.' }).click();
    await window.keyboard.press('End');
    await window.keyboard.press('Enter');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Wander the caret through the document
    for (let i = 0; i < 5; i++) {
      await window.keyboard.press('ArrowUp');
      await window.waitForTimeout(80);
      await expectPlaceholderMatchesCaret(window);
    }
    for (let i = 0; i < 5; i++) await window.keyboard.press('ArrowDown');
    await window.waitForTimeout(200);

    // ── Full undo/redo round-trip over the whole session ──
    const before = await snapshotEditorState(window);
    expect(before).not.toBeNull();
    expect(before!.length).toBeGreaterThan(12); // sanity: this is a real document
    for (let i = 0; i < 45; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(80);
      if (i % 5 === 0) await expectPlaceholderMatchesCaret(window);
    }
    for (let i = 0; i < 45; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(80);
      if (i % 5 === 0) await expectPlaceholderMatchesCaret(window);
    }
    await window.waitForTimeout(400);
    expect(await snapshotEditorState(window)).toEqual(before);
    await expectInvariants(window);

    // ── Serialization purity: placeholder DOM hacks must never reach the DB ──
    await window.waitForTimeout(1200);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    expect(doc!.content).not.toContain('is-placeholder');
    expect(doc!.content).not.toContain('data-placeholder');
    const types = JSON.parse(doc!.content).root.children.map((c: any) => c.type);
    expect(types).toContain('heading');
    expect(types).toContain('list');
    expect(types).toContain('quote');
  });

  test('scattered empty paragraphs: caret walk lights up only the caret block', async ({ window }) => {
    await enterEmptyBody(window);
    // Realistic spacing pattern: text blocks separated by intentional blank lines
    await window.keyboard.type('top section');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');
    await window.keyboard.type('middle section');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');
    await window.keyboard.type('bottom section');
    await window.keyboard.press('Enter'); // trailing empty, caret here
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Walk to the top and back — at every stop, only the caret's block may
    // carry the placeholder, even though several empty paragraphs exist.
    for (let i = 0; i < 8; i++) {
      await window.keyboard.press('ArrowUp');
      await window.waitForTimeout(80);
      await expectPlaceholderMatchesCaret(window);
    }
    for (let i = 0; i < 8; i++) {
      await window.keyboard.press('ArrowDown');
      await window.waitForTimeout(80);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('images: decorator nodes, NodeSelection, and undo/redo of a paste', async ({ window }) => {
    test.setTimeout(90_000);
    await enterEmptyBody(window, 'Img Doc');
    await window.keyboard.type('Intro text');
    await window.keyboard.press('Enter');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await pasteImage(window);
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor.locator('.image-container').first()).toBeVisible();
    await expectPlaceholderMatchesCaret(window); // caret near a decorator — oracle still holds

    await window.keyboard.press('Enter');
    await window.keyboard.type('after image');
    await window.keyboard.press('Enter');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await window.waitForTimeout(HISTORY_PAUSE);

    // Clicking the image leaves the Lexical range selection untouched (the
    // decorator manages its own selected state), so the placeholder on the
    // trailing empty paragraph legitimately stays — pin that behavior
    await editor.locator('.image-container').first().click();
    await window.waitForTimeout(300);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);

    // Escape still blurs and clears, image selected or not
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // Back in, then undo the whole construction and redo it
    await editor.locator('p').last().click();
    await window.waitForTimeout(200);
    await expectPlaceholderMatchesCaret(window);

    for (let i = 0; i < 8; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(150);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor.locator('.image-container')).toHaveCount(0);

    for (let i = 0; i < 8; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(150);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor.locator('.image-container')).toHaveCount(1);
    await expect(editor).toContainText('after image');
    await expectInvariants(window);
  });

  test('reopen from DB: hydration summons no placeholders and pollutes no history', async ({ window }) => {
    test.setTimeout(90_000);
    await enterEmptyBody(window, 'Hydration Doc');
    await window.keyboard.type('alpha content');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter'); // intentional blank line
    await pasteImage(window);
    await window.keyboard.press('Enter');
    // Checklist last: 'todo one' + Enter leaves a trailing EMPTY item.
    // (Enter on an empty item would exit the list and destroy it.)
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('todo one');
    await window.keyboard.press('Enter');
    await expect(visibleMain(window).locator('li.is-placeholder')).toHaveCount(1);
    await window.waitForTimeout(1500); // debounced save

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'Hydration Doc' }).click();
    await window.waitForTimeout(2500); // hydration + image path resolution editor.update()s

    // Hydration fired several editor updates — none may produce a focus
    // placeholder (editor is not focused after reopen)
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    // …but the PERSISTENT empty-checklist placeholder must be re-applied by
    // the mutation listeners even without focus
    await expect(visibleMain(window).locator('li.is-placeholder')).toHaveCount(1);
    await expectInvariants(window);

    // Click into the trailing empty paragraph → placeholder appears
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await editor.locator('p').last().click();
    await window.waitForTimeout(200);
    await expectPlaceholderMatchesCaret(window);

    // History must be empty after hydration (all hydration updates are
    // history-merged): undo must NOT eat the document
    for (let i = 0; i < 3; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(150);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor).toContainText('alpha content');
    await expect(editor.locator('.image-container')).toHaveCount(1);

    // New edits after reopen undo cleanly back to the hydrated state
    await editor.locator('p').last().click();
    await window.keyboard.type('fresh edit');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(editor).not.toContainText('fresh edit');
    await expect(editor).toContainText('alpha content');
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });

  test('checklist storm: mouse toggles never spawn paragraph placeholders; undo reverts toggles', async ({ window }) => {
    await enterEmptyBody(window, 'Checklist Doc');
    await window.keyboard.type('[ ] ');
    for (let i = 1; i <= 5; i++) {
      await window.keyboard.type(`task ${i}`);
      await window.keyboard.press('Enter');
    }
    await window.keyboard.press('Enter'); // exit checklist
    await window.keyboard.type('end note');
    await window.waitForTimeout(HISTORY_PAUSE);

    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor.locator('li.editor-list-item-unchecked')).toHaveCount(5);

    // Toggle three boxes by mouse — each is an editor update with no caret
    // in a paragraph; no focus placeholder may flicker in
    for (const idx of [0, 2, 4]) {
      await editor.locator('li.editor-list-item-unchecked, li.editor-list-item-checked')
        .nth(idx).click({ position: { x: 10, y: 10 } });
      await window.waitForTimeout(250);
      await expect(paragraphPlaceholders(window)).toHaveCount(0);
      await expectInvariants(window);
    }
    await expect(editor.locator('li.editor-list-item-checked')).toHaveCount(3);

    // Toggles are history entries: undo them all from the keyboard
    await editor.locator('p').filter({ hasText: 'end note' }).click();
    let undos = 0;
    while (undos < 8 && (await editor.locator('li.editor-list-item-checked').count()) > 0) {
      await window.keyboard.press(`${mod}+z`);
      undos++;
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor.locator('li.editor-list-item-checked')).toHaveCount(0);

    for (let i = 0; i < undos; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor.locator('li.editor-list-item-checked')).toHaveCount(3);
    await expectInvariants(window);
  });

  test('tables: cell placeholders follow the caret through Tab nav, typing, undo, and Escape', async ({ window }) => {
    await enterEmptyBody(window, 'Table Doc');
    await window.keyboard.type('/table');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(500);

    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor.locator('table')).toHaveCount(1);

    // Cells are Lexical shadow roots, so cell paragraphs DO get the focus
    // placeholder — with the shorter cell-specific text. Insert leaves the
    // caret in the first cell.
    const cellPlaceholder = editor.locator('td p.is-placeholder, th p.is-placeholder');
    await expect(cellPlaceholder).toHaveCount(1);
    await expect(cellPlaceholder.first()).toHaveAttribute('data-placeholder', "Type or press '/'");
    await expectPlaceholderMatchesCaret(window);

    // Typing clears it; Tab moves it to the next (empty) cell
    await window.keyboard.type('cell A');
    await expect(cellPlaceholder).toHaveCount(0);
    await window.keyboard.press('Tab');
    await window.waitForTimeout(200);
    await expect(cellPlaceholder).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.type('cell B');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(cellPlaceholder).toHaveCount(0);

    // Emptying the cell brings it back
    for (let i = 0; i < 6; i++) await window.keyboard.press('Backspace');
    await window.waitForTimeout(200);
    await expect(cellPlaceholder).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);

    // Undo the clearing — cell text returns, placeholder goes
    for (let i = 0; i < 4 && !(await editor.textContent())?.includes('cell B'); i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(200);
      await expectInvariants(window);
    }
    await expect(editor).toContainText('cell B');
    await expect(cellPlaceholder).toHaveCount(0);

    // Escape is two-stage in tables: the table plugin consumes the first one
    // and moves the caret out to the adjacent top-level paragraph — the
    // placeholder must FOLLOW it out of the cell, not linger inside
    for (let i = 0; i < 8; i++) await window.keyboard.press('Backspace');
    await window.waitForTimeout(200);
    await expect(cellPlaceholder).toHaveCount(1);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(250);
    await expect(cellPlaceholder).toHaveCount(0);
    await expect(paragraphPlaceholders(window)).toHaveCount(1); // now on the top-level paragraph
    await expect(paragraphPlaceholders(window).first()).toHaveAttribute(
      'data-placeholder',
      PARAGRAPH_PLACEHOLDER,
    );
    await expectPlaceholderMatchesCaret(window);

    // The second Escape reaches rich-text's blur handler → everything clears
    await window.keyboard.press('Escape');
    await window.waitForTimeout(250);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });

  test('multi-block selection delete and restore', async ({ window }) => {
    await enterEmptyBody(window);
    const lines = ['line one', 'line two', 'line three', 'line four', 'line five'];
    for (const [i, line] of lines.entries()) {
      await window.keyboard.type(line);
      if (i < lines.length - 1) await window.keyboard.press('Enter');
    }
    await window.waitForTimeout(HISTORY_PAUSE);

    const editor = visibleMain(window).locator('.ContentEditable__root');
    const bodyParagraphs = editor.locator('> p');
    // Relative counts: the new-note template contributes its own trailing paragraph
    const fullCount = await bodyParagraphs.count();
    expect(fullCount).toBeGreaterThanOrEqual(5);

    // Select across three blocks — non-collapsed: no placeholder
    for (let i = 0; i < 3; i++) await window.keyboard.press('Shift+ArrowUp');
    await window.waitForTimeout(250); // let Lexical ingest the selection
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await window.keyboard.press('Backspace');
    await window.waitForTimeout(250);
    await expectPlaceholderMatchesCaret(window);
    expect(await bodyParagraphs.count()).toBeLessThan(fullCount);

    for (let i = 0; i < 5 && (await bodyParagraphs.count()) < fullCount; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(bodyParagraphs).toHaveCount(fullCount);
    for (const line of lines) await expect(editor).toContainText(line);

    for (let i = 0; i < 5 && (await bodyParagraphs.count()) === fullCount; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    expect(await bodyParagraphs.count()).toBeLessThan(fullCount);
    await expectInvariants(window);
  });

  test('Enter-spam stress: 25 empty paragraphs, undo storm with the oracle at every step', async ({ window }) => {
    test.setTimeout(120_000);
    await enterEmptyBody(window);
    for (let i = 0; i < 25; i++) {
      await window.keyboard.press('Enter');
      if (i % 5 === 4) await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    const before = await snapshotEditorState(window);

    // Mass reconciliation both directions — the plugin's cached DOM
    // reference must never go stale or duplicate
    for (let i = 0; i < 30; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(120);
      await expectPlaceholderMatchesCaret(window);
    }
    for (let i = 0; i < 30; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(120);
      await expectPlaceholderMatchesCaret(window);
    }
    await window.waitForTimeout(300);
    expect(await snapshotEditorState(window)).toEqual(before);
    await expectInvariants(window);
  });

  test('duplicate tabs (shared editor): switching never desyncs the placeholder', async ({ window }) => {
    await enterEmptyBody(window, 'Dup Doc');
    await window.waitForTimeout(700); // let the title save so the doc is identifiable
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    const docId = await window.evaluate(() => {
      const s = (window as any).__documentStore.getState();
      const tab = s.openTabs.find((t: any) => t.tabId === s.selectedId);
      return tab?.docId as string;
    });

    // Open a duplicate tab for the same doc — same editor instance, selection
    // is stashed/restored per tab by TabSelectionPlugin (history-merge updates)
    const dupTabId = await window.evaluate((id: string) => {
      const store = (window as any).__documentStore;
      const before = new Set(store.getState().openTabs.map((t: any) => t.tabId));
      store.getState().openTab(id);
      return store.getState().openTabs
        .find((t: any) => !before.has(t.tabId) && t.docId === id)?.tabId as string;
    }, docId);
    await window.waitForTimeout(400);
    // Fresh duplicate has no saved selection → no placeholder may survive the switch
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);

    // Bounce between the two tabs several times — selection save/restore
    // cycles through history-merge updates each time
    const tabs = await window.evaluate(() =>
      (window as any).__documentStore.getState().openTabs.map((t: any) => t.tabId),
    );
    for (let i = 0; i < 4; i++) {
      await window.evaluate(
        (id: string) => (window as any).__documentStore.getState().selectDocument(id),
        tabs[i % 2],
      );
      await window.waitForTimeout(300);
      await expectPlaceholderMatchesCaret(window);
      await expectInvariants(window);
    }

    // Editing still works normally in the duplicate
    await window.evaluate(
      (id: string) => (window as any).__documentStore.getState().selectDocument(id),
      dupTabId,
    );
    await window.waitForTimeout(300);
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await editor.locator('p').last().click();
    await window.waitForTimeout(200);
    await expectPlaceholderMatchesCaret(window);
    await window.keyboard.type('shared editor text');
    await expect(editor).toContainText('shared editor text');
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(editor).not.toContainText('shared editor text');
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });
});

// ════════════════════════════════════════════════════════════════════
// Escape → refocus → edit flows: the complete user journey around the
// fix. Leaving the editor must be cleanly resumable — typing, history,
// transforms, and formatting all behave as if the blur never happened,
// and blur/focus themselves must contribute NOTHING to history.
// ════════════════════════════════════════════════════════════════════

/** The last body paragraph in the visible editor. */
function lastBodyParagraph(window: Page) {
  return visibleMain(window).locator('.ContentEditable__root p').last();
}

/** Click back into the last paragraph and put the caret at its end. */
async function refocusAtEnd(window: Page) {
  await lastBodyParagraph(window).click();
  await window.keyboard.press('End');
  await window.waitForTimeout(150);
}

/**
 * Click back into the paragraph containing `text` and put the caret at its
 * end — "resume where I was editing". (The new-note template keeps a trailing
 * empty paragraph, so p.last() is NOT the edited paragraph.)
 */
async function refocusText(window: Page, text: string) {
  await visibleMain(window)
    .locator('.ContentEditable__root p')
    .filter({ hasText: text })
    .first()
    .click();
  await window.keyboard.press('End');
  await window.waitForTimeout(150);
}

test.describe('Block placeholder — escape → refocus → edit flows', () => {
  test('escape, verify gone, refocus, type — the basic resume', async ({ window }) => {
    await enterEmptyBody(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await refocusAtEnd(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.type('resumed typing');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('resumed typing');
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });

  test('type, escape, refocus, undo, redo — history works across a blur round-trip', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('persist me');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await refocusText(window, 'persist me');
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('persist me');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });

  test('blur/focus contribute NOTHING to history: 5 escape cycles, then one undo kills the whole edit', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('abc');
    await window.waitForTimeout(HISTORY_PAUSE);

    // Five full blur/refocus cycles — if BLUR/FOCUS handlers (or the click
    // selection changes) pushed history entries, undo would need to chew
    // through them first
    for (let i = 0; i < 5; i++) {
      await window.keyboard.press('Escape');
      await window.waitForTimeout(150);
      await expect(paragraphPlaceholders(window)).toHaveCount(0);
      await refocusText(window, 'abc');
    }

    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    // ONE undo removes the typing — proof the cycles added zero entries
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('abc');
    await expectInvariants(window);
  });

  test('redo stack survives a blur round-trip', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('temp text');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Blur with a pending redo, then come back
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await refocusAtEnd(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // The redo must still be there — selection-only updates don't discard it
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('temp text');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);
  });

  test('escape-segmented typing: chunks written across blur breaks undo back step by step', async ({ window }) => {
    await enterEmptyBody(window);
    let written = '';
    for (const chunk of ['one', ' two', ' three']) {
      await window.keyboard.type(chunk);
      written += chunk;
      await window.waitForTimeout(HISTORY_PAUSE);
      await window.keyboard.press('Escape');
      await window.waitForTimeout(150);
      await expect(paragraphPlaceholders(window)).toHaveCount(0);
      // Resume at the end of the text written so far, not in another block
      await refocusText(window, written);
    }
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor).toContainText('one two three');

    let undos = 0;
    while (undos < 8 && (await paragraphPlaceholders(window).count()) === 0) {
      await window.keyboard.press(`${mod}+z`);
      undos++;
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    for (let i = 0; i < undos; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor).toContainText('one two three');
    await expectInvariants(window);
  });

  test('refocus into a DIFFERENT empty paragraph than the one escaped from', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('top');
    await window.keyboard.press('Enter'); // empty paragraph (index 1)
    await window.keyboard.press('Enter'); // empty paragraph (index 2), caret here
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // Click the FIRST empty paragraph, not the one we escaped from — the
    // oracle verifies the placeholder is on the clicked element specifically
    await visibleMain(window).locator('.ContentEditable__root p').nth(1).click();
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });

  test('escape, refocus, markdown transform, escape, refocus, undo the transform', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(150);
    await refocusAtEnd(window);

    await window.keyboard.type('## ');
    await window.waitForTimeout(HISTORY_PAUSE);
    const h2 = window.locator('.ContentEditable__root h2:not(.editor-title)');
    await expect(h2).toHaveCount(1);
    await expect(window.locator('.ContentEditable__root h2.is-placeholder')).toHaveCount(1);

    // Persistent heading placeholder survives the blur; refocus and undo
    await window.keyboard.press('Escape');
    await window.waitForTimeout(150);
    await expect(window.locator('.ContentEditable__root h2.is-placeholder')).toHaveCount(1);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await h2.click();
    await window.waitForTimeout(150);
    for (let i = 0; i < 3 && (await h2.count()) > 0; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(200);
    }
    await expect(h2).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });

  test('escape, refocus, slash-command insert, undo, redo', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(150);
    await refocusAtEnd(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.type('/div');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);
    const hr = visibleMain(window).locator('.ContentEditable__root hr');
    await expect(hr).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    for (let i = 0; i < 4 && (await hr.count()) > 0; i++) {
      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(hr).toHaveCount(0);

    for (let i = 0; i < 4 && (await hr.count()) === 0; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(hr).toHaveCount(1);
    await expectInvariants(window);
  });

  test('blur via sidebar click instead of Escape: same resume flows hold', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('sidebar blur');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.locator('aside[data-state]').click({ position: { x: 10, y: 400 } });
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await refocusAtEnd(window);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('sidebar blur');
    await expectInvariants(window);
  });

  test('escape with a word selected, refocus, append, undo chain', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('select me now');
    await window.waitForTimeout(HISTORY_PAUSE);

    // Double-click selects a word → non-collapsed → no placeholder anyway
    await visibleMain(window)
      .locator('.ContentEditable__root p')
      .filter({ hasText: 'select me now' })
      .first()
      .dblclick();
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);

    const editor = visibleMain(window).locator('.ContentEditable__root');
    await editor.locator('p').filter({ hasText: 'select me now' }).click();
    await window.keyboard.press('End');
    await window.keyboard.type(' appended');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(editor).toContainText('select me now appended');

    let undos = 0;
    while (undos < 6 && (await paragraphPlaceholders(window).count()) === 0) {
      await window.keyboard.press(`${mod}+z`);
      undos++;
      await window.waitForTimeout(200);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('escape, switch note, return, undo — per-note history isolation across blur', async ({ window }) => {
    await enterEmptyBody(window, 'Note Alpha');
    await window.keyboard.type('alpha text');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await enterEmptyBody(window, 'Note Beta');
    await window.keyboard.type('beta text');
    await window.waitForTimeout(700);

    // Return to Alpha via its tab, refocus, undo — only Alpha's edit reverts
    await window.locator('[data-tab-id]').filter({ hasText: 'Note Alpha' }).click();
    await window.waitForTimeout(400);
    await expect(paragraphPlaceholders(window)).toHaveCount(0); // unfocused on arrival

    const editor = visibleMain(window).locator('.ContentEditable__root');
    await editor.locator('p').filter({ hasText: 'alpha text' }).click();
    await window.keyboard.press('End');
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(editor).not.toContainText('alpha text');
    await expectPlaceholderMatchesCaret(window);

    // Beta is untouched
    await window.locator('[data-tab-id]').filter({ hasText: 'Note Beta' }).click();
    await window.waitForTimeout(400);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('beta text');
    await expectInvariants(window);
  });

  test('escape from a checklist, refocus the empty item, type, undo, redo', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('todo one');
    await window.keyboard.press('Enter'); // trailing empty item, caret in it
    await window.waitForTimeout(HISTORY_PAUSE);
    const emptyItem = visibleMain(window).locator('li.is-placeholder');
    await expect(emptyItem).toHaveCount(1);

    // Escape: paragraph placeholders clear, the persistent To-do stays
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expect(emptyItem).toHaveCount(1);

    // Click into the empty item's text area (x offset avoids the checkbox)
    await visibleMain(window).locator('li').last().click({ position: { x: 40, y: 8 } });
    await window.waitForTimeout(200);
    await window.keyboard.type('todo two');
    await expect(emptyItem).toHaveCount(0);
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(emptyItem).toHaveCount(1);
    await expect(emptyItem.first()).toHaveAttribute('data-placeholder', 'To-do');

    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('todo two');
    await expect(emptyItem).toHaveCount(0);
    await expectInvariants(window);
  });

  test('rapid escape/refocus/type interleaving, then unwind it all', async ({ window }) => {
    await enterEmptyBody(window);
    const chars = ['a', 'b', 'c', 'd'];
    for (const ch of chars) {
      await refocusAtEnd(window);
      await window.keyboard.type(ch);
      await window.keyboard.press('Escape');
      await window.waitForTimeout(120);
      await expect(paragraphPlaceholders(window)).toHaveCount(0);
      await expectInvariants(window);
    }
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor).toContainText('abcd');

    await refocusAtEnd(window);
    let undos = 0;
    while (undos < 10 && (await paragraphPlaceholders(window).count()) === 0) {
      await window.keyboard.press(`${mod}+z`);
      undos++;
      await window.waitForTimeout(180);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    for (let i = 0; i < undos; i++) {
      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(180);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(editor).toContainText('abcd');
    await expectInvariants(window);
  });

  test('escape, refocus, bold-toggle on empty selection, type, unwind', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(150);
    await refocusAtEnd(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Format toggle on a collapsed selection is a pending state, not an edit —
    // the placeholder must stay until actual text lands
    await window.keyboard.press(`${mod}+b`);
    await window.waitForTimeout(150);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.type('bold');
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor.locator('strong, .font-bold').first()).toContainText('bold');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(150);
    await refocusAtEnd(window);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(editor.locator('strong, .font-bold').first()).toContainText('bold');
    await expectInvariants(window);
  });

  test('escape from the title, then resume in the body', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.waitForTimeout(150);
    await expect(paragraphPlaceholders(window)).toHaveCount(0); // caret in title

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);

    await refocusAtEnd(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await window.keyboard.type('body after title escape');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('body after title escape');
    await expectInvariants(window);
  });
});

// ════════════════════════════════════════════════════════════════════
// History integrity: state-level validation. Lexical attaches the editor
// to its root DOM node, so we can serialize the REAL editor state — the
// thing history entries snapshot — and prove that walking history down
// and back up traverses the exact same states, with the placeholder
// correct at every depth. Plus keyboard-editing breadth: every deletion
// granularity, split/merge, indent, and transform an editor must honor.
// ════════════════════════════════════════════════════════════════════

/** Serialized Lexical editor state of the visible editor (no DOM, no selection). */
async function getEditorStateJson(window: Page): Promise<string> {
  return window.evaluate(() => {
    const main = Array.from(document.querySelectorAll('main')).find(
      (m) => (m as HTMLElement).style.display !== 'none',
    );
    const root = main?.querySelector('.ContentEditable__root') as any;
    const editor = root?.__lexicalEditor;
    if (!editor) throw new Error('no __lexicalEditor on visible root');
    return JSON.stringify(editor.getEditorState().toJSON());
  });
}

/**
 * The deep history validator: undo to the floor, recording the serialized
 * editor state at every depth, then redo back to the top asserting each
 * step reproduces the EXACT state seen on the way down (mirror property).
 * The placeholder oracle runs at every single step in both directions.
 */
async function validateHistoryReplay(window: Page, maxSteps = 25): Promise<number> {
  const initial = await getEditorStateJson(window);
  const undoStates: string[] = [];
  let prev = initial;
  let steps = 0;
  while (steps < maxSteps) {
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(150);
    await expectPlaceholderMatchesCaret(window);
    const s = await getEditorStateJson(window);
    if (s === prev) break; // history floor
    undoStates.push(s);
    prev = s;
    steps++;
  }
  expect(steps, 'history should contain at least one entry').toBeGreaterThan(0);

  for (let r = 1; r <= steps; r++) {
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(150);
    await expectPlaceholderMatchesCaret(window);
    const s = await getEditorStateJson(window);
    const depth = steps - r;
    const expected = depth === 0 ? initial : undoStates[depth - 1];
    expect(s, `redo step ${r}/${steps} must mirror the state seen at undo depth ${depth}`).toBe(expected);
  }
  return steps;
}

test.describe('Block placeholder — history integrity & keyboard editing breadth', () => {
  const wordDelete = process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace';

  test('unwind/replay state mirror over a mixed typed document', async ({ window }) => {
    test.setTimeout(90_000);
    await enterEmptyBody(window);
    await window.keyboard.type('opening line');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter');
    await window.keyboard.type('## ');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.type('Section');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter');
    await window.keyboard.type('- ');
    await window.keyboard.type('a bullet');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter'); // exit list
    await window.keyboard.type('closing line');
    await window.waitForTimeout(HISTORY_PAUSE);

    const steps = await validateHistoryReplay(window);
    expect(steps).toBeGreaterThanOrEqual(4); // pauses forced several distinct entries
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('closing line');
    await expectInvariants(window);
  });

  test('unwind/replay with an escape+refocus break between every history step', async ({ window }) => {
    test.setTimeout(90_000);
    await enterEmptyBody(window);
    for (const word of ['first', ' second', ' third']) {
      await window.keyboard.type(word);
      await window.waitForTimeout(HISTORY_PAUSE);
    }
    const initial = await getEditorStateJson(window);

    // Undo with a full blur/refocus cycle between every step — the cycles
    // must be invisible to history (same states as an uninterrupted walk)
    const undoStates: string[] = [];
    let prev = initial;
    let steps = 0;
    while (steps < 8) {
      await window.keyboard.press('Escape');
      await window.waitForTimeout(150);
      await expect(paragraphPlaceholders(window)).toHaveCount(0);
      // Refocus the first body paragraph — present whether or not the text
      // has been undone away yet
      await visibleMain(window).locator('.ContentEditable__root p').first().click();
      await window.keyboard.press('End');
      await window.waitForTimeout(100);

      await window.keyboard.press(`${mod}+z`);
      await window.waitForTimeout(150);
      await expectPlaceholderMatchesCaret(window);
      const s = await getEditorStateJson(window);
      if (s === prev) break;
      undoStates.push(s);
      prev = s;
      steps++;
    }
    expect(steps).toBeGreaterThan(0);

    // Redo back up, again with a blur break before every step
    for (let r = 1; r <= steps; r++) {
      await window.keyboard.press('Escape');
      await window.waitForTimeout(150);
      await visibleMain(window).locator('.ContentEditable__root p').first().click();
      await window.keyboard.press('End');
      await window.waitForTimeout(100);

      await window.keyboard.press(`${mod}+Shift+z`);
      await window.waitForTimeout(150);
      await expectPlaceholderMatchesCaret(window);
      const s = await getEditorStateJson(window);
      const depth = steps - r;
      expect(s, `redo ${r} with blur breaks`).toBe(depth === 0 ? initial : undoStates[depth - 1]);
    }
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('first second third');
    await expectInvariants(window);
  });

  test('zigzag undo/redo lands on exact recorded state checkpoints', async ({ window }) => {
    await enterEmptyBody(window);
    const F: string[] = [await getEditorStateJson(window)]; // F[0] = empty doc
    for (const chunk of ['red', ' green', ' blue']) {
      await window.keyboard.type(chunk);
      await window.waitForTimeout(HISTORY_PAUSE);
      F.push(await getEditorStateJson(window)); // F[1..3]
    }

    // Walk the history pointer through a zigzag and assert the EXACT state
    // at every stop: 3 →2 →1 →2 →1 →0 →1 →2 →3
    const moves: Array<[string, number]> = [
      [`${mod}+z`, 2], [`${mod}+z`, 1], [`${mod}+Shift+z`, 2], [`${mod}+z`, 1],
      [`${mod}+z`, 0], [`${mod}+Shift+z`, 1], [`${mod}+Shift+z`, 2], [`${mod}+Shift+z`, 3],
    ];
    for (const [key, expectedIdx] of moves) {
      await window.keyboard.press(key);
      await window.waitForTimeout(180);
      await expectPlaceholderMatchesCaret(window);
      expect(await getEditorStateJson(window), `after ${key} → checkpoint F[${expectedIdx}]`).toBe(
        F[expectedIdx],
      );
    }
    await expectInvariants(window);
  });

  test('word-by-word deletion: placeholder at empty, full history mirror', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('alpha beta gamma');
    await window.waitForTimeout(HISTORY_PAUSE);

    // Delete word-by-word until the paragraph is empty
    for (let i = 0; i < 6 && (await paragraphPlaceholders(window).count()) === 0; i++) {
      await window.keyboard.press(wordDelete);
      await window.waitForTimeout(150);
      await expectPlaceholderMatchesCaret(window);
    }
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await window.waitForTimeout(HISTORY_PAUSE);

    await validateHistoryReplay(window);
    // Top of history = empty paragraph again → placeholder showing
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('delete-to-line-start: instant clear to placeholder, history mirror', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('clear me entirely');
    await window.waitForTimeout(HISTORY_PAUSE);

    if (process.platform === 'darwin') {
      await window.keyboard.press('Meta+Backspace');
    } else {
      await window.keyboard.press('Shift+Home');
      await window.waitForTimeout(200);
      await window.keyboard.press('Backspace');
    }
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);
    await window.waitForTimeout(HISTORY_PAUSE);

    await validateHistoryReplay(window);
    await expectInvariants(window);
  });

  test('paragraph split at the middle and at the end: undo merges, redo re-splits', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('firstsecond');
    await window.waitForTimeout(HISTORY_PAUSE);

    // Split in the middle → two non-empty halves, no placeholder.
    // Settle between caret moves: back-to-back CDP arrow keys can outrun
    // Lexical's async selectionchange ingestion and get partially dropped.
    for (let i = 0; i < 6; i++) {
      await window.keyboard.press('ArrowLeft');
      await window.waitForTimeout(60);
    }
    await window.keyboard.press('Enter');
    await window.waitForTimeout(HISTORY_PAUSE);
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor.locator('p').filter({ hasText: /^first$/ })).toHaveCount(1);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // Split at the end of 'second' → empty paragraph + placeholder
    // (settle after each selection move — same keystroke race as above)
    await editor.locator('p').filter({ hasText: /^second$/ }).click();
    await window.waitForTimeout(150);
    await window.keyboard.press('End');
    await window.waitForTimeout(100);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await validateHistoryReplay(window);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('backspace-merge at paragraph start: undo restores the split', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('one');
    await window.keyboard.press('Enter');
    await window.keyboard.type('two');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.press('Home');
    await window.keyboard.press('Backspace'); // merge 'two' up into 'one'
    await window.waitForTimeout(HISTORY_PAUSE);
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor).toContainText('onetwo');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    await validateHistoryReplay(window);
    await expect(editor).toContainText('onetwo');
    await expectInvariants(window);
  });

  test('forward-delete pulls the next (empty) paragraph up; history mirror', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('alpha');
    await window.keyboard.press('Enter'); // empty paragraph below
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Caret back to the end of 'alpha', forward-delete swallows the empty p
    await refocusText(window, 'alpha');
    const editor = visibleMain(window).locator('.ContentEditable__root');
    const pCount = await editor.locator('p').count();
    await window.keyboard.press('Delete');
    await window.waitForTimeout(250);
    expect(await editor.locator('p').count()).toBeLessThan(pCount);
    await expectPlaceholderMatchesCaret(window);
    await window.waitForTimeout(HISTORY_PAUSE);

    await validateHistoryReplay(window);
    await expectInvariants(window);
  });

  test('checklist indent/outdent of an empty item keeps To-do through history', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('parent task');
    await window.keyboard.press('Enter'); // empty item, caret in it
    await window.waitForTimeout(HISTORY_PAUSE);
    const emptyItem = visibleMain(window).locator('li.is-placeholder');
    await expect(emptyItem).toHaveCount(1);

    // Indent the empty item — the reconciler rebuilds nested list DOM; the
    // mutation listener must re-apply To-do on the recreated node. While
    // nested, the wrapper <li> (also an empty ListItemNode) is marked too —
    // benign: the nested <ul> covers its ghost (verified by screenshot), so
    // exactly one "To-do" is visible. Pin both li's carrying class+attr.
    await window.keyboard.press('Tab');
    await window.waitForTimeout(300);
    await expect(emptyItem).toHaveCount(2);
    await expect(emptyItem.last()).toHaveAttribute('data-placeholder', 'To-do');

    await window.keyboard.press('Shift+Tab');
    await window.waitForTimeout(300);
    await expect(emptyItem).toHaveCount(1);
    await window.waitForTimeout(HISTORY_PAUSE);

    await validateHistoryReplay(window);
    await expect(emptyItem).toHaveCount(1);
    await expectInvariants(window);
  });

  test('transform chain with branch discard: heading → undo → list; placeholder text tracks the block type', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('## ');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(window.locator('.ContentEditable__root h2.is-placeholder').first()).toHaveAttribute(
      'data-placeholder', 'Heading 2',
    );

    // Undo the transform: the first undo restores the literal '## ' TEXT
    // (transform and typing are separate history entries) — pin that
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    await expect(window.locator('.ContentEditable__root h2:not(.editor-title)')).toHaveCount(0);
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('##');
    await expectPlaceholderMatchesCaret(window);

    // Second undo clears the '## ' text → empty paragraph, then branch: bullet list
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.type('- ');
    await window.waitForTimeout(HISTORY_PAUSE);
    const bulletItem = window.locator('.ContentEditable__root li.is-placeholder');
    await expect(bulletItem).toHaveCount(1);
    await expect(bulletItem.first()).toHaveAttribute('data-placeholder', 'List item');

    // The heading branch was discarded — redo must NOT resurrect the h2
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(250);
    await expect(window.locator('.ContentEditable__root h2:not(.editor-title)')).toHaveCount(0);
    await expect(bulletItem).toHaveCount(1);

    await validateHistoryReplay(window);
    await expectInvariants(window);
  });

  test('quote exit: Enter leaves the quote; undo re-enters it; history mirror', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('> ');
    await window.keyboard.type('quoted wisdom');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter'); // exit to a fresh paragraph
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await validateHistoryReplay(window);
    await expect(visibleMain(window).locator('.ContentEditable__root blockquote')).toContainText('quoted wisdom');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('empty-paragraph churn: Enter/Backspace alternation, every state placeholder-bearing', async ({ window }) => {
    test.setTimeout(90_000);
    await enterEmptyBody(window);
    // Churn through states where EVERY history entry is an empty-paragraph
    // mutation — the placeholder is implicated in every single state
    const keys = ['Enter', 'Enter', 'Backspace', 'Enter', 'Backspace', 'Backspace', 'Enter', 'Enter'];
    for (const key of keys) {
      await window.keyboard.press(key);
      await window.waitForTimeout(HISTORY_PAUSE / 2);
      await expectPlaceholderMatchesCaret(window);
    }
    await window.waitForTimeout(HISTORY_PAUSE);

    await validateHistoryReplay(window);
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });

  test('typing inserted mid-text: undo removes only the insertion; history mirror', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('start end');
    await window.waitForTimeout(HISTORY_PAUSE);
    // Move the caret to the end of 'start' (4 lefts from the end) and insert.
    // Settled presses — consecutive arrows can race Lexical's selectionchange.
    for (let i = 0; i < 4; i++) {
      await window.keyboard.press('ArrowLeft');
      await window.waitForTimeout(60);
    }
    await window.keyboard.type(' middle');
    await window.waitForTimeout(HISTORY_PAUSE);
    const editor = visibleMain(window).locator('.ContentEditable__root');
    await expect(editor).toContainText('start middle end');

    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    await expect(editor).toContainText('start end');
    await expect(editor).not.toContainText('middle');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);
    await expect(editor).toContainText('start middle end');

    await validateHistoryReplay(window);
    await expectInvariants(window);
  });
});

// ════════════════════════════════════════════════════════════════════
// Title interplay: the TitleNode has its OWN persistent placeholder
// ("New Page" ghost, toggled by emptiness — not focus). The paragraph
// placeholder is focus + caret driven. The two share one editor and one
// history, so the blur/focus behavior change must never cross-contaminate
// them — especially when undo/redo teleports the caret across the
// title/body boundary.
// ════════════════════════════════════════════════════════════════════

/** The title's own ghost placeholder ("New Page"). */
function titleGhost(window: Page) {
  return visibleMain(window).locator('h1.editor-title.is-placeholder');
}

test.describe('Block placeholder — title interplay', () => {
  test('empty-title ghost and body placeholder coexist; escape clears only the body one', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    // Fresh note: empty title shows its ghost
    await expect(titleGhost(window)).toHaveCount(1);
    await expect(titleGhost(window).first()).toHaveAttribute('data-placeholder', 'New Page');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // Caret into the body: BOTH placeholders visible at once
    await visibleMain(window).locator('.ContentEditable__root p').first().click();
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expect(titleGhost(window)).toHaveCount(1);
    await expectInvariants(window);

    // Escape clears ONLY the focus-driven paragraph placeholder
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expect(titleGhost(window)).toHaveCount(1);

    // Caret into the title: paragraph placeholder stays away, ghost persists
    await visibleMain(window).locator('h1.editor-title').click();
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expect(titleGhost(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('caret crossing the title/body boundary toggles only the paragraph placeholder', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('.ContentEditable__root p').first().click();
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // ArrowUp into the title — selection moves WITHIN the editor (no blur):
    // this exercises the update-listener path, not the BLUR handler
    await window.keyboard.press('ArrowUp');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expect(titleGhost(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    // And back down into the body
    await window.keyboard.press('ArrowDown');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });

  test('typing a title hides its ghost; undo restores it without spawning a body placeholder', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('My Notes');
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(titleGhost(window)).toHaveCount(0);

    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    // Title empty again → its mutation-driven ghost returns; caret is in the
    // title so the paragraph placeholder must stay away
    await expect(titleGhost(window)).toHaveCount(1);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(250);
    await expect(visibleMain(window).locator('h1.editor-title')).toContainText('My Notes');
    await expect(titleGhost(window)).toHaveCount(0);
    await expectInvariants(window);
  });

  test('undo teleporting the caret from body into title clears the body placeholder', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('Doc');
    await window.waitForTimeout(HISTORY_PAUSE);
    await window.keyboard.press('Enter'); // insertNewAfter → caret in fresh empty paragraph
    await window.waitForTimeout(HISTORY_PAUSE);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Undo the paragraph insertion: the caret jumps BACK into the title.
    // The placeholder must vanish with it — this is the exact cross-boundary
    // selection restore the plugin has to track.
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);

    // Redo: caret teleports forward into the recreated empty paragraph
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(250);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await validateHistoryReplay(window);
    await expectInvariants(window);
  });

  test('Enter mid-title splits the tail into the body; undo/redo mirror', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('HeadTail');
    await window.waitForTimeout(HISTORY_PAUSE);
    for (let i = 0; i < 4; i++) {
      await window.keyboard.press('ArrowLeft');
      await window.waitForTimeout(60);
    }
    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);

    // Pinned: the tail text moves into a new first body paragraph
    const title = visibleMain(window).locator('h1.editor-title');
    await expect(title).toContainText('Head');
    await expect(title).not.toContainText('Tail');
    await expect(
      visibleMain(window).locator('.ContentEditable__root p').first(),
    ).toContainText('Tail');
    // Caret sits in the non-empty 'Tail' paragraph → no placeholder
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);
    await window.waitForTimeout(HISTORY_PAUSE);

    await validateHistoryReplay(window);
    await expect(title).toContainText('Head');
    await expectInvariants(window);
  });

  test('backspace at the start of the first body paragraph merges it into the title (intentional, Notion-style); undo restores', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('My Title');
    await window.keyboard.press('Enter');
    await window.keyboard.type('body text');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.press('Home');
    await window.waitForTimeout(150);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);
    // Intentional, Notion-style behavior: backspacing at the start of the
    // first body paragraph merges its text INTO the title (the reverse —
    // backspace at title start — is blocked by the title plugin)
    const title = visibleMain(window).locator('h1.editor-title');
    await expect(title).toContainText('My Titlebody text');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);
    await window.waitForTimeout(HISTORY_PAUSE);

    // Undo splits them apart again; full mirror both directions
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    await expect(title).toContainText('My Title');
    await expect(title).not.toContainText('body text');
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('body text');
    await expectPlaceholderMatchesCaret(window);

    await validateHistoryReplay(window);
    await expectInvariants(window);
  });

  test('blocked backspace at title start adds no history entry', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('Title');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.press('Home');
    await window.waitForTimeout(150);
    const stateBefore = await getEditorStateJson(window);
    await window.keyboard.press('Backspace'); // blocked by the title plugin
    await window.waitForTimeout(250);
    expect(await getEditorStateJson(window)).toBe(stateBefore);

    // A single undo reverts the TYPING — proof the blocked key left no entry
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    await expect(titleGhost(window)).toHaveCount(1);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);
    await expectInvariants(window);
  });

  test('escape from title, edit body, then unwind across the boundary', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('Draft');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expect(titleGhost(window)).toHaveCount(0); // title has text — no ghost

    await visibleMain(window).locator('.ContentEditable__root p').first().click();
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await window.keyboard.type('content');
    await window.waitForTimeout(HISTORY_PAUSE);

    // Unwind: undo 'content' (caret stays in the emptied paragraph), then
    // undo 'Draft' (caret teleports into the title — placeholder must clear)
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    await expect(titleGhost(window)).toHaveCount(1);
    await expectPlaceholderMatchesCaret(window);

    // Redo both; everything restored, placeholder follows the caret forward
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(250);
    await expectPlaceholderMatchesCaret(window);
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(250);
    await expect(visibleMain(window).locator('h1.editor-title')).toContainText('Draft');
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('content');
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectInvariants(window);
  });

  test('select-all + delete lands the caret in the title: ghost returns, no body placeholder', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleMain(window).locator('h1.editor-title').click();
    await window.keyboard.type('Wipe Doc');
    await window.keyboard.press('Enter');
    await window.keyboard.type('some body content');
    await window.waitForTimeout(HISTORY_PAUSE);

    await window.keyboard.press(`${mod}+a`);
    await window.waitForTimeout(250);
    await expect(paragraphPlaceholders(window)).toHaveCount(0); // non-collapsed
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(300);

    // Everything gone; the caret lands in the emptied TITLE — its ghost is
    // back, and the body paragraph placeholder must NOT appear
    await expect(titleGhost(window)).toHaveCount(1);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
    await expectPlaceholderMatchesCaret(window);
    await window.waitForTimeout(HISTORY_PAUSE);

    // Undo resurrects title + body; redo wipes again — full mirror
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(250);
    await expect(visibleMain(window).locator('h1.editor-title')).toContainText('Wipe Doc');
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('some body content');
    await expectPlaceholderMatchesCaret(window);

    await validateHistoryReplay(window);
    await expectInvariants(window);
  });
});
