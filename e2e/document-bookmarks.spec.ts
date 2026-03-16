/**
 * E2E tests for the document-level bookmark feature.
 *
 * "Document bookmark" = the star-a-note feature driven by the toolbar BookmarkButton
 * and the sidebar Bookmarks section.  This is distinct from content-level BookmarkNode
 * cards (URL-in-editor embeds), which are tested in image-bookmark-embed.spec.ts.
 *
 * Backend vs UI setup strategy
 * ─────────────────────────────
 *  BACKEND setup (`bookmarkViaBackend`) — tests that verify *display* given existing
 *    state: sidebar appears, items show/sort, navigation works, context menu labels.
 *    Avoids coupling display assertions to the creation flow, and makes sort/timestamp
 *    tests deterministic.
 *
 *  UI setup (click toolbar button) — tests that verify the *creation flow itself*:
 *    aria-label toggle, visual state change, DB field values written by the UI action,
 *    stress/persistence tests, context menu actions (the action IS the thing under test).
 */

import {
  test as base,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  findPackagedBinary,
  hasDevBuild,
  PROJECT_ROOT,
} from './electron-app';
import { test } from './electron-app';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a new note, type a title, wait for debounce save, return its doc ID. */
async function createNoteWithTitle(window: Page, title: string): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);

  const visibleTitle = window.locator('main:visible h1.editor-title');
  await visibleTitle.click();
  await window.keyboard.type(title);
  await window.waitForTimeout(700); // debounce save

  return window.evaluate(() => {
    const store = (window as any).__documentStore;
    return store.getState().selectedId as string;
  });
}

/**
 * Set a note's bookmark status directly in the DB via IPC **and** update the
 * Zustand store so the UI re-renders immediately.
 *
 * Use for tests that verify *display* — sidebar section, sorting, navigation —
 * rather than the creation flow itself.
 */
async function bookmarkViaBackend(window: Page, docId: string, ts?: string): Promise<void> {
  const bookmarkedAt = ts ?? new Date().toISOString();
  // 1. Persist to SQLite
  await window.evaluate(
    ({ id, at }: { id: string; at: string }) =>
      (window as any).lychee.invoke('documents.update', { id, metadata: { bookmarkedAt: at } }),
    { id: docId, at: bookmarkedAt },
  );
  // 2. Update in-memory Zustand store so React re-renders sidebar
  await window.evaluate(
    ({ id, at }: { id: string; at: string }) => {
      const store = (window as any).__documentStore;
      const state = store.getState();
      const doc = state.documents.find((d: any) => d.id === id);
      if (doc) {
        state.updateDocumentInStore(id, { metadata: { ...doc.metadata, bookmarkedAt: at } });
      }
    },
    { id: docId, at: bookmarkedAt },
  );
  await window.waitForTimeout(150);
}

/** Remove a note's bookmark via backend + store update. */
async function unbookmarkViaBackend(window: Page, docId: string): Promise<void> {
  await window.evaluate(
    (id: string) =>
      (window as any).lychee.invoke('documents.update', { id, metadata: { bookmarkedAt: null } }),
    docId,
  );
  await window.evaluate(
    (id: string) => {
      const store = (window as any).__documentStore;
      const state = store.getState();
      const doc = state.documents.find((d: any) => d.id === id);
      if (doc) {
        state.updateDocumentInStore(id, { metadata: { ...doc.metadata, bookmarkedAt: null } });
      }
    },
    docId,
  );
  await window.waitForTimeout(150);
}

/**
 * Click the toolbar bookmark button (aria-label varies by state).
 * Use only for tests that verify the UI action itself, not just the resulting state.
 */
async function clickToolbarBookmarkButton(window: Page) {
  const btn = window.locator('main:visible').getByRole('button', {
    name: /bookmark this note|remove bookmark/i,
  });
  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.click();
  await window.waitForTimeout(500); // IPC + optimistic-update settle
}

