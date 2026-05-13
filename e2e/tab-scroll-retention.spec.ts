/**
 * E2E tests for tab scroll retention. Holds the fix in lexical-editor.tsx
 * accountable on two axes:
 *
 *   1. Cross-doc switches — outgoing <main> gets display:none, and the
 *      original save-in-useLayoutEffect read scrollTop=0 (Chromium 41+).
 *      Covered by the Cross-Document, Edge Cases, and Stress describes.
 *
 *   2. Caret-pull on activation — TabSelectionPlugin restores the caret via
 *      a deferred editor.update, which can scrollIntoView toward a caret on
 *      a different node. Covered by the Duplicate Tab Stress describe (each
 *      duplicate parks its caret on a distinct paragraph far from its scroll
 *      target, so without the rAF re-restore the scroll drags to the caret).
 *
 * Audit invariant: with the fix removed, 29 of 31 tests fail. The 2 that
 * still pass are functional baselines that are correct by design regardless
 * of the bug (`selectTab(active)` no-op; fresh-mount scrollTop=0).
 *
 * Notes are created by injecting a pre-built Lexical serialized state via
 * documents.create rather than typed in the UI — keeps runtime tight and
 * removes the focused-contenteditable side effects from baseline setup.
 */

import { test, expect } from './electron-app';
import type { Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a Lexical serialized state with `lineCount` paragraphs so the doc scrolls. */
function buildScrollableLexicalState(lineCount: number): string {
  const children = Array.from({ length: lineCount }, (_, i) => ({
    children: [
      {
        detail: 0,
        format: 0,
        mode: 'normal',
        style: '',
        text: `Body line ${i + 1} padded with enough text to force the editor past the viewport height.`,
        type: 'text',
        version: 1,
      },
    ],
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    textFormat: 0,
    textStyle: '',
  }));
  return JSON.stringify({
    root: {
      children,
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  });
}

const SCROLLABLE_BODY = buildScrollableLexicalState(60);
const SHORT_BODY = buildScrollableLexicalState(1);
const VERY_LONG_BODY = buildScrollableLexicalState(200);

/** Create a doc directly via IPC + open it as a tab. No typing in the UI. */
async function createAndOpenNote(
  window: Page,
  title: string,
  content: string = SCROLLABLE_BODY,
): Promise<{ tabId: string; docId: string }> {
  const docId = await window.evaluate(
    async (args: { title: string; content: string }) => {
      const lychee = (window as any).lychee;
      const store = (window as any).__documentStore;
      const { document } = await lychee.invoke('documents.create', {
        title: args.title,
        content: args.content,
      });
      await store.getState().loadDocuments(true);
      store.getState().openOrCreateTab(document.id);
      return document.id as string;
    },
    { title, content },
  );

  // Wait for the editor to mount and lay out
  await expect(
    window.locator('main:not([style*="display: none"]) .ContentEditable__root'),
  ).toBeVisible();
  await window.waitForTimeout(200);

  const tabId = await window.evaluate(
    (id: string) => {
      const s = (window as any).__documentStore.getState();
      return s.openTabs.find((t: any) => t.docId === id && t.tabId === s.selectedId)?.tabId
        ?? s.openTabs.find((t: any) => t.docId === id)?.tabId
        ?? null;
    },
    docId,
  );
  if (!tabId) throw new Error(`No tab opened for ${docId}`);
  return { tabId, docId };
}

async function openDuplicateTab(window: Page, docId: string): Promise<string> {
  const newTabId = await window.evaluate((id: string) => {
    const store = (window as any).__documentStore;
    const before = new Set(store.getState().openTabs.map((t: any) => t.tabId));
    store.getState().openTab(id);
    const after = store.getState().openTabs;
    const newTab = after.find((t: any) => !before.has(t.tabId) && t.docId === id);
    return newTab?.tabId as string;
  }, docId);
  await window.waitForTimeout(200);
  return newTabId;
}

async function closeTab(window: Page, tabId: string): Promise<void> {
  await window.evaluate(
    (id: string) => (window as any).__documentStore.getState().closeTab(id),
    tabId,
  );
  await window.waitForTimeout(200);
}

async function getScrollHeight(window: Page): Promise<number> {
  return window.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
    return main?.scrollHeight ?? 0;
  });
}

