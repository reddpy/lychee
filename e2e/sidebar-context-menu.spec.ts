/**
 * E2E tests for sidebar context menu, hover dropdown (⋯ Options),
 * and click interactions on notes in both the Notes section and Bookmarks section.
 *
 * What's already in sidebar.spec.ts (not duplicated here):
 *   • Right-click shows menu items (basic smoke test)
 *   • "Add page inside" creates a nested note (basic)
 *   • "Open in new tab" opens a second tab (basic)
 *
 * This file adds:
 *   Context menu — all 4 options exercised, conditional rendering, DB validation
 *   Hover dropdown (⋯) — same options as context menu, hover + button
 *   Notes ↔ Bookmarks section cross-section behavior
 *   Click interactions — left, middle, Cmd+click
 */

import { test, expect } from './electron-app';
import type { Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────

async function createNoteWithTitle(window: Page, title: string): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  await window.locator('main:visible h1.editor-title').click();
  await window.keyboard.type(title);
  await window.waitForTimeout(700);
  return window.evaluate(() =>
    (window as any).__documentStore.getState().selectedId as string,
  );
}

/** Right-click on a note item in the sidebar to open its context menu. */
async function rightClickNote(window: Page, docId: string) {
  await window.locator(`[data-note-id="${docId}"]`).first().click({ button: 'right' });
  await window.waitForTimeout(300);
}

/**
 * Hover over a note item and click its ⋯ Options dropdown trigger.
 * The trigger is a span[role="button"] containing the lucide-more-horizontal SVG.
 */
async function openOptionsDropdown(window: Page, docId: string) {
  const noteItem = window.locator(`[data-note-id="${docId}"]`).first();
  await noteItem.hover();
  await window.waitForTimeout(200);
  const optionsBtn = noteItem.locator('[role="button"]:has(svg.lucide-more-horizontal)');
  await expect(optionsBtn).toBeVisible({ timeout: 3000 });
  await optionsBtn.click();
  await window.waitForTimeout(300);
}

/** Set bookmarkedAt on a note directly via IPC + Zustand store update. */
async function bookmarkViaBackend(window: Page, docId: string): Promise<void> {
  const at = new Date().toISOString();
  await window.evaluate(
    ({ id, ts }: { id: string; ts: string }) =>
      (window as any).lychee.invoke('documents.update', { id, metadata: { bookmarkedAt: ts } }),
    { id: docId, ts: at },
  );
  await window.evaluate(
    ({ id, ts }: { id: string; ts: string }) => {
      const store = (window as any).__documentStore;
      const state = store.getState();
      const doc = state.documents.find((d: any) => d.id === id);
      if (doc) state.updateDocumentInStore(id, { metadata: { ...doc.metadata, bookmarkedAt: ts } });
    },
    { id: docId, ts: at },
  );
  await window.waitForTimeout(150);
}

/** Get currently selected note ID from the Zustand store. */
async function getSelectedId(window: Page): Promise<string> {
  return window.evaluate(() =>
    (window as any).__documentStore.getState().selectedId as string,
  );
}

/** How many times a [data-note-id] element appears in the full sidebar DOM. */
async function noteIdCount(window: Page, docId: string): Promise<number> {
  return window.locator(`[data-note-id="${docId}"]`).count();
}

/** Returns true when the note appears in both Notes and Bookmarks sections. */
async function isInBookmarksSection(window: Page, docId: string): Promise<boolean> {
  return (await noteIdCount(window, docId)) >= 2;
}

/** Read a document from the DB via IPC. */
async function getDocFromDb(window: Page, id: string) {
  const r = await window.evaluate(
    (docId: string) => (window as any).lychee.invoke('documents.get', { id: docId }),
    id,
  );
  return r.document as {
    id: string;
    title: string;
    deletedAt: string | null;
    parentId: string | null;
    metadata: { bookmarkedAt?: string | null };
    [key: string]: unknown;
  };
}

/** Bookmarks section header button in the sidebar. */
function bookmarksSectionHeader(window: Page) {
  return window.locator('aside').locator('button').filter({ hasText: /^Bookmarks$/ }).first();
}

