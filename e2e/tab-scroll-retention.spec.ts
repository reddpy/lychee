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

// ── Reorder ──────────────────────────────────────────────────────────
//
// Dragging tabs in the strip reorders `openTabs`. Each docId in the editor
// area renders one persistent <main>, so without a stable render order React's
// keyed reconciler will pick one <main> to move via insertBefore on every
// reorder. The element it picks is the doc whose old index sits BEFORE the
// running "last placed" cursor in the new order — concretely, the active
// tab's <main> is moved iff the active tab's drag pushes it to a HIGHER
// index in openTabs (L→R drag of the active). insertBefore on a scrollable
// element in Chromium resets its scrollTop to 0 — that's the user-visible
// bug. (The per-tab cache is NOT corrupted, because Chromium does not fire
// a scroll event for layout-driven scrollTop changes.)
//
// Audit invariant: with the stable-order fix in EditorArea/App.tsx removed,
// re-running this file must produce exactly 15 failures across the four
// Reorder describes: 4 in main Reorder + 4 bug-catching in Reorder Edge
// Cases (round-trip, typing-after, repeat-reorder, far-caret) + all 5 in
// Reorder Stress + both tests in Reorder Real-World (real-mouse dnd-kit
// drag and reorder-during-sidebar-toggle). The 5 remaining Reorder Edge
// Cases tests (scroll=0, short non-scrollable, same-index no-op,
// inactive-tab drag, duplicates of one doc) PASS in both states by
// design — they assert orthogonal invariants in shapes where React's
// reconciler doesn't pick the active <main> to move (or where there is
// no scroll to lose). Those tests are labeled "[By-design]" inline.

async function reorderTabs(window: Page, fromIndex: number, toIndex: number): Promise<void> {
  await window.evaluate(
    (args: { from: number; to: number }) =>
      (window as any).__documentStore.getState().reorderTabs(args.from, args.to),
    { from: fromIndex, to: toIndex },
  );
  await window.waitForTimeout(200);
}

test.describe('Tab Scroll Retention — Reorder', () => {
  // Direct repro of the user-reported bug.
  test('active tab dragged left → right keeps its scroll position', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Reorder L→R A');
    await setActiveScrollTop(window, 800);
    const scrolledA = await getScrollTop(window);
    expect(scrolledA).toBeGreaterThan(500);

    await createAndOpenNote(window, 'Reorder L→R B');
    await setActiveScrollTop(window, 0);

    // Active tab back to A at index 0, then drag it to index 1.
    // React will move A's <main> via insertBefore — that's the bug surface.
    await selectTab(window, tabA);
    await reorderTabs(window, 0, 1);

    // A is still active; its scroll must not have reset to 0
    expect(Math.abs((await getScrollTop(window)) - scrolledA)).toBeLessThan(100);
  });

  // Active scrolled to bottom of a long doc, dragged right — same shape as
  // the user's report but stresses the "near-max scroll" boundary.
  test('active tab scrolled to bottom dragged left → right preserves bottom position', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Reorder Bottom A', VERY_LONG_BODY);
    const sH = await getScrollHeight(window);
    const cH = await getClientHeight(window);
    const bottom = Math.max(0, sH - cH - 10);
    await setActiveScrollTop(window, bottom);
    const scrolled = await getScrollTop(window);
    expect(scrolled).toBeGreaterThan(0);

    await createAndOpenNote(window, 'Reorder Bottom B');
    await setActiveScrollTop(window, 0);
    await selectTab(window, tabA);

    await reorderTabs(window, 0, 1);
    expect(Math.abs((await getScrollTop(window)) - scrolled)).toBeLessThan(100);
  });

  // 3-tab variant: active at index 0 dragged to the FAR right (index 2).
  // React still moves the active <main> (lands last in new, smallest old idx).
  test('active tab dragged across full strip (0 → end) keeps scroll', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'Reorder Far A');
    await setActiveScrollTop(window, 650);
    await createAndOpenNote(window, 'Reorder Far B');
    await setActiveScrollTop(window, 0);
    await createAndOpenNote(window, 'Reorder Far C');
    await setActiveScrollTop(window, 0);

    await selectTab(window, tabA);
    // [A, B, C] → [B, C, A]: React moves A.
    await reorderTabs(window, 0, 2);
    expect(Math.abs((await getScrollTop(window)) - 650)).toBeLessThan(100);
  });

  // Active in the middle, dragged one step right.
  test('active tab at middle dragged one slot right keeps scroll', async ({ window }) => {
    await createAndOpenNote(window, 'Reorder Mid A');
    await setActiveScrollTop(window, 0);
    const { tabId: tabB } = await createAndOpenNote(window, 'Reorder Mid B');
    await setActiveScrollTop(window, 540);
    await createAndOpenNote(window, 'Reorder Mid C');
    await setActiveScrollTop(window, 0);

    await selectTab(window, tabB);
    // [A, B, C] → [A, C, B]: React moves B.
    await reorderTabs(window, 1, 2);
    expect(Math.abs((await getScrollTop(window)) - 540)).toBeLessThan(100);
  });
});

