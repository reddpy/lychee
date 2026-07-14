import { test, expect } from './electron-app';
import type { ElectronApplication, Page } from '@playwright/test';

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

async function clickMenuItem(electronApp: ElectronApplication, label: string): Promise<void> {
  await electronApp.evaluate(({ Menu }, itemLabel) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) throw new Error('No application menu set');
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.label === itemLabel) return item;
        if (item.submenu) {
          const found = find(item.submenu.items);
          if (found) return found;
        }
      }
      return null;
    };
    const item = find(menu.items);
    if (!item) throw new Error(`Menu item not found: ${itemLabel}`);
    item.click();
  }, label);
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

  test('escape then clicking a previous text line never flashes the placeholder on the empty line', async ({ window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('hello text'); // line 1 has text
    await window.keyboard.press('Enter');      // line 2 empty, caret here → placeholder on line 2
    await window.waitForTimeout(200);
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    // Escape blurs and clears the placeholder
    await window.keyboard.press('Escape');
    await window.waitForTimeout(250);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);

    // Watch for ANY <p> gaining is-placeholder during the refocus click. The
    // surviving pre-blur selection still points at the empty line, so a naive
    // FOCUS sync paints the placeholder there for a frame before the click's
    // selectionchange lands — a visible flash on the wrong block.
    await window.evaluate(() => {
      const root = document.querySelector('main:not([style*="display: none"]) .ContentEditable__root');
      (window as unknown as { __flash: string[] }).__flash = [];
      if (!root) return;
      const obs = new MutationObserver((records) => {
        for (const r of records) {
          const el = r.target as HTMLElement;
          if (el.tagName === 'P' && el.classList.contains('is-placeholder')) {
            (window as unknown as { __flash: string[] }).__flash.push(el.textContent ?? '');
          }
        }
      });
      obs.observe(root, { attributes: true, attributeFilter: ['class'], subtree: true });
      (window as unknown as { __flashObs: MutationObserver }).__flashObs = obs;
    });

    // Click the end of the text on the PREVIOUS line
    const textPara = visibleMain(window)
      .locator('.ContentEditable__root p')
      .filter({ hasText: 'hello text' })
      .first();
    const box = await textPara.boundingBox();
    await window.mouse.click(box!.x + box!.width - 4, box!.y + box!.height / 2);
    await window.waitForTimeout(400);

    const flashes = await window.evaluate(() => {
      const w = window as unknown as { __flashObs?: MutationObserver; __flash: string[] };
      w.__flashObs?.disconnect();
      return w.__flash;
    });
    // Caret is in the non-empty line → no placeholder may have appeared at all
    expect(flashes, `placeholder flashed during refocus: ${JSON.stringify(flashes)}`).toEqual([]);
    await expect(paragraphPlaceholders(window)).toHaveCount(0);
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
  test('Edit menu undo works while the editor is focused', async ({ electronApp, window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('menu undo');
    await clickMenuItem(electronApp, 'Undo');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
  });

  test('Edit menu undo restores a checklist toggle after Escape', async ({ electronApp, window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('[ ] Task');
    const checkItem = window.locator('.ContentEditable__root li[role="checkbox"]');
    await expect(checkItem).toHaveClass(/editor-list-item-unchecked/);

    await checkItem.click({ position: { x: 10, y: 10 } });
    await expect(checkItem).toHaveClass(/editor-list-item-checked/);
    await window.keyboard.press('Escape');
    await clickMenuItem(electronApp, 'Undo');

    await expect(checkItem).toHaveClass(/editor-list-item-unchecked/);
    await expectInvariants(window);
  });

  test('Edit menu undo continues through Lexical history after Escape blurs the editor', async ({ electronApp, window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('s');
    // HistoryPlugin merges closely-spaced edits, so separate these two steps.
    await window.waitForTimeout(1500);
    await window.keyboard.type('tuff');
    await expect(window.locator('.ContentEditable__root')).toContainText('stuff');

    await window.keyboard.press('Escape');
    await clickMenuItem(electronApp, 'Undo');
    await expect(window.locator('.ContentEditable__root')).toContainText('s');

    // Blur again to make sure the first menu undo did not fall back to the
    // browser's native undo stack, which cannot continue through Lexical's.
    await window.keyboard.press('Escape');
    await clickMenuItem(electronApp, 'Undo');
    await expect(window.locator('.ContentEditable__root')).not.toContainText('s');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);
    await expectInvariants(window);
  });

  test('Edit menu redo restores a Lexical undo after Escape', async ({ electronApp, window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('before redo');
    await window.keyboard.press('Escape');
    await clickMenuItem(electronApp, 'Undo');
    await expect(paragraphPlaceholders(window)).toHaveCount(1);

    await window.keyboard.press('Escape');
    await clickMenuItem(electronApp, 'Redo');
    await expect(window.locator('.ContentEditable__root')).toContainText('before redo');
    await expectInvariants(window);
  });

  test('Edit menu history commands target only the active note', async ({ electronApp, window }) => {
    await enterEmptyBody(window, 'Menu history A');
    await window.keyboard.type('alpha body');
    await window.waitForTimeout(300);
    await enterEmptyBody(window, 'Menu history B');
    await window.keyboard.type('bravo body');
    await window.waitForTimeout(300);

    await window.locator('[data-tab-id]').filter({ hasText: 'Menu history A' }).click();
    await window.keyboard.press('Escape');
    await clickMenuItem(electronApp, 'Undo');
    await expect(visibleMain(window).locator('.ContentEditable__root')).not.toContainText('alpha body');

    await window.locator('[data-tab-id]').filter({ hasText: 'Menu history B' }).click();
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('bravo body');
  });

  test('Edit menu undo preserves a focused find field instead of undoing the note', async ({ electronApp, window }) => {
    await enterEmptyBody(window);
    await window.keyboard.type('document text');
    await window.keyboard.press(`${mod}+f`);
    const findInput = window.getByPlaceholder('Find...');
    await expect(findInput).toBeFocused();
    await findInput.fill('find query');

    await clickMenuItem(electronApp, 'Undo');
    await expect(findInput).toHaveValue('');
    await expect(visibleMain(window).locator('.ContentEditable__root')).toContainText('document text');
  });

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

test.describe('Block placeholder — document scale & interference', () => {

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

  test('tables: blurring an empty cell then clicking another never flashes the placeholder on the first cell', async ({ window }) => {
    // Cell paragraphs are a SECOND focus-driven placeholder path (shadow roots),
    // so the same stale-selection flash the DOM-caret guard prevents for
    // top-level paragraphs must also be prevented inside the table.
    await enterEmptyBody(window);
    await window.keyboard.type('/table');
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(500);
    const editor = visibleMain(window).locator('.ContentEditable__root');
    const cellPlaceholder = editor.locator('td p.is-placeholder, th p.is-placeholder');
    await expect(cellPlaceholder).toHaveCount(1); // caret in cell#0

    // Blur while the caret is still in cell#0. editor.blur() is what Escape runs
    // in @lexical/rich-text, minus the table plugin's Escape interception (which
    // would move the caret OUT of the cell). It stands in for clicking outside.
    await window.evaluate(() => {
      const root = document.querySelector(
        'main:not([style*="display: none"]) .ContentEditable__root',
      ) as unknown as { __lexicalEditor?: { blur: () => void } };
      root?.__lexicalEditor?.blur();
    });
    await window.waitForTimeout(250);
    await expect(cellPlaceholder).toHaveCount(0);

    // Record any cell paragraph that GAINS the placeholder, tagged with its cell
    // index — the escaped-from cell#0 must never light up during the refocus.
    await window.evaluate(() => {
      const root = document.querySelector('main:not([style*="display: none"]) .ContentEditable__root')!;
      (window as unknown as { __cellFlash: string[] }).__cellFlash = [];
      const obs = new MutationObserver((recs) => {
        for (const r of recs) {
          const el = r.target as HTMLElement;
          if (el.tagName !== 'P' || !el.classList.contains('is-placeholder')) continue;
          const cell = el.closest('td,th');
          const idx = cell ? Array.from(root.querySelectorAll('td,th')).indexOf(cell) : -1;
          (window as unknown as { __cellFlash: string[] }).__cellFlash.push(`cell#${idx}`);
        }
      });
      obs.observe(root, { attributes: true, attributeFilter: ['class'], subtree: true });
      (window as unknown as { __cellObs: MutationObserver }).__cellObs = obs;
    });

    await editor.locator('td').nth(1).click(); // click a DIFFERENT empty cell
    await window.waitForTimeout(400);

    const flashes = await window.evaluate(() => {
      const w = window as unknown as { __cellObs?: MutationObserver; __cellFlash: string[] };
      w.__cellObs?.disconnect();
      return w.__cellFlash;
    });
    expect(flashes.filter((c) => c === 'cell#0'), `cell#0 flashed: ${JSON.stringify(flashes)}`).toEqual([]);
    // Final state: exactly one cell placeholder, on the clicked cell.
    await expect(cellPlaceholder).toHaveCount(1);
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

});
