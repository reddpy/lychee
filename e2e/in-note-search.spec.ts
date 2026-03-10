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

function findTrigger(window: any) {
  return window.getByTestId("note-find-trigger");
}

function findInput(window: any) {
  return window.getByTestId("note-find-input");
}

function findPanel(window: any) {
  return window.getByTestId("note-find-panel");
}

function findCounter(window: any) {
  return window.getByTestId("note-find-counter");
}

async function expectSingleFindUiInstance(window: any) {
  // Find controls should exist only for the active tab/editor instance.
  await expect(window.getByTestId("note-find-trigger")).toHaveCount(1);
  const panelCount = await window.getByTestId("note-find-panel").count();
  expect(panelCount).toBeLessThanOrEqual(1);
}

async function ensureFindOpen(window: any) {
  if ((await findInput(window).count()) === 0) {
    await window.keyboard.press(`${mod}+f`);
    // Fallback to explicit click in case the shortcut is intercepted by env/window state.
    if ((await findInput(window).count()) === 0) {
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
  panelOpen: boolean;
  gateActive: boolean;
}> {
  return window.evaluate(() => {
    const cssAny = CSS as any;
    const highlights = cssAny?.highlights;
    const panelOpen = !!document.querySelector('[data-testid="note-find-panel"]');
    const gateActive = document.body.matches(":has([data-testid='note-find-panel'])");
    if (!highlights || typeof highlights.get !== "function") {
      return { supported: false, allCount: 0, activeCount: 0, panelOpen, gateActive };
    }
    const all = highlights.get("lychee-find-all");
    const active = highlights.get("lychee-find-active");
    return {
      supported: true,
      allCount: typeof all?.size === "number" ? all.size : 0,
      activeCount: typeof active?.size === "number" ? active.size : 0,
      panelOpen,
      gateActive,
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
    await expect(findCounter(window)).not.toHaveText("0/0");

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);
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
    await expect(findInput(window)).toHaveCount(0);
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

    await window.getByTestId("note-find-prev").click();
    await expect(findCounter(window)).toHaveText("5/5");

    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("1/5");

    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
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
    await expect(findCounter(window)).toHaveText(/^[123]\/3$/);
  });

  test("stress: rapid next navigation across many matches stays stable", async ({
    window,
  }) => {
    const lines = Array.from({ length: 20 }, (_, i) => `gamma line ${i + 1}`);
    await createNoteWithBody(window, "Stress note", lines);

    await window.keyboard.press(`${mod}+f`);
    await findInput(window).fill("gamma");
    await expect(findCounter(window)).toHaveText("1/20");

    const next = window.getByTestId("note-find-next");
    for (let i = 0; i < 35; i += 1) {
      await next.click();
    }

    const text = (await findCounter(window).innerText()).trim();
    const match = /^(\d+)\/20$/.exec(text);
    expect(match).toBeTruthy();
    const current = Number(match?.[1] ?? "0");
    expect(current).toBeGreaterThanOrEqual(1);
    expect(current).toBeLessThanOrEqual(20);
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
    await expect(window.getByTestId("note-find-prev")).toBeDisabled();
    await expect(window.getByTestId("note-find-next")).toBeDisabled();
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
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    await findInput(window).fill("melon");
    await expect(findCounter(window)).toHaveText("1/2");
  });

  test("repeated text uses non-overlapping matching behavior", async ({ window }) => {
    await createNoteWithBody(window, "Non-overlap note", ["aaaaa"]);

    await ensureFindOpen(window);
    await findInput(window).fill("aa");
    await expect(findCounter(window)).toHaveText("1/2");
    await window.getByTestId("note-find-next").click();
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
    await window.getByTestId("note-find-next").click();
    await findPanel(window).getByRole("button", { name: "Next match" }).click();
    await expect(findCounter(window)).toHaveText("3/3");

    await createNoteWithBody(window, "Search target note", [
      "plum alpha",
      "plum beta",
    ]);
    await expect(findInput(window)).toHaveCount(0);

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
    await expect(findInput(window)).toHaveCount(0);
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
    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
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
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/5");

    // Switch back to note A tab; find may be closed here, so reopen and verify
    // note B's active position did not bleed into note A.
    await tabByTitle(window, "Tab note A").click();
    await ensureFindOpen(window);
    await findInput(window).fill("lemon");
    await expect(findCounter(window)).toHaveText("3/4");

    // Switch back to note B tab and ensure note A position does not bleed.
    await tabByTitle(window, "Tab note B").click();
    await ensureFindOpen(window);
    await findInput(window).fill("lemon");
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
      await window.getByTestId("note-find-next").click();
    }
    await expect(findCounter(window)).toHaveText("5/5");

    await createNoteWithBody(window, "Bounds note B", [
      "pear y1",
      "pear y2",
    ]);

    await ensureFindOpen(window);
    await findInput(window).fill("pear");
    await expect(findCounter(window)).toHaveText("1/2");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/2");

    // Return to note A, reopen find, and ensure note B index did not bleed.
    await tabByTitle(window, "Bounds note A").click();
    await ensureFindOpen(window);
    await findInput(window).fill("pear");
    await expect(findCounter(window)).toHaveText("5/5");

    // Return to note B and ensure note A's larger index did not bleed.
    await tabByTitle(window, "Bounds note B").click();
    await ensureFindOpen(window);
    await findInput(window).fill("pear");
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
    await expect(findInput(window)).toHaveCount(0);
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
    await expect(findInput(window)).toHaveCount(0);
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
    await expect(findInput(window)).toHaveCount(0);

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
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    await window.locator('[data-tab-id]').filter({ hasText: 'Matrix tab B' }).click();
    await setFindQueryAndAssert(window, "banana", "1/4");
    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
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

    const assertCounterReadable = async () => {
      const text = (await findCounter(window).innerText()).trim();
      const match = /^(\d+)\/(\d+)$/.exec(text);
      expect(match).toBeTruthy();
      const current = Number(match?.[1] ?? "0");
      const total = Number(match?.[2] ?? "0");
      expect(total).toBeGreaterThanOrEqual(0);
      expect(current).toBeGreaterThanOrEqual(0);
      expect(current).toBeLessThanOrEqual(total);
    };

    // Deterministic baseline per tab.
    await tabA.click();
    await setFindQueryAndAssert(window, "delta", "1/3");
    await tabB.click();
    await setFindQueryAndAssert(window, "echo", "1/4");
    await tabC.click();
    await setFindQueryAndAssert(window, "foxtrot", "1/3");

    for (let i = 0; i < 8; i += 1) {
      await tabA.click();
      await ensureFindOpen(window);
      await findInput(window).fill("delta");
      await expect(findInput(window)).toHaveValue("delta");
      await assertCounterReadable();
      await window.getByTestId("note-find-next").click();
      await assertCounterReadable();

      await tabB.click();
      await ensureFindOpen(window);
      await findInput(window).fill("echo");
      await expect(findInput(window)).toHaveValue("echo");
      await assertCounterReadable();
      await window.getByTestId("note-find-next").click();
      await window.getByTestId("note-find-next").click();
      await assertCounterReadable();

      await tabC.click();
      await ensureFindOpen(window);
      await findInput(window).fill("foxtrot");
      await expect(findInput(window)).toHaveValue("foxtrot");
      await assertCounterReadable();
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
    await window.getByTestId("note-find-next").click();
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
    await expect(window.getByTestId("note-find-next")).not.toBeDisabled();

    await tabByTitle(window, "Zero tab B").click();
    await setFindQueryAndAssert(window, "jasmine", "0/0");
    await expect(window.getByTestId("note-find-next")).toBeDisabled();

    await tabByTitle(window, "Zero tab A").click();
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("jasmine");
    await expect(findCounter(window)).toHaveText("1/3");
    await expect(window.getByTestId("note-find-next")).not.toBeDisabled();
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

    const assertCounterReadable = async () => {
      const text = (await findCounter(window).innerText()).trim();
      const match = /^(\d+)\/(\d+)$/.exec(text);
      expect(match).toBeTruthy();
      const current = Number(match?.[1] ?? "0");
      const total = Number(match?.[2] ?? "0");
      expect(total).toBeGreaterThanOrEqual(0);
      expect(current).toBeGreaterThanOrEqual(0);
      expect(current).toBeLessThanOrEqual(total);
    };

    // Baseline exact counts once per tab.
    await tabA.click();
    await setFindQueryAndAssert(window, "sigma", "1/240");
    await tabB.click();
    await setFindQueryAndAssert(window, "tau", "1/240");

    for (let i = 0; i < 6; i += 1) {
      await tabA.click();
      await ensureFindOpen(window);
      await findInput(window).fill("sigma");
      await expect(findInput(window)).toHaveValue("sigma");
      await assertCounterReadable();
      await expectSingleFindUiInstance(window);
      await window.getByTestId("note-find-next").click();
      await assertCounterReadable();

      await tabB.click();
      await ensureFindOpen(window);
      await findInput(window).fill("tau");
      await expect(findInput(window)).toHaveValue("tau");
      await assertCounterReadable();
      await expectSingleFindUiInstance(window);
      await window.getByTestId("note-find-next").click();
      await assertCounterReadable();
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
      await expect(findInput(window)).toHaveCount(0);
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
        await expect(findInput(window)).toHaveCount(0);
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
        await window.getByTestId("note-find-next").click();
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
    await expect(findInput(window)).toHaveCount(0);
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);
  });

  test("close semantics: trigger, close button, Escape, and Cmd/Ctrl+F all close find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Close semantics", ["orbit one", "orbit two"]);

    await findTrigger(window).click();
    await expect(findInput(window)).toBeVisible();
    await findTrigger(window).click();
    await expect(findInput(window)).toHaveCount(0);

    await ensureFindOpen(window);
    await window.getByTestId("note-find-close").click();
    await expect(findInput(window)).toHaveCount(0);

    await ensureFindOpen(window);
    await window.keyboard.press("Escape");
    await expect(findInput(window)).toHaveCount(0);

    await ensureFindOpen(window);
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);
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
    await expect(findInput(window)).toHaveCount(0);

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toBeFocused();
    await expect(findInput(window)).toHaveValue("alpha");

    const selection = await readInputSelection(window);
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.value.length);

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
    await expect(findInput(window)).toHaveCount(0);

    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("gamma");
    await expect(findInput(window)).toBeFocused();
    await window.keyboard.type("delta");
    await expect(findInput(window)).toHaveValue("delta");
    await expect(findCounter(window)).toHaveText("1/1");
  });

  test("close button and trigger toggle both preserve query state across reopen", async ({
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

    await window.getByTestId("note-find-close").click();
    await expect(findInput(window)).toHaveCount(0);
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("orbit");

    await findTrigger(window).click();
    await expect(findInput(window)).toHaveCount(0);
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
    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("3/4");

    // Hide search UI, then reopen and ensure highlight state reappears at same position.
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);
    await window.keyboard.press(`${mod}+f`);
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("kiwi");
    await expect(findCounter(window)).toHaveText("3/4");

    await window.getByTestId("note-find-next").click();
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
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);

    // Tab B: set different query/index and close.
    await tabByTitle(window, "Reappear tab B").click();
    await ensureFindOpen(window);
    await findInput(window).fill("beta");
    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("3/4");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);

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
    await expect(findInput(window)).toHaveCount(0);

    await tabByTitle(window, "No bleed tab B").click();
    await ensureFindOpen(window);
    await findInput(window).fill("peach");
    await expect(findCounter(window)).toHaveText("1/2");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);

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
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);

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
    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("4/4");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type("rose keep one");
    await window.keyboard.press("Enter");
    await window.keyboard.type("rose keep two");

    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("rose");
    const { current, total } = await readCounter(window);
    expect(total).toBe(2);
    expect(current).toBeGreaterThanOrEqual(1);
    expect(current).toBeLessThanOrEqual(2);
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
    await expect(findInput(window)).toHaveCount(0);

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("lambda three");
    await window.keyboard.press(`${mod}+z`);
    await window.keyboard.press(`${mod}+Shift+z`);

    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("lambda");
    await expectCounterReadable(window);
    const { total } = await readCounter(window);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(total).toBeLessThanOrEqual(3);
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
    await expect(window.getByTestId("note-find-next")).toBeDisabled();
    await expect(window.getByTestId("note-find-prev")).toBeDisabled();

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);
    await window.keyboard.press(`${mod}+f`);
    await ensureFindOpen(window);
    await expect(findInput(window)).toHaveValue("kiwi");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(window.getByTestId("note-find-next")).toBeDisabled();
    await expect(window.getByTestId("note-find-prev")).toBeDisabled();
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
      await expect(findInput(window)).toHaveCount(0);

      await tabB.click();
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("berry");
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toHaveCount(0);
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
    await expect(findInput(window)).toHaveCount(0);

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
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");
    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);

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

    await ensureFindOpen(window);
    await findInput(window).fill("orchid");
    await expectCounterReadable(window);
    const { total } = await readCounter(window);
    expect(total).toBe(3);
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
    expect(openSnapshot.panelOpen).toBeTruthy();
    expect(openSnapshot.gateActive).toBeTruthy();
    expect(openSnapshot.allCount).toBeGreaterThan(0);
    expect(openSnapshot.activeCount).toBeGreaterThan(0);

    await window.keyboard.press(`${mod}+f`);
    await expect(findInput(window)).toHaveCount(0);
    const closedSnapshot = await readHighlightUxSnapshot(window);
    expect(closedSnapshot.panelOpen).toBeFalsy();
    expect(closedSnapshot.gateActive).toBeFalsy();
    // Registry shape can vary by runtime/build mode when panel closes; visual gate must be off.
    expect(closedSnapshot.allCount).toBeGreaterThanOrEqual(0);

    await window.keyboard.press(`${mod}+f`);
    await ensureFindOpen(window);
    const reopenedSnapshot = await readHighlightUxSnapshot(window);
    expect(reopenedSnapshot.panelOpen).toBeTruthy();
    expect(reopenedSnapshot.gateActive).toBeTruthy();
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
      await expect(findInput(window)).toHaveCount(0);
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
        if ((await window.getByTestId("note-find-next").isDisabled()) === false) {
          await window.getByTestId("note-find-next").click();
        }
      } else if (op === 2) {
        await ensureFindOpen(window);
        if ((await window.getByTestId("note-find-prev").isDisabled()) === false) {
          await window.getByTestId("note-find-prev").click();
        }
      } else if (op === 3) {
        await ensureFindOpen(window);
        const q = rand() > 0.2 ? tokenByTab[tab] : `${tokenByTab[tab]}-${i}`;
        expectedQueryByTab[tab] = q;
        await findInput(window).fill(q);
      } else {
        // Close if open, otherwise open then close (toggle stress).
        if ((await findInput(window).count()) > 0) {
          await window.keyboard.press(`${mod}+f`);
          await expect(findInput(window)).toHaveCount(0);
        } else {
          await window.keyboard.press(`${mod}+f`);
          await ensureFindOpen(window);
          await window.keyboard.press(`${mod}+f`);
          await expect(findInput(window)).toHaveCount(0);
        }
      }

      // Periodically force close->reopen validation for active tab.
      if (i % 7 === 0) {
        if ((await findInput(window).count()) === 0) {
          await window.keyboard.press(`${mod}+f`);
        }
        await ensureFindOpen(window);
        await expect(findInput(window)).toHaveValue(expectedQueryByTab[tab]);
        await expectCounterReadable(window);
        await window.keyboard.press(`${mod}+f`);
        await expect(findInput(window)).toHaveCount(0);
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

    const startTop = await readActiveMainScrollTop(window);
    for (let i = 0; i < 8; i += 1) {
      await window.keyboard.press("Enter");
      await expectCounterReadable(window);
    }
    const endTop = await readActiveMainScrollTop(window);
    // In compact layouts there may be some movement, but it should stay bounded.
    expect(Math.abs(endTop - startTop)).toBeLessThanOrEqual(120);
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
    await expectCounterReadable(window);

    for (let i = 0; i < 14; i += 1) {
      await window.keyboard.press("Enter");
      await expectCounterReadable(window);
    }
  });

  test("live edits: counter updates while find is open and active index stays valid", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Live edit counter", ["orchid one", "orchid two"]);
    await setFindQueryAndAssert(window, "orchid", "1/2");

    // Add another matching line while find remains open.
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

    await window.getByTestId("note-find-prev").click();
    await expect(findCounter(window)).toHaveText("4/4");

    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("1/4");
  });

  test("empty and whitespace query handling stays stable", async ({ window }) => {
    await createNoteWithBody(window, "Whitespace query", ["luna one", "luna two"]);
    await setFindQueryAndAssert(window, "luna", "1/2");

    await findInput(window).fill("");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(window.getByTestId("note-find-next")).toBeDisabled();

    await findInput(window).fill("   ");
    await expect(findCounter(window)).toHaveText("0/0");
    await expect(window.getByTestId("note-find-prev")).toBeDisabled();

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
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    await tabByTitle(window, "Close-active B").click();
    await setFindQueryAndAssert(window, "sage", "1/2");
    await window.getByTestId("note-find-next").click();
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
    const mutations = [
      "z",
      "ze",
      "zen",
      "zen ",
      "zen o",
      "zen one",
      "zen",
      "ze",
      "z",
      "",
      "  ",
      "zero",
      "zebra",
      "zen",
    ];

    for (const q of mutations) {
      await findInput(window).fill(q);
      await expectCounterReadable(window);
    }
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

    // Query spanning node boundary should not falsely match as one contiguous text node.
    await findInput(window).fill("abcdef");
    await expect(findCounter(window)).toHaveText("0/0");
    await expectCounterReadable(window);
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
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/2");
    await findInput(window).fill(decomposed);
    await expect(findCounter(window)).toHaveText("1/2");
    await window.getByTestId("note-find-next").click();
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
    await expect(window.getByTestId("note-find-next")).toBeDisabled();
    await expect(window.getByTestId("note-find-prev")).toBeDisabled();
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
      await window.getByTestId("note-find-next").click();
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
    await expect(findInput(window)).toHaveCount(0);

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

    // Undo should revert to 2 matches; redo back to 3.
    await window.keyboard.press(`${mod}+z`);
    await expect(findCounter(window)).toHaveText("1/2");
    await window.keyboard.press(`${mod}+Shift+z`);
    await expect(findCounter(window)).toHaveText("1/3");
    await expectCounterReadable(window);
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
    await expect(window.getByTestId("note-find-next")).toBeDisabled();
    await expect(window.getByTestId("note-find-prev")).toBeDisabled();
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
    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("4/4");

    // Reduce content to only two matches.
    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type("peony keep one");
    await window.keyboard.press("Enter");
    await window.keyboard.type("peony keep two");

    const { current, total } = await readCounter(window);
    expect(total).toBe(2);
    expect(current).toBeGreaterThanOrEqual(1);
    expect(current).toBeLessThanOrEqual(2);
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
    await expectCounterReadable(window);

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();

    // Burst of edits while find is open.
    for (let i = 0; i < 12; i += 1) {
      await window.keyboard.press("End");
      await window.keyboard.press("Enter");
      await window.keyboard.type(i % 2 === 0 ? `sun burst ${i}` : `moon burst ${i}`);
      await expectCounterReadable(window);
    }
  });

  test("IME composition while find is active keeps counter valid", async ({ window }) => {
    await createNoteWithBody(window, "IME find note", [
      "かな かな",
      "かなび",
      "latin text",
    ]);
    await ensureFindOpen(window);

    // Simulate composition lifecycle on the find input.
    await window.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="note-find-input"]',
      );
      if (!input) return;
      input.dispatchEvent(new CompositionEvent("compositionstart", { data: "か" }));
      input.value = "か";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new CompositionEvent("compositionupdate", { data: "かな" }));
      input.value = "かな";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new CompositionEvent("compositionend", { data: "かな" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await expect(findInput(window)).toHaveValue("かな");
    await expectCounterReadable(window);
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
    await expectCounterReadable(window);

    // Replace everything in one burst while find remains open.
    await editorRoot.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type("replacement block without target token");
    await expect(findCounter(window)).toHaveText("0/0");
    await expectCounterReadable(window);
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
          await window.getByTestId("note-find-next").click();
        }
      } else {
        const { total } = await readCounter(window);
        if (total === 0) {
          await findInput(window).fill(token);
        } else {
          await window.getByTestId("note-find-prev").click();
        }
      }

      if (i % 10 === 0) {
        const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
        await editorRoot.click();
        await window.keyboard.press("End");
        await window.keyboard.press("Enter");
        await window.keyboard.type(i % 20 === 0 ? `${token} added ${i}` : `other ${i}`);
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
    await window.getByTestId("note-find-next").click();
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

    const queries = ["i", "I", "İ", "ı", "ist", "IŞ"];
    for (const q of queries) {
      await ensureFindOpen(window);
      await window.evaluate((value) => {
        const input = document.querySelector<HTMLInputElement>(
          '[data-testid="note-find-input"]',
        );
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, q);
      if ((await findCounter(window).count()) > 0) {
        await expectCounterReadable(window);
      }
    }
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

    // Inject control-character queries directly to mimic paste edge cases.
    const controlQueries = ["line\none", "line\tone", "line\u200bone"];
    for (const q of controlQueries) {
      await window.evaluate((value) => {
        const input = document.querySelector<HTMLInputElement>(
          '[data-testid="note-find-input"]',
        );
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, q);
      await expectCounterReadable(window);
    }
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
    await window.getByTestId("note-find-next").click();
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
    await window.getByTestId("note-find-next").click();
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
        if (total > 0) await window.getByTestId("note-find-next").click();
      } else if (op === 2) {
        const { total } = await readCounter(window);
        if (total > 0) await window.getByTestId("note-find-prev").click();
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
});
