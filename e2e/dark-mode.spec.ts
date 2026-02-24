import { test, expect } from './electron-app';
import type { Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────

/** Fast state seed — sets localStorage, DB, and .dark class directly. No UI. */
async function seedTheme(window: Page, mode: 'light' | 'dark' | 'system') {
  await window.evaluate((m) => {
    localStorage.setItem('lychee-theme', m);
    const dark = m === 'dark' ||
      (m === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }, mode);
  await window.evaluate((m) =>
    (window as any).lychee.invoke('settings.set', { key: 'theme', value: m }),
  mode);
}

/** Navigate to Settings > Appearance and click a theme button. */
async function setThemeViaUI(window: Page, label: 'Light' | 'Dark' | 'System') {
  const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
  await settingsBtn.click();

  const dialog = window.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();

  await dialog.getByText('Appearance', { exact: true }).click();
  await dialog.getByText(label, { exact: true }).click();

  await window.keyboard.press('Escape');
  await window.waitForTimeout(350);
}

/** Check whether <html> has the .dark class. */
async function hasDarkClass(window: Page): Promise<boolean> {
  return window.evaluate(() => document.documentElement.classList.contains('dark'));
}

/** Read theme from SQLite via IPC. */
async function getDbTheme(window: Page): Promise<string | null> {
  const result = await window.evaluate(() =>
    (window as any).lychee.invoke('settings.get', { key: 'theme' }),
  );
  return result.value;
}

/** Read theme from localStorage. */
async function getLocalStorageTheme(window: Page): Promise<string | null> {
  return window.evaluate(() => localStorage.getItem('lychee-theme'));
}

// ── Tests ────────────────────────────────────────────────

test.describe('Dark Mode', () => {
  // ────────────────────────────────────────────────────────
  // Theme switching via UI (tests the actual click flow)
  // ────────────────────────────────────────────────────────

  test('defaults to light theme on fresh launch', async ({ window }) => {
    expect(await hasDarkClass(window)).toBe(false);
  });

  test('switching to Dark via UI adds .dark class', async ({ window }) => {
    await setThemeViaUI(window, 'Dark');
    expect(await hasDarkClass(window)).toBe(true);
  });

  test('switching back to Light via UI removes .dark class', async ({ window }) => {
    await setThemeViaUI(window, 'Dark');
    expect(await hasDarkClass(window)).toBe(true);

    await setThemeViaUI(window, 'Light');
    expect(await hasDarkClass(window)).toBe(false);
  });

  test('System theme resolves via UI without error', async ({ window }) => {
    await setThemeViaUI(window, 'System');
    const dark = await hasDarkClass(window);
    expect(typeof dark).toBe('boolean');
  });

  // ────────────────────────────────────────────────────────
  // UI feedback (must use real clicks)
  // ────────────────────────────────────────────────────────

  test('selected theme button has active styling', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await dialog.getByText('Appearance', { exact: true }).click();

    const darkBtn = dialog.getByText('Dark', { exact: true });
    await darkBtn.click();
    await expect(darkBtn).toHaveClass(/font-medium/);

    const lightBtn = dialog.getByText('Light', { exact: true });
    await expect(lightBtn).not.toHaveClass(/font-medium/);
  });

  // ────────────────────────────────────────────────────────
  // Dual-write: UI click writes to both stores
  // ────────────────────────────────────────────────────────

  test('UI click persists to both localStorage and SQLite', async ({ window }) => {
    await setThemeViaUI(window, 'Dark');
    await window.waitForTimeout(200);

    expect(await getLocalStorageTheme(window)).toBe('dark');
    expect(await getDbTheme(window)).toBe('dark');
  });

  test('multiple UI switches leave both stores in sync', async ({ window }) => {
    for (const theme of ['Dark', 'Light', 'System', 'Dark'] as const) {
      await setThemeViaUI(window, theme);
    }
    await window.waitForTimeout(200);

    expect(await getLocalStorageTheme(window)).toBe('dark');
    expect(await getDbTheme(window)).toBe('dark');
  });

  // ────────────────────────────────────────────────────────
  // CSS variables respond to theme (seeded, no UI needed)
  // ────────────────────────────────────────────────────────

  test('body background differs between light and dark', async ({ window }) => {
    const lightBg = await window.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );

    await seedTheme(window, 'dark');

    const darkBg = await window.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );

    expect(lightBg).not.toBe(darkBg);
  });

  // ────────────────────────────────────────────────────────
  // Sync: both stores agree → stays consistent after reload
  // ────────────────────────────────────────────────────────

  test('sync: dark in both stores survives reload', async ({ window }) => {
    await seedTheme(window, 'dark');

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(true);
    expect(await getLocalStorageTheme(window)).toBe('dark');
    expect(await getDbTheme(window)).toBe('dark');
  });

  test('sync: light in both stores survives reload', async ({ window }) => {
    await seedTheme(window, 'light');

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(false);
    expect(await getLocalStorageTheme(window)).toBe('light');
    expect(await getDbTheme(window)).toBe('light');
  });

  test('sync: system in both stores survives reload', async ({ window }) => {
    await seedTheme(window, 'system');

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await getLocalStorageTheme(window)).toBe('system');
    expect(await getDbTheme(window)).toBe('system');
  });

  // ────────────────────────────────────────────────────────
  // Desync: localStorage ≠ DB → localStorage always wins,
  //         DB is reconciled to match after reload
  // ────────────────────────────────────────────────────────

  test('desync: localStorage=dark, DB=light → dark wins', async ({ window }) => {
    await seedTheme(window, 'light');
    await window.evaluate(() => localStorage.setItem('lychee-theme', 'dark'));

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(true);
    expect(await getLocalStorageTheme(window)).toBe('dark');
    expect(await getDbTheme(window)).toBe('dark');
  });

  test('desync: localStorage=light, DB=dark → light wins', async ({ window }) => {
    await seedTheme(window, 'dark');
    await window.evaluate(() => localStorage.setItem('lychee-theme', 'light'));

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(false);
    expect(await getLocalStorageTheme(window)).toBe('light');
    expect(await getDbTheme(window)).toBe('light');
  });

  test('desync: localStorage=system, DB=dark → system wins', async ({ window }) => {
    await seedTheme(window, 'dark');
    await window.evaluate(() => localStorage.setItem('lychee-theme', 'system'));

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await getLocalStorageTheme(window)).toBe('system');
    expect(await getDbTheme(window)).toBe('system');
  });

  test('desync: localStorage=dark, DB=system → dark wins', async ({ window }) => {
    await seedTheme(window, 'system');
    await window.evaluate(() => localStorage.setItem('lychee-theme', 'dark'));

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(true);
    expect(await getLocalStorageTheme(window)).toBe('dark');
    expect(await getDbTheme(window)).toBe('dark');
  });

  test('desync: localStorage=system, DB=light → system wins', async ({ window }) => {
    await seedTheme(window, 'light');
    await window.evaluate(() => localStorage.setItem('lychee-theme', 'system'));

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await getLocalStorageTheme(window)).toBe('system');
    expect(await getDbTheme(window)).toBe('system');
  });

  test('desync: localStorage=light, DB=system → light wins', async ({ window }) => {
    await seedTheme(window, 'system');
    await window.evaluate(() => localStorage.setItem('lychee-theme', 'light'));

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(false);
    expect(await getLocalStorageTheme(window)).toBe('light');
    expect(await getDbTheme(window)).toBe('light');
  });

  // ────────────────────────────────────────────────────────
  // Edge cases: missing or invalid localStorage
  // ────────────────────────────────────────────────────────

  test('empty localStorage falls back to light and reconciles both stores', async ({ window }) => {
    await seedTheme(window, 'dark');
    await window.evaluate(() => localStorage.removeItem('lychee-theme'));

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(false);
    expect(await getLocalStorageTheme(window)).toBe('light');
    expect(await getDbTheme(window)).toBe('light');
  });

  test('invalid localStorage value falls back to light and reconciles both stores', async ({ window }) => {
    await seedTheme(window, 'dark');
    await window.evaluate(() => localStorage.setItem('lychee-theme', 'garbage'));

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(false);
    expect(await getLocalStorageTheme(window)).toBe('light');
    expect(await getDbTheme(window)).toBe('light');
  });

  test('both stores empty (fresh install) → light default in both stores', async ({ window }) => {
    await window.evaluate(() => localStorage.removeItem('lychee-theme'));
    await window.evaluate(() =>
      (window as any).lychee.invoke('settings.set', { key: 'theme', value: '' }),
    );

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await window.waitForTimeout(500);

    expect(await hasDarkClass(window)).toBe(false);
    expect(await getLocalStorageTheme(window)).toBe('light');
    expect(await getDbTheme(window)).toBe('light');
  });
});