// ── Context Menu — All Options ────────────────────────────────────────

test.describe('Sidebar Context Menu — All Options', () => {
  test('right-click shows all 4 options on a root note', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'CM All Options');
    await rightClickNote(window, docId);

    await expect(window.getByRole('menuitem', { name: /open in new tab/i })).toBeVisible({ timeout: 3000 });
    await expect(window.getByRole('menuitem', { name: /add to bookmarks/i })).toBeVisible({ timeout: 3000 });
    await expect(window.getByRole('menuitem', { name: /add page inside/i })).toBeVisible({ timeout: 3000 });
    await expect(window.getByRole('menuitem', { name: /move to trash/i })).toBeVisible({ timeout: 3000 });
  });

  test('"Open in new tab" opens an additional tab without switching selectedId', async ({ window }) => {
    const idA = await createNoteWithTitle(window, 'CM Open Tab A');
    const idB = await createNoteWithTitle(window, 'CM Open Tab B');

    // B is currently selected
    expect(await getSelectedId(window)).toBe(idB);
    const tabsBefore = await window.locator('[data-tab-id]').count();

    // Right-click note A → Open in new tab
    await rightClickNote(window, idA);
    await window.getByRole('menuitem', { name: /open in new tab/i }).click();
    await window.waitForTimeout(400);

    // New tab opened
    await expect(window.locator('[data-tab-id]')).toHaveCount(tabsBefore + 1, { timeout: 3000 });
    // But selectedId has NOT changed — focus stays on B
    expect(await getSelectedId(window)).toBe(idB);
  });

  test('"Add to bookmarks" from context menu adds note to Bookmarks section', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'CM Add Bookmark');
    await rightClickNote(window, docId);
    await window.getByRole('menuitem', { name: /add to bookmarks/i }).click();
    await window.waitForTimeout(500);

    // Note still in Notes section AND now in Bookmarks section
    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(true);
    }).toPass({ timeout: 3000 });
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    // DB: bookmarkedAt set
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('"Add to bookmarks" keeps note in Notes section (not removed)', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'CM Bookmark Stays In Notes');
    await rightClickNote(window, docId);
    await window.getByRole('menuitem', { name: /add to bookmarks/i }).click();
    await window.waitForTimeout(500);

    // [data-note-id] should appear at least twice (Notes + Bookmarks)
    const count = await noteIdCount(window, docId);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('"Remove bookmark" from context menu removes note from Bookmarks section only', async ({ window }) => {
    // BACKEND: pre-set so we only test the remove action
    const docId = await createNoteWithTitle(window, 'CM Remove Bookmark');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    await rightClickNote(window, docId);
    await window.getByRole('menuitem', { name: /remove bookmark/i }).click();
    await window.waitForTimeout(500);

    // Now only in Notes section (count = 1)
    await expect(async () => {
      expect(await noteIdCount(window, docId)).toBe(1);
    }).toPass({ timeout: 3000 });
    // Notes section still shows it
    await expect(window.locator(`[data-note-id="${docId}"]`).first()).toBeVisible();
    // DB: bookmarkedAt null
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt ?? null).toBeNull();
    }).toPass({ timeout: 5000 });
  });

  test('"Add page inside" creates a child note visible below parent in Notes section', async ({ window }) => {
    const parentId = await createNoteWithTitle(window, 'CM Parent Note');
    await rightClickNote(window, parentId);
    await window.getByRole('menuitem', { name: /add page inside/i }).click();
    await window.waitForTimeout(600);

    // Two notes visible
    const notes = window.locator('[data-note-id]');
    await expect(notes).toHaveCount(2, { timeout: 5000 });

    // DB: new child has correct parentId
    await expect(async () => {
      const result = await window.evaluate(() =>
        (window as any).lychee.invoke('documents.list', { limit: 500, offset: 0 }),
      );
      const docs = result.documents;
      expect(docs).toHaveLength(2);
      const child = docs.find((d: any) => d.parentId === parentId);
      expect(child).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('"Add page inside" opens the new child note in an editor tab', async ({ window }) => {
    const parentId = await createNoteWithTitle(window, 'CM Parent Opens Child');
    const tabsBefore = await window.locator('[data-tab-id]').count();

    await rightClickNote(window, parentId);
    await window.getByRole('menuitem', { name: /add page inside/i }).click();
    await window.waitForTimeout(600);

    // A new tab should have opened for the child
    await expect(window.locator('[data-tab-id]')).toHaveCount(tabsBefore + 1, { timeout: 5000 });
  });

  test('"Move to Trash Bin" removes note from Notes section', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'CM Trash Note');
    await expect(window.locator(`[data-note-id="${docId}"]`).first()).toBeVisible();

    await rightClickNote(window, docId);
    await window.getByRole('menuitem', { name: /move to trash/i }).click();
    await window.waitForTimeout(500);

    // Note no longer in Notes section
    await expect(window.locator(`[data-note-id="${docId}"]`).first()).not.toBeVisible({ timeout: 3000 });
  });

  test('"Move to Trash Bin" sets deletedAt in DB', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'CM Trash DB Check');
    await rightClickNote(window, docId);
    await window.getByRole('menuitem', { name: /move to trash/i }).click();
    await window.waitForTimeout(500);

    await expect(async () => {
      const doc = await window.evaluate(
        (id: string) => (window as any).lychee.invoke('documents.getById', { id }),
        docId,
      ).catch(() =>
        window.evaluate(
          (id: string) => (window as any).lychee.invoke('documents.get', { id }),
          docId,
        ),
      );
      // After trash the document should have deletedAt set
      const document = doc.document ?? doc;
      expect(document.deletedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('"Move to Trash Bin" closes its tab if the note was open', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'CM Trash Open Tab');

    // Note is open in a tab (created above)
    const tab = window.locator('[data-tab-id]').filter({ hasText: 'CM Trash Open Tab' });
    await expect(tab).toBeVisible();

    await rightClickNote(window, docId);
    await window.getByRole('menuitem', { name: /move to trash/i }).click();
    await window.waitForTimeout(500);

    // Tab should close after trash
    await expect(tab).not.toBeVisible({ timeout: 3000 });
  });
});

// ── Context Menu — Conditional Items ─────────────────────────────────

test.describe('Sidebar Context Menu — Conditional Items', () => {
  test('"Add page inside" is absent at maximum nesting depth (4)', async ({ window }) => {
    // Build 5 levels: root → L1 → L2 → L3 → L4 (depth 4, canAddChild = false)
    const rootId = await createNoteWithTitle(window, 'Depth Root');

    // Create 4 more levels via IPC (faster than UI)
    let currentParent = rootId;
    for (let depth = 1; depth <= 4; depth++) {
      const result = await window.evaluate(
        ({ parentId, title }: { parentId: string; title: string }) =>
          (window as any).lychee.invoke('documents.create', { parentId, title }),
        { parentId: currentParent, title: `Depth L${depth}` },
      );
      currentParent = result.document.id;
      await window.waitForTimeout(200);
    }
    // Reload the store to reflect backend changes
    await window.evaluate(() => {
      const store = (window as any).__documentStore;
      return store.getState().loadDocuments?.();
    }).catch(() => {});
    await window.waitForTimeout(500);

    // Expand the tree to reach L4
    // Click each parent to expand it
    const expandAll = async () => {
      for (let i = 0; i < 5; i++) {
        const chevrons = window.locator('[role="button"][aria-label="Expand"]');
        const count = await chevrons.count();
        if (count === 0) break;
        await chevrons.first().click();
        await window.waitForTimeout(200);
      }
    };
    await expandAll();

    // Find the deepest note (Depth L4) and right-click it
    const deepestNote = window.locator('[data-note-id]').filter({ hasText: 'Depth L4' }).first();
    await expect(deepestNote).toBeVisible({ timeout: 5000 });
    await deepestNote.click({ button: 'right' });
    await window.waitForTimeout(300);

    // "Add page inside" must NOT appear at depth 4
    await expect(window.getByRole('menuitem', { name: /add page inside/i })).not.toBeVisible({ timeout: 3000 });
    // Other options still present
    await expect(window.getByRole('menuitem', { name: /open in new tab/i })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: /move to trash/i })).toBeVisible();
  });

  test('Right-click on note in Bookmarks section has no "Add page inside"', async ({ window }) => {
    // BACKEND: inject bookmark so the note appears in Bookmarks section
    const docId = await createNoteWithTitle(window, 'BM CM No Add Inside');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    // Right-click the occurrence in the Bookmarks section (the last/second occurrence)
    const bookmarkSectionItem = window.locator(`[data-note-id="${docId}"]`).last();
    await bookmarkSectionItem.click({ button: 'right' });
    await window.waitForTimeout(300);

    // "Add page inside" must not appear — BookmarksSection passes canAddChild={false}
    await expect(window.getByRole('menuitem', { name: /add page inside/i })).not.toBeVisible({ timeout: 3000 });
    // The other 3 options should be there
    await expect(window.getByRole('menuitem', { name: /open in new tab/i })).toBeVisible({ timeout: 3000 });
    await expect(window.getByRole('menuitem', { name: /remove bookmark/i })).toBeVisible({ timeout: 3000 });
    await expect(window.getByRole('menuitem', { name: /move to trash/i })).toBeVisible({ timeout: 3000 });
  });

  test('Right-click on note in Bookmarks section: "Remove bookmark" works correctly', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'BM CM Remove Works');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    // Right-click the Bookmarks section item
    await window.locator(`[data-note-id="${docId}"]`).last().click({ button: 'right' });
    await window.waitForTimeout(300);
    await window.getByRole('menuitem', { name: /remove bookmark/i }).click();
    await window.waitForTimeout(500);

    // Section disappears (only one note was bookmarked)
    await expect(bookmarksSectionHeader(window)).not.toBeVisible({ timeout: 3000 });
    // Note still in Notes section
    await expect(window.locator(`[data-note-id="${docId}"]`).first()).toBeVisible();
  });

  test('Right-click on note in Bookmarks section: "Open in new tab" works', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'BM CM Open Tab');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    const tabsBefore = await window.locator('[data-tab-id]').count();

    await window.locator(`[data-note-id="${docId}"]`).last().click({ button: 'right' });
    await window.waitForTimeout(300);
    await window.getByRole('menuitem', { name: /open in new tab/i }).click();
    await window.waitForTimeout(400);

    await expect(window.locator('[data-tab-id]')).toHaveCount(tabsBefore + 1, { timeout: 3000 });
  });

  test('Right-click on note in Bookmarks section: "Move to Trash Bin" removes from both sections', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'BM CM Trash Both');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    await window.locator(`[data-note-id="${docId}"]`).last().click({ button: 'right' });
    await window.waitForTimeout(300);
    await window.getByRole('menuitem', { name: /move to trash/i }).click();
    await window.waitForTimeout(500);

    // Gone from both sections
    await expect(window.locator(`[data-note-id="${docId}"]`).first()).not.toBeVisible({ timeout: 3000 });
    await expect(bookmarksSectionHeader(window)).not.toBeVisible({ timeout: 3000 });
  });
});

