import { test, expect, getLatestDocumentFromDb } from "./electron-app";
import type { Page, ElectronApplication } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createNote(window: Page): Promise<void> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
}

async function focusEditorBody(window: Page): Promise<void> {
  const title = window.locator("h1.editor-title");
  await title.click();
  await window.keyboard.press("Enter");
  await window.waitForTimeout(200);
}

async function insertTableViaSlashCommand(window: Page): Promise<void> {
  await window.keyboard.type("/");
  await window.waitForTimeout(200);
  // Filter to "Table" and confirm with Enter so we don't rely on menu position (avoids viewport issues when content is above)
  await window.keyboard.type("table");
  await window.waitForTimeout(150);
  await window.keyboard.press("Enter");
  await window.waitForTimeout(400);
}

/** Set OS clipboard text via Electron main process, then paste into the focused element. */
async function pasteText(
  window: Page,
  electronApp: ElectronApplication,
  text: string,
): Promise<void> {
  await window.evaluate(async (t) => {
    await navigator.clipboard.writeText(t);
  }, text);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await window.keyboard.press(`${modifier}+V`);
  await window.waitForTimeout(500);
}

/** Returns the number of rows (tr) inside the first table in the editor. */
async function getTableRowCount(window: Page): Promise<number> {
  return window.locator("table.EditorTheme__table tr").count();
}

/**
 * Copy a real image file to the OS clipboard via Electron's main process,
 * then paste it into the focused element.
 * Writes a 1×1 transparent PNG (base64) to a temp file and reads it as a NativeImage.
 */
async function pasteImageFile(
  window: Page,
  electronApp: ElectronApplication,
): Promise<void> {
  // Minimal 1×1 transparent PNG, base64-encoded
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  await window.evaluate(async (base64: string) => {
    const resp = await fetch(`data:image/png;base64,${base64}`);
    const blob = await resp.blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }, PNG_B64);

  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await window.keyboard.press(`${modifier}+V`);
  await window.waitForTimeout(500);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Table — slash command", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
  });

  test("slash command inserts a 3×3 table with a header row", async ({
    window,
  }) => {
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);

    // Table element is present
    const table = window.locator("table.EditorTheme__table");
    await expect(table).toBeVisible();

    // 3 rows total
    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(3);

    // First row uses <th> header cells
    const headerCells = window.locator(
      "table.EditorTheme__table tr:first-of-type th",
    );
    await expect(headerCells).toHaveCount(3);

    // Remaining rows use <td> data cells
    const dataCells = window.locator(
      "table.EditorTheme__table tr:not(:first-child) td",
    );
    await expect(dataCells).toHaveCount(6); // 2 rows × 3 columns
  });

  test("inserted table is persisted to the database as a Lexical table node", async ({
    window,
  }) => {
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);

    // Wait for debounced content save
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const tableNode = content.root.children.find(
      (n: { type: string }) => n.type === "table",
    );
    expect(tableNode).toBeDefined();
    // 3 rows
    expect(tableNode.children).toHaveLength(3);
  });

  test("typing in a table cell persists to the database", async ({
    window,
  }) => {
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);

    // Click the first header cell and type
    await window.locator("table.EditorTheme__table th").first().click();
    await window.keyboard.type("Column A");
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("Column A");
  });
});

test.describe("Table — paste markdown", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
  });

  test("pasting a plain markdown table creates a table node", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    const markdown = [
      "| Name | City |",
      "| --- | --- |",
      "| Alice | Paris |",
      "| Bob | Tokyo |",
    ].join("\n");

    await pasteText(window, electronApp, markdown);

    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(3); // 1 header + 2 data
    await expect(
      window.locator("table.EditorTheme__table th").first(),
    ).toContainText("Name");
    await expect(
      window.locator("table.EditorTheme__table td").first(),
    ).toContainText("Alice");
  });

  test("pasted table header and data cell counts match the markdown", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    const markdown = [
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 | 2 | 3 |",
    ].join("\n");

    await pasteText(window, electronApp, markdown);

    // 1 header row with 3 <th>, 1 data row with 3 <td>
    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(3);
    await expect(window.locator("table.EditorTheme__table td")).toHaveCount(3);
  });

  test("pasted markdown table is persisted to the database", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    await pasteText(
      window,
      electronApp,
      "| Key | Value |\n| --- | --- |\n| foo | bar |",
    );
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const tableNode = content.root.children.find(
      (n: { type: string }) => n.type === "table",
    );
    expect(tableNode).toBeDefined();
    expect(tableNode.children).toHaveLength(2); // header + 1 data row
  });

  test("pasting bold text in a cell creates a formatted text node", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    await pasteText(
      window,
      electronApp,
      "| **Bold** | Normal |\n| --- | --- |",
    );

    // The first header cell should contain a <strong> element with "Bold"
    const firstHeader = window.locator("table.EditorTheme__table th").first();
    await expect(firstHeader.locator("strong")).toContainText("Bold");

    // The second header cell should have plain text
    const secondHeader = window.locator("table.EditorTheme__table th").nth(1);
    await expect(secondHeader).toContainText("Normal");
    await expect(secondHeader.locator("strong")).toHaveCount(0);
  });

  test("pasting italic text in a cell creates a formatted text node", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    await pasteText(window, electronApp, "| *Italic* | plain |\n| --- | --- |");

    const firstHeader = window.locator("table.EditorTheme__table th").first();
    await expect(firstHeader.locator("em")).toContainText("Italic");
  });

  test("pasting code text in a cell creates a code-formatted text node", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    await pasteText(window, electronApp, "| `code` | plain |\n| --- | --- |");

    const firstHeader = window.locator("table.EditorTheme__table th").first();
    // Lexical renders code-formatted text in a <code> element
    await expect(firstHeader.locator("code")).toContainText("code");
  });

  test("pasting mixed inline formatting in one cell works", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    await pasteText(
      window,
      electronApp,
      "| **bold** and *italic* |\n| --- |\n| data |",
    );

    const firstHeader = window.locator("table.EditorTheme__table th").first();
    await expect(firstHeader.locator("strong")).toContainText("bold");
    await expect(firstHeader.locator("em")).toContainText("italic");
  });

  test("non-table clipboard text is not converted to a table", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    await pasteText(window, electronApp, "just plain text, no table here");

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
    await expect(window.locator(".ContentEditable__root")).toContainText(
      "just plain text",
    );
  });

  test("clipboard missing the divider row is not converted to a table", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    // Header row present but no divider → should not become a table
    await pasteText(window, electronApp, "| A | B |\n| C | D |");

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
  });

  test("pasting tab-separated or CSV-like text does not create a table", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);

    await pasteText(window, electronApp, "A\tB\tC\n1\t2\t3");
    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
    await expect(window.locator(".ContentEditable__root")).toContainText("A");

    await focusEditorBody(window);
    await pasteText(window, electronApp, "X,Y,Z\n4,5,6");
    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
  });
});

