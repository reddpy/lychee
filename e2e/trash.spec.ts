import { test, expect, listDocumentsFromDb, listTrashedFromDb, getDocumentFromDb } from './electron-app';

async function createAndTrashNote(
  window: any,
  title: string,
  bodyLines: string[] = [],
): Promise<string> {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  await window.locator('h1.editor-title').click();
  await window.keyboard.type(title);
  // The title is a separate field; commit it (Enter) so the sidebar shows it.
  await window.keyboard.press('Enter');
  for (let i = 0; i < bodyLines.length; i += 1) {
    await window.keyboard.type(bodyLines[i]);
    if (i < bodyLines.length - 1) await window.keyboard.press('Enter');
  }
  await window.waitForTimeout(700);

  const noteId = await window
    .locator('[data-note-id]')
    .first()
    .getAttribute('data-note-id');

  const note = window.locator('[data-note-id]').filter({ hasText: title });
  await note.click({ button: 'right' });
  await window.getByText('Move to Trash Bin').click();
  await window.waitForTimeout(400);

  return noteId!;
}

test.describe('Trash Bin', () => {
  test('move a note to trash via context menu', async ({ window }) => {
    // Create a note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Trashable Note');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(700);

    const noteId = await window.locator('[data-note-id]').first().getAttribute('data-note-id');

    // Right-click the note in sidebar
    const note = window.locator('[data-note-id]').filter({ hasText: 'Trashable Note' });
    await note.click({ button: 'right' });

    // Click "Move to Trash Bin"
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Note should be gone from sidebar
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Trashable Note' })).toHaveCount(0);

    // Tab should be closed, back to empty state
    await expect(window.getByTestId('empty-state')).toBeVisible();

    // ── Backend: document has deletedAt set in SQLite ──
    const doc = await getDocumentFromDb(window, noteId!);
    expect(doc).toBeTruthy();
    expect(doc!.deletedAt).toBeTruthy();

    // Active documents list should be empty
    const activeDocs = await listDocumentsFromDb(window);
    expect(activeDocs).toHaveLength(0);

    // Trashed documents list should contain it
    const trashedDocs = await listTrashedFromDb(window);
    expect(trashedDocs).toHaveLength(1);
    expect(trashedDocs[0].title).toBe('Trashable Note');
  });

  test('open trash bin popover', async ({ window }) => {
    const trashBtn = window.locator('[aria-label="Trash Bin"]');
    await trashBtn.click();

    // The popover should show with a search input
    await expect(window.getByPlaceholder('Search trash...')).toBeVisible();
  });

  test('trashed note appears in trash bin', async ({ window }) => {
    // Create and trash a note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('For Trash');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(700);

    const note = window.locator('[data-note-id]').filter({ hasText: 'For Trash' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Open trash bin
    const trashBtn = window.locator('[aria-label="Trash Bin"]');
    await trashBtn.click();
    await window.waitForTimeout(500);

    // The trashed note should appear (scoped to the browser: the open tab and
    // the preview panel also render the same title).
    await expect(
      window.getByTestId('trash-browser').getByText('For Trash').first(),
    ).toBeVisible();
  });

  test('restore a note from trash', async ({ window }) => {
    // Create and trash a note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Restore Me');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(700);

    const noteId = await window.locator('[data-note-id]').first().getAttribute('data-note-id');

    const note = window.locator('[data-note-id]').filter({ hasText: 'Restore Me' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // ── Backend: confirm it's trashed ──
    let doc = await getDocumentFromDb(window, noteId!);
    expect(doc!.deletedAt).toBeTruthy();

    // Open trash bin
    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);

    // Click Restore button
    await window.locator('[aria-label="Restore"]').first().click();
    await window.waitForTimeout(500);

    // Close the trash popover by pressing Escape
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // The note should reappear in the sidebar
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Restore Me' })).toHaveCount(1);

    // ── Backend: deletedAt is cleared after restore ──
    doc = await getDocumentFromDb(window, noteId!);
    expect(doc).toBeTruthy();
    expect(doc!.deletedAt).toBeNull();

    const activeDocs = await listDocumentsFromDb(window);
    expect(activeDocs).toHaveLength(1);
    expect(activeDocs[0].title).toBe('Restore Me');
  });

  test('permanently delete a note from trash', async ({ window }) => {
    // Reproduce the hover-only sidebar mode from issue #241.
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(300);
    await window.mouse.move(1, 200);
    await window.waitForTimeout(300);

    // Create and trash a note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Delete Forever');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(700);

    // Return to the edge trigger before interacting with the floating sidebar.
    await window.mouse.move(1, 200);
    await window.waitForTimeout(300);
    const noteId = await window.locator('[data-note-id]').first().getAttribute('data-note-id');

    const note = window.locator('[data-note-id]').filter({ hasText: 'Delete Forever' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Open trash bin
    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);

    // Click delete button
    await window.locator('[aria-label="Permanently delete"]').first().click();
    await window.waitForTimeout(300);

    // Confirm dialog should appear
    await expect(window.getByText('Are you sure you want to delete this note from Trash?')).toBeVisible();

    // Confirm deletion
    await window.getByRole('button', { name: 'Delete note' }).click();
    await window.waitForTimeout(400);

    // Completing the dialog closes the popover and releases its floating-sidebar lock.
    await expect(window.getByPlaceholder('Search trash...')).not.toBeVisible();
    await window.mouse.move(700, 300);
    await window.waitForTimeout(300);
    await expect(window.locator('aside[data-state="collapsed"]')).toHaveClass(/-translate-x-full/);

    // Trash should be empty or the note should be gone
    await expect(window.getByText('Delete Forever')).not.toBeVisible();

    // ── Backend: document is completely gone from SQLite ──
    const doc = await getDocumentFromDb(window, noteId!);
    expect(doc).toBeNull();

    const trashedDocs = await listTrashedFromDb(window);
    expect(trashedDocs).toHaveLength(0);
  });

  test('search within trash bin', async ({ window }) => {
    // Create and trash two notes
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Alpha Note');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(700);

    let note = window.locator('[data-note-id]').filter({ hasText: 'Alpha Note' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Beta Note');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(700);

    note = window.locator('[data-note-id]').filter({ hasText: 'Beta Note' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // ── Backend: both docs are trashed ──
    const trashedDocs = await listTrashedFromDb(window);
    expect(trashedDocs).toHaveLength(2);

    // Open trash bin
    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);

    // Search for "Alpha"
    const searchInput = window.getByPlaceholder('Search trash...');
    await searchInput.fill('Alpha');
    await window.waitForTimeout(300);

    // Should show Alpha, not Beta (scoped to the browser; the tab strip also
    // renders note titles).
    const trashBrowser = window.getByTestId('trash-browser');
    await expect(trashBrowser.getByText('Alpha Note').first()).toBeVisible();
    await expect(trashBrowser.getByText('Beta Note')).toHaveCount(0);
  });

  test('trash browser previews the selected note without extra clicks', async ({ window }) => {
    await createAndTrashNote(window, 'Preview Me', [
      'First preview line',
      'Second preview line',
    ]);

    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);

    const browser = window.getByTestId('trash-browser');
    await expect(browser).toBeVisible();
    // The first note is selected automatically and its content previews.
    await expect(window.getByTestId('trash-preview-title')).toHaveText('Preview Me');
    await expect(browser.getByText('First preview line')).toBeVisible();
    await expect(browser.getByText('Second preview line')).toBeVisible();

    const trashedDocs = await listTrashedFromDb(window);
    expect(trashedDocs).toHaveLength(1);
  });

  test('trash browser updates the preview as selection changes', async ({ window }) => {
    await createAndTrashNote(window, 'Older Note', ['older body line']);
    await createAndTrashNote(window, 'Newer Note', ['newer body line']);

    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);

    const browser = window.getByTestId('trash-browser');
    const items = browser.locator('[cmdk-item][data-doc-id]');
    await expect(items).toHaveCount(2);

    // Selecting each trashed note swaps the preview in place, no clicks to open.
    await items.filter({ hasText: 'Older Note' }).click();
    await expect(window.getByTestId('trash-preview-title')).toHaveText('Older Note');
    await expect(browser.getByText('older body line')).toBeVisible();

    await items.filter({ hasText: 'Newer Note' }).click();
    await expect(window.getByTestId('trash-preview-title')).toHaveText('Newer Note');
    await expect(browser.getByText('newer body line')).toBeVisible();
  });

  test('restore a note from the trash browser preview', async ({ window }) => {
    const noteId = await createAndTrashNote(window, 'Restore From Browser', ['keep me']);

    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);

    await window.locator('[aria-label="Restore"]').first().click();
    await window.waitForTimeout(500);

    // The browser stays open after restoring, but the note leaves the list.
    await expect(window.getByTestId('trash-browser')).toBeVisible();
    await expect(
      window.getByTestId('trash-browser').getByText('Restore From Browser'),
    ).toHaveCount(0);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
    await expect(
      window.locator('[data-note-id]').filter({ hasText: 'Restore From Browser' }),
    ).toHaveCount(1);

    const doc = await getDocumentFromDb(window, noteId);
    expect(doc).toBeTruthy();
    expect(doc!.deletedAt).toBeNull();
  });

  test('permanently delete a note from the trash browser preview', async ({ window }) => {
    const noteId = await createAndTrashNote(window, 'Delete From Browser', ['delete me']);

    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);

    await window.locator('[aria-label="Permanently delete"]').first().click();

    const confirm = window.getByTestId('trash-delete-confirm');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete note' }).click();
    await window.waitForTimeout(400);

    // Completing a permanent delete closes the browser.
    await expect(window.getByTestId('trash-browser')).toHaveCount(0);
    await expect(window.getByPlaceholder('Search trash...')).not.toBeVisible();

    const doc = await getDocumentFromDb(window, noteId);
    expect(doc).toBeNull();
  });
});