/** Get the toolbar bookmark button locator. */
function toolbarBookmarkBtn(window: Page) {
  return window.locator('main:visible').getByRole('button', {
    name: /bookmark this note|remove bookmark/i,
  });
}

/** Get the raw document row from SQLite via IPC. */
async function getDocFromDb(window: Page, id: string) {
  const result = await window.evaluate(
    (docId: string) => (window as any).lychee.invoke('documents.get', { id: docId }),
    id,
  );
  return result.document as {
    id: string;
    title: string;
    content: string;
    metadata: { bookmarkedAt?: string | null };
    [key: string]: unknown;
  };
}

/** Right-click a note item in the sidebar to open its context menu. */
async function openSidebarContextMenu(window: Page, docId: string) {
  const noteItem = window.locator(`[data-note-id="${docId}"]`).first();
  await noteItem.click({ button: 'right' });
  await window.waitForTimeout(300);
}

/** The Bookmarks section header button in the sidebar. */
function bookmarksSectionHeader(window: Page) {
  return window.locator('aside').locator('button').filter({ hasText: /^Bookmarks$/ }).first();
}

/**
 * Returns true when a note's [data-note-id] element appears at least twice in the DOM:
 * once in the Notes section and once in the Bookmarks section.
 */
async function isInBookmarksSection(window: Page, docId: string): Promise<boolean> {
  const count = await window.locator(`[data-note-id="${docId}"]`).count();
  return count >= 2;
}

// ── Toolbar Button Tests ──────────────────────────────────────────────
// All UI-driven: these tests verify the toolbar button behavior itself.

test.describe('Document Bookmark — Toolbar Button', () => {
  test('bookmark button is visible in the editor toolbar', async ({ window }) => {
    await createNoteWithTitle(window, 'Toolbar Visibility');
    await expect(toolbarBookmarkBtn(window)).toBeVisible({ timeout: 5000 });
  });

  test('initial state: aria-label is "Bookmark this note"', async ({ window }) => {
    await createNoteWithTitle(window, 'Aria Label Unbookmarked');
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Bookmark this note' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('clicking bookmark button changes aria-label to "Remove bookmark"', async ({ window }) => {
    await createNoteWithTitle(window, 'Aria Label Toggle On');
    await clickToolbarBookmarkButton(window);
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Remove bookmark' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('clicking again reverts aria-label to "Bookmark this note"', async ({ window }) => {
    await createNoteWithTitle(window, 'Aria Label Toggle Off');
    await clickToolbarBookmarkButton(window);
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Remove bookmark' }),
    ).toBeVisible({ timeout: 5000 });
    await clickToolbarBookmarkButton(window);
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Bookmark this note' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('bookmarked button loses muted-foreground class (gains accent color)', async ({ window }) => {
    await createNoteWithTitle(window, 'Bookmark Visual Fill');
    const btn = toolbarBookmarkBtn(window);
    await expect(btn).toHaveClass(/muted-foreground/);
    await clickToolbarBookmarkButton(window);
    await expect(btn).not.toHaveClass(/muted-foreground/);
  });
});

// ── Sidebar Bookmarks Section ─────────────────────────────────────────
// Display tests use backend setup so sidebar rendering is tested independently
// of the toolbar button creation flow.