async function getClientHeight(window: Page): Promise<number> {
  return window.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
    return main?.clientHeight ?? 0;
  });
}

async function selectTab(window: Page, tabId: string): Promise<void> {
  await window.evaluate(
    (id: string) => (window as any).__documentStore.getState().selectDocument(id),
    tabId,
  );
  await window.waitForTimeout(200);
}

async function setActiveScrollTop(window: Page, value: number): Promise<void> {
  await window.evaluate((v: number) => {
    const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
    if (main) main.scrollTop = v;
  }, value);
  await window.waitForTimeout(120);
}

async function getScrollTop(window: Page): Promise<number> {
  return window.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
    return main?.scrollTop ?? 0;
  });
}

// ── Tests ────────────────────────────────────────────────────────────

test.describe('Tab Scroll Retention — Cross-Document', () => {
  test('scroll position preserved on round-trip between two different documents', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Scroll Cross A');
    await setActiveScrollTop(window, 700);
    const scrolledA = await getScrollTop(window);
    expect(scrolledA).toBeGreaterThan(500);

    const { tabId: tabB } = await createAndOpenNote(window, 'Scroll Cross B');
    await setActiveScrollTop(window, 0);

    await selectTab(window, tabA);
    const restoredA = await getScrollTop(window);
    expect(Math.abs(restoredA - scrolledA)).toBeLessThan(100);

    await selectTab(window, tabB);
    expect(await getScrollTop(window)).toBeLessThan(100);
  });

  test('independent scroll positions for two different documents across multiple switches', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Cross Dual A');
    await setActiveScrollTop(window, 600);

    const { tabId: tabB } = await createAndOpenNote(window, 'Cross Dual B');
    await setActiveScrollTop(window, 300);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 600)).toBeLessThan(100);

    await selectTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 300)).toBeLessThan(100);

    // Re-scroll A, round-trip, latest value preserved
    await selectTab(window, tabA);
    await setActiveScrollTop(window, 900);
    await selectTab(window, tabB);
    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 900)).toBeLessThan(100);
  });

  test('scroll preserved across three-document rotation', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Rot A');
    await setActiveScrollTop(window, 800);

    const { tabId: tabB } = await createAndOpenNote(window, 'Rot B');
    await setActiveScrollTop(window, 400);

    const { tabId: tabC } = await createAndOpenNote(window, 'Rot C');
    await setActiveScrollTop(window, 200);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 800)).toBeLessThan(100);

    await selectTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 400)).toBeLessThan(100);

    await selectTab(window, tabC);
    expect(Math.abs((await getScrollTop(window)) - 200)).toBeLessThan(100);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 800)).toBeLessThan(100);
  });

  test('scroll preserved after typing in another tab', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Persist A');
    await setActiveScrollTop(window, 750);

    // Switch to B and type something to confirm scroll on A is not perturbed
    const { tabId: tabB } = await createAndOpenNote(window, 'Persist B');
    await window.locator('main:not([style*="display: none"]) [contenteditable="true"]').click();
    await window.keyboard.type('extra content typed in B');
    await window.waitForTimeout(700); // let debounced save settle

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 750)).toBeLessThan(100);

    await selectTab(window, tabB);
    await expect(
      window.locator('main:not([style*="display: none"]) .ContentEditable__root'),
    ).toContainText('extra content typed in B');
  });

  test('rapid back-and-forth tab switches do not drift scroll position', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Rapid A');
    await setActiveScrollTop(window, 500);

    const { tabId: tabB } = await createAndOpenNote(window, 'Rapid B');
    await setActiveScrollTop(window, 250);

    for (let i = 0; i < 6; i++) {
      await selectTab(window, tabA);
      await selectTab(window, tabB);
    }

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 500)).toBeLessThan(100);

    await selectTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 250)).toBeLessThan(100);
  });

  test('onScroll listener captures the latest scroll position, not just the first', async ({ window }) => {
    // Specifically exercises the listener: every interim scroll should update
    // the saved position, so when the tab is re-activated the most recent
    // pre-switch value is restored.
    const { tabId: tabA } = await createAndOpenNote(window, 'Latest A');
    await setActiveScrollTop(window, 100);
    await setActiveScrollTop(window, 400);
    await setActiveScrollTop(window, 850); // final position before switch

    const { tabId: tabB } = await createAndOpenNote(window, 'Latest B');
    await setActiveScrollTop(window, 0);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 850)).toBeLessThan(100);

    await selectTab(window, tabB);
    expect(await getScrollTop(window)).toBeLessThan(100);
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────