// ── Reorder Edge Cases ───────────────────────────────────────────────
//
// Tests in this describe split into two groups:
//   • Bug-catching (fail without the fix): round-trip drag, typing after
//     drag, repeated reorder of same active tab, reorder with far caret.
//   • By-design invariants (pass with OR without the fix, marked below):
//     scroll=0 / short non-scrollable / same-index no-op / inactive-tab
//     drag / duplicates of one doc. Each of these is a case where React's
//     reconciler does NOT pick the active <main> as the one to move (or
//     where there is no scroll to lose), so they verify orthogonal
//     invariants rather than acting as bug-regression guards.

test.describe('Tab Scroll Retention — Reorder Edge Cases', () => {
  // [By-design] No scroll to lose when starting at 0.
  test('scroll exactly at 0 stays at 0 across L→R drag (not a "default")', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RE Edge0 A');
    await setActiveScrollTop(window, 500);
    await setActiveScrollTop(window, 0); // listener saves 0
    await createAndOpenNote(window, 'RE Edge0 B');
    await setActiveScrollTop(window, 300);
    await selectTab(window, tabA);
    await reorderTabs(window, 0, 1);
    expect(await getScrollTop(window)).toBeLessThan(50);
  });

  // [By-design] Short doc can't scroll, so nothing to lose.
  test('short non-scrollable doc dragged L→R does not crash and stays at 0', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RE Short A', SHORT_BODY);
    await createAndOpenNote(window, 'RE Short B');
    await setActiveScrollTop(window, 200);
    await selectTab(window, tabA);
    await reorderTabs(window, 0, 1);
    expect(await getScrollTop(window)).toBe(0);
  });

  // [By-design] Same-index drag is a no-op; openTabs/uniqueDocIds unchanged.
  test('drag from index to same index is a no-op (no scroll perturbation)', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RE NoOp A');
    await setActiveScrollTop(window, 600);
    await createAndOpenNote(window, 'RE NoOp B');
    await setActiveScrollTop(window, 200);
    await selectTab(window, tabA);
    await reorderTabs(window, 0, 0); // same-index "drag"
    expect(Math.abs((await getScrollTop(window)) - 600)).toBeLessThan(100);
  });

  // [By-design] Reconciler moves only inactive <main>s here; active untouched.
  test('drag of inactive tab does not perturb active tab scroll OR its cache', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RE Inactive A');
    await setActiveScrollTop(window, 600);
    await createAndOpenNote(window, 'RE Inactive B');
    await setActiveScrollTop(window, 200);
    const { tabId: tabC } = await createAndOpenNote(window, 'RE Inactive C');
    await setActiveScrollTop(window, 450);
    // C is active. Drag B (index 1) to position 0.
    await reorderTabs(window, 1, 0);
    expect(Math.abs((await getScrollTop(window)) - 450)).toBeLessThan(100);
    // A's cached scroll must still restore correctly
    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 600)).toBeLessThan(100);
    // And C still restores on its own when revisited
    await selectTab(window, tabC);
    expect(Math.abs((await getScrollTop(window)) - 450)).toBeLessThan(100);
  });

  test('round-trip drag (L→R then R→L back) returns to original scroll', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RE RT A');
    await setActiveScrollTop(window, 770);
    await createAndOpenNote(window, 'RE RT B');
    await setActiveScrollTop(window, 0);
    await selectTab(window, tabA);

    await reorderTabs(window, 0, 1); // L→R
    expect(Math.abs((await getScrollTop(window)) - 770)).toBeLessThan(100);
    await reorderTabs(window, 1, 0); // back
    expect(Math.abs((await getScrollTop(window)) - 770)).toBeLessThan(100);
  });

  test('typing in active tab after L→R drag continues to autoscroll/save correctly', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RE Type A');
    await setActiveScrollTop(window, 600);
    await createAndOpenNote(window, 'RE Type B');
    await setActiveScrollTop(window, 0);
    await selectTab(window, tabA);
    await reorderTabs(window, 0, 1);
    // Scroll preserved
    expect(Math.abs((await getScrollTop(window)) - 600)).toBeLessThan(100);
    // Adjust scroll post-drag — listener must still capture it
    await setActiveScrollTop(window, 200);
    await createAndOpenNote(window, 'RE Type C');
    await setActiveScrollTop(window, 800);
    await selectTab(window, tabA);
    expect(Math.abs((await getScrollTop(window)) - 200)).toBeLessThan(100);
  });

  test('reorder followed by another reorder of the same active tab still preserves scroll', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RE Repeat A');
    await setActiveScrollTop(window, 680);
    await createAndOpenNote(window, 'RE Repeat B');
    await setActiveScrollTop(window, 0);
    await createAndOpenNote(window, 'RE Repeat C');
    await setActiveScrollTop(window, 0);
    await selectTab(window, tabA);

    await reorderTabs(window, 0, 1); // A → middle
    expect(Math.abs((await getScrollTop(window)) - 680)).toBeLessThan(100);
    await reorderTabs(window, 1, 2); // A → end
    expect(Math.abs((await getScrollTop(window)) - 680)).toBeLessThan(100);
  });

  // [By-design] Duplicates share one docId → uniqueDocIds unchanged → no React move.
  test('duplicate tabs: L→R drag of one duplicate does not lose its scroll, and its sibling keeps its own', async ({ window }) => {
    const { tabId: t1, docId } = await createAndOpenNote(window, 'RE Dup');
    await setActiveScrollTop(window, 800);
    const t2 = await openDuplicateTab(window, docId);
    await selectTab(window, t2);
    await setActiveScrollTop(window, 150);

    // Duplicates share one <main>; reordering tabs of the same docId does NOT
    // change uniqueDocIds, so React performs no move. This test still pins
    // that scroll on the active duplicate is preserved and the per-tabId
    // cache for the sibling remains correct.
    await reorderTabs(window, 1, 0);
    expect(Math.abs((await getScrollTop(window)) - 150)).toBeLessThan(100);
    await selectTab(window, t1);
    expect(Math.abs((await getScrollTop(window)) - 800)).toBeLessThan(100);
  });

  test('reorder while caret is on a far-away node — scroll does not drift toward caret', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RE Caret A');
    // Click the very first paragraph (caret near top) then scroll to bottom
    await window
      .locator('main:not([style*="display: none"]) .ContentEditable__root p')
      .first()
      .click();
    await window.waitForTimeout(100);
    await setActiveScrollTop(window, 800);
    const target = await getScrollTop(window);

    await createAndOpenNote(window, 'RE Caret B');
    await setActiveScrollTop(window, 0);
    await selectTab(window, tabA);

    // L→R drag of active. Lexical's selection-restore + insertBefore must not
    // combine to drag scroll to the caret near the top.
    await reorderTabs(window, 0, 1);
    expect(Math.abs((await getScrollTop(window)) - target)).toBeLessThan(150);
  });
});