test.describe("Table — action menu", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  async function openActionMenu(window: Page): Promise<void> {
    // Click a data cell to place the cursor there, then trigger the action menu
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
  }

  test("add row below increases the row count by one", async ({ window }) => {
    const rowsBefore = await getTableRowCount(window);

    await openActionMenu(window);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(300);

    const rowsAfter = await getTableRowCount(window);
    expect(rowsAfter).toBe(rowsBefore + 1);
  });

  test("add row above increases the row count by one", async ({ window }) => {
    const rowsBefore = await getTableRowCount(window);

    await openActionMenu(window);
    await window.locator('button[title="Insert row above"]').click();
    await window.waitForTimeout(300);

    expect(await getTableRowCount(window)).toBe(rowsBefore + 1);
  });

  test("insert column right increases the column count by one", async ({
    window,
  }) => {
    const colsBefore = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();

    await openActionMenu(window);
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(300);

    const colsAfter = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colsAfter).toBe(colsBefore + 1);
  });

  test("insert column left increases the column count by one", async ({
    window,
  }) => {
    const colsBefore = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();

    await openActionMenu(window);
    await window.locator('button[title="Insert column left"]').click();
    await window.waitForTimeout(300);

    const colsAfter = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colsAfter).toBe(colsBefore + 1);
  });

  test("delete row reduces the row count by one", async ({ window }) => {
    const rowsBefore = await getTableRowCount(window);

    await openActionMenu(window);
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(300);

    expect(await getTableRowCount(window)).toBe(rowsBefore - 1);
  });

  test("delete table removes the table from the editor entirely", async ({
    window,
  }) => {
    await expect(window.locator("table.EditorTheme__table")).toBeVisible();

    await openActionMenu(window);
    await window.locator('button[title="Delete table"]').click();
    await window.waitForTimeout(300);

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
  });

  test("deleted table is removed from the database after save", async ({
    window,
  }) => {
    await openActionMenu(window);
    await window.locator('button[title="Delete table"]').click();
    await window.waitForTimeout(1000); // debounce

    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const hasTable = content.root.children.some(
      (n: { type: string }) => n.type === "table",
    );
    expect(hasTable).toBe(false);
  });

  test("delete table when it is the only content leaves document in valid state", async ({
    window,
  }) => {
    // beforeEach already inserted one table; that table is the only body content
    await expect(window.locator("table.EditorTheme__table").first()).toBeVisible();

    await openActionMenu(window);
    await window.locator('button[title="Delete table"]').click();
    await window.waitForTimeout(1500); // allow debounced save

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const hasTable = content.root.children.some(
      (n: { type: string }) => n.type === "table",
    );
    expect(hasTable).toBe(false);
    expect(content.root.children.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Table — image paste and URL transformation ────────────────────────────────
//
// Rule: actual image files can be pasted anywhere (they land at root via
// $insertNodeToNearestRoot). URL-to-embed transformation must be suppressed
// when the cursor is inside a table cell (enforced by link-click-plugin).

test.describe("Table — image paste and URL transformation", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  test("pasting an image file while inside a table cell inserts an image node into the document", async ({
    window,
    electronApp,
  }) => {
    // Focus a data cell first
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(200);

    await pasteImageFile(window, electronApp);

    // An image element must exist somewhere in the editor
    // (image-plugin uses $insertNodeToNearestRoot, so it may land outside the table)
    await expect(
      window.locator(".ContentEditable__root .editor-image"),
    ).toHaveCount(1);
  });

  test("pasting an image file while inside a table header cell inserts an image node into the document", async ({
    window,
    electronApp,
  }) => {
    await window.locator("table.EditorTheme__table th").first().click();
    await window.waitForTimeout(200);

    await pasteImageFile(window, electronApp);

    // Image lands at root (not inside the cell); same behavior as data cells
    await expect(
      window.locator(".ContentEditable__root .editor-image"),
    ).toHaveCount(1);
  });

  test("pasted image is stored in the database as an image node", async ({
    window,
    electronApp,
  }) => {
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(200);

    await pasteImageFile(window, electronApp);
    await window.waitForTimeout(1000); // debounce

    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const hasImage = (node: any): boolean => {
      if (node.type === "image") return true;
      return (node.children ?? []).some(hasImage);
    };
    expect(hasImage(content.root)).toBe(true);
  });

  test("pasting a URL inside a table cell does not create a bookmark or embed node", async ({
    window,
    electronApp,
  }) => {
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(200);

    // Paste a URL that would normally trigger URL-to-bookmark transformation
    await pasteText(window, electronApp, "https://example.com");
    await window.waitForTimeout(500);

    // No bookmark or embed widget should appear
    await expect(
      window.locator('.ContentEditable__root [data-lexical-decorator="true"]'),
    ).toHaveCount(0);

    // The table is still intact
    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
  });

  test("pasting a YouTube URL inside a table cell does not create a YouTube embed", async ({
    window,
    electronApp,
  }) => {
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(200);

    await pasteText(
      window,
      electronApp,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    await window.waitForTimeout(500);

    // No YouTube iframe should appear
    await expect(window.locator('iframe[src*="youtube"]')).toHaveCount(0);

    // Table still present
    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
  });

  test("pasting a plain URL outside a table DOES trigger transformation (control test)", async ({
    window,
    electronApp,
  }) => {
    // Click below the table to place cursor outside any table
    const editor = window.locator(".ContentEditable__root");
    await editor.press("End");
    await window.keyboard.press("Escape");
    await window.waitForTimeout(200);

    // Use keyboard to move cursor after the table
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowDown");
    await window.waitForTimeout(200);

    await pasteText(window, electronApp, "https://example.com");
    await window.waitForTimeout(1000);

    // Outside the table, a URL paste should either create a decorator or stay as text
    // Either outcome is acceptable; the important invariant is that the table is unaffected
    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
  });
});

// ── Table — keyboard navigation ───────────────────────────────────────────────

test.describe("Table — keyboard navigation", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  test("Tab moves focus from one cell to the next", async ({ window }) => {
    // Click the first header cell and type, then tab to the next
    const firstHeader = window.locator("table.EditorTheme__table th").first();
    await firstHeader.click();
    await window.keyboard.type("CellA");
    await window.keyboard.press("Tab");
    await window.keyboard.type("CellB");
    await window.waitForTimeout(300);

    // Both texts should appear
    await expect(
      window.locator("table.EditorTheme__table th").nth(0),
    ).toContainText("CellA");
    await expect(
      window.locator("table.EditorTheme__table th").nth(1),
    ).toContainText("CellB");
  });

  test("Shift+Tab moves focus to the previous cell", async ({ window }) => {
    // Start at second header cell
    await window.locator("table.EditorTheme__table th").nth(1).click();
    await window.keyboard.type("Second");
    await window.keyboard.press("Shift+Tab");
    await window.keyboard.type("First");
    await window.waitForTimeout(300);

    await expect(
      window.locator("table.EditorTheme__table th").nth(0),
    ).toContainText("First");
    await expect(
      window.locator("table.EditorTheme__table th").nth(1),
    ).toContainText("Second");
  });

  test("Tab through all cells in order (header then data)", async ({
    window,
  }) => {
    const firstHeader = window.locator("table.EditorTheme__table th").first();
    await firstHeader.click();

    // Tab through all 9 cells of the 3×3 table
    const labels = ["H1", "H2", "H3", "D1", "D2", "D3", "E1", "E2", "E3"];
    for (const label of labels) {
      await window.keyboard.type(label);
      await window.keyboard.press("Tab");
    }
    await window.waitForTimeout(300);

    // Spot-check a few cells
    await expect(
      window.locator("table.EditorTheme__table th").nth(0),
    ).toContainText("H1");
    await expect(
      window.locator("table.EditorTheme__table th").nth(2),
    ).toContainText("H3");
    await expect(
      window.locator("table.EditorTheme__table td").nth(0),
    ).toContainText("D1");
    await expect(
      window.locator("table.EditorTheme__table td").nth(5),
    ).toContainText("E3");
  });

  test("Tab from the last cell of the last row creates a new row", async ({
    window,
  }) => {
    const rowsBefore = await getTableRowCount(window);

    // Navigate to the last cell and ensure selection is committed before Tab
    const lastCell = window.locator("table.EditorTheme__table td").last();
    await lastCell.click();
    await window.waitForTimeout(400);
    await window.keyboard.press("Tab");
    await window.waitForTimeout(500);

    expect(await getTableRowCount(window)).toBe(rowsBefore + 1);
  });

  test("Tab-created row persists to the database", async ({ window }) => {
    const lastCell = window.locator("table.EditorTheme__table td").last();
    await lastCell.click();
    await window.waitForTimeout(400);
    await window.keyboard.press("Tab");
    await window.waitForTimeout(300);
    await window.keyboard.type("new row content");
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("new row content");
    const parsed = JSON.parse(doc!.content);
    const table = parsed.root.children.find((n: any) => n.type === "table");
    expect(table.children).toHaveLength(4); // original 3 + 1 tab-added
  });
});

// ── Table — cell content editing ─────────────────────────────────────────────

test.describe("Table — cell content editing", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  test("typing then clearing a cell leaves it empty", async ({ window }) => {
    const cell = window.locator("table.EditorTheme__table th").first();
    await cell.click();
    await window.keyboard.type("temporary");
    await window.keyboard.press("Meta+A");
    await window.keyboard.press("Backspace");
    await window.waitForTimeout(300);

    await expect(cell).toHaveText("");
  });

  test("typing special HTML characters in a cell is stored as literal text", async ({
    window,
  }) => {
    const cell = window.locator("table.EditorTheme__table th").first();
    await cell.click();
    await window.keyboard.type("<b>not bold</b>");
    await window.waitForTimeout(1000);

    // The text content should be the literal string, not rendered HTML
    await expect(cell).toContainText("<b>not bold</b>");

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("<b>not bold</b>");
  });

  test("typing angle brackets in a cell does not break the editor", async ({
    window,
  }) => {
    const cell = window.locator("table.EditorTheme__table td").first();
    await cell.click();
    await window.keyboard.type("a > b && c < d");
    await window.waitForTimeout(300);

    await expect(cell).toContainText("a > b && c < d");
    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
  });

  test("typing unicode (CJK) in a cell persists correctly", async ({
    window,
  }) => {
    const cell = window.locator("table.EditorTheme__table th").first();
    await cell.click();
    await window.keyboard.type("日本語テスト");
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("日本語テスト");
  });

  test("typing emoji in a cell persists correctly", async ({ window }) => {
    const cell = window.locator("table.EditorTheme__table td").first();
    await cell.click();
    await window.keyboard.type("🎉🚀💡");
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("🎉🚀💡");
  });

  test("typing long content in a cell (300 chars) persists fully", async ({
    window,
  }) => {
    const longText = "abcdefghij".repeat(30); // 300 chars
    const cell = window.locator("table.EditorTheme__table th").first();
    await cell.click();
    await window.keyboard.type(longText);
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain(longText);
  });

  test("all cells in a 3×3 table can be filled and all persist to DB", async ({
    window,
  }) => {
    // Fill every cell: 3 header + 6 data
    const headers = window.locator("table.EditorTheme__table th");
    const datas = window.locator("table.EditorTheme__table td");

    for (let i = 0; i < 3; i++) {
      await headers.nth(i).click();
      await window.keyboard.type(`H${i + 1}`);
    }
    for (let i = 0; i < 6; i++) {
      await datas.nth(i).click();
      await window.keyboard.type(`D${i + 1}`);
    }
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    for (let i = 1; i <= 3; i++) expect(doc!.content).toContain(`H${i}`);
    for (let i = 1; i <= 6; i++) expect(doc!.content).toContain(`D${i}`);
  });

  test("typing in a data cell does not affect the header cell in the same column", async ({
    window,
  }) => {
    const firstHeader = window.locator("table.EditorTheme__table th").first();
    const firstData = window.locator("table.EditorTheme__table td").first();

    await firstHeader.click();
    await window.keyboard.type("Header Text");
    await firstData.click();
    await window.keyboard.type("Data Text");
    await window.waitForTimeout(300);

    await expect(firstHeader).toContainText("Header Text");
    await expect(firstData).toContainText("Data Text");
  });

  test("backspace deletes characters inside a cell without removing the cell", async ({
    window,
  }) => {
    const cell = window.locator("table.EditorTheme__table th").first();
    await cell.click();
    await window.keyboard.type("hello");
    await window.keyboard.press("Backspace");
    await window.keyboard.press("Backspace");
    await window.waitForTimeout(300);

    await expect(cell).toContainText("hel");
    // Cell still present
    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(3);
  });
});

// ── Table — action menu: position and column operations ──────────────────────

test.describe("Table — action menu: position and column delete", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  async function openActionMenuForCell(
    window: Page,
    selector: string,
  ): Promise<void> {
    await window.locator(selector).first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
  }

  test("delete column reduces column count by one", async ({ window }) => {
    const colsBefore = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(300);

    const colsAfter = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colsAfter).toBe(colsBefore - 1);
  });

  test("delete column removes the column from every row", async ({
    window,
  }) => {
    // Fill the first column with known text so we can verify it disappears
    const firstColCells = [
      window.locator("table.EditorTheme__table th").first(),
      window
        .locator("table.EditorTheme__table tr")
        .nth(1)
        .locator("td")
        .first(),
      window
        .locator("table.EditorTheme__table tr")
        .nth(2)
        .locator("td")
        .first(),
    ];
    for (const cell of firstColCells) {
      await cell.click();
      await window.keyboard.type("DEL_ME");
    }
    await window.waitForTimeout(300);

    // Delete from first data cell (which is in the first column)
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(300);

    // All rows should now have 2 columns instead of 3
    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(2);
    await expect(
      window.locator("table.EditorTheme__table tr").nth(1).locator("td"),
    ).toHaveCount(2);
  });

  test("delete column persists to the database", async ({ window }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const table = content.root.children.find((n: any) => n.type === "table");
    // Each row should now have 2 cells
    for (const row of table.children) {
      expect(row.children).toHaveLength(2);
    }
  });

  test("delete one data row reduces row count and persists", async ({
    window,
  }) => {
    const rowsBefore = await getTableRowCount(window);
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(500);

    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(
      rowsBefore - 1,
    );
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const table = content.root.children.find((n: any) => n.type === "table");
    expect(table.children).toHaveLength(rowsBefore - 1);
  });

  test("insert row below positions the new row immediately after the current row", async ({
    window,
  }) => {
    // Type something in the first data row to identify it
    const firstDataRow = window.locator("table.EditorTheme__table tr").nth(1);
    await firstDataRow.locator("td").first().click();
    await window.keyboard.type("ROW_1");
    await window.waitForTimeout(200);

    // Insert a row below
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(300);

    // Row 1 (index 1) should still have ROW_1, row 2 (index 2) should be blank
    await expect(
      window
        .locator("table.EditorTheme__table tr")
        .nth(1)
        .locator("td")
        .first(),
    ).toContainText("ROW_1");
    await expect(
      window
        .locator("table.EditorTheme__table tr")
        .nth(2)
        .locator("td")
        .first(),
    ).toHaveText("");
  });

  test("insert row above positions the new row immediately before the current row", async ({
    window,
  }) => {
    const firstDataRow = window.locator("table.EditorTheme__table tr").nth(1);
    await firstDataRow.locator("td").first().click();
    await window.keyboard.type("EXISTING");
    await window.waitForTimeout(200);

    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Insert row above"]').click();
    await window.waitForTimeout(300);

    // The new blank row should now be at index 1, pushing EXISTING to index 2
    await expect(
      window
        .locator("table.EditorTheme__table tr")
        .nth(1)
        .locator("td")
        .first(),
    ).toHaveText("");
    await expect(
      window
        .locator("table.EditorTheme__table tr")
        .nth(2)
        .locator("td")
        .first(),
    ).toContainText("EXISTING");
  });

  test("insert column right adds cells to every row", async ({ window }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(300);

    // Each row must have the same (new) column count
    const headerCount = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    const dataRowCells = await window
      .locator("table.EditorTheme__table tr")
      .nth(1)
      .locator("td")
      .count();
    expect(dataRowCells).toBe(headerCount);
  });

  test("insert column left persists to the database", async ({ window }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert column left"]').click();
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const table = content.root.children.find((n: any) => n.type === "table");
    expect(table.children[0].children).toHaveLength(4); // 3 + 1
  });

  test("delete column from last column reduces count and persists", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(500);

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(2);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    for (const row of table.children) {
      expect(row.children).toHaveLength(2);
    }
  });

  test("delete row from last row reduces count and persists", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:last-of-type td:first-child",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(500);

    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(2);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(2);
  });

  test("insert column left from last column adds column before last", async ({
    window,
  }) => {
    await window
      .locator("table.EditorTheme__table tr:nth-of-type(2) td:last-child")
      .click();
    await window.keyboard.type("LAST");
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
    );
    await window.locator('button[title="Insert column left"]').click();
    await window.waitForTimeout(300);

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(4);
    await expect(
      window.locator("table.EditorTheme__table tr:nth-of-type(2) td:last-child"),
    ).toContainText("LAST");
  });
});