test.describe('Tab Scroll Retention — Edge Cases', () => {
  test('scrollTop of 0 (top) is preserved as 0, not lost as a default', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Edge Top A');
    // Scroll away then back to 0 — listener should record 0
    await setActiveScrollTop(window, 500);
    await setActiveScrollTop(window, 0);

    const { tabId: tabB } = await createAndOpenNote(window, 'Edge Top B');
    await setActiveScrollTop(window, 600);

    await selectTab(window, tabA);
    expect(await getScrollTop(window)).toBeLessThan(50);

    await selectTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 600)).toBeLessThan(100);
  });

  test('near-max scroll (bottom of long doc) is preserved on round-trip', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Edge Max A', VERY_LONG_BODY);
    const scrollHeight = await getScrollHeight(window);
    const clientHeight = await getClientHeight(window);
    const target = Math.max(0, scrollHeight - clientHeight - 20);
    await setActiveScrollTop(window, target);
    const scrolled = await getScrollTop(window);

    await createAndOpenNote(window, 'Edge Max B');
    await setActiveScrollTop(window, 0);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - scrolled)).toBeLessThan(100);
  });

  test('non-scrollable short doc does not crash on tab switch and stays at 0', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Edge Short A', SHORT_BODY);
    expect(await getScrollTop(window)).toBe(0);

    const { tabId: tabB } = await createAndOpenNote(window, 'Edge Short B');
    await setActiveScrollTop(window, 500);

    // Round-trip — short doc should still be at 0
    await selectTab(window, tabA);
    expect(await getScrollTop(window)).toBe(0);

    // And B's scroll should still be preserved
    await selectTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 500)).toBeLessThan(100);
  });

  test('closing then reopening a doc loses its scroll position (editor unmounted)', async ({ window }) => {
    const { tabId: tabA, docId: docA } = await createAndOpenNote(window, 'Edge Close A');
    await setActiveScrollTop(window, 700);

    const { tabId: tabB } = await createAndOpenNote(window, 'Edge Close B');
    await setActiveScrollTop(window, 200);

    // Close A entirely — editor for docA is unmounted, its scrollPositions Map is GC'd
    await closeTab(window, tabA);
    // Re-open the same doc — fresh editor instance with no memory
    await window.evaluate(
      (id: string) => (window as any).__documentStore.getState().openOrCreateTab(id),
      docA,
    );
    await window.waitForTimeout(300);
    expect(await getScrollTop(window)).toBeLessThan(50);

    // B's scroll, in a still-mounted editor, must still be intact
    await selectTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 200)).toBeLessThan(100);
  });

  test('closing a non-active tab does not disturb the active tab scroll', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Edge Inactive A');
    await setActiveScrollTop(window, 600);

    const { tabId: tabB } = await createAndOpenNote(window, 'Edge Inactive B');
    await setActiveScrollTop(window, 300);

    // C is going to be the active tab whose scroll must not be touched
    await createAndOpenNote(window, 'Edge Inactive C');
    await setActiveScrollTop(window, 450);

    // Close B (non-active)
    await closeTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 450)).toBeLessThan(100);

    // A's scroll should still be there
    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 600)).toBeLessThan(100);
  });

  test('selecting the already-active tab does not perturb its scroll', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Edge SelfSelect');
    await setActiveScrollTop(window, 550);

    await selectTab(window, tabA); // no-op selection
    await selectTab(window, tabA);
    await selectTab(window, tabA);

    expect(Math.abs((await getScrollTop(window)) - 550)).toBeLessThan(100);
  });

  test('mixed duplicate + cross-doc tabs maintain independent scroll per tabId', async ({ window }) => {
    // Doc A — one tab
    const { tabId: tabA } = await createAndOpenNote(window, 'Mix A');
    await setActiveScrollTop(window, 450);

    // Doc B — first tab, then a duplicate of the same docId
    const { tabId: tabB1, docId: docB } = await createAndOpenNote(window, 'Mix B');
    await setActiveScrollTop(window, 650);
    const tabB2 = await openDuplicateTab(window, docB);
    await selectTab(window, tabB2);
    await setActiveScrollTop(window, 150);

    // All three positions must be preserved
    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 450)).toBeLessThan(100);

    await selectTab(window, tabB1);
    expect(Math.abs((await getScrollTop(window)) - 650)).toBeLessThan(100);

    await selectTab(window, tabB2);
    expect(Math.abs((await getScrollTop(window)) - 150)).toBeLessThan(100);
  });

  test('scrollTop beyond doc height is clamped and the clamped value is preserved', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Edge Clamp A');
    await setActiveScrollTop(window, 999_999);
    const clamped = await getScrollTop(window);
    expect(clamped).toBeGreaterThan(0);

    await createAndOpenNote(window, 'Edge Clamp B');
    await setActiveScrollTop(window, 0);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - clamped)).toBeLessThan(100);
  });

  test('doc content updated via API while tab is inactive — switch back does not crash', async ({ window }) => {
    const { tabId: tabA, docId: docA } = await createAndOpenNote(window, 'Edge Update A');
    await setActiveScrollTop(window, 400);

    await createAndOpenNote(window, 'Edge Update B');
    await setActiveScrollTop(window, 100);

    // Mutate A's title via the backend while A is hidden. (Content rewrites
    // are blocked while a document is open in the editor — the live editor
    // state is the source of truth — so this test stays at the title-level.)
    await window.evaluate(async (id: string) => {
      const lychee = (window as any).lychee;
      await lychee.invoke('documents.update', { id, title: 'Edge Update A — renamed' });
    }, docA);
    await window.waitForTimeout(200);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 400)).toBeLessThan(150);
  });

  test('newly created and immediately activated tab starts at scrollTop 0', async ({ window }) => {
    await createAndOpenNote(window, 'Edge Init A');
    expect(await getScrollTop(window)).toBe(0);
  });
});

