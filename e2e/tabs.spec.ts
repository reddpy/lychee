import { test, expect } from './electron-app';

test.describe('Tab Management', () => {
  test('creating a note opens a tab', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    const tabs = window.locator('[data-tab-id]');
    await expect(tabs).toHaveCount(1);
  });

  test('creating multiple notes opens multiple tabs', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    const tabs = window.locator('[data-tab-id]');
    await expect(tabs).toHaveCount(2);
  });

  test('clicking a tab switches the active document', async ({ window }) => {
    const visibleTitle = window.locator('main:visible h1.editor-title');

    // Create first note and type a title
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle.click();
    await window.keyboard.type('Note A');
    await window.waitForTimeout(600);

    // Create second note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle.click();
    await window.keyboard.type('Note B');
    await window.waitForTimeout(600);

    // Click the first tab (Note A)
    const tabA = window.locator('[data-tab-id]').filter({ hasText: 'Note A' });
    await tabA.click();
    await window.waitForTimeout(300);

    // The editor should show Note A's title
    await expect(visibleTitle).toContainText('Note A');
  });

  test('closing a tab removes it', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    await expect(window.locator('[data-tab-id]')).toHaveCount(1);

    // Close the tab
    const closeBtn = window.locator('[data-tab-id]').first().locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });
    await window.waitForTimeout(300);

    await expect(window.locator('[data-tab-id]')).toHaveCount(0);

    // Should return to empty state
    await expect(window.getByText('Start writing')).toBeVisible();
  });

  test('closing active tab switches to adjacent tab', async ({ window }) => {
    const visibleTitle = window.locator('main:visible h1.editor-title');

    // Create Note A
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle.click();
    await window.keyboard.type('Tab A');
    await window.waitForTimeout(600);

    // Create Note B
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle.click();
    await window.keyboard.type('Tab B');
    await window.waitForTimeout(600);

    // Currently on Tab B, close it
    const closeBtn = window.locator('[data-tab-id]').filter({ hasText: 'Tab B' }).locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });
    await window.waitForTimeout(300);

    // Tab A should now be active
    await expect(window.locator('[data-tab-id]')).toHaveCount(1);
    await expect(window.locator('[data-tab-id]').first()).toContainText('Tab A');
  });

  test('tab title updates when document title changes', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);

    const tab = window.locator('[data-tab-id]').first();
    await expect(tab).toContainText('New Page');

    // Type a title
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('Renamed Note');
    await window.waitForTimeout(700);

    await expect(tab).toContainText('Renamed Note');
  });

  test('tab chevrons enable when multiple tabs exist', async ({ window }) => {
    // Create first note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    // Create second note
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(300);

    // Click the first note in sidebar to select it
    const firstNote = window.locator('[data-note-id]').first();
    await firstNote.click();
    await window.waitForTimeout(300);

    // Previous tab should be disabled (we're on the first), next should be enabled
    // Actually the chevrons depend on the active tab position
    const prevBtn = window.locator('[aria-label="Previous tab"]');
    const nextBtn = window.locator('[aria-label="Next tab"]');

    // At least one should be enabled since we have 2 tabs
    const prevDisabled = await prevBtn.isDisabled();
    const nextDisabled = await nextBtn.isDisabled();
    expect(prevDisabled && nextDisabled).toBeFalsy();
  });
});