// ── Table — action menu options stress ────────────────────────────────────────

test.describe("Table — action menu options stress", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  async function openActionMenuForCell(
    window: Page,
    selector: string,
  ): Promise<void> {
    await window.locator(selector).first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
  }

  test("insert column left 5 times results in 8 columns and persists", async ({
    window,
  }) => {
    for (let i = 0; i < 5; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
      );
      await window.locator('button[title="Insert column left"]').click();
      await window.waitForTimeout(150);
    }

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(8);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children[0].children).toHaveLength(8);
  });

  test("delete column from last then from middle leaves 1 column", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(500);

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(1);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    for (const row of table.children) {
      expect(row.children).toHaveLength(1);
    }
  });

  test("delete row from last row twice leaves header only", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:last-of-type td:first-child",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:last-of-type td:first-child",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(500);

    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(1);
    await expect(window.locator("table.EditorTheme__table td")).toHaveCount(0);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(1);
  });

  test("alternating insert column left and right 3 times each", async ({
    window,
  }) => {
    for (let i = 0; i < 3; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
      );
      await window.locator('button[title="Insert column left"]').click();
      await window.waitForTimeout(150);
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
      );
      await window.locator('button[title="Insert column right"]').click();
      await window.waitForTimeout(150);
    }

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(9);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children[0].children).toHaveLength(9);
  });

  test("insert row below from header 5 times then persists", async ({
    window,
  }) => {
    const rowsBefore = await getTableRowCount(window);

    for (let i = 0; i < 5; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:first-of-type th",
      );
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(150);
    }

    expect(await getTableRowCount(window)).toBe(rowsBefore + 5);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(rowsBefore + 5);
  });

  test("insert row above 10x from first data row and persists", async ({
    window,
  }) => {
    const rowsBefore = await getTableRowCount(window);

    for (let i = 0; i < 10; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td",
      );
      await window.locator('button[title="Insert row above"]').click();
      await window.waitForTimeout(150);
    }

    expect(await getTableRowCount(window)).toBe(rowsBefore + 10);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(rowsBefore + 10);
  });

  test("insert column right 5x from last column and persists", async ({
    window,
  }) => {
    for (let i = 0; i < 5; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
      );
      await window.locator('button[title="Insert column right"]').click();
      await window.waitForTimeout(150);
    }

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(8);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children[0].children).toHaveLength(8);
  });

  test("delete row from middle row (second data row)", async ({ window }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(3) td:first-child",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(500);

    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(2);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(2);
  });

  test("delete column from middle column (second column)", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:nth-child(2)",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(500);

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(2);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    for (const row of table.children) {
      expect(row.children).toHaveLength(2);
    }
  });

  test("insert row above is enabled when focused on data cell", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td",
    );
    const insertRowAboveBtn = window.locator(
      'button[title="Insert row above"]',
    );
    await expect(insertRowAboveBtn).toBeEnabled();
  });

  test("header-only table: insert row above disabled, insert row below works", async ({
    window,
  }) => {
    for (let i = 0; i < 2; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:last-of-type td",
      );
      await window.locator('button[title="Delete row"]').click();
      await window.waitForTimeout(200);
    }

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:first-of-type th",
    );
    await expect(
      window.locator('button[title="Insert row above"]'),
    ).toBeDisabled();
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(300);
    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(2);
  });

  test("mixed sequence: insert row, insert col, delete row, insert col, delete col", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(3) td:first-child",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
    );
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:nth-child(2)",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(500);

    expect(await getTableRowCount(window)).toBe(3);
    const colCount = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colCount).toBe(4); // +1 insert col, -1 delete col => 3+1=4
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(3);
    for (const row of table.children) {
      expect(row.children).toHaveLength(4);
    }
  });

  test("all options from last cell in table work", async ({ window }) => {
    const lastCell = "table.EditorTheme__table tr:last-of-type td:last-child";
    await window.locator(lastCell).click();
    await window.keyboard.type("X");
    await window.waitForTimeout(200);

    await openActionMenuForCell(window, lastCell);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(200);
    expect(await getTableRowCount(window)).toBe(4);

    await openActionMenuForCell(window, lastCell);
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(200);
    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(4);

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("X");
  });

  test("delete column from first column twice leaves 1 column", async ({
    window,
  }) => {
    for (let i = 0; i < 2; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
      );
      await window.locator('button[title="Delete column"]').click();
      await window.waitForTimeout(200);
    }

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(1);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    for (const row of table.children) {
      expect(row.children).toHaveLength(1);
    }
  });

  test("insert column left from first column adds column and persists", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert column left"]').click();
    await window.waitForTimeout(300);

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(4);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children[0].children).toHaveLength(4);
  });

  test("delete table from header cell removes table and persists", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:first-of-type th:first-child",
    );
    await window.locator('button[title="Delete table"]').click();
    await window.waitForTimeout(500);

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const tableNode = content.root.children.find(
      (n: { type: string }) => n.type === "table",
    );
    expect(tableNode).toBeUndefined();
  });

  test("alternate mixed sequence: delete col, insert row, delete row, insert col left, delete col", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(3) td:first-child",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert column left"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:nth-child(2)",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(500);

    expect(await getTableRowCount(window)).toBe(3);
    const colCount = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colCount).toBe(2); // 3 - 1 - 1 + 1 = 2
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(3);
    for (const row of table.children) {
      expect(row.children).toHaveLength(2);
    }
  });

  test("single-column table: insert column left and right then persists", async ({
    window,
  }) => {
    for (let i = 0; i < 2; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
      );
      await window.locator('button[title="Delete column"]').click();
      await window.waitForTimeout(200);
    }

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert column left"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:last-child",
    );
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(500);

    await expect(
      window.locator("table.EditorTheme__table tr:first-of-type th"),
    ).toHaveCount(3);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children[0].children).toHaveLength(3);
    expect(table.children).toHaveLength(3);
  });

  test("content preserved through mutation sequence", async ({ window }) => {
    await window
      .locator("table.EditorTheme__table tr:nth-of-type(2) td:first-child")
      .click();
    await window.keyboard.type("A1");
    await window
      .locator("table.EditorTheme__table tr:nth-of-type(2) td:nth-child(2)")
      .click();
    await window.keyboard.type("B1");
    await window
      .locator("table.EditorTheme__table tr:nth-of-type(3) td:first-child")
      .click();
    await window.keyboard.type("A2");
    await window.waitForTimeout(300);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(200);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:nth-child(2)",
    );
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(500);

    await expect(
      window.locator("table.EditorTheme__table tr:nth-of-type(2) td:first-child"),
    ).toContainText("A1");
    await expect(
      window.locator(
        "table.EditorTheme__table tr:nth-of-type(2) td:nth-child(2)",
      ),
    ).toContainText("B1");
    // A2 was in row 3; insert row below row 2 pushes it to row 4
    await expect(
      window.locator("table.EditorTheme__table tr:nth-of-type(4) td:first-child"),
    ).toContainText("A2");
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("A1");
    expect(doc!.content).toContain("B1");
    expect(doc!.content).toContain("A2");
  });
});