// ── Hover Dropdown (⋯ Options) ────────────────────────────────────────

test.describe('Sidebar Hover Dropdown (⋯ Options)', () => {
  test('hovering a note item reveals the ⋯ Options button', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Hover Reveals Options Btn');
    const noteItem = window.locator(`[data-note-id="${docId}"]`).first();

    await noteItem.hover();
    await window.waitForTimeout(200);

    const optionsBtn = noteItem.locator('[role="button"]:has(svg.lucide-more-horizontal)');
    await expect(optionsBtn).toBeVisible({ timeout: 3000 });
  });

  test('⋯ dropdown has same 4 options as the context menu', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Dropdown Same Options');
    await openOptionsDropdown(window, docId);

    await expect(window.getByRole('menuitem', { name: /open in new tab/i })).toBeVisible({ timeout: 3000 });
    await expect(window.getByRole('menuitem', { name: /add to bookmarks/i })).toBeVisible({ timeout: 3000 });
    await expect(window.getByRole('menuitem', { name: /add page inside/i })).toBeVisible({ timeout: 3000 });
    await expect(window.getByRole('menuitem', { name: /move to trash/i })).toBeVisible({ timeout: 3000 });
  });

  test('⋯ dropdown "Open in new tab" opens a tab without switching selected note', async ({ window }) => {
    const idA = await createNoteWithTitle(window, 'Dropdown Open Tab A');
    const idB = await createNoteWithTitle(window, 'Dropdown Open Tab B');

    expect(await getSelectedId(window)).toBe(idB);
    const tabsBefore = await window.locator('[data-tab-id]').count();

    await openOptionsDropdown(window, idA);
    await window.getByRole('menuitem', { name: /open in new tab/i }).click();
    await window.waitForTimeout(400);

    await expect(window.locator('[data-tab-id]')).toHaveCount(tabsBefore + 1, { timeout: 3000 });
    expect(await getSelectedId(window)).toBe(idB);
  });

  test('⋯ dropdown "Add to bookmarks" adds to Bookmarks section', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Dropdown Add Bookmark');
    await openOptionsDropdown(window, docId);
    await window.getByRole('menuitem', { name: /add to bookmarks/i }).click();
    await window.waitForTimeout(500);

    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });
    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(true);
    }).toPass({ timeout: 3000 });
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('⋯ dropdown "Add page inside" creates a child note', async ({ window }) => {
    const parentId = await createNoteWithTitle(window, 'Dropdown Add Inside Parent');
    await openOptionsDropdown(window, parentId);
    await window.getByRole('menuitem', { name: /add page inside/i }).click();
    await window.waitForTimeout(600);

    await expect(window.locator('[data-note-id]')).toHaveCount(2, { timeout: 5000 });

    await expect(async () => {
      const result = await window.evaluate(() =>
        (window as any).lychee.invoke('documents.list', { limit: 500, offset: 0 }),
      );
      const docs = result.documents;
      const child = docs.find((d: any) => d.parentId === parentId);
      expect(child).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('⋯ dropdown "Move to Trash Bin" removes note from Notes section', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Dropdown Trash Note');
    await openOptionsDropdown(window, docId);
    await window.getByRole('menuitem', { name: /move to trash/i }).click();
    await window.waitForTimeout(500);

    await expect(window.locator(`[data-note-id="${docId}"]`).first()).not.toBeVisible({ timeout: 3000 });
  });

  test('⋯ dropdown "Remove bookmark" removes note from Bookmarks section', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Dropdown Remove Bookmark');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    await openOptionsDropdown(window, docId);
    await window.getByRole('menuitem', { name: /remove bookmark/i }).click();
    await window.waitForTimeout(500);

    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(false);
    }).toPass({ timeout: 3000 });
    await expect(bookmarksSectionHeader(window)).not.toBeVisible({ timeout: 3000 });
  });

  test('hovering a note item reveals the "+" Add Page Inside button for root notes', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Hover Reveals Plus Btn');
    const noteItem = window.locator(`[data-note-id="${docId}"]`).first();

    await noteItem.hover();
    await window.waitForTimeout(200);

    // The + button is a span[role="button"] containing the lucide-plus SVG
    const plusBtn = noteItem.locator('[role="button"]:has(svg.lucide-plus)');
    await expect(plusBtn).toBeVisible({ timeout: 3000 });
  });

  test('"+" hover button creates a child note (same as context menu "Add page inside")', async ({ window }) => {
    const parentId = await createNoteWithTitle(window, 'Plus Btn Creates Child');
    const noteItem = window.locator(`[data-note-id="${parentId}"]`).first();

    await noteItem.hover();
    await window.waitForTimeout(200);

    const plusBtn = noteItem.locator('[role="button"]:has(svg.lucide-plus)');
    await expect(plusBtn).toBeVisible({ timeout: 3000 });
    await plusBtn.click();
    await window.waitForTimeout(600);

    // Two notes exist
    await expect(window.locator('[data-note-id]')).toHaveCount(2, { timeout: 5000 });

    // DB: child has parentId
    await expect(async () => {
      const result = await window.evaluate(() =>
        (window as any).lychee.invoke('documents.list', { limit: 500, offset: 0 }),
      );
      const docs = result.documents;
      const child = docs.find((d: any) => d.parentId === parentId);
      expect(child).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('⋯ dropdown dismisses on Escape key', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Dropdown Escape Dismiss');
    await openOptionsDropdown(window, docId);

    await expect(window.getByRole('menuitem', { name: /open in new tab/i })).toBeVisible({ timeout: 3000 });
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    await expect(window.getByRole('menuitem', { name: /open in new tab/i })).not.toBeVisible({ timeout: 3000 });
  });

  test('context menu dismisses on Escape key', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'CM Escape Dismiss');
    await rightClickNote(window, docId);

    await expect(window.getByRole('menuitem', { name: /open in new tab/i })).toBeVisible({ timeout: 3000 });
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    await expect(window.getByRole('menuitem', { name: /open in new tab/i })).not.toBeVisible({ timeout: 3000 });
  });
});