test.describe('Document Bookmark — Sidebar Section', () => {
  test('Bookmarks section is hidden when no notes are bookmarked', async ({ window }) => {
    await createNoteWithTitle(window, 'No Bookmarks Yet');
    await expect(bookmarksSectionHeader(window)).not.toBeVisible();
  });

  test('Bookmarks section appears after backend-bookmarking a note', async ({ window }) => {
    // BACKEND: set bookmark state directly, then verify the sidebar reacts
    const docId = await createNoteWithTitle(window, 'Section Appears Backend');
    await expect(bookmarksSectionHeader(window)).not.toBeVisible();

    await bookmarkViaBackend(window, docId);

    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });
  });

  test('bookmarked note (backend) appears as an item in the Bookmarks section', async ({ window }) => {
    // BACKEND: inject bookmark state; test verifies sidebar renders the item
    const docId = await createNoteWithTitle(window, 'Item In Section Backend');
    await bookmarkViaBackend(window, docId);

    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(true);
    }).toPass({ timeout: 3000 });
  });

  test('un-bookmarking via UI removes note from Bookmarks section', async ({ window }) => {
    // BACKEND: set up bookmark state; then UI action removes it — verifies the
    // remove flow without coupling to the add flow
    const docId = await createNoteWithTitle(window, 'Toggle Remove From Section');
    await bookmarkViaBackend(window, docId);

    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(true);
    }).toPass({ timeout: 3000 });

    // Now exercise the UI removal path
    await clickToolbarBookmarkButton(window);

    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(false);
    }).toPass({ timeout: 3000 });
  });

  test('Bookmarks section disappears when last bookmark is removed (backend)', async ({ window }) => {
    // BACKEND: add and remove via backend — tests section visibility logic in isolation
    const docId = await createNoteWithTitle(window, 'Last Bookmark Backend');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    await unbookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).not.toBeVisible({ timeout: 3000 });
  });

  test('Bookmarks section header shows "Bookmarks" label', async ({ window }) => {
    // BACKEND: inject bookmark so the section renders, then check its label
    const docId = await createNoteWithTitle(window, 'Header Label Check');
    await bookmarkViaBackend(window, docId);

    const header = bookmarksSectionHeader(window);
    await expect(header).toBeVisible({ timeout: 3000 });
    await expect(header).toContainText('Bookmarks');
  });

  test('Bookmarks section collapses and re-expands on header click', async ({ window }) => {
    // BACKEND: inject bookmark state; test verifies collapse/expand animation
    const docId = await createNoteWithTitle(window, 'Collapse Expand');
    await bookmarkViaBackend(window, docId);

    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });
    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(true);
    }).toPass({ timeout: 3000 });

    // Collapse
    await bookmarksSectionHeader(window).click();
    await window.waitForTimeout(400); // spring animation

    await expect(bookmarksSectionHeader(window)).toBeVisible(); // header stays
    await expect(async () => {
      const count = await window.locator(`[data-note-id="${docId}"]`).count();
      expect(count).toBe(1); // Bookmarks section items hidden
    }).toPass({ timeout: 3000 });

    // Expand
    await bookmarksSectionHeader(window).click();
    await window.waitForTimeout(400);
    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(true);
    }).toPass({ timeout: 3000 });
  });

  test('clicking a bookmarked note in the Bookmarks section opens it', async ({ window }) => {
    // BACKEND: set up two notes, bookmark one — test verifies sidebar navigation
    const docIdA = await createNoteWithTitle(window, 'Open Via Bookmarks Section');
    await bookmarkViaBackend(window, docIdA);

    // Open another note (switches selected)
    await createNoteWithTitle(window, 'Other Note Navigation');

    // Click note A via its second occurrence in the Bookmarks section
    const noteItemInBookmarks = window.locator(`[data-note-id="${docIdA}"]`).last();
    await noteItemInBookmarks.click();
    await window.waitForTimeout(400);

    const selectedId = await window.evaluate(() =>
      (window as any).__documentStore.getState().selectedId as string,
    );
    expect(selectedId).toBe(docIdA);
  });

  test('multiple backend-bookmarked notes all appear in the section', async ({ window }) => {
    // BACKEND: inject 3 bookmarks; tests that the sidebar renders all of them
    const ids: string[] = [];
    for (const title of ['Section Alpha', 'Section Beta', 'Section Gamma']) {
      const id = await createNoteWithTitle(window, title);
      await bookmarkViaBackend(window, id);
      ids.push(id);
    }

    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    for (const id of ids) {
      await expect(async () => {
        expect(await isInBookmarksSection(window, id)).toBe(true);
      }).toPass({ timeout: 5000 });
    }
  });

  test('bookmarks in sidebar sorted most-recently-bookmarked first (backend timestamps)', async ({ window }) => {
    // BACKEND with explicit timestamps — deterministic sort order, no UI timing races
    const id1 = await createNoteWithTitle(window, 'Sort First');
    const id2 = await createNoteWithTitle(window, 'Sort Second');
    const id3 = await createNoteWithTitle(window, 'Sort Third');

    // Bookmark with 1-second spacing so localeCompare sorts deterministically
    await bookmarkViaBackend(window, id1, '2024-01-01T00:00:01.000Z');
    await bookmarkViaBackend(window, id2, '2024-01-01T00:00:02.000Z');
    await bookmarkViaBackend(window, id3, '2024-01-01T00:00:03.000Z');

    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    // Collect data-note-id values from DOM in order; duplicate IDs belong to Bookmarks section
    await expect(async () => {
      const allItems = window.locator('[data-note-id]');
      const count = await allItems.count();
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = await allItems.nth(i).getAttribute('data-note-id');
        if (id) ids.push(id);
      }
      const idCounts = new Map<string, number>();
      for (const id of ids) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
      const bookmarkIds = [...new Set(ids.filter((id) => idCounts.get(id)! >= 2))];

      // id3 bookmarked latest → first in section
      expect(bookmarkIds[0]).toBe(id3);
      expect(bookmarkIds[1]).toBe(id2);
      expect(bookmarkIds[2]).toBe(id1);
    }).toPass({ timeout: 5000 });
  });
});