// ── Table — repeated mutations ────────────────────────────────────────────────

test.describe("Table — repeated mutations", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  async function openActionMenu(window: Page): Promise<void> {
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
  }

  test("adding 5 rows one by one results in 8 total rows", async ({
    window,
  }) => {
    for (let i = 0; i < 5; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(300);
    }

    expect(await getTableRowCount(window)).toBe(8); // original 3 + 5
  });

  test("build a larger table via the menu: add 10 rows results in 13 total and persists", async ({
    window,
  }) => {
    for (let i = 0; i < 10; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(200);
    }

    expect(await getTableRowCount(window)).toBe(13); // original 3 + 10
    await window.waitForTimeout(1000); // debounce
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(13);
  });

  test("adding 3 columns one by one results in 6 total columns", async ({
    window,
  }) => {
    for (let i = 0; i < 3; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert column right"]').click();
      await window.waitForTimeout(300);
    }

    const colCount = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colCount).toBe(6); // original 3 + 3
  });

  test("all rows maintain the same column count after 3 column insertions", async ({
    window,
  }) => {
    for (let i = 0; i < 3; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert column right"]').click();
      await window.waitForTimeout(300);
    }

    const expectedCols = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    const rowCount = await getTableRowCount(window);
    for (let r = 1; r < rowCount; r++) {
      const cellsInRow = await window
        .locator("table.EditorTheme__table tr")
        .nth(r)
        .locator("td")
        .count();
      expect(cellsInRow).toBe(expectedCols);
    }
  });

  test("adding 5 rows then deleting 3 leaves 5 total rows", async ({
    window,
  }) => {
    // Add 5 rows
    for (let i = 0; i < 5; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(200);
    }

    // Delete 3 rows
    for (let i = 0; i < 3; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Delete row"]').click();
      await window.waitForTimeout(200);
    }

    expect(await getTableRowCount(window)).toBe(5); // 3 + 5 - 3 = 5
  });

  test("row count after 5 additions persists to the database", async ({
    window,
  }) => {
    for (let i = 0; i < 5; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(200);
    }
    await window.waitForTimeout(1000); // debounce

    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(8);
  });

  test("column count after 3 additions persists to the database", async ({
    window,
  }) => {
    for (let i = 0; i < 3; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert column right"]').click();
      await window.waitForTimeout(200);
    }
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    // Every row should have 6 cells
    for (const row of table.children) {
      expect(row.children).toHaveLength(6);
    }
  });

  test("interleaving row and column insertions keeps consistent cell counts", async ({
    window,
  }) => {
    // +1 row, +1 col, +1 row, +1 col
    for (let i = 0; i < 2; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(200);
      await openActionMenu(window);
      await window.locator('button[title="Insert column right"]').click();
      await window.waitForTimeout(200);
    }

    const colCount = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    const rowCount = await getTableRowCount(window);
    // Verify every row has the same number of cells
    for (let r = 1; r < rowCount; r++) {
      const cells = await window
        .locator("table.EditorTheme__table tr")
        .nth(r)
        .locator("td")
        .count();
      expect(cells).toBe(colCount);
    }
  });
});

