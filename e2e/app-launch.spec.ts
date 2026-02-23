import { test, expect } from './electron-app';

test.describe('App Launch', () => {
  test('window opens with correct title', async ({ electronApp }) => {
    const window = await electronApp.firstWindow();
    const title = await window.title();
    expect(title).toBeTruthy();
  });

  test('shows sidebar in expanded state', async ({ window }) => {
    const sidebar = window.locator('aside[data-state="expanded"]');
    await expect(sidebar).toBeVisible();
  });

  test('shows Notes section header', async ({ window }) => {
    await expect(window.getByText('Notes')).toBeVisible();
  });

  test('shows New Note button', async ({ window }) => {
    await expect(window.locator('[aria-label="New note"]')).toBeVisible();
  });

  test('shows empty state when no document is selected', async ({ window }) => {
    await expect(window.getByText('Start writing')).toBeVisible();
  });

  test('shows Trash Bin in sidebar footer', async ({ window }) => {
    await expect(window.getByText('Trash Bin')).toBeVisible();
  });

  test('shows Settings in sidebar footer', async ({ window }) => {
    await expect(window.getByText('Settings')).toBeVisible();
  });

  test('has tab navigation chevrons', async ({ window }) => {
    await expect(window.locator('[aria-label="Previous tab"]')).toBeVisible();
    await expect(window.locator('[aria-label="Next tab"]')).toBeVisible();
  });

  test('tab navigation chevrons are disabled when no tabs exist', async ({ window }) => {
    await expect(window.locator('[aria-label="Previous tab"]')).toBeDisabled();
    await expect(window.locator('[aria-label="Next tab"]')).toBeDisabled();
  });
});
