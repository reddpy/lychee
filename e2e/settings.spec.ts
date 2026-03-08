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

test.describe('Settings Modal — responsive sizing', () => {
  async function openSettingsDialog(window: import('@playwright/test').Page) {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
    } else {
      const collapsedBtn = window.locator('button[aria-label="Settings"]');
      await collapsedBtn.click();
    }
    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('dialog stays within viewport at minimum window size', async ({ electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setSize(680, 480);
    });
    await window.waitForTimeout(400);

    const dialog = await openSettingsDialog(window);
    const dialogBox = await dialog.boundingBox();
    const viewport = window.viewportSize();

    expect(dialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('dialog height shrinks with a small viewport', async ({ electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(800, 500);
    });
    await window.waitForTimeout(400);

    const dialog = await openSettingsDialog(window);
    const dialogBox = await dialog.boundingBox();
    const viewport = window.viewportSize();

    expect(dialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    // Dialog height should be less than the viewport height (capped by 100vh - 6rem)
    expect(dialogBox!.height).toBeLessThan(viewport!.height);
    // And it must not overflow the bottom
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('dialog uses full height (32rem) when viewport is large', async ({ electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1200, 900);
    });
    await window.waitForTimeout(400);

    const dialog = await openSettingsDialog(window);
    const dialogBox = await dialog.boundingBox();

    expect(dialogBox).toBeTruthy();

    // 32rem = 512px at default 16px root font size
    expect(dialogBox!.height).toBeGreaterThanOrEqual(500);
    expect(dialogBox!.height).toBeLessThanOrEqual(520);
  });

  test('nav and content remain visible at small viewport', async ({ electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(680, 480);
    });
    await window.waitForTimeout(400);

    const dialog = await openSettingsDialog(window);

    const nav = dialog.locator('nav');
    await expect(nav).toBeVisible();
    await expect(nav.getByText('General', { exact: true })).toBeVisible();
    await expect(nav.getByText('Appearance', { exact: true })).toBeVisible();
    await expect(nav.getByText('Editor', { exact: true })).toBeVisible();

    await expect(dialog.getByText('General settings will appear here.')).toBeVisible();
  });

  test('section switching works at small viewport', async ({ electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(680, 480);
    });
    await window.waitForTimeout(400);

    const dialog = await openSettingsDialog(window);

    await dialog.getByText('Appearance', { exact: true }).click();
    await expect(dialog.getByText('Choose how Lychee looks.')).toBeVisible();

    await dialog.getByText('Editor', { exact: true }).click();
    await expect(dialog.getByText('Editor settings will appear here.')).toBeVisible();
  });

  test('dialog width respects viewport margins', async ({ electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(680, 480);
    });
    await window.waitForTimeout(400);

    const dialog = await openSettingsDialog(window);
    const dialogBox = await dialog.boundingBox();
    const viewport = window.viewportSize();

    expect(dialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    // Should have at least 1rem (16px) margin on each side
    const leftMargin = dialogBox!.x;
    const rightMargin = viewport!.width - (dialogBox!.x + dialogBox!.width);
    expect(leftMargin).toBeGreaterThanOrEqual(12);
    expect(rightMargin).toBeGreaterThanOrEqual(12);
  });
});