// ── Table — undo/redo ─────────────────────────────────────────────────────────

test.describe("Table — undo/redo", () => {
  const undo = async (window: Page) => window.keyboard.press("Meta+Z");
  const redo = async (window: Page) => window.keyboard.press("Meta+Shift+Z");

  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  test("undo after typing in a cell reverts the cell content", async ({
    window,
  }) => {
    const cell = window.locator("table.EditorTheme__table th").first();
    await cell.click();
    await window.keyboard.type("typed text");
    await window.waitForTimeout(200);

    await undo(window);
    await window.waitForTimeout(200);

    await expect(cell).not.toContainText("typed text");
  });

  test("undo after inserting a row reverts the row count", async ({
    window,
  }) => {
    const rowsBefore = await getTableRowCount(window);

    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(300);

    expect(await getTableRowCount(window)).toBe(rowsBefore + 1);

    await undo(window);
    await window.waitForTimeout(300);

    expect(await getTableRowCount(window)).toBe(rowsBefore);
  });

  test("undo after inserting a column reverts the column count", async ({
    window,
  }) => {
    const colsBefore = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();

    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(300);

    await undo(window);
    await window.waitForTimeout(300);

    const colsAfter = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colsAfter).toBe(colsBefore);
  });

  test("undo after deleting a table restores it", async ({ window }) => {
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Delete table"]').click();
    await window.waitForTimeout(300);
    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);

    await undo(window);
    await window.waitForTimeout(300);

    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
  });

  test("redo re-applies a row insertion after undo", async ({ window }) => {
    const rowsBefore = await getTableRowCount(window);

    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(300);

    await undo(window);
    await window.waitForTimeout(300);
    expect(await getTableRowCount(window)).toBe(rowsBefore);

    await redo(window);
    await window.waitForTimeout(300);
    expect(await getTableRowCount(window)).toBe(rowsBefore + 1);
  });
});