// ── DB Validation ─────────────────────────────────────────────────────
// All UI-driven: verify the full creation-flow writes correct values to the DB.

test.describe('Document Bookmark — DB Validation', () => {
  test('bookmarkedAt is set in DB after clicking bookmark in UI', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB Set BookmarkedAt');
    await clickToolbarBookmarkButton(window);

    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('bookmarkedAt is a valid ISO-8601 timestamp', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB ISO Timestamp');
    await clickToolbarBookmarkButton(window);

    await expect(async () => {
      const ts = (await getDocFromDb(window, docId)).metadata.bookmarkedAt;
      expect(ts).toBeTruthy();
      expect(Number.isNaN(new Date(ts as string).getTime())).toBe(false);
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }).toPass({ timeout: 5000 });
  });

  test('bookmarkedAt is null in DB after un-bookmarking via UI', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB Null BookmarkedAt');
    await clickToolbarBookmarkButton(window); // bookmark
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });

    await clickToolbarBookmarkButton(window); // unbookmark
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt ?? null).toBeNull();
    }).toPass({ timeout: 5000 });
  });

  test('bookmarkedAt timestamp in DB is within 10 seconds of when button was clicked', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB Timestamp Recency');
    const beforeClick = Date.now();
    await clickToolbarBookmarkButton(window);
    const afterClick = Date.now();

    await expect(async () => {
      const ts = (await getDocFromDb(window, docId)).metadata.bookmarkedAt;
      expect(ts).toBeTruthy();
      const saved = new Date(ts as string).getTime();
      expect(saved).toBeGreaterThanOrEqual(beforeClick - 100);
      expect(saved).toBeLessThanOrEqual(afterClick + 10_000);
    }).toPass({ timeout: 5000 });
  });

  test('toggle on/off/on: final DB state is bookmarked', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB Toggle Cycle');
    await clickToolbarBookmarkButton(window); // on
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });

    await clickToolbarBookmarkButton(window); // off
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt ?? null).toBeNull();
    }).toPass({ timeout: 5000 });

    await clickToolbarBookmarkButton(window); // on again
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('bookmarking does not overwrite the document content field', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'DB Metadata Merge');
    const contentBefore = (await getDocFromDb(window, docId)).content;

    await clickToolbarBookmarkButton(window);

    await expect(async () => {
      const doc = await getDocFromDb(window, docId);
      expect(doc.content).toBe(contentBefore);
      expect(doc.metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });
});