// ── Reorder Stress ───────────────────────────────────────────────────

test.describe('Tab Scroll Retention — Reorder Stress', () => {
  test('walk active tab from index 0 all the way to end of a 5-tab strip', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RS Walk A');
    await setActiveScrollTop(window, 760);
    for (let i = 1; i < 5; i++) {
      await createAndOpenNote(window, `RS Walk ${i}`);
      await setActiveScrollTop(window, 0);
    }
    await selectTab(window, tabA); // ensure A is active at index 0

    // Drag A one slot to the right at a time, asserting scroll after each step.
    for (let from = 0; from < 4; from++) {
      await reorderTabs(window, from, from + 1);
      expect(Math.abs((await getScrollTop(window)) - 760)).toBeLessThan(100);
    }
  });

  test('every tab in a 5-tab strip survives an L→R drag as the active tab', async ({ window }) => {
    const tabs: { tabId: string; target: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const { tabId } = await createAndOpenNote(window, `RS Each ${i}`);
      const target = 200 + i * 130; // 200, 330, 460, 590, 720
      await setActiveScrollTop(window, target);
      tabs.push({ tabId, target });
    }

    // Promote each tab to index 0, then drag it L→R to the end.
    for (const { tabId, target } of tabs) {
      await selectTab(window, tabId);
      // Find current index of tabId in openTabs
      const fromIdx = await window.evaluate((id: string) => {
        const s = (window as any).__documentStore.getState();
        return s.openTabs.findIndex((t: any) => t.tabId === id);
      }, tabId);
      const lastIdx = (await window.evaluate(
        () => (window as any).__documentStore.getState().openTabs.length,
      )) - 1;
      if (fromIdx !== lastIdx) {
        await reorderTabs(window, fromIdx, lastIdx);
        expect(Math.abs((await getScrollTop(window)) - target)).toBeLessThan(100);
      }
    }
  });

  test('10 rapid L→R drags of the same active tab (back-forth) hold scroll', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RS Rapid A');
    await setActiveScrollTop(window, 700);
    await createAndOpenNote(window, 'RS Rapid B');
    await setActiveScrollTop(window, 0);
    await selectTab(window, tabA);

    for (let i = 0; i < 10; i++) {
      await reorderTabs(window, 0, 1);
      await reorderTabs(window, 1, 0);
    }
    expect(Math.abs((await getScrollTop(window)) - 700)).toBeLessThan(100);
  });

  test('reorder interleaved with switches preserves every scroll across 4 tabs', async ({ window }) => {
    const tabs: { tabId: string; target: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const { tabId } = await createAndOpenNote(window, `RS Interleave ${i}`);
      const target = 180 + i * 170; // 180, 350, 520, 690
      await setActiveScrollTop(window, target);
      tabs.push({ tabId, target });
    }

    // Interleave selects and reorders, always L→R from the current active tab.
    const program: Array<['select', number] | ['reorderActiveRight']> = [
      ['select', 0],
      ['reorderActiveRight'],
      ['select', 2],
      ['reorderActiveRight'],
      ['select', 1],
      ['reorderActiveRight'],
      ['select', 3],
      ['reorderActiveRight'],
      ['select', 0],
      ['reorderActiveRight'],
    ];
    for (const step of program) {
      if (step[0] === 'select') {
        await selectTab(window, tabs[step[1]].tabId);
        expect(Math.abs((await getScrollTop(window)) - tabs[step[1]].target)).toBeLessThan(100);
      } else {
        const activeId = await window.evaluate(
          () => (window as any).__documentStore.getState().selectedId as string,
        );
        const fromIdx = await window.evaluate((id: string) => {
          const s = (window as any).__documentStore.getState();
          return s.openTabs.findIndex((t: any) => t.tabId === id);
        }, activeId);
        const lastIdx = (await window.evaluate(
          () => (window as any).__documentStore.getState().openTabs.length,
        )) - 1;
        if (fromIdx < lastIdx) {
          await reorderTabs(window, fromIdx, fromIdx + 1);
          const expectedTarget = tabs.find((t) => t.tabId === activeId)!.target;
          expect(Math.abs((await getScrollTop(window)) - expectedTarget)).toBeLessThan(100);
        }
      }
    }

    // Final sweep — every tab's cache still resolves correctly.
    for (const { tabId, target } of tabs) {
      await selectTab(window, tabId);
      expect(Math.abs((await getScrollTop(window)) - target)).toBeLessThan(100);
    }
  });

  test('close + L→R drag combo across 5 tabs preserves remaining scrolls', async ({ window }) => {
    const tabs: { tabId: string; target: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const { tabId } = await createAndOpenNote(window, `RS Close+Drag ${i}`);
      const target = 200 + i * 140;
      await setActiveScrollTop(window, target);
      tabs.push({ tabId, target });
    }

    // Close index 2
    await closeTab(window, tabs[2].tabId);
    // Now [t0, t1, t3, t4]. Active = t4 (was last). Drag it L→R is a no-op
    // (already at end), so drag t0 to end instead.
    await selectTab(window, tabs[0].tabId);
    await reorderTabs(window, 0, 3); // [t1, t3, t4, t0]
    expect(Math.abs((await getScrollTop(window)) - tabs[0].target)).toBeLessThan(100);

    // Each remaining tab still restores from its cache
    for (const idx of [0, 1, 3, 4]) {
      await selectTab(window, tabs[idx].tabId);
      expect(Math.abs((await getScrollTop(window)) - tabs[idx].target)).toBeLessThan(100);
    }
  });
});