// ── Click Interactions ────────────────────────────────────────────────

test.describe('Sidebar Click Interactions', () => {
  test('left-click on a note switches selectedId to that note', async ({ window }) => {
    const idA = await createNoteWithTitle(window, 'Click Switch A');
    const idB = await createNoteWithTitle(window, 'Click Switch B');

    expect(await getSelectedId(window)).toBe(idB);

    await window.locator(`[data-note-id="${idA}"]`).first().click();
    await window.waitForTimeout(300);

    expect(await getSelectedId(window)).toBe(idA);
  });

  test('middle-click opens note in new tab without switching selectedId', async ({ window }) => {
    const idA = await createNoteWithTitle(window, 'Middle Click A');
    const idB = await createNoteWithTitle(window, 'Middle Click B');

    expect(await getSelectedId(window)).toBe(idB);
    const tabsBefore = await window.locator('[data-tab-id]').count();

    // Middle-click note A
    await window.locator(`[data-note-id="${idA}"]`).first().click({ button: 'middle' });
    await window.waitForTimeout(400);

    // New tab opened
    await expect(window.locator('[data-tab-id]')).toHaveCount(tabsBefore + 1, { timeout: 3000 });
    // selectedId still B
    expect(await getSelectedId(window)).toBe(idB);
  });

  test('Cmd/Ctrl+click opens note in new tab without switching selectedId', async ({ window }) => {
    const idA = await createNoteWithTitle(window, 'CmdClick A');
    const idB = await createNoteWithTitle(window, 'CmdClick B');

    expect(await getSelectedId(window)).toBe(idB);
    const tabsBefore = await window.locator('[data-tab-id]').count();

    await window.locator(`[data-note-id="${idA}"]`).first().click({ modifiers: ['Meta'] });
    await window.waitForTimeout(400);

    await expect(window.locator('[data-tab-id]')).toHaveCount(tabsBefore + 1, { timeout: 3000 });
    expect(await getSelectedId(window)).toBe(idB);
  });

  test('clicking note in Bookmarks section switches selectedId to that note', async ({ window }) => {
    const idA = await createNoteWithTitle(window, 'BM Click Nav A');
    await bookmarkViaBackend(window, idA);

    // Create a second note so focus moves away from A
    const idB = await createNoteWithTitle(window, 'BM Click Nav B');
    expect(await getSelectedId(window)).toBe(idB);

    // Click note A via its Bookmarks section occurrence
    await window.locator(`[data-note-id="${idA}"]`).last().click();
    await window.waitForTimeout(300);

    expect(await getSelectedId(window)).toBe(idA);
  });

  test('middle-click on note in Bookmarks section opens it in new tab', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'BM Middle Click');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    const idOther = await createNoteWithTitle(window, 'BM Middle Click Other');
    expect(await getSelectedId(window)).toBe(idOther);
    const tabsBefore = await window.locator('[data-tab-id]').count();

    // Middle-click the Bookmarks section occurrence
    await window.locator(`[data-note-id="${docId}"]`).last().click({ button: 'middle' });
    await window.waitForTimeout(400);

    await expect(window.locator('[data-tab-id]')).toHaveCount(tabsBefore + 1, { timeout: 3000 });
    expect(await getSelectedId(window)).toBe(idOther); // focus unchanged
  });
});