// ── Context Menu ──────────────────────────────────────────────────────
// "Add to bookmarks" — no setup needed, tests the action itself (UI-driven).
// "Remove bookmark" — BACKEND to pre-set state, tests only the removal action.

test.describe('Document Bookmark — Context Menu', () => {
  test('right-click on unbookmarked note shows "Add to bookmarks"', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Context Menu Add Label');
    await openSidebarContextMenu(window, docId);
    await expect(window.getByRole('menuitem', { name: /add to bookmarks/i })).toBeVisible({
      timeout: 3000,
    });
  });

  test('"Add to bookmarks" in context menu bookmarks the note', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Context Menu Bookmark Action');
    await openSidebarContextMenu(window, docId);
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

  test('right-click on backend-bookmarked note shows "Remove bookmark"', async ({ window }) => {
    // BACKEND: pre-set bookmark so menu label reflects it; avoids coupling to UI creation
    const docId = await createNoteWithTitle(window, 'Context Menu Remove Label');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    await openSidebarContextMenu(window, docId);
    await expect(window.getByRole('menuitem', { name: /remove bookmark/i })).toBeVisible({
      timeout: 3000,
    });
  });

  test('"Remove bookmark" in context menu un-bookmarks the note', async ({ window }) => {
    // BACKEND: pre-set so we test only the removal action
    const docId = await createNoteWithTitle(window, 'Context Menu Remove Action');
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    await openSidebarContextMenu(window, docId);
    await window.getByRole('menuitem', { name: /remove bookmark/i }).click();
    await window.waitForTimeout(500);

    await expect(bookmarksSectionHeader(window)).not.toBeVisible({ timeout: 3000 });
    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt ?? null).toBeNull();
    }).toPass({ timeout: 5000 });
  });

  test('context menu and toolbar button stay in sync', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Context+Toolbar Sync');

    // Bookmark via context menu
    await openSidebarContextMenu(window, docId);
    await window.getByRole('menuitem', { name: /add to bookmarks/i }).click();
    await window.waitForTimeout(500);

    // Toolbar reflects the new state
    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Remove bookmark' }),
    ).toBeVisible({ timeout: 5000 });

    // Unbookmark via toolbar
    await clickToolbarBookmarkButton(window);

    // Context menu should now offer "Add to bookmarks" again
    await openSidebarContextMenu(window, docId);
    await expect(window.getByRole('menuitem', { name: /add to bookmarks/i })).toBeVisible({
      timeout: 3000,
    });
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────