// ── Stress ───────────────────────────────────────────────────────────

test.describe('Tab Scroll Retention — Stress', () => {
  test('6 distinct docs, each scrolled to a different position, all preserved after rotation', async ({ window }) => {
    const tabs: { tabId: string; target: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const { tabId } = await createAndOpenNote(window, `Stress 6 ${i}`);
      const target = 100 + i * 150; // 100, 250, 400, 550, 700, 850 — distinct positions
      await setActiveScrollTop(window, target);
      tabs.push({ tabId, target });
    }

    // Walk through all of them; each must restore its own position
    for (const { tabId, target } of tabs) {
      await selectTab(window, tabId);
      const actual = await getScrollTop(window);
      expect(Math.abs(actual - target)).toBeLessThan(100);
    }

    // Walk in reverse for good measure
    for (let i = tabs.length - 1; i >= 0; i--) {
      const { tabId, target } = tabs[i];
      await selectTab(window, tabId);
      const actual = await getScrollTop(window);
      expect(Math.abs(actual - target)).toBeLessThan(100);
    }
  });

  test('20 rapid back-and-forth switches between two docs do not drift', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Stress 20 A');
    await setActiveScrollTop(window, 700);

    const { tabId: tabB } = await createAndOpenNote(window, 'Stress 20 B');
    await setActiveScrollTop(window, 350);

    for (let i = 0; i < 20; i++) {
      await selectTab(window, tabA);
      await selectTab(window, tabB);
    }

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 700)).toBeLessThan(100);

    await selectTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 350)).toBeLessThan(100);
  });

  test('non-sequential switching across 5 docs preserves every position', async ({ window }) => {
    const targets = [200, 800, 350, 550, 100];
    const created: { tabId: string; target: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const { tabId } = await createAndOpenNote(window, `Stress 5 ${i}`);
      await setActiveScrollTop(window, targets[i]);
      created.push({ tabId, target: targets[i] });
    }

    // Deliberate non-sequential order
    const order = [3, 0, 4, 2, 1, 0, 3, 1, 4, 2];
    for (const idx of order) {
      const { tabId, target } = created[idx];
      await selectTab(window, tabId);
      const actual = await getScrollTop(window);
      expect(Math.abs(actual - target)).toBeLessThan(100);
    }
  });

  test('many sequential scrolls in a single tab — only the final value is restored', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Stress Sequential A');
    const sequence = [50, 200, 350, 500, 100, 700, 400, 900, 250];
    for (const v of sequence) await setActiveScrollTop(window, v);
    const final = sequence[sequence.length - 1];

    await createAndOpenNote(window, 'Stress Sequential B');
    await setActiveScrollTop(window, 0);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - final)).toBeLessThan(100);
  });

  test('scroll preserved after closing several intermediate tabs', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Stress Close A');
    await setActiveScrollTop(window, 600);

    const intermediateIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { tabId } = await createAndOpenNote(window, `Stress Close mid ${i}`);
      await setActiveScrollTop(window, 100 + i * 50);
      intermediateIds.push(tabId);
    }

    const { tabId: tabZ } = await createAndOpenNote(window, 'Stress Close Z');
    await setActiveScrollTop(window, 800);

    // Close all the intermediates
    for (const id of intermediateIds) await closeTab(window, id);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 600)).toBeLessThan(100);

    await selectTab(window, tabZ);
    expect(Math.abs((await getScrollTop(window)) - 800)).toBeLessThan(100);
  });
});