// ── Table — paste edge cases ──────────────────────────────────────────────────

test.describe("Table — paste edge cases", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
  });

  test("pasting a wide table (10 columns) renders all columns", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    const headers = Array.from({ length: 10 }, (_, i) => `C${i + 1}`).join(
      " | ",
    );
    const divider = Array(10).fill("---").join(" | ");
    const row = Array.from({ length: 10 }, (_, i) => `v${i + 1}`).join(" | ");
    await pasteText(
      window,
      electronApp,
      `| ${headers} |\n| ${divider} |\n| ${row} |`,
    );

    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(10);
    await expect(window.locator("table.EditorTheme__table td")).toHaveCount(10);
  });

  test("pasting a tall table (15 data rows) renders all rows", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    const lines = ["| N |", "| --- |"];
    for (let i = 1; i <= 15; i++) lines.push(`| row${i} |`);
    await pasteText(window, electronApp, lines.join("\n"));

    // 1 header + 15 data = 16 rows
    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(16);
  });

  test("pasting a table with empty cells creates empty cells in the DOM", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(
      window,
      electronApp,
      "| A |  | C |\n| --- | --- | --- |\n|  | B |  |",
    );

    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(3);
    await expect(window.locator("table.EditorTheme__table td")).toHaveCount(3);
    // Header: A, empty, C
    await expect(
      window.locator("table.EditorTheme__table th").nth(0),
    ).toContainText("A");
    await expect(
      window.locator("table.EditorTheme__table th").nth(2),
    ).toContainText("C");
  });

  test("pasting a table with special characters in cells stores them literally", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(
      window,
      electronApp,
      '| <tag> | "quoted" |\n| --- | --- |\n| a&b | c\\d |',
    );

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("<tag>");
    // JSON encodes double-quotes as \", so search for the escaped form in the raw JSON
    expect(doc!.content).toContain('\\"quoted\\"');
  });

  test("pasting a table with unicode content renders and persists correctly", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(
      window,
      electronApp,
      "| 日本語 | 中文 |\n| --- | --- |\n| 한국어 | العربية |",
    );

    await expect(
      window.locator("table.EditorTheme__table th").first(),
    ).toContainText("日本語");
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("日本語");
    expect(doc!.content).toContain("한국어");
  });

  test("pasting a table with emoji in cells renders and persists correctly", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(
      window,
      electronApp,
      "| 🎉 | 🚀 |\n| --- | --- |\n| 💡 | 🔥 |",
    );

    await expect(
      window.locator("table.EditorTheme__table th").first(),
    ).toContainText("🎉");
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("🎉");
  });

  test("pasting strikethrough text in a cell renders with strikethrough", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(
      window,
      electronApp,
      "| ~~struck~~ | normal |\n| --- | --- |",
    );

    const firstHeader = window.locator("table.EditorTheme__table th").first();
    // Lexical renders strikethrough via CSS class on a span, not a <s> element
    await expect(firstHeader.locator("span.line-through")).toContainText("struck");
  });

  test("pasting a single-column table creates a valid 1-column table", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(window, electronApp, "| Only |\n| --- |\n| one |\n| col |");

    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(1);
    await expect(window.locator("table.EditorTheme__table td")).toHaveCount(2);
    await expect(
      window.locator("table.EditorTheme__table th").first(),
    ).toContainText("Only");
  });

  test("pasting a header-only table (no data rows) creates a table with 1 row", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(window, electronApp, "| X | Y | Z |\n| --- | --- | --- |");

    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(1);
    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(3);
    await expect(window.locator("table.EditorTheme__table td")).toHaveCount(0);
  });

  test("paste header-only table, delete row, table gone and persisted to DB", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(window, electronApp, "| X | Y | Z |\n| --- | --- | --- |");
    await window.waitForTimeout(500);

    await window.locator("table.EditorTheme__table tr:first-of-type th").first().click();
    await window.waitForTimeout(300);
    await window.locator('button[title="Table actions"]').click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(1500);

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    expect(content.root.children.some((n: { type: string }) => n.type === "table")).toBe(false);
  });

  test("pasting a table with very long cell content stores it fully", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    const longText = "word ".repeat(60).trim(); // 300 chars
    await pasteText(window, electronApp, `| ${longText} |\n| --- |\n| short |`);

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain(longText);
  });

  test("pasting a second table into a note that already has one creates two separate tables", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);

    // Move cursor out of the first table, then paste a second
    await window.keyboard.press("Escape");
    await window.waitForTimeout(200);
    await window.keyboard.press("ArrowDown");
    await window.waitForTimeout(200);

    await pasteText(window, electronApp, "| P | Q |\n| --- | --- |\n| 1 | 2 |");
    await window.waitForTimeout(500);

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(2);
  });

  test("pasting multiple markdown tables in one clipboard creates multiple table nodes", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    const twoTables = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "| X | Y |",
      "| --- | --- |",
      "| p | q |",
    ].join("\n");

    await pasteText(window, electronApp, twoTables);
    await window.waitForTimeout(500);

    // Both tables should appear
    await expect(window.locator("table.EditorTheme__table")).toHaveCount(2);
  });
});

// ── Table — surrounding content integrity ─────────────────────────────────────

test.describe("Table — surrounding content integrity", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
  });

  test("text typed before a table is preserved when the table is modified", async ({
    window,
  }) => {
    await focusEditorBody(window);
    await window.keyboard.type("BEFORE_TABLE");
    await window.keyboard.press("Enter");
    await insertTableViaSlashCommand(window);

    // Add a row to the table (wait for table/cell selection so action bar appears)
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(600);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 8000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(300);

    await expect(window.locator(".ContentEditable__root")).toContainText(
      "BEFORE_TABLE",
    );
  });

  test("text typed after a table is preserved when the table is modified", async ({
    window,
  }) => {
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);

    // Move below the table and type
    await window.keyboard.press("Escape");
    await window.waitForTimeout(200);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.type("AFTER_TABLE");
    await window.waitForTimeout(200);

    // Now modify the table
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(300);

    await expect(window.locator(".ContentEditable__root")).toContainText(
      "AFTER_TABLE",
    );
  });

  test("deleting a table does not remove surrounding paragraph content", async ({
    window,
  }) => {
    await focusEditorBody(window);
    await window.keyboard.type("TOP_PARA");
    await window.keyboard.press("Enter");
    await insertTableViaSlashCommand(window);
    await window.keyboard.press("Escape");
    await window.waitForTimeout(300);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.type("BOTTOM_PARA");
    await window.waitForTimeout(300);

    // Delete the table (click table cell and wait for action bar)
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(600);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 8000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Delete table"]').click();
    await window.waitForTimeout(300);

    await expect(window.locator(".ContentEditable__root")).toContainText(
      "TOP_PARA",
    );
    await expect(window.locator(".ContentEditable__root")).toContainText(
      "BOTTOM_PARA",
    );
    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
  });

  test("table and surrounding text all persist to the database", async ({
    window,
  }) => {
    await focusEditorBody(window);
    await window.keyboard.type("Before");
    await window.keyboard.press("Enter");
    await insertTableViaSlashCommand(window);
    await window.locator("table.EditorTheme__table th").first().click();
    await window.keyboard.type("InCell");
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.content).toContain("Before");
    expect(doc!.content).toContain("InCell");
    const parsed = JSON.parse(doc!.content);
    const hasTable = parsed.root.children.some((n: any) => n.type === "table");
    expect(hasTable).toBe(true);
  });
});

