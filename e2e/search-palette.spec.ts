import { test, expect } from "./electron-app";
import type { Page, Locator } from "@playwright/test";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function createNoteWithBody(window: Page, title: string, bodyLines: string[]) {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(320);

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

  await window.waitForTimeout(360);
}

function searchButton(window: Page) {
  return window.getByRole("button", { name: /^Search/ }).first();
}

function palette(window: Page) {
  return window.getByRole("dialog");
}

function paletteInput(window: Page) {
  return window.getByPlaceholder("Search notes...");
}

function resultItems(window: Page) {
  return palette(window).locator("[cmdk-item]");
}

function previewCounter(window: Page) {
  return palette(window).locator("span").filter({ hasText: /^\d+\/\d+$/ }).first();
}

function tabByTitle(window: Page, title: string) {
  const safe = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return window.getByRole("button", { name: new RegExp(`^${safe}\\s+Close tab$`) }).first();
}

function openTabButtons(window: Page) {
  return window.locator("[data-tab-id]");
}

function findInput(window: Page) {
  return window.getByTestId("note-find-input");
}

function findCounter(window: Page) {
  return window.getByTestId("note-find-counter");
}

function findTrigger(window: Page) {
  return window.getByTestId("note-find-trigger");
}

function activeEditorTitle(window: Page) {
  return window
    .locator('main:not([style*="display: none"])')
    .first()
    .locator("h1.editor-title")
    .first();
}

async function readActiveMainScrollTop(window: Page): Promise<number> {
  return window.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main:not([style*="display: none"])');
    return main?.scrollTop ?? 0;
  });
}

async function openPalette(window: Page) {
  if ((await palette(window).count()) === 0) {
    await searchButton(window).click();
  }
  await expect(palette(window)).toBeVisible();
  await expect(paletteInput(window)).toBeFocused();
}

async function waitForResultRows(window: Page, min = 1) {
  await expect(async () => {
    const count = await resultItems(window).count();
    expect(count).toBeGreaterThanOrEqual(min);
  }).toPass();
}

async function getVisibleResultTitles(window: Page, limit = 10): Promise<string[]> {
  await waitForResultRows(window, 1);
  const count = await resultItems(window).count();
  const target = Math.min(count, limit);
  const titles: string[] = [];
  for (let i = 0; i < target; i += 1) {
    const text = (await resultItems(window).nth(i).innerText()).trim();
    const title = text.split("\n")[0]?.trim() ?? "";
    titles.push(title);
  }
  return titles;
}

async function assertResultCountAtMost(window: Page, max: number) {
  await expect(async () => {
    const count = await resultItems(window).count();
    expect(count).toBeLessThanOrEqual(max);
  }).toPass();
}

async function closeTab(window: Page, title: string) {
  const tab = tabByTitle(window, title);
  await expect(tab).toBeVisible();
  await tab.hover();
  await tab.locator('[aria-label="Close tab"]').click();
  await expect(tabByTitle(window, title)).toHaveCount(0);
}

async function assertNoDuplicateTabTitle(window: Page, title: string) {
  await expect(async () => {
    const count = await window
      .getByRole("button", {
        name: new RegExp(`${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+Close tab`),
      })
      .count();
    expect(count).toBe(1);
  }).toPass();
}

async function openFromPaletteByTitle(window: Page, title: string) {
  await openPalette(window);
  await paletteInput(window).fill(title);
  await waitForResultRows(window, 1);
  const target = resultItems(window).filter({ hasText: title }).first();
  await expect(target).toBeVisible();
  await target.click();
  await expect(palette(window)).toHaveCount(0);
}

async function selectedItem(window: Page): Promise<Locator> {
  const selected = palette(window).locator('[cmdk-item][data-selected="true"]').first();
  await expect(selected).toBeVisible();
  return selected;
}

async function openFindUi(window: Page) {
  await window.keyboard.press(`${mod}+f`);
  if ((await findInput(window).count()) === 0 && (await findTrigger(window).count()) > 0) {
    await findTrigger(window).click();
  }
  await expect(findInput(window)).toBeVisible();
}

async function closePaletteIfOpen(window: Page) {
  if ((await palette(window).count()) === 0) return;
  await window.keyboard.press("Escape");
  if ((await palette(window).count()) > 0) {
    await window.keyboard.press("Escape");
  }
  await expect(palette(window)).toHaveCount(0);
}

async function readPreviewCounter(window: Page): Promise<{ current: number; total: number }> {
  const text = (await previewCounter(window).innerText()).trim();
  const match = /^(\d+)\/(\d+)$/.exec(text);
  expect(match).toBeTruthy();
  return {
    current: Number(match?.[1] ?? "0"),
    total: Number(match?.[2] ?? "0"),
  };
}

async function movePreviewToIndex(window: Page, targetIndex1Based: number) {
  const start = await readPreviewCounter(window);
  expect(start.total).toBeGreaterThan(0);
  expect(targetIndex1Based).toBeGreaterThanOrEqual(1);
  expect(targetIndex1Based).toBeLessThanOrEqual(start.total);

  let guard = 0;
  while (guard < start.total + 4) {
    const now = await readPreviewCounter(window);
    if (now.current === targetIndex1Based) return;
    if (now.current < targetIndex1Based) {
      await palette(window).getByRole("button", { name: "Next match" }).click();
    } else {
      await palette(window).getByRole("button", { name: "Previous match" }).click();
    }
    guard += 1;
  }
  throw new Error(`Failed to move preview to ${targetIndex1Based}`);
}

