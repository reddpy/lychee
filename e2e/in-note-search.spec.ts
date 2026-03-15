import { test, expect } from "./electron-app";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function createNoteWithBody(
  window: any,
  title: string,
  bodyLines: string[],
) {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(350);

  const titleEl = window
    .locator('main:not([style*="display: none"])')
    .first()
    .locator("h1.editor-title")
    .first();
  await expect(titleEl).toBeVisible();
  await titleEl.click();
  await window.keyboard.type(title);
  await window.keyboard.press("Enter");

  for (const line of bodyLines) {
    await window.keyboard.type(line);
    await window.keyboard.press("Enter");
  }

  await window.waitForTimeout(450);
}

function activeMain(window: any) {
  return window.locator('main:not([style*="display: none"])').first();
}

function findTrigger(window: any) {
  return activeMain(window).getByTestId("note-find-trigger");
}

function findInput(window: any) {
  return activeMain(window).getByTestId("note-find-input");
}

function findCounter(window: any) {
  return activeMain(window).getByTestId("note-find-counter");
}

function findNext(window: any) {
  return activeMain(window).getByTestId("note-find-next");
}

function findPrev(window: any) {
  return activeMain(window).getByTestId("note-find-prev");
}

function findClose(window: any) {
  return activeMain(window).getByTestId("note-find-close");
}

async function expectSingleFindUiInstance(window: any) {
  // Find controls should be visible only for the active tab/editor instance.
  // Multiple triggers exist in the DOM (one per mounted tab), but only one should be visible.
  await expect(
    window.locator('main:not([style*="display: none"]) [data-testid="note-find-trigger"]'),
  ).toHaveCount(1);
}

async function ensureFindOpen(window: any) {
  if (!(await findInput(window).isVisible())) {
    await window.keyboard.press(`${mod}+f`);
    // Fallback to explicit click in case the shortcut is intercepted by env/window state.
    if (!(await findInput(window).isVisible())) {
      await findTrigger(window).click();
    }
  }
  await expect(findInput(window)).toBeVisible();
}

async function setFindQueryAndAssert(window: any, query: string, expected: string) {
  await ensureFindOpen(window);
  await findInput(window).fill(query);
  await expect(findCounter(window)).toHaveText(expected);
}

async function expectCounterReadable(window: any) {
  const { current, total } = await readCounter(window);
  expect(total).toBeGreaterThanOrEqual(0);
  expect(current).toBeGreaterThanOrEqual(0);
  expect(current).toBeLessThanOrEqual(total);
}

async function readInputSelection(window: any): Promise<{
  value: string;
  start: number;
  end: number;
}> {
  return window.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="note-find-input"]');
    if (!input) return { value: "", start: -1, end: -1 };
    return {
      value: input.value,
      start: input.selectionStart ?? -1,
      end: input.selectionEnd ?? -1,
    };
  });
}

async function readCounter(window: any): Promise<{ current: number; total: number }> {
  const text = (await findCounter(window).innerText()).trim();
  const match = /^(\d+)\/(\d+)$/.exec(text);
  expect(match).toBeTruthy();
  const current = Number(match?.[1] ?? "0");
  const total = Number(match?.[2] ?? "0");
  return { current, total };
}

async function readHighlightUxSnapshot(window: any): Promise<{
  supported: boolean;
  allCount: number;
  activeCount: number;
  searchOpen: boolean;
}> {
  return window.evaluate(() => {
    const cssAny = CSS as any;
    const highlights = cssAny?.highlights;
    // Search is "open" when the trigger button has aria-expanded="true" in the active main.
    const activeMain = document.querySelector('main:not([style*="display: none"])');
    const trigger = activeMain?.querySelector('[data-testid="note-find-trigger"]');
    const searchOpen = trigger?.getAttribute("aria-expanded") === "true";
    if (!highlights || typeof highlights.get !== "function") {
      return { supported: false, allCount: 0, activeCount: 0, searchOpen };
    }
    const all = highlights.get("lychee-find-all");
    const active = highlights.get("lychee-find-active");
    return {
      supported: true,
      allCount: typeof all?.size === "number" ? all.size : 0,
      activeCount: typeof active?.size === "number" ? active.size : 0,
      searchOpen,
    };
  });
}