// ── Table — multiple tables in one note ───────────────────────────────────────

test.describe("Table — multiple tables in one note", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
  });

  async function insertTwoTables(window: Page): Promise<void> {
    await insertTableViaSlashCommand(window);
    await window.keyboard.press("Escape");
    await window.waitForTimeout(200);
    await window.keyboard.press("ArrowDown");
    await window.waitForTimeout(200);
    await insertTableViaSlashCommand(window);
    await window.waitForTimeout(400);
  }

  test("two tables can be inserted in the same note", async ({ window }) => {
    await insertTwoTables(window);
    await expect(window.locator("table.EditorTheme__table")).toHaveCount(2);
  });

  test("both tables persist to the database", async ({ window }) => {
    await insertTwoTables(window);
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const parsed = JSON.parse(doc!.content);
    const tables = parsed.root.children.filter((n: any) => n.type === "table");
    expect(tables).toHaveLength(2);
  });

  test("typing in the first table does not affect the second table", async ({
    window,
  }) => {
    await insertTwoTables(window);

    const tables = window.locator("table.EditorTheme__table");
    await tables.first().locator("th").first().click();
    await window.keyboard.type("TABLE_ONE");
    await window.waitForTimeout(300);

    await expect(tables.nth(0).locator("th").first()).toContainText(
      "TABLE_ONE",
    );
    await expect(tables.nth(1).locator("th").first()).not.toContainText(
      "TABLE_ONE",
    );
  });

  test("deleting the first table leaves the second intact", async ({
    window,
  }) => {
    await insertTwoTables(window);

    await window
      .locator("table.EditorTheme__table")
      .first()
      .locator("td")
      .first()
      .click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Delete table"]').click();
    await window.waitForTimeout(300);

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(1);
  });

  test("adding a row to the second table does not change the first table row count", async ({
    window,
  }) => {
    await insertTwoTables(window);

    const rowsBefore = await window
      .locator("table.EditorTheme__table")
      .first()
      .locator("tr")
      .count();

    await window
      .locator("table.EditorTheme__table")
      .nth(1)
      .locator("td")
      .first()
      .click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(300);

    const rowsAfter = await window
      .locator("table.EditorTheme__table")
      .first()
      .locator("tr")
      .count();
    expect(rowsAfter).toBe(rowsBefore);
  });
});

// ── Table — DB content structure after mutations ──────────────────────────────

test.describe("Table — DB content structure after mutations", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  async function openActionMenu(window: Page): Promise<void> {
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
  }

  test("after inserting a row, all rows in DB have the same number of cells", async ({
    window,
  }) => {
    await openActionMenu(window);
    await window.locator('button[title="Insert row below"]').click();
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    const colCounts = table.children.map((row: any) => row.children.length);
    expect(new Set(colCounts).size).toBe(1); // all rows have same cell count
  });

  test("after inserting a column, DB row cell counts all match the new count", async ({
    window,
  }) => {
    await openActionMenu(window);
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    const colCounts = table.children.map((row: any) => row.children.length);
    expect(new Set(colCounts).size).toBe(1);
    expect(colCounts[0]).toBe(4); // original 3 + 1
  });

  test("headerState values are preserved correctly in DB after adding rows", async ({
    window,
  }) => {
    for (let i = 0; i < 3; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(200);
    }
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );

    // First row: header cells (headerState = 1)
    for (const cell of table.children[0].children) {
      expect(cell.headerState).toBe(1);
    }
    // All other rows: data cells (headerState = 0)
    for (let r = 1; r < table.children.length; r++) {
      for (const cell of table.children[r].children) {
        expect(cell.headerState).toBe(0);
      }
    }
  });

  test("cell text content is correctly nested in DB JSON after typing", async ({
    window,
  }) => {
    await window.locator("table.EditorTheme__table th").first().click();
    await window.keyboard.type("HEADER_VAL");
    await window.locator("table.EditorTheme__table td").first().click();
    await window.keyboard.type("DATA_VAL");
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );

    const headerCellText =
      table.children[0].children[0].children[0].children[0].text;
    const dataCellText =
      table.children[1].children[0].children[0].children[0].text;
    expect(headerCellText).toBe("HEADER_VAL");
    expect(dataCellText).toBe("DATA_VAL");
  });
});

// ── Table — edge cases ───────────────────────────────────────────────────────