test.describe("Search palette e2e", () => {
  test.beforeEach(async ({ window }) => {
    // Keep a deterministic wide layout so preview-specific tests are valid by default.
    await window.setViewportSize({ width: 1400, height: 900 });
  });

  test("opens via button and Cmd/Ctrl+P, focuses input, and closes with empty query", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Palette open close", ["alpha line"]);

    await searchButton(window).click();
    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toBeFocused();

    await window.keyboard.press("Escape");
    await expect(palette(window)).toHaveCount(0);

    await window.keyboard.press(`${mod}+p`);
    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toBeFocused();

    await window.keyboard.press("Escape");
    await expect(palette(window)).toHaveCount(0);
  });

  test("Escape with non-empty query clears query first, then closes on second Escape", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Palette escape semantics", ["beta line", "beta two"]);
    await openPalette(window);

    await paletteInput(window).fill("beta");
    await expect(resultItems(window)).toHaveCount(1);

    await window.keyboard.press("Escape");
    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toHaveValue("");

    await window.keyboard.press("Escape");
    await expect(palette(window)).toHaveCount(0);
  });

  test("recent mode shows most recently updated notes and caps at 30", async ({ window }) => {
    for (let i = 1; i <= 35; i += 1) {
      await createNoteWithBody(window, `Recent cap note ${i}`, [`recent line ${i}`]);
    }

    await openPalette(window);
    await paletteInput(window).fill("");
    await assertResultCountAtMost(window, 30);
    await waitForResultRows(window, 3);

    const titles = await getVisibleResultTitles(window, 3);
    expect(titles[0]).toContain("Recent cap note 35");
    expect(titles[1]).toContain("Recent cap note 34");
    expect(titles[2]).toContain("Recent cap note 33");
  });

  test("query mode caps result list at 50 even when more docs match", async ({ window }) => {
    for (let i = 1; i <= 55; i += 1) {
      await createNoteWithBody(window, `Limit match ${i}`, [`token common ${i}`]);
    }

    await openPalette(window);
    await paletteInput(window).fill("limit match");

    await expect(async () => {
      const count = await resultItems(window).count();
      expect(count).toBe(50);
    }).toPass();
  });

  test("ranking prioritizes exact title, then prefix, then contains, then body-only", async ({
    window,
  }) => {
    await createNoteWithBody(window, "planet", ["noise"]);
    await createNoteWithBody(window, "planet trail", ["noise"]);
    await createNoteWithBody(window, "my planet note", ["noise"]);
    await createNoteWithBody(window, "completely different", ["planet appears in body only"]);

    await openPalette(window);
    await paletteInput(window).fill("planet");
    await waitForResultRows(window, 4);

    const titles = await getVisibleResultTitles(window, 4);
    expect(titles[0]).toBe("planet");
    expect(titles[1]).toBe("planet trail");
    expect(titles[2]).toBe("my planet note");
    expect(titles[3]).toBe("completely different");
  });

  test("body-only matches render snippet text and match-count badge", async ({ window }) => {
    await createNoteWithBody(window, "Snippet target note", [
      "alpha one",
      "alpha two",
      "alpha three",
      "other line",
    ]);
    await createNoteWithBody(window, "No body match note", ["nothing relevant"]);

    await openPalette(window);
    await paletteInput(window).fill("alpha");

    const first = resultItems(window).first();
    await expect(first).toContainText("Snippet target note");
    await expect(first).toContainText("alpha");
    await expect(first.locator("span").filter({ hasText: /^3$/ })).toBeVisible();
  });

  test("Enter opens selected result in active tab and closes palette", async ({ window }) => {
    await createNoteWithBody(window, "Open with enter exact", ["needle"]);
    await createNoteWithBody(window, "Open with enter alternate", ["needle"]);

    await openPalette(window);
    await paletteInput(window).fill("open with enter exact");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");

    await expect(palette(window)).toHaveCount(0);
    await expect(window.locator("h1.editor-title").first()).toContainText("Open with enter exact");
  });

  test("Cmd/Ctrl+click keeps palette open while opening the selected note", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Background open selected", ["target body"]);
    await createNoteWithBody(window, "Current active editor", ["active body"]);

    await openPalette(window);
    await paletteInput(window).fill("background open selected");
    await waitForResultRows(window, 1);
    await resultItems(window).first().click({ modifiers: [mod as "Meta" | "Control"] });

    await expect(palette(window)).toBeVisible();
    await expect(window.locator("h1.editor-title").first()).toContainText("Background open selected");
  });

  test("clicking preview Open note button opens selected note and closes palette", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Preview open target", ["delta text"]);
    await createNoteWithBody(window, "Preview open other", ["delta text"]);

    await openPalette(window);
    await paletteInput(window).fill("preview open target");
    await expect(resultItems(window)).toHaveCount(1);

    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);
    await expect(window.locator("h1.editor-title").first()).toContainText("Preview open target");
  });

  test("preview match navigation buttons update counter and wrap correctly", async ({ window }) => {
    await createNoteWithBody(window, "Preview nav note", [
      "zeta one",
      "zeta two",
      "zeta three",
      "zeta four",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("zeta");
    await waitForResultRows(window, 1);
    const baseline = await readPreviewCounter(window);
    expect(baseline.total).toBe(4);

    await palette(window).getByRole("button", { name: "Next match" }).click();
    const afterNext = await readPreviewCounter(window);
    expect(afterNext.total).toBe(4);
    expect(afterNext.current).toBeGreaterThanOrEqual(1);
    expect(afterNext.current).toBeLessThanOrEqual(4);

    for (let i = 0; i < 8; i += 1) {
      await palette(window).getByRole("button", { name: "Next match" }).click();
      const current = await readPreviewCounter(window);
      expect(current.total).toBe(4);
      expect(current.current).toBeGreaterThanOrEqual(1);
      expect(current.current).toBeLessThanOrEqual(4);
    }

    await palette(window).getByRole("button", { name: "Previous match" }).click();
    const afterPrev = await readPreviewCounter(window);
    expect(afterPrev.total).toBe(4);
    expect(afterPrev.current).toBeGreaterThanOrEqual(1);
    expect(afterPrev.current).toBeLessThanOrEqual(4);
  });

  test("arrow-key selection syncs preview state to the selected result", async ({ window }) => {
    await createNoteWithBody(window, "Arrow sync one", ["omega"]);
    await createNoteWithBody(window, "Arrow sync two", ["omega", "omega", "omega"]);

    await openPalette(window);
    await paletteInput(window).fill("arrow sync");
    await waitForResultRows(window, 2);

    const firstSelectedText = (await (await selectedItem(window)).innerText()).trim();
    await window.keyboard.press("ArrowDown");
    const secondSelectedText = (await (await selectedItem(window)).innerText()).trim();
    expect(secondSelectedText).not.toBe(firstSelectedText);

    const counter = await readPreviewCounter(window);
    if (secondSelectedText.includes("Arrow sync two")) {
      expect(counter.total).toBe(3);
    } else if (secondSelectedText.includes("Arrow sync one")) {
      expect(counter.total).toBe(1);
    } else {
      expect(counter.total).toBeGreaterThan(0);
    }
  });

  test("preview pane toggle hides and restores preview controls without losing input focus", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Preview toggle note", ["theta one", "theta two"]);
    await openPalette(window);
    await paletteInput(window).fill("theta");

    const hideButton = palette(window).getByRole("button", { name: "Hide preview pane" });
    await expect(hideButton).toBeVisible();
    await hideButton.click();

    await expect(palette(window).getByRole("button", { name: "Show preview pane" })).toBeVisible();
    await expect(palette(window).getByRole("button", { name: "Open note" })).toHaveCount(0);
    await expect(paletteInput(window)).toBeFocused();

    await palette(window).getByRole("button", { name: "Show preview pane" }).click();
    await expect(palette(window).getByRole("button", { name: "Hide preview pane" })).toBeVisible();
    await expect(palette(window).getByRole("button", { name: "Open note" })).toBeVisible();
  });

  test("hidden preview still opens the intended note result", async ({ window }) => {
    await createNoteWithBody(window, "Hidden preview transfer target", [
      "amber one",
      "amber two",
      "amber three",
    ]);
    await createNoteWithBody(window, "Hidden preview transfer active", ["other content"]);

    await openPalette(window);
    await paletteInput(window).fill("amber");
    await waitForResultRows(window, 1);

    await palette(window).getByRole("button", { name: "Hide preview pane" }).click();
    await expect(palette(window).getByRole("button", { name: "Show preview pane" })).toBeVisible();

    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);
    await expect(activeEditorTitle(window)).toContainText("Hidden preview transfer target");
  });

  test("compact viewport keeps palette search usable after resize", async ({ window }) => {
    await window.setViewportSize({ width: 760, height: 620 });
    await window.waitForTimeout(120);
    await createNoteWithBody(window, "Compact palette note", ["sigma one", "sigma two"]);

    await openPalette(window);
    await paletteInput(window).fill("sigma");
    await waitForResultRows(window, 1);
    await expect(resultItems(window).first()).toContainText("Compact palette note");
    await expect(paletteInput(window)).toBeFocused();
  });

  test("no-match query shows explicit empty state and no result rows", async ({ window }) => {
    await createNoteWithBody(window, "No-match baseline", ["lorem ipsum"]);
    await openPalette(window);
    await paletteInput(window).fill("query-that-does-not-exist-anywhere");

    await expect(palette(window).getByText("No matching notes.")).toBeVisible();
    await expect(resultItems(window)).toHaveCount(0);
  });

  test("search button works while sidebar is collapsed and floating", async ({ window }) => {
    await createNoteWithBody(window, "Collapsed sidebar palette", ["visible content"]);

    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(250);
    await expect(window.locator('aside[data-state="collapsed"]').first()).toBeVisible();

    await window.mouse.move(2, 140);
    await window.waitForTimeout(250);
    await searchButton(window).click();

    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toBeFocused();
  });

  test("opening an already active tab from palette does not duplicate tabs and keeps focus stable", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Already active note", ["ux active"]);
    await createNoteWithBody(window, "Other note", ["ux other"]);

    await tabByTitle(window, "Already active note").click();
    await expect(activeEditorTitle(window)).toContainText("Already active note");
    const tabsBefore = await openTabButtons(window).count();

    await openPalette(window);
    await paletteInput(window).fill("already active note");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");

    await expect(palette(window)).toHaveCount(0);
    await expect(activeEditorTitle(window)).toContainText("Already active note");
    const tabsAfter = await openTabButtons(window).count();
    expect(tabsAfter).toBe(tabsBefore);
    await assertNoDuplicateTabTitle(window, "Already active note");
  });

  test("same active note keeps existing in-note find when reopened from palette query", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Same active find preserve", [
      "wal alpha",
      "wal beta",
      "wal gamma",
    ]);
    await createNoteWithBody(window, "Same active find other", ["filler"]);
    await tabByTitle(window, "Same active find preserve").click();
    await expect(activeEditorTitle(window)).toContainText("Same active find preserve");

    await openFindUi(window);
    await findInput(window).fill("wal");
    await expect(findCounter(window)).toHaveText("1/3");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    const tabsBefore = await openTabButtons(window).count();

    await openPalette(window);
    await paletteInput(window).fill("wal");
    await waitForResultRows(window, 1);
    const sameNoteRow = resultItems(window).filter({ hasText: "Same active find preserve" }).first();
    await expect(sameNoteRow).toBeVisible();
    await sameNoteRow.click();
    await expect(palette(window)).toHaveCount(0);

    await expect(activeEditorTitle(window)).toContainText("Same active find preserve");
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("wal");
    await expect(findCounter(window)).toHaveText("2/3");

    const tabsAfter = await openTabButtons(window).count();
    expect(tabsAfter).toBe(tabsBefore);
    await assertNoDuplicateTabTitle(window, "Same active find preserve");
  });

  test("same-note preserve: different palette query does not override active in-note find query/index", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Same note different query preserve", [
      "wal alpha",
      "wal beta",
      "wal gamma",
      "gamma marker unique",
    ]);
    await tabByTitle(window, "Same note different query preserve").click();
    await openFindUi(window);
    await findInput(window).fill("wal");
    await expect(findCounter(window)).toHaveText("1/3");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    await openPalette(window);
    await paletteInput(window).fill("gamma marker");
    await waitForResultRows(window, 1);
    await resultItems(window).filter({ hasText: "Same note different query preserve" }).first().click();
    await expect(palette(window)).toHaveCount(0);

    await expect(activeEditorTitle(window)).toContainText("Same note different query preserve");
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("wal");
    await expect(findCounter(window)).toHaveText("2/3");
  });

  test("same-note preserve: click and Enter opening both preserve active in-note find state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Same note parity preserve", [
      "wal one",
      "wal two",
      "wal three",
    ]);
    await tabByTitle(window, "Same note parity preserve").click();
    await openFindUi(window);
    await findInput(window).fill("wal");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    // Click path.
    await openPalette(window);
    await paletteInput(window).fill("same note parity preserve");
    await waitForResultRows(window, 1);
    await resultItems(window).filter({ hasText: "Same note parity preserve" }).first().click();
    await expect(palette(window)).toHaveCount(0);
    await expect(findInput(window)).toHaveValue("wal");
    await expect(findCounter(window)).toHaveText("2/3");

    // Keyboard Enter path.
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("3/3");
    await openPalette(window);
    await paletteInput(window).fill("same note parity preserve");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);
    await expect(findInput(window)).toHaveValue("wal");
    await expect(findCounter(window)).toHaveText("3/3");
  });

  test("same-note preserve: hidden preview open keeps current in-note find session untouched", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Same note hidden preview preserve", [
      "wal aa",
      "wal bb",
      "wal cc",
    ]);
    await tabByTitle(window, "Same note hidden preview preserve").click();
    await openFindUi(window);
    await findInput(window).fill("wal");
    await expect(findCounter(window)).toHaveText("1/3");

    await openPalette(window);
    await paletteInput(window).fill("wal");
    await waitForResultRows(window, 1);
    const hidePreview = palette(window).getByRole("button", { name: "Hide preview pane" });
    if ((await hidePreview.count()) > 0) {
      await hidePreview.click();
    }
    await resultItems(window).filter({ hasText: "Same note hidden preview preserve" }).first().click();
    await expect(palette(window)).toHaveCount(0);

    await expect(findInput(window)).toHaveValue("wal");
    await expect(findCounter(window)).toHaveText("1/3");
  });

  test("same-note preserve: moving preview chevrons then opening same active note keeps existing find state", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Same note chevron preserve", [
      "wal one",
      "wal two",
      "wal three",
      "wal four",
      "wal five",
    ]);
    await tabByTitle(window, "Same note chevron preserve").click();
    await openFindUi(window);
    await findInput(window).fill("wal");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/5");

    await openPalette(window);
    await paletteInput(window).fill("wal");
    await waitForResultRows(window, 1);
    await palette(window).getByRole("button", { name: "Next match" }).click();
    await palette(window).getByRole("button", { name: "Next match" }).click();
    await expect(previewCounter(window)).toHaveText("3/5");
    await resultItems(window).filter({ hasText: "Same note chevron preserve" }).first().click();
    await expect(palette(window)).toHaveCount(0);

    await expect(findInput(window)).toHaveValue("wal");
    await expect(findCounter(window)).toHaveText("2/5");
  });

  test("same-note preserve: opening and escaping palette without selecting note leaves in-note find untouched", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Same note escape preserve", [
      "wal x",
      "wal y",
      "wal z",
    ]);
    await tabByTitle(window, "Same note escape preserve").click();
    await openFindUi(window);
    await findInput(window).fill("wal");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    await openPalette(window);
    await paletteInput(window).fill("same note escape preserve");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Escape");
    await expect(paletteInput(window)).toHaveValue("");
    await window.keyboard.press("Escape");
    await expect(palette(window)).toHaveCount(0);

    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("wal");
    await expect(findCounter(window)).toHaveText("2/3");
  });

  test("same-note preserve: empty open find remains empty when same active note is reopened from palette", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Same note empty find preserve", [
      "wal aa",
      "wal bb",
    ]);
    await tabByTitle(window, "Same note empty find preserve").click();
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");

    await openPalette(window);
    await paletteInput(window).fill("same note empty find preserve");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("same-note preserve: rapid repeated same-note opens keep find stable and never duplicate tabs", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Same note rapid preserve", [
      "wal one",
      "wal two",
      "wal three",
      "wal four",
    ]);
    await tabByTitle(window, "Same note rapid preserve").click();
    await openFindUi(window);
    await findInput(window).fill("wal");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/4");
    const tabsBefore = await openTabButtons(window).count();

    for (let i = 0; i < 10; i += 1) {
      await openPalette(window);
      await paletteInput(window).fill("same note rapid preserve");
      await waitForResultRows(window, 1);
      if (i % 2 === 0) {
        await window.keyboard.press("Enter");
      } else {
        await resultItems(window).filter({ hasText: "Same note rapid preserve" }).first().click();
      }
      await expect(palette(window)).toHaveCount(0);
      await expect(activeEditorTitle(window)).toContainText("Same note rapid preserve");
      await expect(findInput(window)).toHaveValue("wal");
      await expect(findCounter(window)).toHaveText("2/4");
      await assertNoDuplicateTabTitle(window, "Same note rapid preserve");
    }

    const tabsAfter = await openTabButtons(window).count();
    expect(tabsAfter).toBe(tabsBefore);
  });

  test("same-note preserve: case-mismatched palette query still keeps existing in-note find unchanged", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Case Preserve Note", [
      "walbody line one",
      "walbody line two",
      "walbody line three",
    ]);
    await tabByTitle(window, "Case Preserve Note").click();
    await openFindUi(window);
    await findInput(window).fill("WalBody");
    await expect(findCounter(window)).toHaveText("1/3");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    await openPalette(window);
    await paletteInput(window).fill("case preserve note");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await expect(activeEditorTitle(window)).toContainText("Case Preserve Note");
    await expect(findInput(window)).toHaveValue("WalBody");
    await expect(findCounter(window)).toHaveText("2/3");
  });

  test("race: rapid query churn with preview toggle opens final intended note and fresh find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Race churn alpha note", [
      "alphaonly token one",
      "alphaonly token two",
    ]);
    await createNoteWithBody(window, "Race churn beta note", [
      "betafinaltoken one",
      "betafinaltoken two",
    ]);
    await createNoteWithBody(window, "Race churn anchor active", ["anchor"]);
    await tabByTitle(window, "Race churn anchor active").click();
    await expect(activeEditorTitle(window)).toContainText("Race churn anchor active");

    await openPalette(window);
    const queries = [
      "race",
      "race churn alpha",
      "race churn beta",
      "alphaonly",
      "betafinaltoken",
      "race churn beta note",
    ];
    for (let i = 0; i < queries.length; i += 1) {
      await paletteInput(window).fill(queries[i]);
      if (i % 2 === 0) {
        const hidePreview = palette(window).getByRole("button", { name: "Hide preview pane" });
        if ((await hidePreview.count()) > 0) {
          await hidePreview.click();
        }
      } else {
        const showPreview = palette(window).getByRole("button", { name: "Show preview pane" });
        if ((await showPreview.count()) > 0) {
          await showPreview.click();
        }
      }
    }

    await paletteInput(window).fill("race churn beta note");
    await waitForResultRows(window, 1);
    const betaRow = resultItems(window).filter({ hasText: "Race churn beta note" }).first();
    await expect(betaRow).toBeVisible();
    await expect(resultItems(window).filter({ hasText: "Race churn alpha note" })).toHaveCount(0);
    await betaRow.click();
    await expect(palette(window)).toHaveCount(0);

    await expect(activeEditorTitle(window)).toContainText("Race churn beta note");
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("opening an already-open but inactive tab navigates to existing tab without duplication", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Open target tab", ["ux target"]);
    await createNoteWithBody(window, "Currently active tab", ["ux active now"]);
    await tabByTitle(window, "Currently active tab").click();
    await expect(activeEditorTitle(window)).toContainText("Currently active tab");

    const tabsBefore = await openTabButtons(window).count();
    await openFromPaletteByTitle(window, "Open target tab");

    await expect(activeEditorTitle(window)).toContainText("Open target tab");
    const tabsAfter = await openTabButtons(window).count();
    expect(tabsAfter).toBe(tabsBefore);
    await assertNoDuplicateTabTitle(window, "Open target tab");
  });

  test("opening a note that is not currently open creates/selects tab and navigates correctly", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Closed then reopen target", ["ux reopen"]);
    await createNoteWithBody(window, "Anchor active note", ["anchor"]);

    await closeTab(window, "Closed then reopen target");
    await expect(activeEditorTitle(window)).toContainText("Anchor active note");

    const tabsBefore = await openTabButtons(window).count();
    await openFromPaletteByTitle(window, "Closed then reopen target");

    await expect(activeEditorTitle(window)).toContainText("Closed then reopen target");
    await expect(tabByTitle(window, "Closed then reopen target")).toBeVisible();
    const tabsAfter = await openTabButtons(window).count();
    expect(tabsAfter).toBeGreaterThanOrEqual(tabsBefore);
    expect(tabsAfter).toBeLessThanOrEqual(tabsBefore + 1);
    await assertNoDuplicateTabTitle(window, "Closed then reopen target");
  });

  test("preview chevron navigation remains bounded and user can still run fresh in-note find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Chevron carryover target", [
      "iris one",
      "iris two",
      "iris three",
      "iris four",
      "iris five",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("iris");
    await waitForResultRows(window, 1);

    for (let i = 0; i < 7; i += 1) {
      await palette(window).getByRole("button", { name: "Next match" }).click();
    }
    const beforeOpen = await readPreviewCounter(window);
    expect(beforeOpen.total).toBe(5);

    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    await findInput(window).fill("iris two");
    await expect(findCounter(window)).toHaveText("1/1");
    await findInput(window).fill("iris");
    await expect(findCounter(window)).toHaveText("1/5");
  });

  test("preview open keeps specific navigated match active and scrolls to it", async ({
    window,
  }) => {
    const lines = Array.from({ length: 40 }, (_, i) => `anchor match line ${i + 1}`);
    await createNoteWithBody(window, "Preview specific jump target", lines);
    await createNoteWithBody(window, "Preview specific jump active", ["filler"]);

    // Ensure we're not already at the target note when opening from palette.
    await expect(activeEditorTitle(window)).toContainText("Preview specific jump active");
    const beforeScroll = await readActiveMainScrollTop(window);

    await openPalette(window);
    await paletteInput(window).fill("anchor");
    await waitForResultRows(window, 1);
    await expect(previewCounter(window)).toHaveText("1/40");

    for (let i = 0; i < 24; i += 1) {
      await palette(window).getByRole("button", { name: "Next match" }).click();
    }
    await expect(previewCounter(window)).toHaveText("25/40");

    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);
    await expect(activeEditorTitle(window)).toContainText("Preview specific jump target");

    // Opening find should cancel transient mode and give a fresh in-note search UI.
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");

    const afterScroll = await readActiveMainScrollTop(window);
    expect(afterScroll).toBeGreaterThan(beforeScroll + 80);
  });

  test("preview open with first match keeps near-top scroll and fresh in-note find", async ({
    window,
  }) => {
    const lines = Array.from({ length: 35 }, (_, i) => `top-match line ${i + 1}`);
    await createNoteWithBody(window, "Preview first-index target", lines);
    await createNoteWithBody(window, "Preview first-index active", ["filler"]);

    await openPalette(window);
    await paletteInput(window).fill("top-match");
    await waitForResultRows(window, 1);
    await expect(previewCounter(window)).toHaveText("1/35");
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    const scrollTop = await readActiveMainScrollTop(window);
    expect(scrollTop).toBeLessThanOrEqual(220);
  });

  test("preview previous on first stays clamped at first and find opens fresh", async ({
    window,
  }) => {
    const lines = Array.from({ length: 32 }, (_, i) => `wrap-match line ${i + 1}`);
    await createNoteWithBody(window, "Preview wrap target", lines);
    await createNoteWithBody(window, "Preview wrap active", ["filler"]);

    await openPalette(window);
    await paletteInput(window).fill("wrap-match");
    await waitForResultRows(window, 1);
    await expect(previewCounter(window)).toHaveText("1/32");
    await palette(window).getByRole("button", { name: "Previous match" }).click();
    await expect(previewCounter(window)).toHaveText("1/32");
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    const scrollTop = await readActiveMainScrollTop(window);
    expect(scrollTop).toBeLessThanOrEqual(220);
  });

  test("preview mixed next/prev navigation keeps deterministic open scroll and fresh find", async ({
    window,
  }) => {
    const lines = Array.from({ length: 28 }, (_, i) => `settle-match line ${i + 1}`);
    await createNoteWithBody(window, "Preview settle target", lines);

    await openPalette(window);
    await paletteInput(window).fill("settle-match");
    await waitForResultRows(window, 1);
    await movePreviewToIndex(window, 21);
    await expect(previewCounter(window)).toHaveText("21/28");
    await movePreviewToIndex(window, 14);
    await expect(previewCounter(window)).toHaveText("14/28");

    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);
    const scrolled = await readActiveMainScrollTop(window);
    expect(scrolled).toBeGreaterThan(80);
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("rapid preview chevron churn then open remains stable and find opens fresh", async ({
    window,
  }) => {
    const lines = Array.from({ length: 26 }, (_, i) => `churn-match line ${i + 1}`);
    await createNoteWithBody(window, "Preview churn target", lines);

    await openPalette(window);
    await paletteInput(window).fill("churn-match");
    await waitForResultRows(window, 1);

    for (let i = 0; i < 60; i += 1) {
      if (i % 3 === 0) {
        await palette(window).getByRole("button", { name: "Previous match" }).click();
      } else {
        await palette(window).getByRole("button", { name: "Next match" }).click();
      }
    }
    const settled = await readPreviewCounter(window);
    expect(settled.total).toBe(26);

    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("sequential opens of same note keep fresh find regardless of previous preview index", async ({
    window,
  }) => {
    const lines = Array.from({ length: 30 }, (_, i) => `sequence-match line ${i + 1}`);
    await createNoteWithBody(window, "Preview sequential target", lines);
    await createNoteWithBody(window, "Preview sequential active", ["filler"]);

    await openPalette(window);
    await paletteInput(window).fill("sequence-match");
    await waitForResultRows(window, 1);
    await movePreviewToIndex(window, 9);
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    await window.keyboard.press(`${mod}+f`);

    await tabByTitle(window, "Preview sequential active").click();
    await openPalette(window);
    await paletteInput(window).fill("sequence-match");
    await waitForResultRows(window, 1);
    await movePreviewToIndex(window, 24);
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("different notes keep fresh find state independent from preview index", async ({
    window,
  }) => {
    const a = Array.from({ length: 20 }, (_, i) => `azure-hit ${i + 1}`);
    const b = Array.from({ length: 16 }, (_, i) => `bronze-hit ${i + 1}`);
    await createNoteWithBody(window, "Transfer isolated A", a);
    await createNoteWithBody(window, "Transfer isolated B", b);

    await openPalette(window);
    await paletteInput(window).fill("azure-hit");
    await waitForResultRows(window, 1);
    await movePreviewToIndex(window, 13);
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    await window.keyboard.press(`${mod}+f`);

    await openPalette(window);
    await paletteInput(window).fill("bronze-hit");
    await waitForResultRows(window, 1);
    await movePreviewToIndex(window, 7);
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("keyboard-open from selected result still opens note while find starts fresh", async ({
    window,
  }) => {
    const lines = Array.from({ length: 22 }, (_, i) => `keyboard-jump line ${i + 1}`);
    await createNoteWithBody(window, "Preview keyboard jump target", lines);

    await openPalette(window);
    await paletteInput(window).fill("keyboard-jump");
    await waitForResultRows(window, 1);
    await movePreviewToIndex(window, 18);
    await expect(previewCounter(window)).toHaveText("18/22");
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("preview-open delayed Cmd/Ctrl+F remains usable after transient 3s period", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Transient timeout target", [
      "mint one",
      "mint two",
      "mint three",
      "mint four",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("mint");
    await waitForResultRows(window, 1);

    await palette(window).getByRole("button", { name: "Next match" }).click();
    await palette(window).getByRole("button", { name: "Next match" }).click();
    await expect(previewCounter(window)).toHaveText("3/4");

    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);
    await window.waitForTimeout(3500);
    await openFindUi(window);
    await expect(findCounter(window)).toHaveText(/^\d+\/\d+$/);
    await findInput(window).fill("mint two");
    await expect(findCounter(window)).toHaveText("1/1");
  });

  test("Cmd/Ctrl+F immediately cancels transient mode and opens fresh find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Transient cancel target", [
      "jade one",
      "jade two",
      "jade three",
      "jade four",
      "jade five",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("jade");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("state transfer contract: Cmd/Ctrl+F clears transferred query immediately", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Transfer clear contract", [
      "ruby one",
      "ruby two",
      "ruby three",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("ruby");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("state transfer contract: after Cmd/Ctrl+F, typing starts a fresh search from first match", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Transfer fresh typing contract", [
      "onyx one",
      "onyx two",
      "onyx three",
      "onyx four",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("onyx");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await findInput(window).fill("onyx");
    await expect(findCounter(window)).toHaveText("1/4");
  });

  test("state transfer contract: hidden-preview mode still opens empty in-note find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Transfer hidden preview contract", [
      "pearl one",
      "pearl two",
      "pearl three",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("pearl");
    await waitForResultRows(window, 1);
    const hidePreview = palette(window).getByRole("button", { name: "Hide preview pane" });
    if ((await hidePreview.count()) > 0) {
      await hidePreview.click();
    }
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("gap: existing in-note find state on target note is preserved when opened via palette tab switch", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Preserve existing find target", [
      "garnet one",
      "garnet two",
      "garnet three",
    ]);
    await createNoteWithBody(window, "Preserve existing find active", ["filler"]);

    // Set explicit in-note find state on target.
    await tabByTitle(window, "Preserve existing find target").click();
    await openFindUi(window);
    await findInput(window).fill("garnet");
    await expect(findCounter(window)).toHaveText("1/3");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/3");

    // Move away, then return via palette open path.
    await tabByTitle(window, "Preserve existing find active").click();
    await openPalette(window);
    await paletteInput(window).fill("preserve existing find target");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await expect(activeEditorTitle(window)).toContainText("Preserve existing find target");
    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("garnet");
    await expect(findCounter(window)).toHaveText("2/3");
  });

  test("gap: transient jump plus immediate content mutation still yields fresh Cmd/Ctrl+F and correct recompute", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Transient mutate contract", [
      "moss one",
      "moss two",
      "moss three",
      "moss four",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("moss");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    // Mutate content before entering in-note find.
    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.type("moss keep");

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    await findInput(window).fill("moss");
    await expect(findCounter(window)).toHaveText("1/1");
  });

  test("gap: Cmd/Ctrl+F spam during transient window never re-injects transferred query", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Transient spam contract", [
      "agate one",
      "agate two",
      "agate three",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("agate");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    for (let i = 0; i < 6; i += 1) {
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toBeVisible();
      await expect(findInput(window)).toHaveValue("");
      await expect(findCounter(window)).toHaveText("0/0");
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toHaveCount(0);
    }
  });

  test("gap: reopening palette and clearing query does not reapply stale transfer into in-note find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Residual transfer contract", [
      "pebble one",
      "pebble two",
      "pebble three",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("pebble");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    // Reopen palette and clear/close to mimic user pivot.
    await openPalette(window);
    await paletteInput(window).fill("other");
    await window.keyboard.press("Escape"); // clears query first
    await expect(paletteInput(window)).toHaveValue("");
    await window.keyboard.press("Escape"); // closes palette
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("durability: rapid palette-open and Cmd/Ctrl+F focus switching always starts fresh find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Durability focus target", [
      "focus token one",
      "focus token two",
      "focus token three",
    ]);
    await createNoteWithBody(window, "Durability focus anchor", ["anchor filler"]);

    for (let i = 0; i < 10; i += 1) {
      await tabByTitle(window, "Durability focus anchor").click();
      await openPalette(window);
      await paletteInput(window).fill("durability focus target");
      await waitForResultRows(window, 1);
      await window.keyboard.press("Enter");
      await expect(palette(window)).toHaveCount(0);
      await expect(activeEditorTitle(window)).toContainText("Durability focus target");

      await openFindUi(window);
      await expect(findInput(window)).toHaveValue("");
      await expect(findCounter(window)).toHaveText("0/0");
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toHaveCount(0);
    }
  });

  test("durability: cross-note transfers stay isolated with mixed preview visibility", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Durability isolate A", [
      "aurelian one",
      "aurelian two",
      "aurelian three",
    ]);
    await createNoteWithBody(window, "Durability isolate B", [
      "beryl one",
      "beryl two",
      "beryl three",
    ]);
    await createNoteWithBody(window, "Durability isolate C", [
      "citrine one",
      "citrine two",
      "citrine three",
    ]);

    const sequence = [
      {
        query: "aurelian",
        expectedTitle: "Durability isolate A",
        probe: "aurelian one",
        hidePreview: false,
      },
      {
        query: "beryl",
        expectedTitle: "Durability isolate B",
        probe: "beryl one",
        hidePreview: true,
      },
      {
        query: "citrine",
        expectedTitle: "Durability isolate C",
        probe: "citrine one",
        hidePreview: false,
      },
      {
        query: "aurelian",
        expectedTitle: "Durability isolate A",
        probe: "aurelian one",
        hidePreview: true,
      },
      {
        query: "beryl",
        expectedTitle: "Durability isolate B",
        probe: "beryl one",
        hidePreview: false,
      },
      {
        query: "citrine",
        expectedTitle: "Durability isolate C",
        probe: "citrine one",
        hidePreview: true,
      },
    ];

    for (const step of sequence) {
      await openPalette(window);
      await paletteInput(window).fill(step.query);
      await waitForResultRows(window, 1);
      const targetRow = resultItems(window).filter({ hasText: step.expectedTitle }).first();
      await expect(targetRow).toBeVisible();

      if (step.hidePreview) {
        const hidePreview = palette(window).getByRole("button", { name: "Hide preview pane" });
        if ((await hidePreview.count()) > 0) {
          await hidePreview.click();
        }
      } else {
        const showPreview = palette(window).getByRole("button", { name: "Show preview pane" });
        if ((await showPreview.count()) > 0) {
          await showPreview.click();
        }
      }

      await targetRow.click();
      await expect(palette(window)).toHaveCount(0);
      await expect(activeEditorTitle(window)).toContainText(step.expectedTitle);

      await openFindUi(window);
      await expect(findInput(window)).toHaveValue("");
      await expect(findCounter(window)).toHaveText("0/0");
      await findInput(window).fill(step.probe);
      await expect(findCounter(window)).toHaveText("1/1");
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toHaveCount(0);
    }
  });

  test("durability: transient expiry boundary remains deterministic before and after 3s", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Durability expiry target", [
      "quartz one",
      "quartz two",
      "quartz three",
    ]);

    // Just before expiry.
    await openPalette(window);
    await paletteInput(window).fill("quartz");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);
    await window.waitForTimeout(2800);
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    await window.waitForTimeout(500);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    await window.keyboard.press(`${mod}+f`);

    // Just after expiry.
    await openPalette(window);
    await paletteInput(window).fill("quartz");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);
    await window.waitForTimeout(3400);
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
    await window.waitForTimeout(500);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("durability: tab close/reopen lifecycle preserves no-duplicate tabs and fresh find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Durability lifecycle target", [
      "lifecycle mark one",
      "lifecycle mark two",
      "lifecycle mark three",
    ]);
    await createNoteWithBody(window, "Durability lifecycle anchor", ["anchor"]);

    await closeTab(window, "Durability lifecycle target");
    await expect(activeEditorTitle(window)).toContainText("Durability lifecycle anchor");

    // Reopen closed tab via palette.
    await openFromPaletteByTitle(window, "Durability lifecycle target");
    await expect(activeEditorTitle(window)).toContainText("Durability lifecycle target");
    await assertNoDuplicateTabTitle(window, "Durability lifecycle target");

    // Switch away and open existing inactive tab via palette (must not duplicate).
    await tabByTitle(window, "Durability lifecycle anchor").click();
    await openFromPaletteByTitle(window, "Durability lifecycle target");
    await expect(activeEditorTitle(window)).toContainText("Durability lifecycle target");
    await assertNoDuplicateTabTitle(window, "Durability lifecycle target");

    // Close and reopen again, this time with preview hidden.
    await closeTab(window, "Durability lifecycle target");
    await openPalette(window);
    await paletteInput(window).fill("durability lifecycle target");
    await waitForResultRows(window, 1);
    const hidePreview = palette(window).getByRole("button", { name: "Hide preview pane" });
    if ((await hidePreview.count()) > 0) {
      await hidePreview.click();
    }
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);

    await expect(activeEditorTitle(window)).toContainText("Durability lifecycle target");
    await assertNoDuplicateTabTitle(window, "Durability lifecycle target");
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("Cmd/Ctrl+click open does not transfer transient query into in-note find", async ({
    window,
  }) => {
    await createNoteWithBody(window, "No transfer via modifier target", [
      "saffron one",
      "saffron two",
    ]);
    await createNoteWithBody(window, "No transfer via modifier active", ["baseline"]);

    await openPalette(window);
    await paletteInput(window).fill("saffron");
    await waitForResultRows(window, 1);
    await resultItems(window).first().click({ modifiers: [mod as "Meta" | "Control"] });
    await closePaletteIfOpen(window);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("transient transfer is isolated per tab and does not leak to other note finds", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Transient isolation A", [
      "cerulean one",
      "cerulean two",
      "cerulean three",
    ]);
    await createNoteWithBody(window, "Transient isolation B", ["amber only"]);

    await openPalette(window);
    await paletteInput(window).fill("cerulean");
    await waitForResultRows(window, 1);
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);

    await tabByTitle(window, "Transient isolation B").click();
    await expect(activeEditorTitle(window)).toContainText("Transient isolation B");
    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("latest palette-open sequence still opens fresh find after multiple transient jumps", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Replace transient source", [
      "lilac one",
      "lilac two",
      "orchid one",
      "orchid two",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("orchid");
    await waitForResultRows(window, 1);
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);

    await openPalette(window);
    await paletteInput(window).fill("lilac");
    await waitForResultRows(window, 1);
    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);

    await openFindUi(window);
    await expect(findInput(window)).toHaveValue("");
    await expect(findCounter(window)).toHaveText("0/0");
  });

  test("regular in-note find does not auto-expire over time", async ({ window }) => {
    await createNoteWithBody(window, "Persistent in-note find", [
      "opal one",
      "opal two",
      "opal three",
      "opal four",
    ]);

    await openFindUi(window);
    await findInput(window).fill("opal");
    await expect(findCounter(window)).toHaveText("1/4");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("2/4");

    // Wait longer than transient-jump TTL to ensure normal find has no timer-based expiry.
    await window.waitForTimeout(4500);

    await expect(findInput(window)).toBeVisible();
    await expect(findInput(window)).toHaveValue("opal");
    await expect(findCounter(window)).toHaveText("2/4");
    await window.getByTestId("note-find-next").click();
    await expect(findCounter(window)).toHaveText("3/4");
  });

  test("stress: rapid mixed preview-visible/hidden opens keep find starting fresh", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Deterministic transfer target", [
      "violet one",
      "violet two",
      "indigo one",
      "indigo two",
    ]);

    const cycles = [
      { query: "violet" },
      { query: "indigo" },
      { query: "violet" },
      { query: "indigo" },
      { query: "violet" },
      { query: "indigo" },
      { query: "violet" },
      { query: "indigo" },
    ];

    for (let i = 0; i < cycles.length; i += 1) {
      await openPalette(window);
      await paletteInput(window).fill(cycles[i].query);
      await waitForResultRows(window, 1);
      if (i % 2 === 0) {
        await palette(window).getByRole("button", { name: "Hide preview pane" }).click();
        await expect(palette(window).getByRole("button", { name: "Show preview pane" })).toBeVisible();
      } else {
        if ((await palette(window).getByRole("button", { name: "Show preview pane" }).count()) > 0) {
          await palette(window).getByRole("button", { name: "Show preview pane" }).click();
        }
      }
      await window.keyboard.press("Enter");
      await expect(palette(window)).toHaveCount(0);

      await openFindUi(window);
      await expect(findInput(window)).toHaveValue("");
      await expect(findCounter(window)).toHaveText("0/0");
      await window.keyboard.press(`${mod}+f`);
      await expect(findInput(window)).toHaveCount(0);
    }
  });

  test("stress: repeated palette opens across mixed tab states never duplicates tabs", async ({
    window,
  }) => {
    const titles = [
      "Stress mixed A",
      "Stress mixed B",
      "Stress mixed C",
      "Stress mixed D",
      "Stress mixed E",
    ];
    for (const title of titles) {
      await createNoteWithBody(window, title, [`${title} body token`]);
    }

    // Close two tabs so the run continuously mixes open and closed note targets.
    await closeTab(window, "Stress mixed B");
    await closeTab(window, "Stress mixed D");

    let seed = 20260312;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 60; i += 1) {
      const title = titles[Math.floor(rand() * titles.length)];
      await openFromPaletteByTitle(window, title);

      await expect(activeEditorTitle(window)).toContainText(title);
      await assertNoDuplicateTabTitle(window, title);
    }

    // Final sweep: every title can be navigated to cleanly from palette.
    for (const title of titles) {
      await openFromPaletteByTitle(window, title);
      await expect(activeEditorTitle(window)).toContainText(title);
      await assertNoDuplicateTabTitle(window, title);
    }
  });

  test("stress: repeated open/search/close cycles keep palette responsive and deterministic", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Stress palette A", ["stress token alpha"]);
    await createNoteWithBody(window, "Stress palette B", ["stress token beta"]);
    await createNoteWithBody(window, "Stress palette C", ["stress token gamma"]);

    const queries = ["stress", "alpha", "beta", "gamma", "palette", "token", "zzz"];
    for (let i = 0; i < 40; i += 1) {
      await window.keyboard.press(`${mod}+p`);
      await expect(palette(window)).toBeVisible();
      const q = queries[i % queries.length];
      await paletteInput(window).fill(q);

      if (q === "zzz") {
        await expect(palette(window).getByText("No matching notes.")).toBeVisible();
      } else {
        await expect(async () => {
          const count = await resultItems(window).count();
          expect(count).toBeGreaterThan(0);
        }).toPass();
      }

      // First escape clears query (if any), second closes.
      await window.keyboard.press("Escape");
      if (q.trim().length > 0) {
        await expect(palette(window)).toBeVisible();
        await expect(paletteInput(window)).toHaveValue("");
        await window.keyboard.press("Escape");
      }
      await expect(palette(window)).toHaveCount(0);
    }
  });
});
