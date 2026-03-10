import { test, expect, listDocumentsFromDb, getDocumentFromDb } from './electron-app';
import type { Page } from '@playwright/test';

async function collapseSidebar(window: Page) {
  await window.locator('[aria-label="Toggle sidebar"]').click();
  await window.waitForTimeout(250);
}

function collapsedSidebar(window: Page) {
  return window.locator('aside[data-state="collapsed"]').first();
}

async function revealFloatingSidebar(window: Page) {
  const sidebar = collapsedSidebar(window);
  for (let attempt = 0; attempt < 3; attempt++) {
    await window.mouse.move(420, 120);
    await window.waitForTimeout(60);
    await window.mouse.move(1, 120 + attempt * 16);
    await window.waitForTimeout(250);
    const className = (await sidebar.getAttribute('class')) ?? '';
    if (className.includes('translate-x-0')) return;
  }
  throw new Error('Failed to reveal floating sidebar from collapsed state');
}

test.describe('Sidebar — Note Management', () => {
  test('create a new note via New Note button', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();

    // A note titled "New Page" should appear in the sidebar
    const noteItem = window.locator('[data-note-id]').first();
    await expect(noteItem).toBeVisible();
    await expect(noteItem).toContainText('New Page');

    // ── Backend: document exists in SQLite ──
    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBeTruthy();
    expect(docs[0].deletedAt).toBeNull();
  });

  test('creating a note opens it in a tab and shows the editor', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();

    // A tab should appear
    const tab = window.locator('[data-tab-id]').first();
    await expect(tab).toBeVisible();
    await expect(tab).toContainText('New Page');

    // The editor should be visible with the title placeholder
    const title = window.locator('h1.editor-title');
    await expect(title).toBeVisible();
  });

  test('create multiple notes', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    const noteItems = window.locator('[data-note-id]');
    await expect(noteItems).toHaveCount(3);

    // ── Backend: all 3 documents exist with correct sort order ──
    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(3);
    const sortOrders = docs.map((d) => d.sortOrder).sort((a, b) => a - b);
    expect(sortOrders).toEqual([0, 1, 2]);
  });

  test('clicking a note in sidebar opens it', async ({ window }) => {
    const visibleTitle = window.locator('main:visible h1.editor-title');

    // Create two notes
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);

    // Type a title in the first note so we can identify it
    await visibleTitle.click();
    await window.keyboard.type('First Note');
    await window.waitForTimeout(600);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);

    // Now click the first note in the sidebar
    const firstNote = window.locator('[data-note-id]').filter({ hasText: 'First Note' });
    await firstNote.click();

    // The editor should show the first note's title
    await expect(visibleTitle).toContainText('First Note');
  });

  test('collapse and expand the Notes section', async ({ window }) => {
    // Create a note first so there's something to collapse
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    // The note should be visible
    await expect(window.locator('[data-note-id]').first()).toBeVisible();

    // Click the Notes section header to collapse
    const notesHeader = window.getByText('Notes').first();
    await notesHeader.click();
    await window.waitForTimeout(400);

    // The note should not be visible (collapsed)
    await expect(window.locator('[data-note-id]').first()).not.toBeVisible();

    // Click again to expand
    await notesHeader.click();
    await window.waitForTimeout(400);

    // The note should be visible again
    await expect(window.locator('[data-note-id]').first()).toBeVisible();
  });

  test('right-click a note shows context menu', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    const noteItem = window.locator('[data-note-id]').first();
    await noteItem.click({ button: 'right' });

    // Context menu should show expected items
    await expect(window.getByText('Open in new tab')).toBeVisible();
    await expect(window.getByText('Move to Trash Bin')).toBeVisible();
  });

  test('create a nested note via context menu "Add page inside"', async ({ window }) => {
    // Create parent note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    const parentNoteId = await window.locator('[data-note-id]').first().getAttribute('data-note-id');

    const parentNote = window.locator('[data-note-id]').first();
    await parentNote.click({ button: 'right' });

    // Click "Add page inside"
    await window.getByText('Add page inside').click();
    await window.waitForTimeout(400);

    // There should now be 2 notes (parent + child)
    const noteItems = window.locator('[data-note-id]');
    await expect(noteItems).toHaveCount(2);

    // ── Backend: child document has correct parentId ──
    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(2);
    const child = docs.find((d) => d.parentId === parentNoteId);
    expect(child).toBeTruthy();
    expect(child!.parentId).toBe(parentNoteId);
  });

  test('"Open in new tab" from context menu opens a second tab', async ({ window }) => {
    // Create a note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    // Create another note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    // Right-click the first note
    const firstNote = window.locator('[data-note-id]').first();
    await firstNote.click({ button: 'right' });
    await window.getByText('Open in new tab').click();
    await window.waitForTimeout(300);

    // Should now have at least 2 tabs
    const tabs = window.locator('[data-tab-id]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

test.describe('Sidebar — Collapsed Floating Regressions', () => {
  test('collapsed sidebar supports edge reveal and pointer-leave hide', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    await collapseSidebar(window);
    const sidebar = collapsedSidebar(window);

    await revealFloatingSidebar(window);
    await expect(sidebar).toHaveClass(/translate-x-0/);

    await window.mouse.move(520, 160);
    await window.waitForTimeout(400);
    await expect(sidebar).toHaveClass(/-translate-x-full/);
  });

  test('collapsed floating sidebar stays open through drag and drop', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(200);
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(200);
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    const notes = window.locator('[data-note-id]');
    const source = notes.nth(2);
    const target = notes.nth(0);

    await collapseSidebar(window);
    await revealFloatingSidebar(window);

    const sidebar = collapsedSidebar(window);
    await expect(sidebar).toHaveClass(/translate-x-0/);
    await source.dragTo(target, {
      sourcePosition: { x: 20, y: 12 },
      targetPosition: { x: 20, y: 2 },
    });
    await window.waitForTimeout(350);

    await expect(sidebar).toHaveClass(/translate-x-0/);
    await expect(window.locator('[data-note-id]')).toHaveCount(3);
  });

  test('collapsed floating sidebar can collapse and reopen after drag', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(200);
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    const notes = window.locator('[data-note-id]');
    const source = notes.nth(1);
    const target = notes.nth(0);

    await collapseSidebar(window);
    await revealFloatingSidebar(window);

    const sidebar = collapsedSidebar(window);
    await expect(sidebar).toHaveClass(/translate-x-0/);
    await source.dragTo(target, {
      sourcePosition: { x: 20, y: 12 },
      targetPosition: { x: 20, y: 2 },
    });
    await window.waitForTimeout(250);
    await expect(sidebar).toHaveClass(/translate-x-0/);

    await window.mouse.move(520, 180);
    await window.waitForTimeout(450);
    await expect(sidebar).toHaveClass(/-translate-x-full/);

    await revealFloatingSidebar(window);
    await expect(sidebar).toHaveClass(/translate-x-0/);
    await expect(window.locator('[data-note-id]')).toHaveCount(2);
  });
});
