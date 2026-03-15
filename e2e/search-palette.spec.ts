import { test, expect } from "./electron-app";
import type { Page, Locator } from "@playwright/test";

const mod = process.platform === "darwin" ? "Meta" : "Control";
const RUN_HEAVY_STRESS = process.env.E2E_HEAVY_STRESS === "1";

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

function activeMain(window: Page) {
  return window.locator('main:not([style*="display: none"])').first();
}

function findInput(window: Page) {
  return activeMain(window).getByTestId("note-find-input");
}

function findCounter(window: Page) {
  return activeMain(window).getByTestId("note-find-counter");
}

function findTrigger(window: Page) {
  return activeMain(window).getByTestId("note-find-trigger");
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

async function readPaletteInputSelection(window: Page): Promise<{
  value: string;
  start: number;
  end: number;
}> {
  return window.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[cmdk-input]');
    if (!input) return { value: "", start: -1, end: -1 };
    return {
      value: input.value,
      start: input.selectionStart ?? -1,
      end: input.selectionEnd ?? -1,
    };
  });
}

async function seedNotesInDb(window: Page, titles: string[]) {
  await window.evaluate(async (nextTitles) => {
    const lychee = (
      window as unknown as {
        lychee: {
          invoke: (
            channel: string,
            payload: Record<string, unknown>,
          ) => Promise<{ document: { id: string } }>;
        };
      }
    ).lychee;
    for (const title of nextTitles) {
      const created = await lychee.invoke("documents.create", {
        parentId: null,
      });
      await lychee.invoke("documents.update", {
        id: created.document.id,
        title,
      });
    }
  }, titles);

  await window.reload();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForSelector("aside[data-state]", { timeout: 15_000 });
}

