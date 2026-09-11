import {
  test,
  expect,
  findPackagedBinary,
  hasDevBuild,
  PROJECT_ROOT,
} from './electron-app';
import {
  test as base,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openAppearanceSettings(window: Page) {
  await window.locator('aside[data-state="expanded"]').getByText('Settings').click();
  const dialog = window.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('nav').getByRole('button', { name: 'Appearance' }).click();
  return dialog;
}

async function readAppearanceSetting(window: Page): Promise<any> {
  const result = await window.evaluate(() =>
    window.lychee.invoke('settings.get', { key: 'ui.appearance' }),
  );
  const value = (result as { value: string | null }).value;
  return value ? JSON.parse(value) : null;
}

function readInlineVar(window: Page, name: string): Promise<string> {
  return window.evaluate(
    (varName) => document.documentElement.style.getPropertyValue(varName).trim(),
    name,
  );
}

async function createNoteWithText(window: Page, title: string, text: string) {
  await window.locator('[aria-label="New note"]').click();
  await window.waitForTimeout(400);
  await window.locator('main:visible h1.editor-title').click();
  await window.keyboard.type(title);
  await window.keyboard.press('Enter');
  await window.keyboard.type(text);
  await window.waitForTimeout(400);
}

test.describe('Appearance: accent color', () => {
  test('selecting a preset updates the accent live and persists', async ({ window }) => {
    const dialog = await openAppearanceSettings(window);

    const preset = dialog.locator('[data-testid="accent-preset"][data-accent="#0ea5e9"]');
    await preset.click();
    await expect(preset).toHaveAttribute('aria-pressed', 'true');

    const primary = await readInlineVar(window, '--primary');
    expect(primary).toBeTruthy();
    expect(primary).not.toBe('');
    // Sky's hue is far from the default brand red (355).
    expect(primary.startsWith('199')).toBe(true);

    const stored = await readAppearanceSetting(window);
    expect(stored?.accent).toBe('#0ea5e9');
  });

  test('reset clears the override back to the ship default', async ({ window }) => {
    const dialog = await openAppearanceSettings(window);
    await dialog.locator('[data-testid="accent-preset"][data-accent="#0ea5e9"]').click();
    expect(await readInlineVar(window, '--primary')).not.toBe('');

    await dialog.locator('[data-testid="accent-reset"]').click();
    expect(await readInlineVar(window, '--primary')).toBe('');

    const stored = await readAppearanceSetting(window);
    expect(stored?.accent).toBeNull();
  });

  test('custom accent circle opens a themed picker and applies the color', async ({ window }) => {
    const dialog = await openAppearanceSettings(window);
    const custom = dialog.locator('[data-testid="accent-custom"]');
    await expect(custom).toBeVisible();
    await expect(custom).toHaveAttribute('aria-pressed', 'false');

    await custom.click();
    const popover = window.locator('[data-slot="popover-content"]');
    await expect(popover).toBeVisible();

    // Themed, curved popup (not the OS color dialog).
    const radius = await popover.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(parseFloat(radius)).toBeGreaterThan(0);

    const hex = popover.getByLabel('Hex color');
    await hex.fill('#00ff00');
    await hex.press('Enter');

    await expect(custom).toHaveAttribute('aria-pressed', 'true');
    expect(await readInlineVar(window, '--primary')).not.toBe('');
    expect((await readAppearanceSetting(window))?.accent).toBe('#00ff00');
  });

  test('accent is persisted into the settings table', async ({ window }) => {
    const dialog = await openAppearanceSettings(window);
    await dialog.locator('[data-testid="accent-preset"][data-accent="#0ea5e9"]').click();

    const snapshot = await window.evaluate(() =>
      window.lychee.invoke('settings.getAll', {}),
    );
    const raw = (snapshot as { settings: Record<string, string> }).settings['ui.appearance'];
    expect(raw, 'ui.appearance should be present in settings.getAll').toBeTruthy();

    const parsed = JSON.parse(raw);
    expect(parsed.accent).toBe('#0ea5e9');
    expect(Array.isArray(parsed.highlightPalette)).toBe(true);
  });
});

test.describe('Appearance: highlight', () => {
  test('default highlight is always the bright yellow', async ({ window }) => {
    await createNoteWithText(window, 'Default Highlight', 'marked');
    await window.keyboard.press(`${mod}+a`);
    await window.keyboard.press(`${mod}+Shift+h`);

    const highlight = window
      .locator('main:visible .ContentEditable__root mark span')
      .first();
    await expect(highlight).toBeVisible();
    const background = await highlight.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).toBe('rgb(253, 224, 71)');
  });

  test('the highlight palette in settings persists (add, remove, custom, reset)', async ({ window }) => {
    const dialog = await openAppearanceSettings(window);
    const preset = (hex: string) =>
      dialog.locator(`[data-testid="highlight-preset"][data-color="${hex}"]`);

    // Ten presets are offered; the default six are active.
    await expect(dialog.locator('[data-testid="highlight-preset"]')).toHaveCount(10);
    await expect(preset('#f87171')).toHaveAttribute('aria-pressed', 'true');
    await expect(preset('#34d399')).toHaveAttribute('aria-pressed', 'false');

    // Add a preset that is not in the default palette.
    await preset('#60a5fa').click();
    await expect(preset('#60a5fa')).toHaveAttribute('aria-pressed', 'true');
    let stored = await readAppearanceSetting(window);
    expect(stored?.highlightPalette).toContain('#60a5fa');
    expect(stored?.highlightPalette).toHaveLength(7);

    // Remove a default preset.
    await preset('#f87171').click();
    await expect(preset('#f87171')).toHaveAttribute('aria-pressed', 'false');
    stored = await readAppearanceSetting(window);
    expect(stored?.highlightPalette).not.toContain('#f87171');
    expect(stored?.highlightPalette).toHaveLength(6);

    // Add a custom hex color via the themed picker.
    await dialog.locator('[data-testid="highlight-custom"]').click();
    const popover = window.locator('[data-slot="popover-content"]');
    await expect(popover).toBeVisible();
    const hex = popover.getByLabel('Hex color');
    await hex.fill('#123456');
    await hex.press('Enter');
    await expect(
      popover.locator('[aria-label="Saturation and brightness"]'),
    ).toBeVisible();

    await dialog.locator('[data-testid="highlight-add"]').click();
    await expect(
      dialog.locator('[data-testid="highlight-preset"][data-color="#123456"]'),
    ).toHaveAttribute('aria-pressed', 'true');
    stored = await readAppearanceSetting(window);
    expect(stored?.highlightPalette).toContain('#123456');

    // Reset restores the defaults.
    await dialog.locator('[data-testid="palette-reset"]').click();
    stored = await readAppearanceSetting(window);
    expect(stored?.highlightPalette).toEqual([
      '#f87171',
      '#fb923c',
      '#facc15',
      '#4ade80',
      '#38bdf8',
      '#c084fc',
    ]);
  });
});

