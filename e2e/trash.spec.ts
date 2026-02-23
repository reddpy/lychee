import { test, expect } from './electron-app';

test.describe('Trash Bin', () => {
  test('move a note to trash via context menu', async ({ window }) => {
    // Create a note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Trashable Note');
    await window.waitForTimeout(700);

    // Right-click the note in sidebar
    const note = window.locator('[data-note-id]').filter({ hasText: 'Trashable Note' });
    await note.click({ button: 'right' });

    // Click "Move to Trash Bin"
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Note should be gone from sidebar
    await expect(window.locator('[data-note-id]').filter({ hasText: 'Trashable Note' })).toHaveCount(0);

    // Tab should be closed, back to empty state
    await expect(window.getByText('Start writing')).toBeVisible();
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
    await window.waitForTimeout(700);

    const note = window.locator('[data-note-id]').filter({ hasText: 'For Trash' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Open trash bin
    const trashBtn = window.locator('[aria-label="Trash Bin"]');
    await trashBtn.click();
    await window.waitForTimeout(500);

    // The trashed note should appear
    await expect(window.getByText('For Trash')).toBeVisible();
  });

  test('restore a note from trash', async ({ window }) => {
    // Create and trash a note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Restore Me');
    await window.waitForTimeout(700);

    const note = window.locator('[data-note-id]').filter({ hasText: 'Restore Me' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

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
  });

  test('permanently delete a note from trash', async ({ window }) => {
    // Create and trash a note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Delete Forever');
    await window.waitForTimeout(700);

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
    await expect(window.getByText('Are you sure you want to delete this page from Trash?')).toBeVisible();

    // Confirm deletion
    await window.getByRole('button', { name: 'Delete page' }).click();
    await window.waitForTimeout(400);

    // Trash should be empty or the note should be gone
    await expect(window.getByText('Delete Forever')).not.toBeVisible();
  });

  test('search within trash bin', async ({ window }) => {
    // Create and trash two notes
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Alpha Note');
    await window.waitForTimeout(700);

    let note = window.locator('[data-note-id]').filter({ hasText: 'Alpha Note' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('h1.editor-title').click();
    await window.keyboard.type('Beta Note');
    await window.waitForTimeout(700);

    note = window.locator('[data-note-id]').filter({ hasText: 'Beta Note' });
    await note.click({ button: 'right' });
    await window.getByText('Move to Trash Bin').click();
    await window.waitForTimeout(400);

    // Open trash bin
    await window.locator('[aria-label="Trash Bin"]').click();
    await window.waitForTimeout(500);

    // Search for "Alpha"
    const searchInput = window.getByPlaceholder('Search trash...');
    await searchInput.fill('Alpha');
    await window.waitForTimeout(300);

    // Should show Alpha, not Beta
    await expect(window.getByText('Alpha Note')).toBeVisible();
    await expect(window.getByText('Beta Note')).not.toBeVisible();
  });
});