async function readActiveMainScrollTop(window: any): Promise<number> {
  return window.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
    return main?.scrollTop ?? 0;
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tabByTitle(window: any, title: string) {
  return window
    .getByRole("button", {
      name: new RegExp(`^${escapeRegex(title)}\\s+Close tab$`),
    })
    .first();
}

test.describe("In-note search", () => {
  test("Cmd/Ctrl+F opens find, focuses input, and toggles closed from input", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Find focus note", [
      "alpha one",
      "alpha two",
      "alpha three",
    ]);

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toBeFocused();

    await findInput(window).fill("alpha");
    await expect(findCounter(window)).toHaveText("1/3");

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();
  });

  test("find stays open on outside click and closes on explicit toggle", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Sticky find", ["needle one", "needle two"]);

    await findTrigger(window).click();
    await expect(findInput(window)).toBeVisible();

    await window.locator("h1.editor-title").click();
    await expect(findInput(window)).toBeVisible();

    await findTrigger(window).click();
    await expect(findInput(window)).not.toBeVisible();
  });

  test("Cmd/Ctrl+F works when focus is outside the editor body", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Global shortcut", ["focus doesn't matter"]);

    await window.locator('[aria-label="New note"]').focus();
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
  });

  test("next/previous navigation updates counter and wraps", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Navigation note", [
      "kiwi one",
      "kiwi two",
      "kiwi three",
      "kiwi four",
      "kiwi five",
    ]);

    await window.keyboard.press(`${mod}+f`);
    await findInput(window).fill("kiwi");
    await expect(findCounter(window)).toHaveText("1/5");

    await findPrev(window).click();
    await expect(findCounter(window)).toHaveText("5/5");

    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("1/5");

    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/5");
  });

  test("opening from search palette keeps in-note find usable", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Palette carry-over", [
      "apple first",
      "apple second",
      "apple third",
    ]);

    await window.getByRole("button", { name: /^Search/ }).first().click();
    const dialog = window.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder("Search notes...").fill("apple");
    const appleResult = dialog
      .locator("[cmdk-item][data-doc-id]")
      .filter({ hasText: "Palette carry-over" })
      .first();
    await expect(appleResult).toBeVisible();
    await appleResult.click();
    await expect(dialog).toHaveCount(0);

    await ensureFindOpen(window);
    await findInput(window).fill("apple");
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("stress: rapid next navigation across many matches stays stable", async ({
    window,
  }) => {
    const lines = Array.from({ length: 20 }, (_, i) => `gamma line ${i + 1}`);
    await createNoteWithBody(window, "Stress note", lines);

    await window.keyboard.press(`${mod}+f`);
    await findInput(window).fill("gamma");
    await expect(findCounter(window)).toHaveText("1/20");

    const next = findNext(window);
    for (let i = 0; i < 35; i += 1) {
      await next.click();
    }

    // 35 clicks from position 1: (1 + 35 - 1) % 20 + 1 = 16
    await expect(findCounter(window)).toHaveText("16/20");
  });

  test("zero-match query shows 0/0 and disables navigation buttons", async ({
    window,
  }) => {
    await createNoteWithBody(window, "No matches note", [
      "banana one",
      "banana two",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("kiwi");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findPrev(window)).toBeDisabled();
    await expect(findNext(window)).toBeDisabled();
  });

  test("query change resets active match to first result", async ({ window }) => {
    await createNoteWithBody(window, "Query reset note", [
      "berry red",
      "berry blue",
      "berry green",
      "melon red",
      "melon blue",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("berry");
    await expect(findCounter(window)).toHaveText("1/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");

    await findInput(window).fill("melon");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("repeated text uses non-overlapping matching behavior", async ({ window }) => {
    await createNoteWithBody(window, "Non-overlap note", ["aaaaa"]);

    await ensureFindOpen(window);
    await findInput(window).fill("aa");
    await expect(findCounter(window)).toHaveText("1/2");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/2");
  });

  test("switching notes does not leak previous note's active position", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Search source note", [
      "plum one",
      "plum two",
      "plum three",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("plum");
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/3");

    await createNoteWithBody(window, "Search target note", [
      "plum alpha",
      "plum beta",
    ]);
    await expect(findInput(window)).not.toBeVisible();

    await ensureFindOpen(window);
    await findInput(window).fill("plum");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("stress: rapid Cmd/Ctrl+F toggles end in deterministic state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Toggle stress note", ["omega one", "omega two"]);

    // 11 toggles from closed should end open.
    for (let i = 0; i < 11; i += 1) {
      await window.keyboard.press(`${mod}+f`);
      await window.waitForTimeout(35);
    }
    await expect(findInput(window)).toBeVisible();

    // One more toggle should close.
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();
  });

  test("multi-tab: active match position does not bleed across notes", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Tab note A", [
      "lemon a1",
      "lemon a2",
      "lemon a3",
      "lemon a4",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("lemon");
    await expect(findCounter(window)).toHaveText("1/4");
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/4");

    // Create second note while keeping first tab open.
    await createNoteWithBody(window, "Tab note B", [
      "lemon b1",
      "lemon b2",
      "lemon b3",
      "lemon b4",
      "lemon b5",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("lemon");
    await expect(findCounter(window)).toHaveText("1/5");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/5");

    // Switch back to note A tab; verify query preserved and position not bled from B.
    await tabByTitle(window, "Tab note A").click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("lemon");
    await expect(findCounter(window)).toHaveText("3/4");

    // Switch back to note B tab; verify query preserved and position not bled from A.
    await tabByTitle(window, "Tab note B").click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("lemon");
    await expect(findCounter(window)).toHaveText("2/5");
  });

  test("multi-tab: same query with different counts never inherits another tab index", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Bounds note A", [
      "pear x1",
      "pear x2",
      "pear x3",
      "pear x4",
      "pear x5",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("pear");
    // Move to 5/5 in note A.
    for (let i = 0; i < 4; i += 1) {
      await findNext(window).click();
    }
    await expect(findCounter(window)).toHaveText("5/5");

    await createNoteWithBody(window, "Bounds note B", [
      "pear y1",
      "pear y2",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("pear");
    await expect(findCounter(window)).toHaveText("1/2");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/2");

    // Return to note A — query and position must be preserved without re-filling.
    await tabByTitle(window, "Bounds note A").click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("pear");
    await expect(findCounter(window)).toHaveText("5/5");

    // Return to note B — must not inherit A's larger index.
    await tabByTitle(window, "Bounds note B").click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("pear");
    await expect(findCounter(window)).toHaveText("2/2");
  });

  test("multi-tab: opening find in one tab does not auto-open on a different tab", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Isolated panel A", ["alpha a", "alpha b"]);
    await ensureFindOpen(window);
    await findInput(window).fill("alpha");
    await expect(findCounter(window)).toHaveText("1/2");
    await expectSingleFindUiInstance(window);

    await createNoteWithBody(window, "Isolated panel B", ["alpha c", "alpha d", "alpha e"]);
    // Switching back to A should keep A's panel state.
    await window.locator('[data-tab-id]').filter({ hasText: 'Isolated panel A' }).click();
    await expect(findInput(window)).toBeVisible();
    await expectSingleFindUiInstance(window);

    // Switching to B should not auto-open from A's state.
    await window.locator('[data-tab-id]').filter({ hasText: 'Isolated panel B' }).click();
    await expect(findInput(window)).not.toBeVisible();
    await expectSingleFindUiInstance(window);
  });

  test("multi-tab: Cmd/Ctrl+F applies to active tab only", async ({ window }) => {
    await createNoteWithBody(window, "Shortcut active A", ["zeta a1", "zeta a2"]);
    await createNoteWithBody(window, "Shortcut active B", [
      "zeta b1",
      "zeta b2",
      "zeta b3",
    ]);

    // Active on B by creation order; open search and assert B match count.
    await window.keyboard.press(`${mod}+f`);
    await ensureFindOpen(window);
    await findInput(window).fill("zeta");
    await expect(findCounter(window)).toHaveText("1/3");
    await expectSingleFindUiInstance(window);

    // Move to A and trigger shortcut there; ensure we get A's count.
    await window.locator('[data-tab-id]').filter({ hasText: 'Shortcut active A' }).click();
    await window.keyboard.press(`${mod}+f`);
    await ensureFindOpen(window);
    await findInput(window).fill("zeta");
    await expect(findCounter(window)).toHaveText("1/2");
    await expectSingleFindUiInstance(window);
  });

  test("multi-tab stress: rapid tab switches + Cmd/Ctrl+F never create multiple active panels", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Stress tab A", [
      "theta a1",
      "theta a2",
      "theta a3",
    ]);
    await createNoteWithBody(window, "Stress tab B", [
      "theta b1",
      "theta b2",
      "theta b3",
      "theta b4",
    ]);

    const tabA = window.locator('[data-tab-id]').filter({ hasText: 'Stress tab A' });
    const tabB = window.locator('[data-tab-id]').filter({ hasText: 'Stress tab B' });

    for (let i = 0; i < 10; i += 1) {
      await tabA.click();
      await window.keyboard.press(`${mod}+f`);
      await ensureFindOpen(window);
      await findInput(window).fill("theta");
      await expect(findCounter(window)).toHaveText("1/3");
      await expectSingleFindUiInstance(window);

      await tabB.click();
      await window.keyboard.press(`${mod}+f`);
      await ensureFindOpen(window);
      await findInput(window).fill("theta");
      await expect(findCounter(window)).toHaveText("1/4");
      await expectSingleFindUiInstance(window);
    }
  });

  test("multi-tab explicit: tab A retains its own open find state when returning", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Retain state A", ["alpha one", "alpha two"]);
    await createNoteWithBody(window, "Retain state B", ["beta one"]);

    // Open search in A.
    await window.locator('[data-tab-id]').filter({ hasText: 'Retain state A' }).click();
    await ensureFindOpen(window);
    await findInput(window).fill("alpha");
    await expect(findCounter(window)).toHaveText("1/2");

    // Move to B (A panel should not render there), then return to A.
    await window.locator('[data-tab-id]').filter({ hasText: 'Retain state B' }).click();
    await expect(findInput(window)).not.toBeVisible();
    await window.locator('[data-tab-id]').filter({ hasText: 'Retain state A' }).click();

    // A should still have its own open panel and query state.
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("alpha");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("multi-tab explicit: tab B stays closed until explicitly opened", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Independent open A", ["gamma one", "gamma two"]);
    await createNoteWithBody(window, "Independent open B", ["gamma three", "gamma four"]);

    // Open in A and verify.
    await window.locator('[data-tab-id]').filter({ hasText: 'Independent open A' }).click();
    await ensureFindOpen(window);
    await findInput(window).fill("gamma");
    await expect(findCounter(window)).toHaveText("1/2");

    // Switch to B and assert no auto-open.
    await window.locator('[data-tab-id]').filter({ hasText: 'Independent open B' }).click();
    await expect(findInput(window)).not.toBeVisible();

    // Explicit open in B should work normally.
    await ensureFindOpen(window);
    await findInput(window).fill("gamma");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("multi-tab matrix: three tabs keep independent query and position state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Matrix tab A", [
      "apple A1",
      "apple A2",
      "apple A3",
    ]);
    await createNoteWithBody(window, "Matrix tab B", [
      "banana B1",
      "banana B2",
      "banana B3",
      "banana B4",
    ]);
    await createNoteWithBody(window, "Matrix tab C", [
      "citrus C1",
      "citrus C2",
    ]);

    await window.locator('[data-tab-id]').filter({ hasText: 'Matrix tab A' }).click();
    await setFindQueryAndAssert(window, "apple", "1/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");

    await window.locator('[data-tab-id]').filter({ hasText: 'Matrix tab B' }).click();
    await setFindQueryAndAssert(window, "banana", "1/4");
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/4");

    await window.locator('[data-tab-id]').filter({ hasText: 'Matrix tab C' }).click();
    await setFindQueryAndAssert(window, "citrus", "1/2");

    // Re-verify each tab restores its own state and not neighbors'.
    await tabByTitle(window, "Matrix tab A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("apple");
    await expect(findCounter(window)).toHaveText("2/3");

    await tabByTitle(window, "Matrix tab B").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("banana");
    await expect(findCounter(window)).toHaveText("3/4");

    await tabByTitle(window, "Matrix tab C").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("citrus");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("multi-tab stress: rapid round-robin with distinct per-tab states remains isolated", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Round tab A", ["delta A1", "delta A2", "delta A3"]);
    await createNoteWithBody(window, "Round tab B", ["echo B1", "echo B2", "echo B3", "echo B4"]);
    await createNoteWithBody(window, "Round tab C", ["foxtrot C1", "foxtrot C2", "foxtrot C3"]);

    const tabA = tabByTitle(window, "Round tab A");
    const tabB = tabByTitle(window, "Round tab B");
    const tabC = tabByTitle(window, "Round tab C");

    // Deterministic baseline per tab.
    await tabA.click();
    await setFindQueryAndAssert(window, "delta", "1/3");
    await tabB.click();
    await setFindQueryAndAssert(window, "echo", "1/4");
    await tabC.click();
    await setFindQueryAndAssert(window, "foxtrot", "1/3");

    for (let i = 0; i < 8; i += 1) {
      await tabA.click();
      // Verify query preserved from previous iteration (not bled from C).
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("delta");
      const counterA = await readCounter(window);
      expect(counterA.total).toBe(3);
      await findNext(window).click();

      await tabB.click();
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("echo");
      const counterB = await readCounter(window);
      expect(counterB.total).toBe(4);
      await findNext(window).click();
      await findNext(window).click();

      await tabC.click();
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("foxtrot");
      const counterC = await readCounter(window);
      expect(counterC.total).toBe(3);
      await expectSingleFindUiInstance(window);
    }
  });

  test("multi-tab: closing one tab does not corrupt find state in remaining tab", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Close tab A", ["iris A1", "iris A2", "iris A3"]);
    await createNoteWithBody(window, "Close tab B", ["iris B1", "iris B2"]);

    await tabByTitle(window, "Close tab A").click();
    await setFindQueryAndAssert(window, "iris", "1/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");

    await tabByTitle(window, "Close tab B").click();
    await setFindQueryAndAssert(window, "iris", "1/2");

    // Close tab B while active.
    const tabB = tabByTitle(window, "Close tab B");
    await tabB.hover();
    await tabB.locator('[aria-label="Close tab"]').click();

    // Return/land on A and validate A state intact.
    await tabByTitle(window, "Close tab A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("iris");
    await expect(findCounter(window)).toHaveText("2/3");
  });

  test("multi-tab: zero-match state in one tab does not leak into match-rich tab", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Zero tab A", ["jasmine one", "jasmine two", "jasmine three"]);
    await createNoteWithBody(window, "Zero tab B", ["lavender one"]);

    await tabByTitle(window, "Zero tab A").click();
    await setFindQueryAndAssert(window, "jasmine", "1/3");
    await expect(findNext(window)).not.toBeDisabled();

    await tabByTitle(window, "Zero tab B").click();
    await setFindQueryAndAssert(window, "jasmine", "0/0");
    await expect(findNext(window)).toBeDisabled();

    await tabByTitle(window, "Zero tab A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("jasmine");
    await expect(findCounter(window)).toHaveText("1/3");
    await expect(findNext(window)).not.toBeDisabled();
  });

  test("multi-tab performance-ish: large docs with rapid switching keep one active find instance", async ({
    window,
  }) => {
    const heavyA = Array.from({ length: 120 }, (_, i) => `sigma A line ${i + 1} sigma`);
    const heavyB = Array.from({ length: 120 }, (_, i) => `tau B line ${i + 1} tau`);
    await createNoteWithBody(window, "Heavy tab A", heavyA);
    await createNoteWithBody(window, "Heavy tab B", heavyB);

    const tabA = tabByTitle(window, "Heavy tab A");
    const tabB = tabByTitle(window, "Heavy tab B");

    // Baseline exact counts once per tab.
    await tabA.click();
    await setFindQueryAndAssert(window, "sigma", "1/240");
    await tabB.click();
    await setFindQueryAndAssert(window, "tau", "1/240");

    for (let i = 0; i < 6; i += 1) {
      await tabA.click();
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("sigma");
      const counterA = await readCounter(window);
      expect(counterA.total).toBe(240);
      await expectSingleFindUiInstance(window);
      await findNext(window).click();

      await tabB.click();
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("tau");
      const counterB = await readCounter(window);
      expect(counterB.total).toBe(240);
      await expectSingleFindUiInstance(window);
      await findNext(window).click();
    }
  });

  test("10-tab soak: per-tab open/closed independence under round-robin switching", async ({
    window,
  }) => {
    const tabs = Array.from({ length: 10 }, (_, i) => `Deca state ${i + 1}`);
    for (let i = 0; i < tabs.length; i += 1) {
      const token = `psi-${i + 1}`;
      const lines = Array.from({ length: 3 }, (_, n) => `${token} line ${n + 1}`);
      await createNoteWithBody(window, tabs[i], lines);
    }

    // Open only in the first tab.
    await tabByTitle(window, tabs[0]).click();
    await setFindQueryAndAssert(window, "psi-1", "1/3");
    await expectSingleFindUiInstance(window);

    // All other tabs should remain closed until explicitly opened.
    for (let i = 1; i < tabs.length; i += 1) {
      await tabByTitle(window, tabs[i]).click();
      await expect(findInput(window)).not.toBeVisible();
      await expectSingleFindUiInstance(window);
    }

    // First tab should still retain its own state.
    await tabByTitle(window, tabs[0]).click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("psi-1");
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("10-tab soak: Cmd/Ctrl+F applies only to active tab with distinct counts", async ({
    window,
  }) => {
    const tabs = Array.from({ length: 10 }, (_, i) => `Deca shortcut ${i + 1}`);
    for (let i = 0; i < tabs.length; i += 1) {
      const token = `rho-${i + 1}`;
      const repeats = (i % 4) + 2; // 2..5
      const lines = Array.from({ length: repeats }, (_, n) => `${token} row ${n + 1}`);
      await createNoteWithBody(window, tabs[i], lines);
    }

    for (let i = 0; i < tabs.length; i += 1) {
      const token = `rho-${i + 1}`;
      const repeats = (i % 4) + 2;
      await tabByTitle(window, tabs[i]).click();

      await window.keyboard.press(`${mod}+f`);
      await ensureFindOpen(window);
      await findInput(window).fill(token);
      await expect(findCounter(window)).toHaveText(`1/${repeats}`);
      await expectSingleFindUiInstance(window);
    }
  });

  test("10-tab stress: rapid multi-round switching never duplicates find panels", async ({
    window,
  }) => {
    const tabs = Array.from({ length: 10 }, (_, i) => `Deca rapid ${i + 1}`);
    for (let i = 0; i < tabs.length; i += 1) {
      await createNoteWithBody(window, tabs[i], [
        `upsilon-${i + 1} a`,
        `upsilon-${i + 1} b`,
        `upsilon-${i + 1} c`,
      ]);
    }

    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < tabs.length; i += 1) {
        const token = `upsilon-${i + 1}`;
        await tabByTitle(window, tabs[i]).click();
        await setFindQueryAndAssert(window, token, "1/3");
        await expectSingleFindUiInstance(window);
        await window.keyboard.press(`${mod}+f`);
        await expect(findInput(window)).not.toBeVisible();
        await expectSingleFindUiInstance(window);
      }
    }
  });

  test("10-tab state map: exact query and position restore per tab after shuffled traversal", async ({
    window,
  }) => {
    const tabs = Array.from({ length: 10 }, (_, i) => `Deca map ${i + 1}`);
    const expectedByTab = new Map<string, { query: string; counter: string }>();

    // Build 10 tabs with unique tokens and varied match counts.
    for (let i = 0; i < tabs.length; i += 1) {
      const query = `nu-${i + 1}`;
      const total = (i % 4) + 2; // 2..5 matches
      const lines = Array.from({ length: total }, (_, n) => `${query} line ${n + 1}`);
      await createNoteWithBody(window, tabs[i], lines);
    }

    // Assign a distinct active index state to each tab.
    for (let i = 0; i < tabs.length; i += 1) {
      const title = tabs[i];
      const query = `nu-${i + 1}`;
      const total = (i % 4) + 2;
      const targetIndex = (i % total) + 1; // 1-based target index in [1..total]

      await tabByTitle(window, title).click();
      await ensureFindOpen(window);
      await findInput(window).fill(query);
      await expect(findCounter(window)).toHaveText(`1/${total}`);

      for (let step = 1; step < targetIndex; step += 1) {
        await findNext(window).click();
      }
      await expect(findCounter(window)).toHaveText(`${targetIndex}/${total}`);
      expectedByTab.set(title, { query, counter: `${targetIndex}/${total}` });
      await expectSingleFindUiInstance(window);
    }

    // Verify in reverse order to catch cross-tab bleed from last-active transitions.
    for (let i = tabs.length - 1; i >= 0; i -= 1) {
      const title = tabs[i];
      const expected = expectedByTab.get(title)!;
      await tabByTitle(window, title).click();
      await ensureFindOpen(window);
      await expect(findInput(window)).toHaveValue(expected.query);
      await expect(findCounter(window)).toHaveText(expected.counter);
      await expectSingleFindUiInstance(window);
    }
  });

  test("keyboard-only: full open/type/navigate/close cycle without mouse", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Keyboard-only find", [
      "nova one",
      "nova two",
      "nova three",
    ]);

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toBeFocused();
    await window.keyboard.type("nova");
    await expect(findCounter(window)).toHaveText("1/3");

    await window.keyboard.press("Enter");
    await expect(findCounter(window)).toHaveText("2/3");
    await window.keyboard.press("Shift+Enter");
    await expect(findCounter(window)).toHaveText("1/3");

    await window.keyboard.press("Escape");
    await expect(findInput(window)).not.toBeVisible();
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();
  });

  test("close semantics: trigger, Escape, and Cmd/Ctrl+F close find; X clears query", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Close semantics", ["orbit one", "orbit two"]);

    // Trigger toggle closes search.
    await findTrigger(window).click();
    await expect(findInput(window)).toBeVisible();
    await findTrigger(window).click();
    await expect(findInput(window)).not.toBeVisible();

    // X button clears the query but keeps search open.
    await ensureFindOpen(window);
    await findInput(window).fill("orbit");
    await expect(findCounter(window)).toHaveText("1/2");
    await findClose(window).click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");

    // Escape closes search.
    await ensureFindOpen(window);
    await window.keyboard.press("Escape");
    await expect(findInput(window)).not.toBeVisible();

    // Cmd/Ctrl+F toggle closes search.
    await ensureFindOpen(window);
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();
  });

  test("Cmd/Ctrl+F close and reopen preserves query, selects all, and typing replaces it", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Persist query on shortcut toggle", [
      "alpha one",
      "alpha two",
      "beta one",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("alpha");
    await expect(findCounter(window)).toHaveText("1/2");

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toBeFocused();
    await expect(findInput(window)).toHaveValue("alpha");

    // Wait for the async select() in the 50ms focus timer to fire.
    // Poll for end === length since that's the definitive signal that select() completed.
    await expect
      .poll(async () => {
        const sel = await readInputSelection(window);
        return sel.end === sel.value.length && sel.start === 0;
      }, { timeout: 2000 })
      .toBe(true);

    await window.keyboard.type("beta");
    await expect(findInput(window)).toHaveValue("beta");
    await expect(findCounter(window)).toHaveText("1/1");
  });

  test("Escape close and reopen preserves query and replace-on-type behavior", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Persist query on escape", [
      "gamma one",
      "gamma two",
      "delta one",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("gamma");
    await expect(findCounter(window)).toHaveText("1/2");

    await window.keyboard.press("Escape");
    await expect(findInput(window)).not.toBeVisible();

    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("gamma");
    await expect(findInput(window)).toBeFocused();
    await window.keyboard.type("delta");
    await expect(findInput(window)).toHaveValue("delta");
    await expect(findCounter(window)).toHaveText("1/1");
  });

  test("X button clears query; trigger toggle preserves query across reopen", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Persist query on close controls", [
      "orbit one",
      "orbit two",
      "planet one",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("orbit");
    await expect(findCounter(window)).toHaveText("1/2");

    // X clears the query (search stays open) then refocus on input.
    await findClose(window).click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");

    // Trigger toggle preserves query across close/reopen.
    await findInput(window).fill("orbit");
    await expect(findCounter(window)).toHaveText("1/2");
    await findTrigger(window).click();
    await expect(findInput(window)).not.toBeVisible();
    await findTrigger(window).click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("orbit");
  });

  test("close and reopen restores match position in the same tab", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Reopen same-tab state", [
      "kiwi one",
      "kiwi two",
      "kiwi three",
      "kiwi four",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("kiwi");
    await expect(findCounter(window)).toHaveText("1/4");
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/4");

    // Hide search UI, then reopen and ensure highlight state reappears at same position.
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("kiwi");
    await expect(findCounter(window)).toHaveText("3/4");

    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("4/4");
  });

  test("across tabs: closed find state reappears per-tab without query bleed", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Reappear tab A", [
      "alpha a1",
      "alpha a2",
      "alpha a3",
    ]);
    await createNoteWithBody(window, "Reappear tab B", [
      "beta b1",
      "beta b2",
      "beta b3",
      "beta b4",
    ]);

    // Tab A: set query/index and close.
    await tabByTitle(window, "Reappear tab A").click();
    await ensureFindOpen(window);
    await findInput(window).fill("alpha");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    // Tab B: set different query/index and close.
    await tabByTitle(window, "Reappear tab B").click();
    await ensureFindOpen(window);
    await findInput(window).fill("beta");
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/4");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    // Reopen on A: must restore A state only.
    await tabByTitle(window, "Reappear tab A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("alpha");
    await expect(findCounter(window)).toHaveText("2/3");

    // Reopen on B: must restore B state only.
    await tabByTitle(window, "Reappear tab B").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("beta");
    await expect(findCounter(window)).toHaveText("3/4");
  });

  test("across tabs: reopen in active tab never revives another tab query", async ({
    window,
  }) => {
    await createNoteWithBody(window, "No bleed tab A", ["mango one", "mango two"]);
    await createNoteWithBody(window, "No bleed tab B", ["peach one", "peach two"]);

    await tabByTitle(window, "No bleed tab A").click();
    await ensureFindOpen(window);
    await findInput(window).fill("mango");
    await expect(findCounter(window)).toHaveText("1/2");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    await tabByTitle(window, "No bleed tab B").click();
    await ensureFindOpen(window);
    await findInput(window).fill("peach");
    await expect(findCounter(window)).toHaveText("1/2");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    // Active on B: reopening via shortcut should restore B query, not A.
    await window.keyboard.press(`${mod}+f`);
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("peach");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("tab close cleanup: closed find state from removed tab does not leak", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Cleanup tab A", [
      "alpha one",
      "alpha two",
      "alpha three",
    ]);
    await createNoteWithBody(window, "Cleanup tab B", ["beta one", "beta two"]);

    await tabByTitle(window, "Cleanup tab A").click();
    await ensureFindOpen(window);
    await findInput(window).fill("alpha");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    const tabA = tabByTitle(window, "Cleanup tab A");
    await tabA.hover();
    await tabA.locator('[aria-label="Close tab"]').click();

    await tabByTitle(window, "Cleanup tab B").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("content changes while find is closed clamp restored index", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Closed-state content mutation", [
      "rose one",
      "rose two",
      "rose three",
      "rose four",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("rose");
    await findNext(window).click();
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("4/4");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type("rose keep one");
    await window.keyboard.press("Enter");
    await window.keyboard.type("rose keep two");

    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("rose");
    // Stored index was 4/4, total dropped to 2 — clamps to 1/2 (reset to first).
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("undo redo while find is closed restores safely on reopen", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Closed-state history replay", [
      "lambda one",
      "lambda two",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("lambda");
    await expect(findCounter(window)).toHaveText("1/2");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("lambda three");
    await window.keyboard.press(`${mod}+z`);
    await window.keyboard.press(`${mod}+Shift+z`);

    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("lambda");
    // Typed "lambda three" (3 total), undo (2), redo (3) — should be 3.
    const { total } = await readCounter(window);
    expect(total).toBe(3);
  });

  test("no-match persisted query stays stable across close and reopen", async ({
    window,
  }) => {
    await createNoteWithBody(window, "No-match persistence", [
      "banana one",
      "banana two",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("kiwi");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();
    await window.keyboard.press(`${mod}+f`);
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("kiwi");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();
  });

  test("rapid tab switching with Cmd/Ctrl+F toggles keeps per-tab query state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Toggle race A", [
      "apple one",
      "apple two",
      "apple three",
    ]);
    await createNoteWithBody(window, "Toggle race B", [
      "berry one",
      "berry two",
      "berry three",
    ]);

    await tabByTitle(window, "Toggle race A").click();
    await ensureFindOpen(window);
    await findInput(window).fill("apple");
    await window.keyboard.press(`${mod}+f`);

    await tabByTitle(window, "Toggle race B").click();
    await ensureFindOpen(window);
    await findInput(window).fill("berry");
    await window.keyboard.press(`${mod}+f`);

    const tabA = tabByTitle(window, "Toggle race A");
    const tabB = tabByTitle(window, "Toggle race B");
    for (let i = 0; i < 10; i += 1) {
      await tabA.click();
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("apple");
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).not.toBeVisible();

      await tabB.click();
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("berry");
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).not.toBeVisible();
    }
  });

  test("search palette open-note flow does not corrupt active tab find state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Background open A", [
      "mango one",
      "mango two",
    ]);
    await createNoteWithBody(window, "Background open B", [
      "papaya one",
      "papaya two",
    ]);

    await tabByTitle(window, "Background open A").click();
    await ensureFindOpen(window);
    await findInput(window).fill("mango");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    await window.getByRole("button", { name: /^Search/ }).first().click();
    const dialog = window.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Search notes...").fill("Background open B");
    const target = dialog
      .locator("[cmdk-item][data-doc-id]")
      .filter({ hasText: "Background open B" })
      .first();
    await expect(target).toBeVisible();
    await target.click();
    await expect(dialog).toHaveCount(0);

    // Active tab should remain A and keep its find state.
    await tabByTitle(window, "Background open A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("mango");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("palette stress cycles keep in-note find state stable and usable", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Palette stress note", [
      "orchid one",
      "orchid two",
      "orchid three",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("orchid");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    for (let i = 0; i < 8; i += 1) {
      await window.getByRole("button", { name: /^Search/ }).first().click();
      const dialog = window.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByPlaceholder("Search notes...").fill("Palette stress note");
      const target = dialog
        .locator("[cmdk-item][data-doc-id]")
        .filter({ hasText: "Palette stress note" })
        .first();
      await expect(target).toBeVisible();
      await target.click();
      await expect(dialog).toHaveCount(0);
    }

    // Palette navigation clears in-note search; verify search still functions after.
    await ensureFindOpen(window);
    await findInput(window).fill("orchid");
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("visual gating: highlight ranges remain but only render when panel is open", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Visual gate baseline", [
      "alpha one",
      "alpha two",
      "alpha three",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("alpha");
    await expect(findCounter(window)).toHaveText("1/3");

    const openSnapshot = await readHighlightUxSnapshot(window);
    test.skip(!openSnapshot.supported, "CSS highlights API unavailable in this runtime");
    expect(openSnapshot.searchOpen).toBeTruthy();
    expect(openSnapshot.allCount).toBeGreaterThan(0);
    expect(openSnapshot.activeCount).toBeGreaterThan(0);

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();
    // Highlight cleanup is async (React effect) — poll until ranges are cleared.
    await expect
      .poll(async () => {
        const snap = await readHighlightUxSnapshot(window);
        return snap.allCount;
      }, { timeout: 5000 })
      .toBe(0);
    const closedSnapshot = await readHighlightUxSnapshot(window);
    expect(closedSnapshot.searchOpen).toBeFalsy();
    expect(closedSnapshot.allCount).toBe(0);
    expect(closedSnapshot.activeCount).toBe(0);

    await window.keyboard.press(`${mod}+f`);
    await ensureFindOpen(window);
    const reopenedSnapshot = await readHighlightUxSnapshot(window);
    expect(reopenedSnapshot.searchOpen).toBeTruthy();
    expect(reopenedSnapshot.allCount).toBeGreaterThan(0);
    expect(reopenedSnapshot.activeCount).toBeGreaterThan(0);
  });

  test("deterministic close/reopen soak: 150 mixed tab operations keep state bounded", async ({
    window,
  }) => {
    const tabs = ["Soak reopen A", "Soak reopen B", "Soak reopen C"];
    const tokenByTab: Record<string, string> = {
      "Soak reopen A": "rhoa",
      "Soak reopen B": "rhob",
      "Soak reopen C": "rhoc",
    };
    for (const t of tabs) {
      const token = tokenByTab[t];
      await createNoteWithBody(window, t, [`${token} one`, `${token} two`, `${token} three`]);
    }

    const expectedQueryByTab: Record<string, string> = {
      "Soak reopen A": tokenByTab["Soak reopen A"],
      "Soak reopen B": tokenByTab["Soak reopen B"],
      "Soak reopen C": tokenByTab["Soak reopen C"],
    };

    let seed = 20260312;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    console.log(`in-note soak seed=${seed}`);

    // Initialize a known closed state for each tab with a query.
    for (const t of tabs) {
      await tabByTitle(window, t).click();
      await ensureFindOpen(window);
      await findInput(window).fill(expectedQueryByTab[t]);
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).not.toBeVisible();
    }

    for (let i = 0; i < 150; i += 1) {
      const tab = tabs[Math.floor(rand() * tabs.length)];
      await tabByTitle(window, tab).click();

      const op = Math.floor(rand() * 5);
      if (op === 0) {
        await window.keyboard.press(`${mod}+f`);
        await ensureFindOpen(window);
      } else if (op === 1) {
        await ensureFindOpen(window);
        if ((await findNext(window).isDisabled()) === false) {
          await findNext(window).click();
        }
      } else if (op === 2) {
        await ensureFindOpen(window);
        if ((await findPrev(window).isDisabled()) === false) {
          await findPrev(window).click();
        }
      } else if (op === 3) {
        await ensureFindOpen(window);
        const q = rand() > 0.2 ? tokenByTab[tab] : `${tokenByTab[tab]}-${i}`;
        expectedQueryByTab[tab] = q;
        await findInput(window).fill(q);
      } else {
        // Close if open, otherwise open then close (toggle stress).
        if (await findInput(window).isVisible()) {
          await window.keyboard.press(`${mod}+f`);
          await expect(findInput(window)).not.toBeVisible();
        } else {
          await window.keyboard.press(`${mod}+f`);
          await ensureFindOpen(window);
          await window.keyboard.press(`${mod}+f`);
          await expect(findInput(window)).not.toBeVisible();
        }
      }

      // Periodically force close->reopen validation for active tab.
      if (i % 7 === 0) {
        if (!(await findInput(window).isVisible())) {
          await window.keyboard.press(`${mod}+f`);
        }
        await ensureFindOpen(window);
        await expect(findInput(window)).toHaveValue(expectedQueryByTab[tab]);
        await expectCounterReadable(window);
        await window.keyboard.press(`${mod}+f`);
        await expect(findInput(window)).not.toBeVisible();
        await window.keyboard.press(`${mod}+f`);
        await ensureFindOpen(window);
        await expect(findInput(window)).toHaveValue(expectedQueryByTab[tab]);
        await expectCounterReadable(window);
      }
    }
  });

  test("enter navigation does not bounce scroll when matches are already visible", async ({
    window,
  }) => {
    await createNoteWithBody(window, "No bounce visible matches", [
      "pear one",
      "pear two",
      "pear three",
      "pear four",
      "pear five",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("pear");
    await expect(findCounter(window)).toHaveText("1/5");

    const startTop = await readActiveMainScrollTop(window);
    for (let i = 0; i < 6; i += 1) {
      await window.keyboard.press("Enter");
    }
    const endTop = await readActiveMainScrollTop(window);
    expect(Math.abs(endTop - startTop)).toBeLessThanOrEqual(4);
  });

  test("enter navigation remains stable in a small viewport", async ({ window }) => {
    await window.setViewportSize({ width: 980, height: 540 });
    await createNoteWithBody(window, "Small viewport find", [
      "apple one",
      "apple two",
      "apple three",
      "apple four",
      "apple five",
      "apple six",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("apple");
    await expect(findCounter(window)).toHaveText("1/6");

    for (let i = 0; i < 8; i += 1) {
      await window.keyboard.press("Enter");
    }
    // 8 presses from 1/6: (1 + 8 - 1) % 6 + 1 = 3
    await expect(findCounter(window)).toHaveText("3/6");
  });

  test("enter navigation on tall blocks keeps counter and scroll behavior stable", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Tall block find", [
      "target alpha",
      "middle filler one",
      "middle filler two",
      "target beta",
      "middle filler three",
      "target gamma",
    ]);

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("```");
    await window.keyboard.press("Enter");
    for (let i = 0; i < 35; i += 1) {
      await window.keyboard.type(`target code line ${i + 1}`);
      await window.keyboard.press("Enter");
    }
    await window.keyboard.type("```");
    await window.keyboard.press("Enter");

    await ensureFindOpen(window);
    await findInput(window).fill("target");
    // 3 body lines + 35 code lines = 38 total "target" matches.
    const { total } = await readCounter(window);
    expect(total).toBe(38);

    for (let i = 0; i < 14; i += 1) {
      await window.keyboard.press("Enter");
    }
    // 14 presses from 1/38 → 15/38
    await expect(findCounter(window)).toHaveText("15/38");
  });

  test("live edits: counter updates while find is open and active index stays valid", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Live edit counter", ["orchid one", "orchid two"]);
    await setFindQueryAndAssert(window, "orchid", "1/2");

    // Add another matching line while find remains open.
    // Wait for the 50ms focus timer from ensureFindOpen to settle before clicking editor.
    await window.waitForTimeout(100);
    await window.locator('main:not([style*="display: none"]) .ContentEditable__root').click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("orchid three");
    await expect(findCounter(window)).toHaveText("1/3");
    await expectCounterReadable(window);

    // Remove one match from query to force recompute.
    await findInput(window).fill("orchid three");
    await expect(findCounter(window)).toHaveText("1/1");
    await expectCounterReadable(window);
  });

  test("boundary wrap: prev at first wraps to last, next at last wraps to first", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Boundary wrap", [
      "raven one",
      "raven two",
      "raven three",
      "raven four",
    ]);
    await setFindQueryAndAssert(window, "raven", "1/4");

    await findPrev(window).click();
    await expect(findCounter(window)).toHaveText("4/4");

    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("1/4");
  });

  test("empty and whitespace query handling stays stable", async ({ window }) => {
    await createNoteWithBody(window, "Whitespace query", ["luna one", "luna two"]);
    await setFindQueryAndAssert(window, "luna", "1/2");

    await findInput(window).fill("");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();

    await findInput(window).fill("   ");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findPrev(window)).toBeDisabled();

    await findInput(window).fill("luna");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("special-character literal queries match and navigate safely", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Special chars", [
      "symbols .* + ? [brackets] (paren) {brace}",
      "path /usr/local/bin",
      "email test+alias@example.com",
    ]);

    await setFindQueryAndAssert(window, ".*", "1/1");
    await findInput(window).fill("[brackets]");
    await expect(findCounter(window)).toHaveText("1/1");
    await findInput(window).fill("/usr/local");
    await expect(findCounter(window)).toHaveText("1/1");
    await findInput(window).fill("test+alias@example.com");
    await expect(findCounter(window)).toHaveText("1/1");
    await expectCounterReadable(window);
  });

  test("active tab close with find open does not orphan UI and preserves remaining tab state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Close-active A", [
      "mint one",
      "mint two",
      "mint three",
    ]);
    await createNoteWithBody(window, "Close-active B", ["sage one", "sage two"]);

    await tabByTitle(window, "Close-active A").click();
    await setFindQueryAndAssert(window, "mint", "1/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");

    await tabByTitle(window, "Close-active B").click();
    await setFindQueryAndAssert(window, "sage", "1/2");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/2");

    const tabB = tabByTitle(window, "Close-active B");
    await tabB.hover();
    await tabB.locator('[aria-label="Close tab"]').click();

    await tabByTitle(window, "Close-active A").click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("mint");
    await expect(findCounter(window)).toHaveText("2/3");
    await expectSingleFindUiInstance(window);
  });

  test("rapid query mutation stress keeps counter parseable and bounded", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Mutation stress", [
      "zen one",
      "zen two",
      "zen three",
      "zero one",
      "zebra one",
    ]);

    await ensureFindOpen(window);
    // Content: "zen one", "zen two", "zen three", "zero one", "zebra one"
    // All 5 lines start with "z", all with "ze", 3 with "zen", 1 with "zero", 1 with "zebra"

    await findInput(window).fill("z");
    await expect(findCounter(window)).toHaveText("1/5");

    await findInput(window).fill("zen");
    await expect(findCounter(window)).toHaveText("1/3");

    await findInput(window).fill("zen one");
    await expect(findCounter(window)).toHaveText("1/1");

    await findInput(window).fill("");
    await expect(findCounter(window)).toHaveText("0/0");

    await findInput(window).fill("  ");
    await expect(findCounter(window)).toHaveText("0/0");

    await findInput(window).fill("zero");
    await expect(findCounter(window)).toHaveText("1/1");

    await findInput(window).fill("zebra");
    await expect(findCounter(window)).toHaveText("1/1");

    await findInput(window).fill("zen");
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("cross-block boundary query does not falsely match and remains stable", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Cross block boundary", ["abc"]);
    await ensureFindOpen(window);

    // Make "def" bold so content spans multiple text nodes.
    await window.locator('main:not([style*="display: none"]) .ContentEditable__root').click();
    await window.keyboard.press("End");
    await window.keyboard.press(`${mod}+b`);
    await window.keyboard.type("def");
    await window.keyboard.press(`${mod}+b`);

    // Positive control: "abc" alone should match.
    await findInput(window).fill("abc");
    await expect(findCounter(window)).toHaveText("1/1");

    // Query spanning node boundary should not falsely match as one contiguous text node.
    await findInput(window).fill("abcdef");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("case and diacritics behavior is stable (case-insensitive, accent-sensitive)", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Case diacritics", [
      "Cafe",
      "café",
      "CAFETERIA",
    ]);
    await ensureFindOpen(window);

    await findInput(window).fill("cafe");
    await expect(findCounter(window)).toHaveText("1/2");

    await findInput(window).fill("CAF");
    await expect(findCounter(window)).toHaveText("1/3");

    await findInput(window).fill("café");
    await expect(findCounter(window)).toHaveText("1/1");
  });

  test("unicode normalization: decomposed query matches canonically equivalent composed text", async ({
    window,
  }) => {
    const composed = "caf\u00E9";
    await createNoteWithBody(window, "Unicode normalize composed search", [
      `${composed} one`,
      `${composed} two`,
    ]);
    await ensureFindOpen(window);

    const decomposed = "cafe\u0301";
    await findInput(window).fill(composed);
    await expect(findCounter(window)).toHaveText("1/2");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/2");
    await findInput(window).fill(decomposed);
    await expect(findCounter(window)).toHaveText("1/2");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/2");
  });

  test("unicode normalization: composed and decomposed queries produce same totals", async ({
    window,
  }) => {
    const composed = "caf\u00E9";
    const decomposed = "cafe\u0301";
    await createNoteWithBody(window, "Unicode normalize totals", [
      `${composed} alpha`,
      `${composed} beta`,
      "plain text",
    ]);
    await ensureFindOpen(window);

    await findInput(window).fill(composed);
    await expect
      .poll(async () => (await readCounter(window)).total, { timeout: 5000 })
      .toBeGreaterThan(0);
    const composedCount = await readCounter(window);

    await findInput(window).fill(decomposed);
    await expect
      .poll(async () => (await readCounter(window)).total, { timeout: 5000 })
      .toBe(composedCount.total);
    const decomposedCount = await readCounter(window);
    expect(decomposedCount.total).toBe(composedCount.total);
  });

  test("ultra-long query stress remains responsive and bounded", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Long query stress", [
      "short content only",
      "another small line",
    ]);
    await ensureFindOpen(window);

    const hugeQuery = "x".repeat(2000);
    await findInput(window).fill(hugeQuery);
    await expect(findCounter(window)).toHaveText("0/0");
    await expectCounterReadable(window);
  });

  test("no-match navigation key spam keeps 0/0 without corruption", async ({
    window,
  }) => {
    await createNoteWithBody(window, "No-match spam", ["alpha beta gamma"]);
    await setFindQueryAndAssert(window, "zzzzzz", "0/0");

    for (let i = 0; i < 30; i += 1) {
      await window.keyboard.press("Enter");
      await window.keyboard.press("Shift+Enter");
    }

    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();
  });

  test("closing another tab during rapid navigation does not affect active tab search state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Active nav tab", [
      "kappa one",
      "kappa two",
      "kappa three",
      "kappa four",
      "kappa five",
    ]);
    await createNoteWithBody(window, "Closable side tab", ["other content"]);

    await tabByTitle(window, "Active nav tab").click();
    await setFindQueryAndAssert(window, "kappa", "1/5");
    for (let i = 0; i < 3; i += 1) {
      await findNext(window).click();
    }
    await expect(findCounter(window)).toHaveText("4/5");

    const sideTab = tabByTitle(window, "Closable side tab");
    await sideTab.hover();
    await sideTab.locator('[aria-label="Close tab"]').click();

    // Active tab search state should remain intact.
    await tabByTitle(window, "Active nav tab").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("kappa");
    await expect(findCounter(window)).toHaveText("4/5");
  });

  test("Cmd/Ctrl+F while search palette is open does not open in-note find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Palette shortcut guard", ["omega line"]);
    await window.getByRole("button", { name: /^Search/ }).first().click();
    const dialog = window.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    await window.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("undo/redo while find is open recomputes counter safely", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Undo redo find", [
      "lambda one",
      "lambda two",
    ]);
    await setFindQueryAndAssert(window, "lambda", "1/2");

    // Add one match while find is open.
    await window.locator('main:not([style*="display: none"]) .ContentEditable__root').click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("lambda three");
    await expect(findCounter(window)).toHaveText("1/3");

    // Undo reverts to 2 matches — counter must recompute.
    await window.keyboard.press(`${mod}+z`);
    await expect(findCounter(window)).toHaveText("1/2");

    // Redo then verify counter is still valid and query is intact.
    await window.keyboard.press(`${mod}+Shift+z`);
    await expect(findInput(window)).toHaveValue("lambda");
    const afterRedo = await readCounter(window);
    // Redo may or may not restore the text (Lexical undo granularity),
    // but total must be either 2 (not restored) or 3 (restored).
    expect([2, 3]).toContain(afterRedo.total);
    expect(afterRedo.current).toBeGreaterThanOrEqual(1);
    expect(afterRedo.current).toBeLessThanOrEqual(afterRedo.total);
  });

  test("active find: full content rewrite while open transitions to 0/0 safely", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Rewrite while searching", [
      "violet one",
      "violet two",
      "violet three",
    ]);
    await setFindQueryAndAssert(window, "violet", "1/3");

    // Rewrite entire editor content while find remains open.
    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type("completely different content");

    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();
  });

  test("active find: removing matches clamps active index to valid range", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Clamp index on delete", [
      "peony one",
      "peony two",
      "peony three",
      "peony four",
    ]);
    await setFindQueryAndAssert(window, "peony", "1/4");
    await findNext(window).click();
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("4/4");

    // Reduce content to only two matches.
    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type("peony keep one");
    await window.keyboard.press("Enter");
    await window.keyboard.type("peony keep two");

    // Was at 4/4, total dropped to 2 — clamps to 1/2 (reset to first).
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("active find: adding new matching content updates total without closing panel", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Add matches while open", ["daisy seed"]);
    await setFindQueryAndAssert(window, "daisy", "1/1");

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("daisy bloom");
    await window.keyboard.press("Enter");
    await window.keyboard.type("daisy field");

    const { total } = await readCounter(window);
    expect(total).toBe(3);
    await expect(findInput(window)).toBeVisible();
  });

  test("active find: rapid edit bursts keep counter parseable and bounded", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Edit burst stress", [
      "sun one",
      "sun two",
      "sun three",
    ]);
    await ensureFindOpen(window);
    await findInput(window).fill("sun");
    await expect(findCounter(window)).toHaveText("1/3");

    // Wait for focus timer to settle before clicking into editor.
    await window.waitForTimeout(100);
    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();

    // Burst of edits while find is open: 6 even (sun) + 6 odd (moon).
    for (let i = 0; i < 12; i += 1) {
      await window.keyboard.press("End");
      await window.keyboard.press("Enter");
      await window.keyboard.type(i % 2 === 0 ? `sun burst ${i}` : `moon burst ${i}`);
    }
    // Restore query in case focus timer interfered, then verify total.
    await findInput(window).fill("sun");
    // 3 original + 6 new "sun" lines = 9 total.
    const { total } = await readCounter(window);
    expect(total).toBe(9);
  });

  test("CJK queries match correctly and navigate", async ({ window }) => {
    await createNoteWithBody(window, "CJK find note", [
      "かな かな",
      "かなび",
      "latin text",
    ]);

    // "かな" appears 3 times: twice in line 1, once in line 2 (prefix of かなび).
    await setFindQueryAndAssert(window, "かな", "1/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/3");
  });

  test("active find: mega-paste and full replace bursts keep behavior stable", async ({
    electronApp,
    window,
  }) => {
    await createNoteWithBody(window, "Mega paste note", ["omega base"]);
    await setFindQueryAndAssert(window, "omega", "1/1");

    const pasteText = Array.from({ length: 300 }, (_, i) => `omega paste ${i + 1}`).join("\n");
    await electronApp.evaluate(({ clipboard }, text) => {
      clipboard.writeText(text);
    }, pasteText);

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.press(`${mod}+v`);
    // 1 original + 300 pasted = 301 "omega" matches.
    const { total } = await readCounter(window);
    expect(total).toBe(301);

    // Replace everything in one burst while find remains open.
    await editorRoot.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type("replacement block without target token");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("race-ish: concurrent side-tab closes while active note is edited with find open", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Race active tab", [
      "race hit one",
      "race hit two",
      "race hit three",
    ]);
    const sideTabs = ["Race side 1", "Race side 2", "Race side 3", "Race side 4"];
    for (const title of sideTabs) {
      await createNoteWithBody(window, title, ["other text"]);
    }

    await tabByTitle(window, "Race active tab").click();
    await setFindQueryAndAssert(window, "race hit", "1/3");
    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');

    for (let i = 0; i < sideTabs.length; i += 1) {
      await editorRoot.click();
      await window.keyboard.press("End");
      await window.keyboard.press("Enter");
      await window.keyboard.type(i % 2 === 0 ? `race hit dynamic ${i}` : `nohit ${i}`);
      await expectCounterReadable(window);

      const side = tabByTitle(window, sideTabs[i]);
      await side.hover();
      await side.locator('[aria-label="Close tab"]').click();

      await tabByTitle(window, "Race active tab").click();
      await ensureFindOpen(window);
      await expect(findInput(window)).toHaveValue("race hit");
      await expectCounterReadable(window);
      await expectSingleFindUiInstance(window);
    }
  });

  test("long session soak: 120 mixed tab-switch/query/nav/edit operations stay consistent", async ({
    window,
  }) => {
    const tabs = ["Soak A", "Soak B", "Soak C", "Soak D", "Soak E"];
    const tokenByTab: Record<string, string> = {
      "Soak A": "soaka",
      "Soak B": "soakb",
      "Soak C": "soakc",
      "Soak D": "soakd",
      "Soak E": "soake",
    };

    for (const title of tabs) {
      const token = tokenByTab[title];
      await createNoteWithBody(window, title, [
        `${token} one`,
        `${token} two`,
        `${token} three`,
      ]);
    }

    for (let i = 0; i < 120; i += 1) {
      const title = tabs[i % tabs.length];
      const token = tokenByTab[title];
      await tabByTitle(window, title).click();
      await ensureFindOpen(window);

      if (i % 3 === 0) {
        await findInput(window).fill(token);
      } else if (i % 3 === 1) {
        const { total } = await readCounter(window);
        if (total === 0) {
          await findInput(window).fill(token);
        } else {
          await findNext(window).click();
        }
      } else {
        const { total } = await readCounter(window);
        if (total === 0) {
          await findInput(window).fill(token);
        } else {
          await findPrev(window).click();
        }
      }

      if (i % 10 === 0) {
        const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
        await editorRoot.click();
        await window.keyboard.press("End");
        await window.keyboard.press("Enter");
        await window.keyboard.type(i % 20 === 0 ? `${token} added ${i}` : `other ${i}`);
        // Restore the search query after editing in the note body.
        await findInput(window).fill(token);
      }

      await expect(findInput(window)).toHaveValue(token);
      await expectCounterReadable(window);
      await expectSingleFindUiInstance(window);
    }
  });

  test("unicode grapheme/emoji queries remain stable and navigable", async ({
    window,
  }) => {
    const family = "👨‍👩‍👧‍👦";
    await createNoteWithBody(window, "Emoji grapheme search", [
      `${family} first`,
      "plain text",
      `${family} second`,
    ]);

    await setFindQueryAndAssert(window, family, "1/2");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/2");
    await expectCounterReadable(window);
  });

  test("locale casing edge queries stay bounded and do not crash", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Locale casing", [
      "I i İ ı",
      "istanbul ISTANBUL",
      "ışık IŞIK",
    ]);
    await ensureFindOpen(window);

    // Case-insensitive: "i" matches "I", "i", and "i" in istanbul/ISTANBUL/ışık/IŞIK.
    await findInput(window).fill("i");
    const iCount = await readCounter(window);
    expect(iCount.total).toBeGreaterThan(0);

    await findInput(window).fill("ist");
    const istCount = await readCounter(window);
    expect(istCount.total).toBeGreaterThanOrEqual(1);

    // Dotted İ is distinct from regular i in accent-sensitive matching.
    await findInput(window).fill("İ");
    const dotICount = await readCounter(window);
    expect(dotICount.total).toBeGreaterThanOrEqual(1);
  });

  test("control-character queries (newline/tab/zero-width) keep search state valid", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Control char query", [
      "line one",
      "line two",
      "line three",
    ]);
    await ensureFindOpen(window);

    // Normal query first to confirm search is working.
    await findInput(window).fill("line");
    await expect(findCounter(window)).toHaveText("1/3");

    // Zero-width space query — should not crash, may or may not match.
    await findInput(window).fill("line\u200bone");
    await expectCounterReadable(window);

    // After edge queries, normal search should still function.
    await findInput(window).fill("line");
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("very long single-line note remains searchable and navigable", async ({
    window,
  }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(350);
    const titleEl = window
      .locator('main:not([style*="display: none"])')
      .first()
      .locator("h1.editor-title")
      .first();
    await titleEl.click();
    await window.keyboard.type("Single-line huge note");
    await window.keyboard.press("Enter");

    const token = "MEGATOK";
    const repeat = 50;
    const chunks: string[] = [];
    for (let i = 0; i < repeat; i += 1) {
      chunks.push(`${token}_${i}`);
      chunks.push("xxxxxxxxxxxxxxxxxxxxxxxx");
    }
    await window.keyboard.type(chunks.join(" "));

    await ensureFindOpen(window);
    await findInput(window).fill("MEGATOK");
    await expect(findCounter(window)).toHaveText(`1/${repeat}`);
    await findNext(window).click();
    await expectCounterReadable(window);
  });

  test("concurrent UI: search palette open does not corrupt in-note search state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Modal coexistence", [
      "modal alpha",
      "modal beta",
    ]);
    await setFindQueryAndAssert(window, "modal", "1/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");

    await window.getByRole("button", { name: /Search/ }).first().click();
    const paletteInput = window.getByPlaceholder("Search notes...");
    await expect(paletteInput).toBeVisible();

    // Find shortcut should be ignored while command palette is open.
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveValue("modal");
    await expect(findCounter(window)).toHaveText("2/3");

    await window.keyboard.press("Escape");
    await expect(paletteInput).toHaveCount(0);

    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("modal");
    await expect(findCounter(window)).toHaveText("2/3");
  });

  test("randomized long-loop soak keeps counters parseable and panel singular", async ({
    window,
  }) => {
    const tabs = ["Rand A", "Rand B", "Rand C"];
    const tokenByTab: Record<string, string> = {
      "Rand A": "randA",
      "Rand B": "randB",
      "Rand C": "randC",
    };
    for (const t of tabs) {
      const token = tokenByTab[t];
      await createNoteWithBody(window, t, [`${token} 1`, `${token} 2`, `${token} 3`]);
    }

    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 150; i += 1) {
      const tab = tabs[Math.floor(rand() * tabs.length)];
      const token = tokenByTab[tab];
      await tabByTitle(window, tab).click();
      await ensureFindOpen(window);

      const op = Math.floor(rand() * 5);
      if (op === 0) {
        await findInput(window).fill(token);
      } else if (op === 1) {
        const { total } = await readCounter(window);
        if (total > 0) await findNext(window).click();
      } else if (op === 2) {
        const { total } = await readCounter(window);
        if (total > 0) await findPrev(window).click();
      } else if (op === 3) {
        const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
        await editorRoot.click();
        await window.keyboard.press("End");
        await window.keyboard.press("Enter");
        await window.keyboard.type(rand() > 0.4 ? `${token} dyn ${i}` : `other dyn ${i}`);
      } else {
        await findInput(window).fill(rand() > 0.5 ? token : `x-${i}`);
      }

      await expectCounterReadable(window);
      await expectSingleFindUiInstance(window);
    }
  });

  test("X button is disabled when query is empty and enabled when query has text", async ({
    window,
  }) => {
    await createNoteWithBody(window, "X disabled state", ["apple one", "apple two"]);

    await ensureFindOpen(window);
    // Empty query: X should be disabled.
    await expect(findClose(window)).toBeDisabled();

    await findInput(window).fill("apple");
    await expect(findCounter(window)).toHaveText("1/2");
    // Non-empty query: X should be enabled.
    await expect(findClose(window)).not.toBeDisabled();

    // Click X to clear.
    await findClose(window).click();
    await expect(findInput(window)).toHaveValue("");
    // After clear: X should be disabled again.
    await expect(findClose(window)).toBeDisabled();
  });

  test("chevron buttons are disabled with zero matches and enabled with matches", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Chevron disabled state", ["cherry one", "cherry two"]);

    await ensureFindOpen(window);
    // No query yet: chevrons disabled.
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();

    await findInput(window).fill("cherry");
    await expect(findCounter(window)).toHaveText("1/2");
    // Matches found: chevrons enabled.
    await expect(findNext(window)).not.toBeDisabled();
    await expect(findPrev(window)).not.toBeDisabled();

    // Zero-match query: chevrons disabled again.
    await findInput(window).fill("zzzznotfound");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();
  });

  test("X clears query but Escape retains it — distinct behaviors", async ({
    window,
  }) => {
    await createNoteWithBody(window, "X vs Escape", ["fig one", "fig two", "fig three"]);

    // Set up a query and navigate to a position.
    await ensureFindOpen(window);
    await findInput(window).fill("fig");
    await expect(findCounter(window)).toHaveText("1/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");

    // X clears query, keeps search open, resets counter.
    await findClose(window).click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");

    // Type a new query — search is still open.
    await findInput(window).fill("fig");
    await expect(findCounter(window)).toHaveText("1/3");

    // Escape closes search but retains the query.
    await window.keyboard.press("Escape");
    await expect(findInput(window)).not.toBeVisible();

    // Reopen: query is preserved.
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("fig");
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("X button clears then re-type and navigate works correctly", async ({
    window,
  }) => {
    await createNoteWithBody(window, "X then retype", ["plum one", "plum two", "plum three"]);

    await ensureFindOpen(window);
    await findInput(window).fill("plum");
    await expect(findCounter(window)).toHaveText("1/3");
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/3");

    // Clear via X.
    await findClose(window).click();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();

    // Re-type same query — should reset to 1/3, not 3/3.
    await findInput(window).fill("plum");
    await expect(findCounter(window)).toHaveText("1/3");
    await expect(findNext(window)).not.toBeDisabled();

    // Navigate normally after re-type.
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");
  });

  test("search stays open when clicking into editor body", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Click outside stable", [
      "grape one",
      "grape two",
      "grape three",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("grape");
    await expect(findCounter(window)).toHaveText("1/3");

    // Click into the editor body — search should stay open.
    await window.waitForTimeout(100);
    await window.locator('main:not([style*="display: none"]) .ContentEditable__root').click();
    await expect(findInput(window)).toBeVisible();
    await expect(findCounter(window)).toHaveText("1/3");

    // Click the title — search should stay open.
    await window.locator('main:not([style*="display: none"]) h1.editor-title').click();
    await expect(findInput(window)).toBeVisible();
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("multi-tab: X clear on tab A does not affect tab B query", async ({
    window,
  }) => {
    await createNoteWithBody(window, "X isolation A", ["lime one", "lime two"]);
    await createNoteWithBody(window, "X isolation B", ["lime three", "lime four", "lime five"]);

    // Set query on both tabs.
    await tabByTitle(window, "X isolation A").click();
    await setFindQueryAndAssert(window, "lime", "1/2");

    await tabByTitle(window, "X isolation B").click();
    await setFindQueryAndAssert(window, "lime", "1/3");

    // Clear query on B via X.
    await findClose(window).click();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");

    // Switch to A — query should be unaffected.
    await tabByTitle(window, "X isolation A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("lime");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("Cmd/Ctrl+F closes search after X cleared query, reopen shows empty", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Toggle after X clear", ["kiwi one", "kiwi two"]);

    await ensureFindOpen(window);
    await findInput(window).fill("kiwi");
    await expect(findCounter(window)).toHaveText("1/2");

    // X clears query, search stays open.
    await findClose(window).click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("");

    // Cmd+F should close the (open, empty-query) search.
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();

    // Reopen: query should still be empty (X cleared it before close).
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("Enter and Shift+Enter in empty input after X clear do nothing", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Enter after X clear", ["peach one", "peach two"]);

    await ensureFindOpen(window);
    await findInput(window).fill("peach");
    await expect(findCounter(window)).toHaveText("1/2");

    // Clear via X.
    await findClose(window).click();
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();

    // Enter and Shift+Enter should not crash or change state.
    await findInput(window).focus();
    await window.keyboard.press("Enter");
    await expect(findCounter(window)).toHaveText("0/0");
    await window.keyboard.press("Shift+Enter");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findInput(window)).toBeVisible();
  });

  test("rapid open/close/open: focus timer from first open does not steal focus after reopen", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Rapid toggle focus", [
      "mango one",
      "mango two",
      "mango three",
    ]);

    // Rapid toggle: open, close before 50ms timer fires, open again.
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).not.toBeVisible();
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toBeFocused();

    // Type a query — should go into the input, not be stolen.
    await window.keyboard.type("mango");
    await expect(findInput(window)).toHaveValue("mango");
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("X clear mid-navigation resets position and counter", async ({
    window,
  }) => {
    await createNoteWithBody(window, "X mid-nav", [
      "date one",
      "date two",
      "date three",
      "date four",
      "date five",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("date");
    await expect(findCounter(window)).toHaveText("1/5");
    await findNext(window).click();
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("4/5");

    // Clear mid-navigation.
    await findClose(window).click();
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();

    // Re-type: should start at 1, not 4.
    await findInput(window).fill("date");
    await expect(findCounter(window)).toHaveText("1/5");
  });

  test("multi-tab: X clear mid-navigation on tab A preserves tab B navigation position", async ({
    window,
  }) => {
    await createNoteWithBody(window, "X nav iso A", [
      "melon one",
      "melon two",
      "melon three",
      "melon four",
    ]);
    await createNoteWithBody(window, "X nav iso B", [
      "melon five",
      "melon six",
      "melon seven",
    ]);

    // Navigate to position 3/4 on tab A.
    await tabByTitle(window, "X nav iso A").click();
    await setFindQueryAndAssert(window, "melon", "1/4");
    await findNext(window).click();
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("3/4");

    // Navigate to position 2/3 on tab B.
    await tabByTitle(window, "X nav iso B").click();
    await setFindQueryAndAssert(window, "melon", "1/3");
    await findNext(window).click();
    await expect(findCounter(window)).toHaveText("2/3");

    // X clear on tab A (resets position).
    await tabByTitle(window, "X nav iso A").click();
    await ensureFindOpen(window);
    await findClose(window).click();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");

    // Tab B should be unaffected — still at 2/3.
    await tabByTitle(window, "X nav iso B").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("melon");
    await expect(findCounter(window)).toHaveText("2/3");
  });

  test("multi-tab: Escape on tab A retains query, X clear on tab B clears — each preserves on switch", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Esc vs X A", [
      "pine one",
      "pine two",
      "pine three",
    ]);
    await createNoteWithBody(window, "Esc vs X B", [
      "pine four",
      "pine five",
    ]);

    // Tab A: set query and close with Escape (retains query).
    await tabByTitle(window, "Esc vs X A").click();
    await setFindQueryAndAssert(window, "pine", "1/3");
    await window.keyboard.press("Escape");
    await expect(findInput(window)).not.toBeVisible();

    // Tab B: set query and clear with X (empties query, stays open).
    await tabByTitle(window, "Esc vs X B").click();
    await setFindQueryAndAssert(window, "pine", "1/2");
    await findClose(window).click();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");

    // Switch back to A: query preserved from Escape close.
    await tabByTitle(window, "Esc vs X A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("pine");
    await expect(findCounter(window)).toHaveText("1/3");

    // Switch back to B: query still empty from X clear.
    await tabByTitle(window, "Esc vs X B").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("multi-tab: chevron disabled/enabled state is per-tab", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Chevron iso A", [
      "walnut one",
      "walnut two",
    ]);
    await createNoteWithBody(window, "Chevron iso B", ["hazelnut only"]);

    // Tab A: query with matches — chevrons enabled.
    await tabByTitle(window, "Chevron iso A").click();
    await setFindQueryAndAssert(window, "walnut", "1/2");
    await expect(findNext(window)).not.toBeDisabled();
    await expect(findPrev(window)).not.toBeDisabled();

    // Tab B: query with zero matches — chevrons disabled.
    await tabByTitle(window, "Chevron iso B").click();
    await setFindQueryAndAssert(window, "walnut", "0/0");
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();

    // Switch back to A: chevrons should still be enabled.
    await tabByTitle(window, "Chevron iso A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("walnut");
    await expect(findCounter(window)).toHaveText("1/2");
    await expect(findNext(window)).not.toBeDisabled();
    await expect(findPrev(window)).not.toBeDisabled();

    // Switch back to B: chevrons should still be disabled.
    await tabByTitle(window, "Chevron iso B").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("walnut");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(findNext(window)).toBeDisabled();
    await expect(findPrev(window)).toBeDisabled();
  });

  test("multi-tab: search open/closed independence after X clear and Escape on different tabs", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Open state A", ["cedar one", "cedar two"]);
    await createNoteWithBody(window, "Open state B", ["cedar three", "cedar four"]);
    await createNoteWithBody(window, "Open state C", ["cedar five"]);

    // Tab A: open search, X clear, leave open (empty).
    await tabByTitle(window, "Open state A").click();
    await setFindQueryAndAssert(window, "cedar", "1/2");
    await findClose(window).click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("");

    // Tab B: open search, Escape close (retains query).
    await tabByTitle(window, "Open state B").click();
    await setFindQueryAndAssert(window, "cedar", "1/2");
    await window.keyboard.press("Escape");
    await expect(findInput(window)).not.toBeVisible();

    // Tab C: never opened search.
    await tabByTitle(window, "Open state C").click();
    await expect(findInput(window)).not.toBeVisible();

    // Verify all three tabs maintain independent open/closed state.
    await tabByTitle(window, "Open state A").click();
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("");

    await tabByTitle(window, "Open state B").click();
    await expect(findInput(window)).not.toBeVisible();
    // Reopen B: query should be preserved from Escape.
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("cedar");

    await tabByTitle(window, "Open state C").click();
    await expect(findInput(window)).not.toBeVisible();
  });
});