test.describe('Appearance — edge cases', () => {
  async function openPicker(window: Page) {
    const dialog = await openAppearanceSettings(window);
    await dialog.locator('[data-testid="accent-custom"]').click();
    const popover = window.locator('[data-slot="popover-content"]');
    await expect(popover).toBeVisible();
    return { dialog, popover, hex: popover.getByLabel('Hex color') };
  }

  test('an invalid hex in the picker keeps the current accent', async ({ window }) => {
    const { popover, hex } = await openPicker(window);

    await hex.fill('not-a-color');
    await hex.press('Enter');

    // Picker reverts to the current value; nothing persisted.
    await expect(hex).toHaveValue('#c14b55');
    expect((await readAppearanceSetting(window)) ?? null).toBeNull();
    await expect(popover).toBeVisible();
  });

  test('shorthand hex is expanded to a normalized value', async ({ window }) => {
    const { hex } = await openPicker(window);

    await hex.fill('#0ea');
    await hex.press('Enter');

    expect((await readAppearanceSetting(window))?.accent).toBe('#00eeaa');
  });

  test('picks a readable primary foreground for light and dark accents', async ({ window }) => {
    const { dialog, hex } = await openPicker(window);

    // Very light accent → dark foreground.
    await hex.fill('#fde047');
    await hex.press('Enter');
    expect(await readInlineVar(window, '--primary-foreground')).toBe('20 15% 8%');

    // Dark preset → white foreground.
    await window.keyboard.press('Escape');
    await dialog.locator('[data-testid="accent-preset"][data-accent="#64748b"]').click();
    expect(await readInlineVar(window, '--primary-foreground')).toBe('0 0% 100%');
  });

  test('accent survives switching the theme mode', async ({ window }) => {
    const dialog = await openAppearanceSettings(window);
    await dialog.locator('[data-testid="accent-preset"][data-accent="#0ea5e9"]').click();
    const before = await readInlineVar(window, '--primary');
    expect(before).not.toBe('');

    await dialog.getByText('Dark', { exact: true }).click();
    await window.waitForTimeout(200);

    // Inline override wins over the `.dark` class tokens.
    expect(await readInlineVar(window, '--primary')).toBe(before);
  });

  test('the highlight palette can never be emptied', async ({ window }) => {
    const dialog = await openAppearanceSettings(window);
    const preset = (color: string) =>
      dialog.locator(`[data-testid="highlight-preset"][data-color="${color}"]`);

    // Toggle off five of the six defaults, leaving only red.
    for (const color of ['#fb923c', '#facc15', '#4ade80', '#38bdf8', '#c084fc']) {
      await preset(color).click();
    }
    expect((await readAppearanceSetting(window))?.highlightPalette).toHaveLength(1);

    // Attempting to remove the last one is a no-op.
    await preset('#f87171').click();
    await expect(preset('#f87171')).toHaveAttribute('aria-pressed', 'true');
    expect((await readAppearanceSetting(window))?.highlightPalette).toEqual(['#f87171']);
  });
});