// ── Reorder Real-World Integration ───────────────────────────────────
//
// Everything above invokes `store.reorderTabs` directly, which exercises the
// reconciler path but skips dnd-kit (5px activation, dragstart state, CSS
// transforms applied to the dragged tab). The tests below drive a real
// mouse drag through the strip and pair the bug surface with a sidebar
// toggle so the editor width — and therefore the scrollable height — is
// actively changing around the reorder.

/** Drag the tab matching `fromTabId` past the center of the tab matching `toTabId`. */
async function dragTabPast(window: Page, fromTabId: string, toTabId: string): Promise<void> {
  const source = window.locator(`[data-tab-id="${fromTabId}"]`);
  const target = window.locator(`[data-tab-id="${toTabId}"]`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Tab element has no bounding box');

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  // Aim well past the target's center so dnd-kit's closestCenter decides to swap.
  const direction = targetBox.x > sourceBox.x ? 1 : -1;
  const endX = targetBox.x + targetBox.width / 2 + direction * (targetBox.width / 2 + 4);
  const endY = targetBox.y + targetBox.height / 2;

  await window.mouse.move(startX, startY);
  await window.mouse.down();
  // Cross the 5px PointerSensor activation distance.
  await window.mouse.move(startX + direction * 6, startY, { steps: 4 });
  await window.waitForTimeout(60);
  // Travel across the gap in many small steps so collision detection fires.
  await window.mouse.move(endX, endY, { steps: 25 });
  await window.waitForTimeout(120);
  await window.mouse.up();
  await window.waitForTimeout(250);
}

test.describe('Tab Scroll Retention — Reorder Real-World', () => {
  test('real mouse drag of active tab L→R via dnd-kit preserves scroll', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RW Drag A');
    await setActiveScrollTop(window, 760);
    const scrolledA = await getScrollTop(window);
    expect(scrolledA).toBeGreaterThan(500);

    const { tabId: tabB } = await createAndOpenNote(window, 'RW Drag B');
    await setActiveScrollTop(window, 0);

    // Activate A, then physically drag A past B with the mouse.
    await selectTab(window, tabA);
    await dragTabPast(window, tabA, tabB);

    // Confirm dnd-kit actually committed the reorder (sanity check on the harness).
    const newOrder = await window.evaluate(() =>
      (window as any).__documentStore.getState().openTabs.map((t: any) => t.tabId),
    );
    expect(newOrder[1]).toBe(tabA);

    // A is still active; its scroll must not have reset to 0.
    expect(Math.abs((await getScrollTop(window)) - scrolledA)).toBeLessThan(100);
  });

  test('reorder concurrent with sidebar toggle (layout shift) preserves scroll', async ({ window }) => {
    const { tabId: tabA } = await createAndOpenNote(window, 'RW Sidebar A');
    await setActiveScrollTop(window, 720);
    await createAndOpenNote(window, 'RW Sidebar B');
    await setActiveScrollTop(window, 0);
    await selectTab(window, tabA);

    // Close the sidebar — editor widens; long-line wrap recomputes scrollHeight.
    // scrollTop may clamp, so we re-scroll to a deterministic target before the
    // reorder so the assertion has a stable baseline.
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(400);
    await setActiveScrollTop(window, 720);
    const baselineClosed = await getScrollTop(window);
    expect(baselineClosed).toBeGreaterThan(500);

    // L→R drag while sidebar is closed — pure reconciler-move case under a
    // wider layout.
    await reorderTabs(window, 0, 1);
    expect(Math.abs((await getScrollTop(window)) - baselineClosed)).toBeLessThan(100);

    // Re-open the sidebar — editor narrows mid-flight; the active tab's
    // <main> stays the same DOM node so scroll should clamp at most, never
    // jump to 0.
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(400);
    expect(await getScrollTop(window)).toBeGreaterThan(100);

    // Reorder again with sidebar open — verify the second toggle didn't
    // poison the cache for A.
    await reorderTabs(window, 1, 0);
    expect(await getScrollTop(window)).toBeGreaterThan(100);
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