// ── Listener Behavior ────────────────────────────────────────────────

test.describe('Tab Scroll Retention — Listener Behavior', () => {
  test('user-driven mouse-wheel scroll is captured by the listener', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Wheel A');
    const main = window.locator('main:not([style*="display: none"])').first();
    await main.hover();
    await window.mouse.wheel(0, 1500); // scroll down
    await window.waitForTimeout(200);
    const wheelScrolled = await getScrollTop(window);
    expect(wheelScrolled).toBeGreaterThan(50);

    await createAndOpenNote(window, 'Wheel B');
    await setActiveScrollTop(window, 0);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - wheelScrolled)).toBeLessThan(150);
  });

  test('rapid switch back during the restore window still resolves to the saved value', async ({ window }) => {
    // Exercises the isRestoringScroll + double-rAF: if we re-switch before the
    // restore frames have completed, the final state must still be correct.
    const { tabId: tabA } = await createAndOpenNote(window, 'Window A');
    await setActiveScrollTop(window, 800);

    const { tabId: tabB } = await createAndOpenNote(window, 'Window B');
    await setActiveScrollTop(window, 250);

    // Fire a tight burst of switches with no settling waits
    await window.evaluate(
      (ids: { a: string; b: string }) => {
        const sel = (window as any).__documentStore.getState().selectDocument;
        for (let i = 0; i < 6; i++) {
          sel(ids.a);
          sel(ids.b);
        }
      },
      { a: tabA, b: tabB },
    );
    await window.waitForTimeout(400);

    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 800)).toBeLessThan(100);

    await selectTab(window, tabB);
    expect(Math.abs((await getScrollTop(window)) - 250)).toBeLessThan(100);
  });
});