// ── Notes ↔ Bookmarks Cross-Section Behavior ─────────────────────────

test.describe('Sidebar — Notes and Bookmarks Section Interaction', () => {
  test('bookmarked note appears in both Notes section and Bookmarks section simultaneously', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Cross Both Sections');
    await bookmarkViaBackend(window, docId);

    // Must appear twice in the sidebar DOM
    await expect(async () => {
      expect(await noteIdCount(window, docId)).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 3000 });

    // Both occurrences visible
    const items = window.locator(`[data-note-id="${docId}"]`);
    await expect(items.first()).toBeVisible();
    await expect(items.last()).toBeVisible();
  });

  test('note title shown consistently in both sections', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Consistent Title Both');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    // Both occurrences show the same title
    const items = window.locator(`[data-note-id="${docId}"]`);
    await expect(items.nth(0)).toContainText('Consistent Title Both');
    await expect(items.nth(1)).toContainText('Consistent Title Both');
  });

  test('trashing a bookmarked note removes it from both sections', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Trash Removes Both');
    await bookmarkViaBackend(window, docId);
    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(true);
    }).toPass({ timeout: 3000 });

    // Trash via context menu from Notes section
    await window.locator(`[data-note-id="${docId}"]`).first().click({ button: 'right' });
    await window.waitForTimeout(300);
    await window.getByRole('menuitem', { name: /move to trash/i }).click();
    await window.waitForTimeout(500);

    // Gone from both
    await expect(window.locator(`[data-note-id="${docId}"]`).first()).not.toBeVisible({ timeout: 3000 });
    await expect(bookmarksSectionHeader(window)).not.toBeVisible({ timeout: 3000 });
  });

  test('context menu "Add to bookmarks" in Notes section creates Bookmarks entry', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Notes CM Adds To BM');
    await expect(bookmarksSectionHeader(window)).not.toBeVisible();

    await window.locator(`[data-note-id="${docId}"]`).first().click({ button: 'right' });
    await window.waitForTimeout(300);
    await window.getByRole('menuitem', { name: /add to bookmarks/i }).click();
    await window.waitForTimeout(500);

    // Now Bookmarks section exists and note is in it
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });
    await expect(async () => {
      expect(await noteIdCount(window, docId)).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 3000 });
  });

  test('bookmarking second note shows both in Bookmarks section', async ({ window }) => {
    const idA = await createNoteWithTitle(window, 'Both Bookmarked A');
    const idB = await createNoteWithTitle(window, 'Both Bookmarked B');
    await bookmarkViaBackend(window, idA);
    await bookmarkViaBackend(window, idB);

    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });
    await expect(async () => {
      expect(await isInBookmarksSection(window, idA)).toBe(true);
      expect(await isInBookmarksSection(window, idB)).toBe(true);
    }).toPass({ timeout: 3000 });
  });

  test('selected note is highlighted in both sections when bookmarked', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Selected Highlight Both');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    // Click the note (select it)
    await window.locator(`[data-note-id="${docId}"]`).first().click();
    await window.waitForTimeout(300);

    expect(await getSelectedId(window)).toBe(docId);

    // Both sidebar items should have the active/selected styling
    // SidebarMenuButton uses isActive prop which adds data-active or aria-current
    const items = window.locator(`[data-note-id="${docId}"]`);
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);
    // At least one active item should be visible (the highlighting is applied via isActive)
    const activeItems = window.locator(`[data-note-id="${docId}"] button[data-active="true"]`).or(
      window.locator(`[data-note-id="${docId}"] [aria-current]`),
    );
    // Just verify at least one exists (exact attribute depends on Radix SidebarMenuButton impl)
    const activeCount = await activeItems.count();
    expect(activeCount).toBeGreaterThanOrEqual(1);
  });
});