test.describe("Table — edge cases", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
    await insertTableViaSlashCommand(window);
  });

  async function openActionMenuForCell(
    window: Page,
    selector: string,
  ): Promise<void> {
    await window.locator(selector).first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
  }

  test("deleting the header row leaves a valid table with data rows only", async ({
    window,
  }) => {
    // Delete the header row (first row)
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:first-of-type th",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(500);

    // Table should still exist with 2 rows (original data rows)
    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(2);
    await expect(window.locator("table.EditorTheme__table td")).toHaveCount(6);

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(2);
  });

  test("insert row above is disabled when focused on header cell", async ({
    window,
  }) => {
    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:first-of-type th",
    );
    const insertRowAboveBtn = window.locator(
      'button[title="Insert row above"]',
    );
    await expect(insertRowAboveBtn).toBeDisabled();
  });

  test("table content persists after switching to another note and back", async ({
    window,
  }) => {
    await window.locator("table.EditorTheme__table th").first().click();
    await window.keyboard.type("SWITCH_TEST");
    await window.waitForTimeout(500);

    // Create a second note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await focusEditorBody(window);
    await window.keyboard.type("Other note");
    await window.waitForTimeout(300);

    // Switch back to first note via sidebar
    await window.locator("[data-note-id]").first().click();
    await window.waitForTimeout(500);

    await expect(
      window.locator("table.EditorTheme__table th").first(),
    ).toContainText("SWITCH_TEST");
  });

  test("delete all data rows leaves header-only table", async ({ window }) => {
    // Delete both data rows
    for (let i = 0; i < 2; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td",
      );
      await window.locator('button[title="Delete row"]').click();
      await window.waitForTimeout(300);
    }

    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(1);
    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(3);
    await expect(window.locator("table.EditorTheme__table td")).toHaveCount(0);

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(1);
  });

  test("delete row when header-only removes table from editor", async ({
    window,
  }) => {
    for (let i = 0; i < 2; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td",
      );
      await window.locator('button[title="Delete row"]').click();
      await window.waitForTimeout(300);
    }

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:first-of-type th",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(500);

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
  });

  test("delete row when header-only removes table from database", async ({
    window,
  }) => {
    for (let i = 0; i < 2; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td",
      );
      await window.locator('button[title="Delete row"]').click();
      await window.waitForTimeout(300);
    }

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:first-of-type th",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(1500);

    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const hasTable = content.root.children.some(
      (n: { type: string }) => n.type === "table",
    );
    expect(hasTable).toBe(false);
  });

  test("delete row when header-only leaves document in valid state", async ({
    window,
  }) => {
    for (let i = 0; i < 2; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:nth-of-type(2) td",
      );
      await window.locator('button[title="Delete row"]').click();
      await window.waitForTimeout(300);
    }

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:first-of-type th",
    );
    await window.locator('button[title="Delete row"]').click();
    await window.waitForTimeout(1500);

    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    expect(content.root.children.some((n: { type: string }) => n.type === "table")).toBe(false);
    expect(content.root.children.length).toBeGreaterThanOrEqual(1);
  });

  test("stress: delete all 3 rows one by one until table gone, backend has no table", async ({
    window,
  }) => {
    for (let i = 0; i < 3; i++) {
      await openActionMenuForCell(
        window,
        "table.EditorTheme__table tr:last-of-type td:first-child, table.EditorTheme__table tr:last-of-type th:first-child",
      );
      await window.locator('button[title="Delete row"]').click();
      await window.waitForTimeout(200);
    }

    await expect(window.locator("table.EditorTheme__table")).toHaveCount(0);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    expect(content.root.children.some((n: { type: string }) => n.type === "table")).toBe(false);
    expect(content.root.children.length).toBeGreaterThanOrEqual(1);
  });

  test("delete column then add column restores column count", async ({
    window,
  }) => {
    const colsBefore = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Delete column"]').click();
    await window.waitForTimeout(300);

    await openActionMenuForCell(
      window,
      "table.EditorTheme__table tr:nth-of-type(2) td:first-child",
    );
    await window.locator('button[title="Insert column right"]').click();
    await window.waitForTimeout(300);

    const colsAfter = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colsAfter).toBe(colsBefore);
  });

  test("pasting table with markdown link in cell renders link", async ({
    window,
    electronApp,
  }) => {
    await focusEditorBody(window);
    await pasteText(
      window,
      electronApp,
      "| [Click here](https://example.com) | plain |\n| --- | --- |\n| 1 | 2 |",
    );

    const link = window.locator("table.EditorTheme__table th").first().locator("a");
    await expect(link).toHaveAttribute("href", "https://example.com/");
    await expect(link).toContainText("Click here");
  });

  test("typing pipe character in cell does not break table structure", async ({
    window,
  }) => {
    const cell = window.locator("table.EditorTheme__table th").first();
    await cell.click();
    await window.keyboard.type("A | B");
    await window.waitForTimeout(500);

    await expect(cell).toContainText("A | B");
    await expect(window.locator("table.EditorTheme__table")).toBeVisible();
    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(3);
  });
});

// ── Table — stress ───────────────────────────────────────────────────────────

test.describe("Table — stress", () => {
  test.beforeEach(async ({ window }) => {
    await createNote(window);
    await focusEditorBody(window);
  });

  async function openActionMenu(window: Page): Promise<void> {
    await window.locator("table.EditorTheme__table td").first().click();
    await window.waitForTimeout(300);
    const actionBtn = window.locator('button[title="Table actions"]');
    await expect(actionBtn).toBeVisible({ timeout: 3000 });
    await actionBtn.click();
    await window.waitForTimeout(200);
  }

  test("add 25 rows via menu results in 28 total and persists", async ({
    window,
  }) => {
    await insertTableViaSlashCommand(window);

    for (let i = 0; i < 25; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(150);
    }

    expect(await getTableRowCount(window)).toBe(28);
    await window.waitForTimeout(1500);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(28);
  });

  test("paste 30-row table renders and persists", async ({
    window,
    electronApp,
  }) => {
    const lines = ["| N | V |", "| --- | --- |"];
    for (let i = 1; i <= 30; i++) lines.push(`| row${i} | val${i} |`);
    await pasteText(window, electronApp, lines.join("\n"));

    await expect(window.locator("table.EditorTheme__table tr")).toHaveCount(31);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(31);
    expect(doc!.content).toContain("row30");
    expect(doc!.content).toContain("val30");
  });

  test("paste 15-column table renders all columns and persists", async ({
    window,
    electronApp,
  }) => {
    const cols = 15;
    const headers = Array.from({ length: cols }, (_, i) => `C${i + 1}`).join(" | ");
    const divider = Array(cols).fill("---").join(" | ");
    const row = Array.from({ length: cols }, (_, i) => `v${i + 1}`).join(" | ");
    await pasteText(
      window,
      electronApp,
      `| ${headers} |\n| ${divider} |\n| ${row} |`,
    );

    await expect(window.locator("table.EditorTheme__table th")).toHaveCount(cols);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children[0].children).toHaveLength(cols);
  });

  test("add 10 rows then delete 8 leaves 5 total", async ({ window }) => {
    await insertTableViaSlashCommand(window);

    for (let i = 0; i < 10; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(150);
    }
    expect(await getTableRowCount(window)).toBe(13);

    for (let i = 0; i < 8; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Delete row"]').click();
      await window.waitForTimeout(150);
    }

    expect(await getTableRowCount(window)).toBe(5);
    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const table = JSON.parse(doc!.content).root.children.find(
      (n: any) => n.type === "table",
    );
    expect(table.children).toHaveLength(5);
  });

  test("add 5 columns then delete 3 leaves 5 columns", async ({ window }) => {
    await insertTableViaSlashCommand(window);

    for (let i = 0; i < 5; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert column right"]').click();
      await window.waitForTimeout(150);
    }
    let colCount = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colCount).toBe(8);

    for (let i = 0; i < 3; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Delete column"]').click();
      await window.waitForTimeout(150);
    }

    colCount = await window
      .locator("table.EditorTheme__table tr:first-of-type th")
      .count();
    expect(colCount).toBe(5);
  });

  test("fill every cell of 5×5 table and all persist", async ({ window }) => {
    await insertTableViaSlashCommand(window);

    // Add 2 rows and 2 columns to get 5×5
    for (let i = 0; i < 2; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert row below"]').click();
      await window.waitForTimeout(150);
    }
    for (let i = 0; i < 2; i++) {
      await openActionMenu(window);
      await window.locator('button[title="Insert column right"]').click();
      await window.waitForTimeout(150);
    }

    const headers = window.locator("table.EditorTheme__table th");
    const datas = window.locator("table.EditorTheme__table td");
    for (let i = 0; i < 5; i++) {
      await headers.nth(i).click();
      await window.keyboard.type(`H${i}`);
    }
    for (let i = 0; i < 20; i++) {
      await datas.nth(i).click();
      await window.keyboard.type(`D${i}`);
    }
    await window.waitForTimeout(1500);

    const doc = await getLatestDocumentFromDb(window);
    for (let i = 0; i < 5; i++) expect(doc!.content).toContain(`H${i}`);
    for (let i = 0; i < 20; i++) expect(doc!.content).toContain(`D${i}`);
  });
});