// ── Duplicate Tab Stress ─────────────────────────────────────────────
//
// Duplicate tabs (same docId, different tabId) share one LexicalEditor
// instance and one <main>. There is NO display:none toggle between
// duplicate switches — but `activeTabId` still changes, so the scroll
// save/restore + selection-restore both run. These tests stress the
// per-tabId scroll cache against:
//   • multiple duplicates with distinct scroll positions
//   • caret/scroll independence — Lexical selection restoration must not
//     drag the scroll back to the caret on duplicate switches
//   • close/reorder/edit operations that touch the shared editor

test.describe('Tab Scroll Retention — Duplicate Tab Stress', () => {
  // Each duplicate's caret lands on a DIFFERENT paragraph from its sibling's,
  // and the scroll target is far from that caret. On every switch, Lexical's
  // selection-restore changes the selection node — which (without the fix)
  // triggers scrollIntoView, dragging the scroll to wherever the caret is.
  // The rAF re-restore must override that and leave scroll at the target.
  async function clickParagraphAndScroll(window: Page, paragraphIdx: number, scrollTarget: number): Promise<void> {
    await window
      .locator('main:not([style*="display: none"]) .ContentEditable__root p')
      .nth(paragraphIdx)
      .click();
    await window.waitForTimeout(100);
    await setActiveScrollTop(window, scrollTarget);
  }

  test('5 duplicate tabs of one doc with distinct carets, each scrolled far from its caret, all preserved across full rotation', async ({ window }) => {
    const { tabId: tab1, docId } = await createAndOpenNote(window, 'Dup5 Stress');
    // Paragraphs span 0..59; targets are deliberately opposite the caret region
    const caretParagraphs = [0, 15, 29, 44, 59];
    const targets = [900, 700, 500, 300, 100];
    await clickParagraphAndScroll(window, caretParagraphs[0], targets[0]);

    const dupTabs: string[] = [tab1];
    for (let i = 1; i < caretParagraphs.length; i++) {
      const dupId = await openDuplicateTab(window, docId);
      dupTabs.push(dupId);
      await selectTab(window, dupId);
      await clickParagraphAndScroll(window, caretParagraphs[i], targets[i]);
    }

    // Forward rotation — each switch CHANGES the selected node, so Lexical's
    // selection restore would scrollIntoView to that caret without the fix.
    for (let i = 0; i < dupTabs.length; i++) {
      await selectTab(window, dupTabs[i]);
      const actual = await getScrollTop(window);
      expect(Math.abs(actual - targets[i])).toBeLessThan(100);
    }

    for (let i = dupTabs.length - 1; i >= 0; i--) {
      await selectTab(window, dupTabs[i]);
      const actual = await getScrollTop(window);
      expect(Math.abs(actual - targets[i])).toBeLessThan(100);
    }
  });

  test('two docs × three duplicates each — every tab preserves its own scroll despite caret pull', async ({ window }) => {
    // Same idea but across two documents, mixed with cross-doc switches.
    // Each duplicate has its caret on a different paragraph.
    const { tabId: a1, docId: docA } = await createAndOpenNote(window, 'Dup2x3 A');
    await clickParagraphAndScroll(window, 5, 800); // caret near top, scrolled near bottom
    const a2 = await openDuplicateTab(window, docA);
    await selectTab(window, a2);
    await clickParagraphAndScroll(window, 28, 200); // caret mid, scrolled near top
    const a3 = await openDuplicateTab(window, docA);
    await selectTab(window, a3);
    await clickParagraphAndScroll(window, 55, 500); // caret near bottom, scrolled mid

    const { tabId: b1, docId: docB } = await createAndOpenNote(window, 'Dup2x3 B');
    await clickParagraphAndScroll(window, 50, 150);
    const b2 = await openDuplicateTab(window, docB);
    await selectTab(window, b2);
    await clickParagraphAndScroll(window, 10, 700);
    const b3 = await openDuplicateTab(window, docB);
    await selectTab(window, b3);
    await clickParagraphAndScroll(window, 32, 450);

    const expectations: { tabId: string; target: number }[] = [
      { tabId: a1, target: 800 },
      { tabId: a2, target: 200 },
      { tabId: a3, target: 500 },
      { tabId: b1, target: 150 },
      { tabId: b2, target: 700 },
      { tabId: b3, target: 450 },
    ];

    const order = [0, 3, 1, 4, 2, 5, 5, 0, 4, 1, 3, 2];
    for (const idx of order) {
      const { tabId, target } = expectations[idx];
      await selectTab(window, tabId);
      const actual = await getScrollTop(window);
      expect(Math.abs(actual - target)).toBeLessThan(100);
    }
  });

  test('rapid switching among 4 duplicate tabs with distinct carets preserves each scroll position', async ({ window }) => {
    const { tabId: t1, docId } = await createAndOpenNote(window, 'Dup Rapid');
    const caretParagraphs = [3, 22, 40, 58];
    const targets = [880, 200, 660, 100];
    await clickParagraphAndScroll(window, caretParagraphs[0], targets[0]);

    const tabs = [t1];
    for (let i = 1; i < targets.length; i++) {
      const id = await openDuplicateTab(window, docId);
      tabs.push(id);
      await selectTab(window, id);
      await clickParagraphAndScroll(window, caretParagraphs[i], targets[i]);
    }

    const hops = [0, 2, 1, 3, 0, 3, 2, 1, 0, 1, 3, 2, 1, 0, 3];
    for (const idx of hops) await selectTab(window, tabs[idx]);

    for (let i = 0; i < tabs.length; i++) {
      await selectTab(window, tabs[i]);
      const actual = await getScrollTop(window);
      expect(Math.abs(actual - targets[i])).toBeLessThan(100);
    }
  });

  test('closing one duplicate does not disturb the caret-pulled scrolls of its siblings', async ({ window }) => {
    const { tabId: t1, docId } = await createAndOpenNote(window, 'Dup CloseMid');
    await clickParagraphAndScroll(window, 55, 250); // caret near bottom, scroll near top

    const t2 = await openDuplicateTab(window, docId);
    await selectTab(window, t2);
    await clickParagraphAndScroll(window, 8, 800); // caret near top, scroll near bottom

    const t3 = await openDuplicateTab(window, docId);
    await selectTab(window, t3);
    await clickParagraphAndScroll(window, 30, 100); // caret middle, scroll top

    await closeTab(window, t2);

    await selectTab(window, t1);
    expect(Math.abs((await getScrollTop(window)) - 250)).toBeLessThan(100);

    await selectTab(window, t3);
    expect(Math.abs((await getScrollTop(window)) - 100)).toBeLessThan(100);
  });

  test('opening a new duplicate of an already-scrolled doc starts at 0 and the existing tab keeps its scroll (caret near top, scroll near bottom)', async ({ window }) => {
    const { tabId: t1, docId } = await createAndOpenNote(window, 'Dup NewDup');
    // Caret near the top, scroll near the bottom — switching back must NOT
    // drag scroll up to the caret position.
    await clickParagraphAndScroll(window, 5, 720);

    const t2 = await openDuplicateTab(window, docId);
    await selectTab(window, t2);
    expect(await getScrollTop(window)).toBeLessThan(50);

    await selectTab(window, t1);
    expect(Math.abs((await getScrollTop(window)) - 720)).toBeLessThan(100);
  });

  test('editing in one duplicate does not perturb the scrolls of its caret-pulled siblings', async ({ window }) => {
    const { tabId: t1, docId } = await createAndOpenNote(window, 'Dup Edit');
    // t1: caret near bottom (p55), scroll near the top (350)
    await clickParagraphAndScroll(window, 55, 350);

    const t2 = await openDuplicateTab(window, docId);
    await selectTab(window, t2);
    // t2: caret near top (p3) — then type, then scroll to 650
    await window
      .locator('main:not([style*="display: none"]) .ContentEditable__root p')
      .nth(3)
      .click();
    await window.keyboard.type(' — edited in duplicate 2');
    await window.waitForTimeout(700);
    await setActiveScrollTop(window, 650);

    // Switch to t1: t1's saved caret is p55 (near bottom). Without the fix,
    // Lexical's selection restore would scroll t1 to ~bottom, not 350.
    await selectTab(window, t1);
    expect(Math.abs((await getScrollTop(window)) - 350)).toBeLessThan(100);

    // Back to t2: t2's saved caret is up near p3 (near top). Without the fix,
    // Lexical would scroll t2 to ~top, not 650.
    await selectTab(window, t2);
    expect(Math.abs((await getScrollTop(window)) - 650)).toBeLessThan(200);
  });

  test('duplicate scroll stays put even when each duplicate has a distinct caret position (Lexical selection restore must not drag scroll)', async ({ window }) => {
    // This is the regression-shape test for the rAF guard.
    // Each duplicate has its own saved selection in TabSelectionPlugin's
    // cache. When activeTabId changes, that cache is restored via a deferred
    // editor.update — which can scrollIntoView to the caret. Our rAF re-restore
    // + isRestoringScroll guard must defeat that.
    const { tabId: t1, docId } = await createAndOpenNote(window, 'Dup Caret');

    // t1: place caret near the bottom by clicking the last paragraph, then
    // scroll to the very top.
    const editable = () => window.locator('main:not([style*="display: none"]) [contenteditable="true"]');
    await editable().locator('p').last().click();
    await window.waitForTimeout(100);
    await setActiveScrollTop(window, 0);

    // t2: open a duplicate, place caret near the top, then scroll to near-bottom.
    const t2 = await openDuplicateTab(window, docId);
    await selectTab(window, t2);
    await editable().locator('p').first().click();
    await window.waitForTimeout(100);
    const sH = await getScrollHeight(window);
    const cH = await getClientHeight(window);
    const lowTarget = Math.max(0, sH - cH - 40);
    await setActiveScrollTop(window, lowTarget);

    // Round-trip — each duplicate's scroll must NOT drift toward its caret.
    await selectTab(window, t1);
    expect(await getScrollTop(window)).toBeLessThan(100);

    await selectTab(window, t2);
    expect(await getScrollTop(window)).toBeGreaterThan(lowTarget - 100);

    // One more pass to be sure
    await selectTab(window, t1);
    expect(await getScrollTop(window)).toBeLessThan(100);

    await selectTab(window, t2);
    expect(await getScrollTop(window)).toBeGreaterThan(lowTarget - 100);
  });

  test('mixed: two docs each with two duplicates + a standalone cross-doc tab, all five tabs independent', async ({ window }) => {
    const { tabId: a1, docId: docA } = await createAndOpenNote(window, 'Mix5 A');
    await setActiveScrollTop(window, 220);
    const a2 = await openDuplicateTab(window, docA);
    await selectTab(window, a2);
    await setActiveScrollTop(window, 580);

    const { tabId: b1, docId: docB } = await createAndOpenNote(window, 'Mix5 B');
    await setActiveScrollTop(window, 330);
    const b2 = await openDuplicateTab(window, docB);
    await selectTab(window, b2);
    await setActiveScrollTop(window, 690);

    const { tabId: c1 } = await createAndOpenNote(window, 'Mix5 C');
    await setActiveScrollTop(window, 460);

    const cases: { tabId: string; target: number }[] = [
      { tabId: a1, target: 220 },
      { tabId: a2, target: 580 },
      { tabId: b1, target: 330 },
      { tabId: b2, target: 690 },
      { tabId: c1, target: 460 },
    ];

    // Three full random-ish passes through the five tabs
    const order = [2, 0, 4, 3, 1, 1, 4, 0, 2, 3, 3, 2, 1, 0, 4];
    for (const idx of order) {
      const { tabId, target } = cases[idx];
      await selectTab(window, tabId);
      const actual = await getScrollTop(window);
      expect(Math.abs(actual - target)).toBeLessThan(100);
    }
  });
});
