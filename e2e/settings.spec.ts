import { test, expect } from './electron-app';

/** Click outside the dialog to dismiss it via the Radix overlay. */
async function clickOutsideDialog(window: import('@playwright/test').Page) {
  const dialog = window.locator('[data-slot="dialog-content"]');
  const box = await dialog.boundingBox();
  if (!box) throw new Error('Dialog not visible — cannot compute outside click target');

  // Click below the dialog, horizontally centered. The overlay covers the
  // full viewport behind the dialog, so any point outside the content works.
  const x = box.x + box.width / 2;
  const y = box.y + box.height + 40;
  await window.mouse.click(x, y);
  await window.waitForTimeout(300);
}

test.describe('Settings Modal', () => {
  test('opens from expanded sidebar Settings button', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Settings');
  });

  test('opens from collapsed sidebar Settings icon', async ({ window }) => {
    // Collapse the sidebar
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(600);

    await expect(window.locator('aside[data-state="expanded"]')).not.toBeVisible();

    // Click the collapsed widget settings button
    const collapsedSettings = window.locator('button[aria-label="Settings"]');
    await collapsedSettings.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Settings');
  });

  test('closes when pressing Escape', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    await expect(dialog).not.toBeVisible();
  });

  test('closes when clicking outside (expanded sidebar)', async ({ electronApp, window }) => {
    // Enlarge the window so there is ample overlay area around the dialog
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1200, 900);
    });
    await window.waitForTimeout(300);

    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await clickOutsideDialog(window);

    await expect(dialog).not.toBeVisible();
  });

  test('closes when clicking outside (collapsed sidebar)', async ({ electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1200, 900);
    });
    await window.waitForTimeout(300);

    // Collapse sidebar
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(600);
    await expect(window.locator('aside[data-state="expanded"]')).not.toBeVisible();

    // Open settings from collapsed widget
    await window.locator('button[aria-label="Settings"]').click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await clickOutsideDialog(window);

    await expect(dialog).not.toBeVisible();
  });

  test('defaults to General section', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('General settings will appear here.')).toBeVisible();
  });

  test('left nav switches between sections', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    // Switch to Appearance
    await dialog.getByText('Appearance', { exact: true }).click();
    await expect(dialog.getByText('Choose how Lychee looks.')).toBeVisible();

    // Switch to Editor
    await dialog.getByText('Editor', { exact: true }).click();
    await expect(dialog.getByText('Editor settings will appear here.')).toBeVisible();

    // Switch back to General
    await dialog.getByText('General', { exact: true }).click();
    await expect(dialog.getByText('General settings will appear here.')).toBeVisible();
  });

  test('resets to General section on reopen', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    // Switch to Editor
    await dialog.getByText('Editor', { exact: true }).click();
    await expect(dialog.getByText('Editor settings will appear here.')).toBeVisible();

    // Close and reopen
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
    await expect(dialog).not.toBeVisible();

    await settingsBtn.click();
    await expect(dialog).toBeVisible();

    // Should be back on General
    await expect(dialog.getByText('General settings will appear here.')).toBeVisible();
  });

  test('shows all three section nav buttons', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    const nav = dialog.locator('nav');
    await expect(nav.getByText('General', { exact: true })).toBeVisible();
    await expect(nav.getByText('Appearance', { exact: true })).toBeVisible();
    await expect(nav.getByText('Editor', { exact: true })).toBeVisible();
  });
});