async function seedNotesWithIds(window: Page, titles: string[]) {
  const docs = await window.evaluate(async (nextTitles) => {
    const lychee = (
      window as unknown as {
        lychee: {
          invoke: (
            channel: string,
            payload: Record<string, unknown>,
          ) => Promise<{ document: { id: string; title: string } }>;
        };
      }
    ).lychee;
    const createdDocs: Array<{ id: string; title: string }> = [];
    for (const title of nextTitles) {
      const created = await lychee.invoke("documents.create", { parentId: null });
      await lychee.invoke("documents.update", {
        id: created.document.id,
        title,
      });
      createdDocs.push({ id: created.document.id, title });
    }
    return createdDocs;
  }, titles);

  await window.reload();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForSelector("aside[data-state]", { timeout: 15_000 });
  return docs;
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

  test("reopening palette after close selects full input text so typing replaces immediately", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Select-all reopen note", ["beta one", "beta two"]);

    await openPalette(window);
    await paletteInput(window).fill("beta");
    await waitForResultRows(window, 1);

    await window.keyboard.press("Escape");
    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toHaveValue("");

    await window.keyboard.type("beta");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Escape");
    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toHaveValue("");

    await window.keyboard.press("Escape");
    await expect(palette(window)).toHaveCount(0);

    await openPalette(window);
    await expect(paletteInput(window)).toBeFocused();
    const selection = await readPaletteInputSelection(window);
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.value.length);

    await window.keyboard.type("gamma");
    await expect(paletteInput(window)).toHaveValue("gamma");
  });

  test("input trailing action clears query and keeps palette focused", async ({ window }) => {
    await createNoteWithBody(window, "Clear action note", ["delta one", "delta two"]);

    await openPalette(window);
    await paletteInput(window).fill("delta");
    await expect(paletteInput(window)).toHaveValue("delta");
    await waitForResultRows(window, 1);

    const clearAction = palette(window)
      .locator('[data-slot="command-input-adornment"] button')
      .first();
    await expect(clearAction).toBeVisible();
    await clearAction.click();

    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toHaveValue("");
    await expect(paletteInput(window)).toBeFocused();
  });

  test("large corpus query churn remains bounded, searchable, and deterministic", async ({
    window,
  }) => {
    await seedNotesInDb(
      window,
      Array.from({ length: 120 }, (_, i) => `Corpus note ${i + 1} common marker`),
    );

    await openPalette(window);
    const queries = [
      "corpus",
      "corpus note",
      "corpus note 11",
      "common marker",
      "corpus note 120",
      "not-present-token",
    ];

    for (let i = 0; i < queries.length; i += 1) {
      await paletteInput(window).fill(queries[i]);
      if (queries[i] === "not-present-token") {
        await expect(palette(window).getByText("No matching notes.")).toBeVisible();
        await expect(resultItems(window)).toHaveCount(0);
      } else {
        await waitForResultRows(window, 1);
        await assertResultCountAtMost(window, 50);
      }
    }

    await paletteInput(window).fill("corpus note 120");
    const exact = resultItems(window).filter({ hasText: "Corpus note 120" }).first();
    await expect(exact).toBeVisible();
    await exact.click();
    await expect(palette(window)).toHaveCount(0);
    await expect(activeEditorTitle(window)).toContainText("Corpus note 120");
  });

  test("race: rapid query churn keeps preview/open action aligned to final query", async ({
    window,
  }) => {
    await seedNotesInDb(window, [
      "Race preview alpha target",
      "Race preview beta final",
      "Race preview gamma filler",
    ]);

    await openPalette(window);
    const churn = [
      "race",
      "race preview alpha",
      "race preview beta",
      "race preview gamma",
      "race preview beta final",
    ];
    for (const q of churn) {
      await paletteInput(window).fill(q);
    }

    await waitForResultRows(window, 1);
    const betaRow = resultItems(window).filter({ hasText: "Race preview beta final" }).first();
    await expect(betaRow).toBeVisible();
    await expect(resultItems(window).filter({ hasText: "Race preview alpha target" })).toHaveCount(
      0,
    );

    await palette(window).getByRole("button", { name: "Open note" }).click();
    await expect(palette(window)).toHaveCount(0);
    await expect(activeEditorTitle(window)).toContainText("Race preview beta final");
  });

  test("cache pressure: over-300 unique queries still resolves correct result after churn", async ({
    window,
  }) => {
    test.slow();
    await seedNotesInDb(
      window,
      Array.from({ length: 305 }, (_, i) => `LRU pressure note ${String(i + 1).padStart(3, "0")}`),
    );

    await openPalette(window);
    for (let i = 1; i <= 305; i += 1) {
      const q = `lru pressure note ${String(i).padStart(3, "0")}`;
      await paletteInput(window).fill(q);
      if (i % 75 === 0 || i === 305) {
        await waitForResultRows(window, 1);
      }
    }

    await paletteInput(window).fill("lru pressure note 001");
    const first = resultItems(window).filter({ hasText: "LRU pressure note 001" }).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(palette(window)).toHaveCount(0);
    await expect(activeEditorTitle(window)).toContainText("LRU pressure note 001");
  });

  test("deferred search consistency: final results match final query after rapid churn", async ({
    window,
  }) => {
    await seedNotesInDb(window, [
      "Deferred alpha match",
      "Deferred beta match",
      "Deferred alphabet soup",
      "Deferred gamma filler",
    ]);

    await openPalette(window);
    const rapidQueries = ["d", "de", "def", "deferred a", "deferred b", "deferred alpha"];
    for (const q of rapidQueries) {
      await paletteInput(window).fill(q);
    }

    await waitForResultRows(window, 1);
    await expect(resultItems(window).filter({ hasText: "Deferred alpha match" }).first()).toBeVisible();
    await expect(resultItems(window).filter({ hasText: "Deferred beta match" })).toHaveCount(0);
  });

  test("open/close during loading recovers without stuck spinner", async ({ window }) => {
    await seedNotesInDb(
      window,
      Array.from({ length: 140 }, (_, i) => `Loading resilience note ${i + 1}`),
    );

    await openPalette(window);
    await paletteInput(window).fill("loading resilience");
    await window.keyboard.press("Escape");
    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toHaveValue("");
    await window.keyboard.press("Escape");
    await expect(palette(window)).toHaveCount(0);

    await openPalette(window);
    await paletteInput(window).fill("loading resilience note 140");
    await waitForResultRows(window, 1);
    await expect(
      palette(window).locator("div").filter({ hasText: /^Searching\.\.\.$|^Loading notes\.\.\.$/ }),
    ).toHaveCount(0);
  });

  test("external DB mutation is reflected in palette after app reload", async ({
    window,
  }) => {
    const seeded = await seedNotesWithIds(window, [
      "Mutable open original title",
      "Mutable open control title",
    ]);
    const target = seeded.find((d) => d.title === "Mutable open original title");
    expect(target).toBeTruthy();
    if (!target) throw new Error("Expected seeded mutable target note");

    await openPalette(window);
    await paletteInput(window).fill("mutable open original");
    await waitForResultRows(window, 1);
    await expect(resultItems(window).filter({ hasText: "Mutable open original title" }).first()).toBeVisible();

    await window.evaluate(async (docId) => {
      await (window as unknown as { lychee: { invoke: (channel: string, payload: Record<string, unknown>) => Promise<unknown> } }).lychee.invoke(
        "documents.update",
        { id: docId, title: "Mutable open updated title" },
      );
    }, target.id);

    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector("aside[data-state]", { timeout: 15_000 });

    await openPalette(window);
    await paletteInput(window).fill("mutable open updated");
    await waitForResultRows(window, 1);
    await expect(resultItems(window).filter({ hasText: "Mutable open updated title" }).first()).toBeVisible();
    await expect(resultItems(window).filter({ hasText: "Mutable open original title" })).toHaveCount(0);
  });

  test("duplicate titles: selecting specific row opens intended doc id", async ({ window }) => {
    const docs = await seedNotesWithIds(window, [
      "Duplicate title edge",
      "Duplicate title edge",
      "Distinct control note",
    ]);

    await openPalette(window);
    await paletteInput(window).fill("duplicate title edge");
    await waitForResultRows(window, 2);

    const duplicateRows = resultItems(window).filter({ hasText: "Duplicate title edge" });
    await expect(duplicateRows).toHaveCount(2);
    const secondId = await duplicateRows.nth(1).getAttribute("data-doc-id");
    expect(secondId).toBeTruthy();
    if (!secondId) throw new Error("Expected second duplicate id");

    await palette(window).locator(`[cmdk-item][data-doc-id="${secondId}"]`).first().click();
    await expect(palette(window)).toHaveCount(0);

    await openPalette(window);
    await paletteInput(window).fill("duplicate title edge");
    const openedRow = palette(window).locator(`[cmdk-item][data-doc-id="${secondId}"]`).first();
    await expect(openedRow.locator('[data-slot="search-result-tab-status"]')).toHaveText("Current");
    const firstId = docs.find((d) => d.id !== secondId && d.title === "Duplicate title edge")?.id;
    if (firstId) {
      await expect(palette(window).locator(`[cmdk-item][data-doc-id="${firstId}"]`).first()).not.toContainText(
        "Current",
      );
    }
  });

  test("single-result keyboard bounds remain stable with Arrow/Home/End", async ({ window }) => {
    await seedNotesInDb(window, ["Single result keyboard target", "single filler"]);
    await openPalette(window);
    await paletteInput(window).fill("single result keyboard target");
    await waitForResultRows(window, 1);
    await expect(resultItems(window)).toHaveCount(1);

    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowUp");
    await window.keyboard.press("Home");
    await window.keyboard.press("End");
    await expect(resultItems(window)).toHaveCount(1);
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);
    await expect(activeEditorTitle(window)).toContainText("Single result keyboard target");
  });

  test("preview-hidden parity under rapid query changes opens final intended result", async ({
    window,
  }) => {
    await seedNotesInDb(window, [
      "Hidden parity alpha",
      "Hidden parity beta final",
      "Hidden parity gamma",
    ]);
    await openPalette(window);
    const hidePreview = palette(window).getByRole("button", { name: "Hide preview pane" });
    if ((await hidePreview.count()) > 0) {
      await hidePreview.click();
    }
    await expect(palette(window).getByRole("button", { name: "Show preview pane" })).toBeVisible();

    const churn = ["hidden", "hidden parity alpha", "hidden parity beta", "hidden parity beta final"];
    for (const q of churn) {
      await paletteInput(window).fill(q);
    }
    await waitForResultRows(window, 1);
    await expect(resultItems(window).filter({ hasText: "Hidden parity beta final" }).first()).toBeVisible();
    await window.keyboard.press("Enter");
    await expect(palette(window)).toHaveCount(0);
    await expect(activeEditorTitle(window)).toContainText("Hidden parity beta final");
  });

  test("fuzz: randomized unicode/punctuation query loop stays bounded and stable", async ({
    window,
  }) => {
    await seedNotesInDb(
      window,
      Array.from({ length: 180 }, (_, i) => `Fuzz corpus ${i + 1} cafe café 👨‍👩‍👧‍👦 [x]+?`),
    );
    await openPalette(window);

    let seed = 20260313;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 [](){}.*+?^$|/\\-_👨‍👩‍👧‍👦é";

    for (let i = 0; i < 220; i += 1) {
      const len = Math.floor(rand() * 18);
      let query = "";
      for (let j = 0; j < len; j += 1) {
        query += alphabet[Math.floor(rand() * alphabet.length)];
      }
      await paletteInput(window).fill(query);
      await expect(palette(window)).toBeVisible();
      await expect(paletteInput(window)).toBeFocused();
      if (query.trim().length === 0) {
        await assertResultCountAtMost(window, 30);
      } else {
        const count = await resultItems(window).count();
        expect(count).toBeGreaterThanOrEqual(0);
        expect(count).toBeLessThanOrEqual(50);
      }
    }
  });

  test("long single-note body payload does not degrade palette responsiveness", async ({
    electronApp,
    window,
  }) => {
    test.slow();
    const lines = Array.from({ length: 500 }, (_, i) =>
      i % 17 === 0 ? `giant-token line ${i + 1}` : `filler content line ${i + 1}`,
    );
    const pasted = lines.join("\n");

    await createNoteWithBody(window, "Huge body target note", ["seed line"]);
    await electronApp.evaluate(({ clipboard }, text) => {
      clipboard.writeText(text);
    }, pasted);

    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.press(`${mod}+v`);
    await window.waitForTimeout(900);

    await createNoteWithBody(window, "Huge body control note", ["small content"]);

    await openPalette(window);
    await paletteInput(window).fill("huge body target note");
    await waitForResultRows(window, 1);
    await expect(resultItems(window).filter({ hasText: "Huge body target note" }).first()).toBeVisible();
  });

  test("huge note body is discoverable via body-only token query", async ({
    electronApp,
    window,
  }) => {
    test.slow();
    const bodyOnlyToken = "ultra-body-only-token-92731";
    const lines = Array.from({ length: 420 }, (_, i) =>
      i % 41 === 0
        ? `${bodyOnlyToken} line ${i + 1}`
        : `bulk filler content line ${i + 1}`,
    );
    const pasted = lines.join("\n");

    // Title intentionally does not include the body token.
    await createNoteWithBody(window, "Huge body body-query target", ["seed line"]);
    await electronApp.evaluate(({ clipboard }, text) => {
      clipboard.writeText(text);
    }, pasted);
    const editorRoot = window.locator('main:not([style*="display: none"]) .ContentEditable__root');
    await editorRoot.click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.press(`${mod}+v`);
    await window.waitForTimeout(900);

    await createNoteWithBody(window, "Huge body unrelated control", ["plain words only"]);

    await openPalette(window);
    await paletteInput(window).fill(bodyOnlyToken);
    await waitForResultRows(window, 1);

    const targetRow = resultItems(window)
      .filter({ hasText: "Huge body body-query target" })
      .first();
    await expect(targetRow).toBeVisible();
    await expect(targetRow).toContainText(bodyOnlyToken);
    await expect(resultItems(window).filter({ hasText: "Huge body unrelated control" })).toHaveCount(
      0,
    );
  });

  test("resize thrash across preview breakpoint keeps palette interactive", async ({ window }) => {
    await seedNotesInDb(window, [
      "Resize thrash alpha",
      "Resize thrash beta",
      "Resize thrash gamma",
    ]);

    await window.setViewportSize({ width: 1400, height: 900 });
    await openPalette(window);
    await paletteInput(window).fill("resize thrash");
    await waitForResultRows(window, 1);

    const widths = [1360, 1060, 980, 1200, 760, 1280, 900, 1400];
    for (const width of widths) {
      await window.setViewportSize({ width, height: 820 });
      await window.waitForTimeout(60);
      await expect(palette(window)).toBeVisible();
      await expect(paletteInput(window)).toBeFocused();
      const count = await resultItems(window).count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test("focus trap stress with tab/shift+tab and escape remains stable", async ({ window }) => {
    await seedNotesInDb(window, ["Focus trap note one", "Focus trap note two"]);
    await openPalette(window);

    for (let i = 0; i < 24; i += 1) {
      await window.keyboard.press("Tab");
      await window.keyboard.press("Shift+Tab");
      await expect(palette(window)).toBeVisible();
    }

    await paletteInput(window).fill("focus trap note one");
    await waitForResultRows(window, 1);
    await window.keyboard.press("Escape");
    await expect(palette(window)).toBeVisible();
    await expect(paletteInput(window)).toHaveValue("");
    await window.keyboard.press("Escape");
    await expect(palette(window)).toHaveCount(0);
  });

  test("a11y snapshot: dialog and keyboard controls remain available after rerenders", async ({
    window,
  }) => {
    await seedNotesInDb(window, ["A11y palette note one", "A11y palette note two"]);
    await openPalette(window);
    await expect(palette(window)).toHaveAttribute("aria-describedby");
    await expect(paletteInput(window)).toBeVisible();

    await paletteInput(window).fill("a11y");
    await waitForResultRows(window, 1);
    await expect(palette(window).getByRole("button", { name: "Open note" })).toBeVisible();
    const toggle = palette(window).getByRole("button", { name: /preview pane/i });
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
      await expect(paletteInput(window)).toBeFocused();
    }
  });

  test("heavy stress: 10k-note startup search latency budget", async ({ window }) => {
    test.slow();
    test.skip(!RUN_HEAVY_STRESS, "Set E2E_HEAVY_STRESS=1 for 10k dataset soak.");

    await seedNotesInDb(
      window,
      Array.from({ length: 10000 }, (_, i) => `Tenk corpus note ${i + 1}`),
    );

    const started = Date.now();
    await openPalette(window);
    await paletteInput(window).fill("tenk corpus note 9999");
    await waitForResultRows(window, 1);
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeLessThan(8000);
    await expect(resultItems(window).filter({ hasText: "Tenk corpus note 9999" }).first()).toBeVisible();
  });

  test("heavy stress: long-session memory and interaction soak remains bounded", async ({
    window,
  }) => {
    test.slow();
    test.skip(!RUN_HEAVY_STRESS, "Set E2E_HEAVY_STRESS=1 for memory soak.");

    await seedNotesInDb(
      window,
      Array.from({ length: 1200 }, (_, i) => `Memory soak note ${i + 1}`),
    );
    await openPalette(window);

    const readHeap = async () =>
      window.evaluate(() => {
        const perf = performance as Performance & {
          memory?: { usedJSHeapSize: number };
        };
        return perf.memory?.usedJSHeapSize ?? -1;
      });

    const heapStart = await readHeap();
    for (let i = 0; i < 260; i += 1) {
      await paletteInput(window).fill(`memory soak note ${((i * 13) % 1200) + 1}`);
      if (i % 5 === 0) {
        await waitForResultRows(window, 1);
      }
      if (i % 11 === 0) {
        await window.keyboard.press("Escape");
        await expect(palette(window)).toBeVisible();
        await expect(paletteInput(window)).toHaveValue("");
      }
    }

    const heapEnd = await readHeap();
    if (heapStart > 0 && heapEnd > 0) {
      // Coarse guardrail only: detect pathological unbounded growth.
      expect(heapEnd - heapStart).toBeLessThan(220 * 1024 * 1024);
    }
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
    await seedNotesInDb(
      window,
      Array.from({ length: 55 }, (_, i) => `Limit match ${i + 1}`),
    );

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

  test("group heading shows 'Matches' only when query has results, hidden otherwise", async ({ window }) => {
    await createNoteWithBody(window, "Heading test note", ["heading body content"]);

    // Empty query — no heading visible
    await openPalette(window);
    await waitForResultRows(window, 1);
    const heading = palette(window).locator("[cmdk-group-heading]");
    await expect(heading).toBeHidden();

    // Query with results — "Matches" heading visible
    await paletteInput(window).fill("heading");
    await waitForResultRows(window, 1);
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Matches");

    // Query with no results — heading hidden again
    await paletteInput(window).fill("zzz-no-match-ever");
    await expect(palette(window).getByText("No matching notes.")).toBeVisible();
    await expect(heading).toBeHidden();
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
    await openPalette(window);
    await paletteInput(window).fill("open target tab");
    await waitForResultRows(window, 1);
    const targetRow = resultItems(window).filter({ hasText: "Open target tab" }).first();
    await expect(targetRow).toBeVisible();
    await expect(targetRow.locator('[data-slot="search-result-tab-status"]')).toHaveText("Active");
    await targetRow.click();
    await expect(palette(window)).toHaveCount(0);

    await expect(activeEditorTitle(window)).toContainText("Open target tab");
    const tabsAfter = await openTabButtons(window).count();
    expect(tabsAfter).toBe(tabsBefore);
    await assertNoDuplicateTabTitle(window, "Open target tab");
  });

  test("result metadata keeps count as rightmost chip for Current and Active rows", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Chip order current row", [
      "ordertoken one",
      "ordertoken two",
      "ordertoken three",
    ]);
    await createNoteWithBody(window, "Chip order background row", [
      "ordertoken alpha",
      "ordertoken beta",
    ]);
    await tabByTitle(window, "Chip order current row").click();
    await expect(activeEditorTitle(window)).toContainText("Chip order current row");

    await openPalette(window);
    await paletteInput(window).fill("ordertoken");
    await waitForResultRows(window, 2);

    const currentRow = resultItems(window).filter({ hasText: "Chip order current row" }).first();
    const activeRow = resultItems(window).filter({ hasText: "Chip order background row" }).first();
    await expect(currentRow).toBeVisible();
    await expect(activeRow).toBeVisible();

    const currentMetaChips = currentRow.locator('[data-slot="search-result-meta"] span');
    const activeMetaChips = activeRow.locator('[data-slot="search-result-meta"] span');
    await expect(currentMetaChips).toHaveCount(2);
    await expect(activeMetaChips).toHaveCount(2);

    const currentTexts = (await currentMetaChips.allInnerTexts()).map((t) => t.trim());
    const activeTexts = (await activeMetaChips.allInnerTexts()).map((t) => t.trim());
    expect(currentTexts).toEqual(["Current", "3"]);
    expect(activeTexts).toEqual(["Active", "2"]);
  });

  test("closed matching note shows only count chip with no Current/Active label", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Closed chip-only target", [
      "chipcounttoken one",
      "chipcounttoken two",
    ]);
    await createNoteWithBody(window, "Closed chip-only anchor", ["filler anchor"]);
    await closeTab(window, "Closed chip-only target");
    await expect(activeEditorTitle(window)).toContainText("Closed chip-only anchor");

    await openPalette(window);
    await paletteInput(window).fill("chipcounttoken");
    await waitForResultRows(window, 1);

    const closedRow = resultItems(window).filter({ hasText: "Closed chip-only target" }).first();
    await expect(closedRow).toBeVisible();
    await expect(closedRow).not.toContainText("Current");
    await expect(closedRow).not.toContainText("Active");

    const closedMetaChips = closedRow.locator('[data-slot="search-result-meta"] span');
    await expect(closedMetaChips).toHaveCount(1);
    await expect(closedMetaChips.first()).toHaveText("2");
  });

  test("empty-query mode shows tab status chips but no match-count chips", async ({ window }) => {
    await createNoteWithBody(window, "Empty query current status", ["status token one"]);
    await createNoteWithBody(window, "Empty query background status", ["status token two"]);
    await tabByTitle(window, "Empty query current status").click();
    await expect(activeEditorTitle(window)).toContainText("Empty query current status");

    await openPalette(window);
    await paletteInput(window).fill("");
    await waitForResultRows(window, 2);

    const currentRow = resultItems(window).filter({ hasText: "Empty query current status" }).first();
    const activeRow = resultItems(window).filter({ hasText: "Empty query background status" }).first();
    await expect(currentRow).toBeVisible();
    await expect(activeRow).toBeVisible();
    await expect(currentRow.locator('[data-slot="search-result-tab-status"]')).toHaveText("Current");
    await expect(activeRow.locator('[data-slot="search-result-tab-status"]')).toHaveText("Active");
    await expect(currentRow.locator('[data-slot="search-result-match-count"]')).toHaveCount(0);
    await expect(activeRow.locator('[data-slot="search-result-match-count"]')).toHaveCount(0);
  });

  test("rapid query churn preserves tab-status then count chip ordering", async ({ window }) => {
    await createNoteWithBody(window, "Churn order current", [
      "churnchiptoken one",
      "churnchiptoken two",
      "churnchiptoken three",
    ]);
    await createNoteWithBody(window, "Churn order background", [
      "churnchiptoken alpha",
      "churnchiptoken beta",
    ]);
    await tabByTitle(window, "Churn order current").click();
    await expect(activeEditorTitle(window)).toContainText("Churn order current");

    await openPalette(window);
    const churnQueries = [
      "churn",
      "churn order",
      "churnchip",
      "churnchiptoken alpha",
      "churnchiptoken",
    ];
    for (const q of churnQueries) {
      await paletteInput(window).fill(q);
    }
    await waitForResultRows(window, 2);

    const currentRow = resultItems(window).filter({ hasText: "Churn order current" }).first();
    const activeRow = resultItems(window).filter({ hasText: "Churn order background" }).first();
    const currentMeta = currentRow.locator('[data-slot="search-result-meta"] span');
    const activeMeta = activeRow.locator('[data-slot="search-result-meta"] span');
    await expect(currentMeta).toHaveCount(2);
    await expect(activeMeta).toHaveCount(2);
    expect((await currentMeta.allInnerTexts()).map((t) => t.trim())).toEqual(["Current", "3"]);
    expect((await activeMeta.allInnerTexts()).map((t) => t.trim())).toEqual(["Active", "2"]);
  });

  test("keyboard-selected rows keep same metadata chips as pointer-hovered rows", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Keyboard parity current", [
      "keychiptoken one",
      "keychiptoken two",
      "keychiptoken three",
    ]);
    await createNoteWithBody(window, "Keyboard parity background", [
      "keychiptoken alpha",
      "keychiptoken beta",
    ]);
    await tabByTitle(window, "Keyboard parity current").click();
    await expect(activeEditorTitle(window)).toContainText("Keyboard parity current");

    await openPalette(window);
    await paletteInput(window).fill("keychiptoken");
    await waitForResultRows(window, 2);

    await window.keyboard.press("ArrowDown");
    const selectedByKeyboard = await selectedItem(window);
    await expect(selectedByKeyboard).toContainText("Keyboard parity background");
    await expect(selectedByKeyboard.locator('[data-slot="search-result-tab-status"]')).toHaveText("Active");
    await expect(selectedByKeyboard.locator('[data-slot="search-result-match-count"]')).toHaveText("2");

    const hoveredRow = resultItems(window).filter({ hasText: "Keyboard parity background" }).first();
    await hoveredRow.hover();
    await expect(hoveredRow.locator('[data-slot="search-result-tab-status"]')).toHaveText("Active");
    await expect(hoveredRow.locator('[data-slot="search-result-match-count"]')).toHaveText("2");
  });

  test("metadata invariant: when count exists, it is always the rightmost chip", async ({
    window,
  }) => {
    await createNoteWithBody(window, "Rightmost count current", [
      "rightmostchiptoken one",
      "rightmostchiptoken two",
      "rightmostchiptoken three",
    ]);
    await createNoteWithBody(window, "Rightmost count active", [
      "rightmostchiptoken alpha",
      "rightmostchiptoken beta",
    ]);
    await createNoteWithBody(window, "Rightmost count closed", [
      "rightmostchiptoken red",
      "rightmostchiptoken blue",
      "rightmostchiptoken green",
      "rightmostchiptoken black",
    ]);

    await closeTab(window, "Rightmost count closed");
    await tabByTitle(window, "Rightmost count current").click();
    await expect(activeEditorTitle(window)).toContainText("Rightmost count current");

    await openPalette(window);
    await paletteInput(window).fill("rightmostchiptoken");
    await waitForResultRows(window, 3);

    const currentRow = resultItems(window).filter({ hasText: "Rightmost count current" }).first();
    const activeRow = resultItems(window).filter({ hasText: "Rightmost count active" }).first();
    const closedRow = resultItems(window).filter({ hasText: "Rightmost count closed" }).first();

    const currentChips = (await currentRow
      .locator('[data-slot="search-result-meta"] span')
      .allInnerTexts()).map((t) => t.trim());
    const activeChips = (await activeRow
      .locator('[data-slot="search-result-meta"] span')
      .allInnerTexts()).map((t) => t.trim());
    const closedChips = (await closedRow
      .locator('[data-slot="search-result-meta"] span')
      .allInnerTexts()).map((t) => t.trim());

    expect(currentChips.at(-1)).toBe("3");
    expect(activeChips.at(-1)).toBe("2");
    expect(closedChips.at(-1)).toBe("4");
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