function buildRestartLaunchOptions(
  tmpDir: string,
): Parameters<typeof _electron.launch>[0] {
  const packagedBinary = findPackagedBinary();
  const options: Parameters<typeof _electron.launch>[0] = {
    env: { ...process.env, NODE_ENV: 'test', E2E: '1' },
    timeout: process.env.CI ? 60_000 : 30_000,
  };
  const extraArgs =
    process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : [];

  if (packagedBinary) {
    options.executablePath = packagedBinary;
    options.args = [`--user-data-dir=${tmpDir}`, ...extraArgs];
  } else if (hasDevBuild()) {
    options.args = [PROJECT_ROOT, `--user-data-dir=${tmpDir}`, ...extraArgs];
  } else {
    throw new Error('No Electron build found.');
  }
  return options;
}

async function launchRestartSession(
  tmpDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await _electron.launch(buildRestartLaunchOptions(tmpDir));
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
  return { app, window };
}

base.describe('Appearance — full app restart persistence', () => {
  let tmpDir: string;

  base.beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-appearance-persist-'));
  });

  base.afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  base('accent + highlight palette survive a complete restart', async () => {
    let session = await launchRestartSession(tmpDir);
    try {
      await session.window.evaluate(() =>
        window.lychee.invoke('settings.set', {
          key: 'ui.appearance',
          value: JSON.stringify({
            version: 1,
            accent: '#123456',
            highlightPalette: ['#facc15', '#4ade80'],
          }),
        }),
      );

      // Confirm it physically landed in the settings table.
      const stored = await session.window.evaluate(() =>
        window.lychee.invoke('settings.get', { key: 'ui.appearance' }),
      );
      expect(JSON.parse((stored as { value: string }).value).accent).toBe('#123456');
    } finally {
      await session.app.close();
    }

    session = await launchRestartSession(tmpDir);
    try {
      const { window } = session;

      // Boot applied the saved accent to the root CSS token.
      const primary = await window.evaluate(() =>
        document.documentElement.style.getPropertyValue('--primary').trim(),
      );
      expect(primary).not.toBe('');

      // Settings UI reflects the persisted palette + custom accent.
      const dialog = await openAppearanceSettings(window);
      await expect(
        dialog.locator('[data-testid="highlight-preset"][data-color="#facc15"]'),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        dialog.locator('[data-testid="highlight-preset"][data-color="#4ade80"]'),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.locator('[data-testid="accent-custom"]')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    } finally {
      await session.app.close();
    }
  });
});