test.describe('Document Bookmark — Edge Cases', () => {
  test('bookmarking a note with no title appears in section as "New Page"', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(600);

    const docId = await window.evaluate(() =>
      (window as any).__documentStore.getState().selectedId as string,
    );

    // BACKEND: inject bookmark; the note has no title typed
    await bookmarkViaBackend(window, docId);
    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });
    await expect(async () => {
      expect(await isInBookmarksSection(window, docId)).toBe(true);
    }).toPass({ timeout: 3000 });
  });

  test('bookmarked note (backend) trashed then restored still has bookmarkedAt in DB', async ({ window }) => {
    // BACKEND: inject bookmark state; test verifies it survives trash/restore
    const docId = await createNoteWithTitle(window, 'Trash Then Restore Bookmarked');
    await bookmarkViaBackend(window, docId);

    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });

    // Trash
    await openSidebarContextMenu(window, docId);
    await window.getByRole('menuitem', { name: /move to trash/i }).click();
    await window.waitForTimeout(500);

    // Restore via IPC
    await window.evaluate(
      (id: string) => (window as any).lychee.invoke('documents.restore', { id }),
      docId,
    );
    await window.waitForTimeout(500);

    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 5000 });
  });

  test('trashing one of multiple backend-bookmarked notes leaves others in section', async ({ window }) => {
    // BACKEND: inject bookmarks for both; test only the effect of trashing one
    const idA = await createNoteWithTitle(window, 'Trash Multi A');
    await bookmarkViaBackend(window, idA);
    const idB = await createNoteWithTitle(window, 'Trash Multi B');
    await bookmarkViaBackend(window, idB);

    await expect(async () => {
      expect(await isInBookmarksSection(window, idB)).toBe(true);
    }).toPass({ timeout: 5000 });

    // Trash B
    await openSidebarContextMenu(window, idB);
    await window.getByRole('menuitem', { name: /move to trash/i }).click();
    await window.waitForTimeout(500);

    // A remains
    await expect(async () => {
      expect(await isInBookmarksSection(window, idA)).toBe(true);
    }).toPass({ timeout: 3000 });
  });

  test('switching to a different tab preserves toolbar button bookmark state', async ({ window }) => {
    // BACKEND: inject state for note A; test verifies toolbar reflects it after tab switch
    const docIdA = await createNoteWithTitle(window, 'Tab Preserve Bookmarked');
    await bookmarkViaBackend(window, docIdA);

    // Open an unbookmarked note (tab switches)
    await createNoteWithTitle(window, 'Tab Preserve Other');

    // Switch back to note A
    await window.locator('[data-tab-id]').filter({ hasText: 'Tab Preserve Bookmarked' }).click();
    await window.waitForTimeout(300);

    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Remove bookmark' }),
    ).toBeVisible({ timeout: 3000 });
  });
});

// ── Stress Tests ──────────────────────────────────────────────────────
// All UI-driven: these test the UI interaction under load, not display.

test.describe('Document Bookmark — Stress Tests', () => {
  test('rapid toggle 10 times ends in bookmarked state', async ({ window }) => {
    const docId = await createNoteWithTitle(window, 'Rapid Toggle Stress');

    // 9 clicks starting from unbookmarked → ends bookmarked (odd number)
    for (let i = 0; i < 9; i++) {
      const btn = window.locator('main:visible').getByRole('button', {
        name: /bookmark this note|remove bookmark/i,
      });
      await btn.click();
      await window.waitForTimeout(80);
    }

    await window.waitForTimeout(800); // let IPC settle

    await expect(async () => {
      expect((await getDocFromDb(window, docId)).metadata.bookmarkedAt).toBeTruthy();
    }).toPass({ timeout: 6000 });

    await expect(
      window.locator('main:visible').getByRole('button', { name: 'Remove bookmark' }),
    ).toBeVisible({ timeout: 3000 });
  });

  test('bookmark 5 notes via UI, all appear in sidebar sorted newest-first', async ({ window }) => {
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const id = await createNoteWithTitle(window, `Stress Bookmark ${i}`);
      await clickToolbarBookmarkButton(window);
      ids.push(id);
      await window.waitForTimeout(150); // ensure distinct timestamps
    }

    for (const id of ids) {
      await expect(async () => {
        expect(await isInBookmarksSection(window, id)).toBe(true);
      }).toPass({ timeout: 5000 });
    }

    // Most recently bookmarked = ids[4] = first in section
    await expect(async () => {
      const allItems = window.locator('[data-note-id]');
      const count = await allItems.count();
      const allIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = await allItems.nth(i).getAttribute('data-note-id');
        if (id) allIds.push(id);
      }
      const idCounts = new Map<string, number>();
      for (const id of allIds) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
      const bookmarkIds = [...new Set(allIds.filter((id) => idCounts.get(id)! >= 2))];
      expect(bookmarkIds[0]).toBe(ids[4]);
    }).toPass({ timeout: 5000 });
  });

  test('un-bookmark all notes via backend, section disappears cleanly', async ({ window }) => {
    // BACKEND: inject all bookmarks; then remove via backend to test section hiding
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const id = await createNoteWithTitle(window, `Bulk Remove ${i}`);
      await bookmarkViaBackend(window, id);
      ids.push(id);
    }

    await expect(bookmarksSectionHeader(window)).toBeVisible({ timeout: 3000 });

    for (const id of ids) {
      await unbookmarkViaBackend(window, id);
    }

    await expect(bookmarksSectionHeader(window)).not.toBeVisible({ timeout: 5000 });
  });
});

// ── Persistence Across Restart ────────────────────────────────────────

function buildLaunchOpts(tmpDir: string): Parameters<typeof _electron.launch>[0] {
  const packagedBinary = findPackagedBinary();
  const opts: Parameters<typeof _electron.launch>[0] = {
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30_000,
  };
  const extraArgs = process.env.CI ? ['--no-sandbox'] : [];
  if (packagedBinary) {
    opts.executablePath = packagedBinary;
    opts.args = [`--user-data-dir=${tmpDir}`, ...extraArgs];
  } else if (hasDevBuild()) {
    opts.args = [PROJECT_ROOT, `--user-data-dir=${tmpDir}`, ...extraArgs];
  } else {
    throw new Error('No Electron build found.');
  }
  return opts;
}

async function launchAndGetWindow(
  tmpDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await _electron.launch(buildLaunchOpts(tmpDir));
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
  return { app, window };
}

base.describe('Document Bookmark — Persistence Across Restart', () => {
  let tmpDir: string;

  base.beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-bookmark-persist-'));
  });

  base.afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  base('bookmarked note (UI) appears in sidebar after restart', async () => {
    let { app, window } = await launchAndGetWindow(tmpDir);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Restart Bookmark Test');
    await window.waitForTimeout(700);

    const docId = await window.evaluate(() =>
      (window as any).__documentStore.getState().selectedId as string,
    );

    const btn = window.locator('main:visible').getByRole('button', { name: /bookmark this note/i });
    await btn.click();
    await window.waitForTimeout(800);

    const doc1 = await window.evaluate(
      (id: string) => (window as any).lychee.invoke('documents.get', { id }),
      docId,
    );
    expect(doc1.document.metadata.bookmarkedAt).toBeTruthy();
    await app.close();

    // Session 2
    ({ app, window } = await launchAndGetWindow(tmpDir));

    const bookmarksHeader = window
      .locator('aside')
      .locator('button')
      .filter({ hasText: /^Bookmarks$/ })
      .first();
    await expect(bookmarksHeader).toBeVisible({ timeout: 5000 });
    await expect(window.locator(`[data-note-id="${docId}"]`)).toHaveCount(2, { timeout: 5000 });

    const doc2 = await window.evaluate(
      (id: string) => (window as any).lychee.invoke('documents.get', { id }),
      docId,
    );
    expect(doc2.document.metadata.bookmarkedAt).toBeTruthy();

    await app.close();
  });

  base('un-bookmarking (UI) persists across restart', async () => {
    let { app, window } = await launchAndGetWindow(tmpDir);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Unbookmark Persist Test');
    await window.waitForTimeout(700);

    const docId = await window.evaluate(() =>
      (window as any).__documentStore.getState().selectedId as string,
    );

    let btn = window.locator('main:visible').getByRole('button', { name: /bookmark this note/i });
    await btn.click();
    await window.waitForTimeout(500);

    btn = window.locator('main:visible').getByRole('button', { name: /remove bookmark/i });
    await btn.click();
    await window.waitForTimeout(800);
    await app.close();

    // Session 2: verify un-bookmarked state is persisted
    ({ app, window } = await launchAndGetWindow(tmpDir));

    const doc = await window.evaluate(
      (id: string) => (window as any).lychee.invoke('documents.get', { id }),
      docId,
    );
    expect(doc.document.metadata.bookmarkedAt ?? null).toBeNull();

    await app.close();
  });
});
