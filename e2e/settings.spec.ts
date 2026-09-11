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

import { clearIpcMocks, mockIpcReject, mockIpcResolve } from './ipc-mock';

/** Click outside the dialog to dismiss it via the Radix overlay. */
async function clickOutsideDialog(window: import('@playwright/test').Page) {
  // Target the actual Radix dismiss layer. Coordinate math against the dialog
  // can land on window chrome or another fixed surface as viewport insets vary.
  await window
    .locator('[data-slot="dialog-overlay"]')
    .click({ position: { x: 1, y: 1 } });
  await window.waitForTimeout(300);
}

async function openEditorSettings(window: import('@playwright/test').Page) {
  await window
    .locator('aside[data-state="expanded"]')
    .getByText('Settings')
    .click();
  const dialog = window.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await dialog.getByText('Editor', { exact: true }).click();
  return dialog;
}

async function openGeneralSettings(window: import('@playwright/test').Page) {
  await window
    .locator('aside[data-state="expanded"]')
    .getByText('Settings')
    .click();
  const dialog = window.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('nav').getByText('General', { exact: true }).click();
  return dialog;
}

test.describe('Settings Modal', () => {
  test.afterEach(async ({ window }) => {
    await clearIpcMocks(window);
  });

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
    await window.waitForFunction(() => globalThis.innerWidth >= 1100, null, { timeout: 5_000 });

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
    await window.waitForFunction(() => globalThis.innerWidth >= 1100, null, { timeout: 5_000 });

    // Collapse sidebar
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(600);
    await expect(window.locator('aside[data-state="expanded"]')).not.toBeVisible();

    // Open settings from collapsed widget
    await window.locator('button[aria-label="Settings"]').click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    // Click the overlay (backdrop) — more reliable than coordinate click when sidebar is collapsed
    await window.locator('[data-slot="dialog-overlay"]').click({ position: { x: 1, y: 1 } });
    await window.waitForTimeout(300);

    await expect(dialog).not.toBeVisible();
  });

  test('defaults to General section', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('App-wide preferences and startup options.')).toBeVisible();
  });

  test('Data section exposes the storage layout and file actions', async ({ window }) => {
    await mockIpcResolve(window, 'data.getLocations', {
      userDataPath: '/Users/test/Library/Application Support/Lychee',
      databasePath: '/Users/test/Library/Application Support/Lychee/lychee.sqlite3',
      imagesPath: '/Users/test/Library/Application Support/Lychee/images',
    });
    await mockIpcResolve(window, 'data.openFolder', { ok: true }, 100);
    await mockIpcResolve(window, 'data.revealDatabase', { ok: true }, 100);
    await window.locator('aside[data-state="expanded"]').getByText('Settings').click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await dialog.locator('nav').getByText('Data', { exact: true }).click();
    await expect(dialog.getByText('/Users/test/Library/Application Support/Lychee')).toBeVisible();
    await expect(dialog.getByText('lychee.sqlite3')).toBeVisible();
    await expect(dialog.getByText('images/')).toBeVisible();

    const openButton = dialog.getByRole('button', { name: 'Open Data Folder' });
    await openButton.click();
    await expect(openButton).toBeDisabled();
    await expect(openButton).toBeEnabled();

    const revealButton = dialog.getByRole('button', {
      name:
        process.platform === 'darwin'
          ? 'Reveal in Finder'
          : process.platform === 'win32'
            ? 'Show in Explorer'
            : 'Show in Folder',
    });
    await revealButton.click();
    await expect(revealButton).toBeDisabled();
    await expect(revealButton).toBeEnabled();
  });

  test('Data section reports an open-folder failure', async ({ window }) => {
    await mockIpcResolve(window, 'data.getLocations', {
      userDataPath: '/Users/test/Library/Application Support/Lychee',
      databasePath: '/Users/test/Library/Application Support/Lychee/lychee.sqlite3',
      imagesPath: '/Users/test/Library/Application Support/Lychee/images',
    });
    await mockIpcReject(window, 'data.openFolder', 'injected open failure');
    await window.locator('aside[data-state="expanded"]').getByText('Settings').click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await dialog.locator('nav').getByText('Data', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Open Data Folder' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Lychee couldn’t open the data folder',
    );
  });

  test('Data section creates a consistent backup', async ({ window }) => {
    await mockIpcResolve(window, 'data.createBackup', {
      canceled: false,
      filePath: '/Users/test/Documents/lychee-backup.sqlite3',
    }, 100);
    await window.locator('aside[data-state="expanded"]').getByText('Settings').click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await dialog.locator('nav').getByText('Data', { exact: true }).click();
    const backupButton = dialog.getByRole('button', { name: 'Create Backup…' });
    await backupButton.click();
    await expect(backupButton).toBeDisabled();
    await expect(dialog.getByRole('status')).toContainText(
      '/Users/test/Documents/lychee-backup.sqlite3',
    );
  });

  test('left nav switches between sections', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    // Switch to Appearance
    await dialog.getByText('Appearance', { exact: true }).click();
    await expect(dialog.getByText('Customize how Lychee looks on your screen.')).toBeVisible();

    // Switch to Editor
    await dialog.getByText('Editor', { exact: true }).click();
    await expect(dialog.getByText('Tune writing behavior, shortcuts, and editor defaults.')).toBeVisible();

    // Switch back to General
    await dialog.getByText('General', { exact: true }).click();
    await expect(dialog.getByText('App-wide preferences and startup options.')).toBeVisible();
  });

  test('Editor spelling preference is persistent and platform-aware', async ({ window }) => {
    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: true }),
    );

    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();
    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    await dialog.getByText('Editor', { exact: true }).click();

    const spellingSwitch = dialog.getByRole('switch', {
      name: 'Check spelling while typing',
    });
    await expect(spellingSwitch).toHaveAttribute('aria-checked', 'true');
    await spellingSwitch.click();
    await expect(spellingSwitch).toHaveAttribute('aria-checked', 'false');

    const stored = await window.evaluate(() =>
      window.lychee.invoke('settings.get', { key: 'spellCheckEnabled' }),
    );
    expect(stored.value).toBe('false');

    const platform = await window.evaluate(() => window.lychee.platform);
    if (platform === 'darwin') {
      await expect(
        dialog.getByText('Spelling languages are managed by macOS.'),
      ).toBeVisible();
    } else {
      await expect(dialog.getByText('Spelling languages')).toBeVisible();
    }

    // Restore the default so later tests and local E2E runs remain isolated.
    await spellingSwitch.click();
    await expect(spellingSwitch).toHaveAttribute('aria-checked', 'true');
  });

  test('spelling preference survives a renderer reload and remains applied to Chromium', async ({
    electronApp,
    window,
  }) => {
    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: false }),
    );
    expect(
      await electronApp.evaluate(({ session }) =>
        session.defaultSession.isSpellCheckerEnabled(),
      ),
    ).toBe(false);

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    const dialog = await openEditorSettings(window);
    const spellingSwitch = dialog.getByRole('switch', {
      name: 'Check spelling while typing',
    });
    await expect(spellingSwitch).toHaveAttribute('aria-checked', 'false');

    await spellingSwitch.click();
    await expect(spellingSwitch).toHaveAttribute('aria-checked', 'true');
    expect(
      await electronApp.evaluate(({ session }) =>
        session.defaultSession.isSpellCheckerEnabled(),
      ),
    ).toBe(true);
    expect(
      await window.evaluate(() =>
        window.lychee.invoke('settings.get', { key: 'spellCheckEnabled' }),
      ),
    ).toEqual({ value: 'true' });
  });

  test('open Editor Settings tracks external spelling state broadcasts live', async ({
    electronApp,
    window,
  }) => {
    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: true }),
    );
    const dialog = await openEditorSettings(window);
    const spellingSwitch = dialog.getByRole('switch', {
      name: 'Check spelling while typing',
    });
    await expect(spellingSwitch).toBeChecked();

    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: false }),
    );
    await expect(spellingSwitch).not.toBeChecked();
    expect(
      await electronApp.evaluate(({ session }) =>
        session.defaultSession.isSpellCheckerEnabled(),
      ),
    ).toBe(false);

    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: true }),
    );
    await expect(spellingSwitch).toBeChecked();
    expect(
      await electronApp.evaluate(({ session }) =>
        session.defaultSession.isSpellCheckerEnabled(),
      ),
    ).toBe(true);
  });

  test('failed spelling toggle rolls the optimistic Settings state back', async ({
    electronApp,
    window,
  }) => {
    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: true }),
    );
    const dialog = await openEditorSettings(window);
    const spellingSwitch = dialog.getByRole('switch', {
      name: 'Check spelling while typing',
    });
    await expect(spellingSwitch).toBeChecked();

    await mockIpcReject(
      window,
      'spellcheck.setEnabled',
      'injected spellcheck failure',
      250,
    );
    await spellingSwitch.click();
    await expect(spellingSwitch).not.toBeChecked();
    await expect(spellingSwitch).toBeChecked();

    expect(
      await window.evaluate(() =>
        window.lychee.invoke('settings.get', { key: 'spellCheckEnabled' }),
      ),
    ).toEqual({ value: 'true' });
    expect(
      await electronApp.evaluate(({ session }) =>
        session.defaultSession.isSpellCheckerEnabled(),
      ),
    ).toBe(true);
  });

  test('spelling language controls follow platform capability and preserve a valid selection', async ({
    electronApp,
    window,
  }) => {
    const initial = await window.evaluate(() =>
      window.lychee.invoke('spellcheck.getState', {}),
    );
    const platform = await window.evaluate(() => window.lychee.platform);
    const dialog = await openEditorSettings(window);

    if (platform === 'darwin') {
      expect(initial).toMatchObject({
        canChooseLanguages: false,
        languages: [],
        availableLanguages: [],
      });
      await expect(
        dialog.getByText('Spelling languages are managed by macOS.'),
      ).toBeVisible();
      await expect(
        dialog.getByText('Spelling languages', { exact: true }),
      ).toHaveCount(0);

      const unchanged = await window.evaluate(() =>
        window.lychee.invoke('spellcheck.setLanguages', {
          languages: ['unsupported-test-language'],
        }),
      );
      expect(unchanged).toEqual(initial);
      return;
    }

    if (!initial.canChooseLanguages) {
      await expect(
        dialog.getByText('No configurable spelling languages are available on this system.'),
      ).toBeVisible();
      await expect(dialog.locator('[data-slot="popover-trigger"]')).toHaveCount(0);
      return;
    }

    await expect(dialog.getByText('Spelling languages', { exact: true })).toBeVisible();
    await dialog.locator('[data-slot="popover-trigger"]').click();
    const popover = window.locator('[data-slot="popover-content"]');
    await expect(popover).toBeVisible();
    const languageOptions = popover.getByRole('checkbox');
    await expect(languageOptions).toHaveCount(initial.availableLanguages.length);
    const selectedOptions = popover.locator(
      '[role="checkbox"][aria-checked="true"]',
    );
    await expect(selectedOptions).toHaveCount(initial.languages.length);

    if (initial.languages.length === 1) {
      await expect(selectedOptions).toBeDisabled();
    }

    const unselected = popover
      .locator('[role="checkbox"][aria-checked="false"]')
      .first();
    if (await unselected.count()) {
      const addedLanguage = await unselected
        .locator('span')
        .last()
        .textContent();
      await unselected.click();
      const updated = await window.evaluate(() =>
        window.lychee.invoke('spellcheck.getState', {}),
      );
      expect(updated.languages).toContain(addedLanguage?.trim());
      const applied = await electronApp.evaluate(({ session }) =>
        session.defaultSession.getSpellCheckerLanguages(),
      );
      expect(applied).toEqual(expect.arrayContaining(updated.languages));
    }

    const beforeInvalid = await window.evaluate(() =>
      window.lychee.invoke('spellcheck.getState', {}),
    );
    const error = await window.evaluate(async () => {
      try {
        await window.lychee.invoke('spellcheck.setLanguages', {
          languages: ['unsupported-test-language'],
        });
        return null;
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    });
    expect(error).toContain('Select at least one supported spelling language');
    expect(
      await window.evaluate(() => window.lychee.invoke('spellcheck.getState', {})),
    ).toEqual(beforeInvalid);
  });

  test('resets to General section on reopen', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    // Switch to Editor
    await dialog.getByText('Editor', { exact: true }).click();
    await expect(dialog.getByText('Tune writing behavior, shortcuts, and editor defaults.')).toBeVisible();

    // Close and reopen
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
    await expect(dialog).not.toBeVisible();

    await settingsBtn.click();
    await expect(dialog).toBeVisible();

    // Should be back on General
    await expect(dialog.getByText('App-wide preferences and startup options.')).toBeVisible();
  });

  test('shows all section nav buttons', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    const nav = dialog.locator('nav');
    await expect(nav.getByText('General', { exact: true })).toBeVisible();
    await expect(nav.getByText('Appearance', { exact: true })).toBeVisible();
    await expect(nav.getByText('Editor', { exact: true })).toBeVisible();
    await expect(nav.getByText('Data', { exact: true })).toBeVisible();
    await expect(nav.getByText('About', { exact: true })).toBeVisible();
  });

  test('About section shows version and update status', async ({ window }) => {
    const settingsBtn = window.locator('aside[data-state="expanded"]').getByText('Settings');
    await settingsBtn.click();

    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await dialog.locator('nav').getByText('About', { exact: true }).click();

    // App version line (e.g. "Version 0.1.0-alpha.1").
    await expect(dialog.getByText(/^Version \d/)).toBeVisible();
    // Under E2E the updater is deliberately inert (see src/main/updater.ts),
    // so the pane shows the 'unsupported' status rather than an update prompt.
    await expect(
      dialog.getByText('Updates are delivered automatically in installed builds.'),
    ).toBeVisible();
  });
});

test.describe('Settings Modal — General preferences', () => {
  test.afterEach(async ({ window }) => {
    await clearIpcMocks(window);
  });

  test('launch-at-login toggle persists to the settings store', async ({ window }) => {
    const dialog = await openGeneralSettings(window);
    const launchSwitch = dialog.getByTestId('launch-at-login');

    await expect(launchSwitch).toHaveAttribute('aria-checked', 'false');
    await launchSwitch.click();
    await expect(launchSwitch).toHaveAttribute('aria-checked', 'true');

    expect(
      await window.evaluate(() => window.lychee.invoke('preferences.getGeneral', {})),
    ).toMatchObject({ launchAtLogin: true });

    // Restore the default so the shared profile stays isolated for later tests.
    await launchSwitch.click();
    await expect(launchSwitch).toHaveAttribute('aria-checked', 'false');
  });

  test('system tray toggle reflects the persisted preference', async ({ window }) => {
    const dialog = await openGeneralSettings(window);
    const traySwitch = dialog.getByTestId('show-in-tray');

    await expect(traySwitch).toHaveAttribute('aria-checked', 'false');
    await traySwitch.click();
    await expect(traySwitch).toHaveAttribute('aria-checked', 'true');

    expect(
      await window.evaluate(() => window.lychee.invoke('preferences.getGeneral', {})),
    ).toMatchObject({ showInTray: true });

    await traySwitch.click();
    await expect(traySwitch).toHaveAttribute('aria-checked', 'false');
  });

  test('restore-last-session toggle reflects the persisted preference', async ({
    window,
  }) => {
    const dialog = await openGeneralSettings(window);
    const restoreSwitch = dialog.getByTestId('restore-last-session');

    await expect(restoreSwitch).toHaveAttribute('aria-checked', 'true');
    await restoreSwitch.click();
    await expect(restoreSwitch).toHaveAttribute('aria-checked', 'false');

    expect(
      await window.evaluate(() => window.lychee.invoke('preferences.getGeneral', {})),
    ).toMatchObject({ restoreLastSession: false });

    await restoreSwitch.click();
    await expect(restoreSwitch).toHaveAttribute('aria-checked', 'true');
  });

  test('preferences pushed from main update the open General pane', async ({ window }) => {
    const dialog = await openGeneralSettings(window);
    const traySwitch = dialog.getByTestId('show-in-tray');
    await expect(traySwitch).toHaveAttribute('aria-checked', 'false');

    // Bypass the store and go straight through IPC: the main-process
    // `preferences:changed` broadcast must keep the pane in sync.
    await window.evaluate(() =>
      window.lychee.invoke('preferences.setGeneral', { showInTray: true }),
    );
    await expect(traySwitch).toHaveAttribute('aria-checked', 'true');

    await window.evaluate(() =>
      window.lychee.invoke('preferences.setGeneral', { showInTray: false }),
    );
    await expect(traySwitch).toHaveAttribute('aria-checked', 'false');
  });

  test('launch-at-login registers with the OS (platform smoke)', async ({
    electronApp,
    window,
  }) => {
    test.skip(
      process.platform === 'linux' ||
        process.env.LYCHEE_E2E_OS_INTEGRATION !== '1',
      'requires a real OS and LYCHEE_E2E_OS_INTEGRATION=1',
    );

    const dialog = await openGeneralSettings(window);
    const launchSwitch = dialog.getByTestId('launch-at-login');
    await expect(launchSwitch).toHaveAttribute('aria-checked', 'false');

    await launchSwitch.click();
    await expect(launchSwitch).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(() =>
        electronApp.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin),
      )
      .toBe(true);

    // Leave the runner's login items untouched.
    await launchSwitch.click();
    await expect
      .poll(() =>
        electronApp.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin),
      )
      .toBe(false);
  });

  test('reset all settings restores preferences and theme', async ({ window }) => {
    await window.evaluate(() =>
      window.lychee.invoke('preferences.setGeneral', {
        launchAtLogin: true,
        showInTray: true,
      }),
    );
    await window.evaluate(() =>
      window.lychee.invoke('settings.set', { key: 'theme', value: 'dark' }),
    );

    const dialog = await openGeneralSettings(window);
    await expect(dialog.getByTestId('launch-at-login')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await dialog.getByTestId('reset-settings').click();
    await dialog.getByTestId('reset-settings-confirm').click();
    await expect(dialog.getByTestId('reset-settings')).toBeVisible();

    expect(
      await window.evaluate(() => window.lychee.invoke('preferences.getGeneral', {})),
    ).toEqual({ launchAtLogin: false, showInTray: false, restoreLastSession: true });
    await expect
      .poll(() =>
        window.evaluate(() =>
          window.lychee.invoke('settings.get', { key: 'theme' }),
        ),
      )
      .toEqual({ value: 'light' });
    await expect(dialog.getByTestId('launch-at-login')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('reset all settings restores appearance, layout, and shortcuts', async ({
    window,
  }) => {
    const defaultBindings = await window.evaluate(() =>
      window.lychee.invoke('keybindings.getAll', {}),
    );
    await window.evaluate(() =>
      window.lychee.invoke('keybindings.set', {
        id: 'app.newNote',
        binding: 'Mod+Alt+N',
      }),
    );
    await window.evaluate(() =>
      window.lychee.invoke('settings.set', { key: 'theme', value: 'dark' }),
    );

    // Collapse the sidebar so layout reset can be observed.
    await window.locator('[aria-label="Toggle sidebar"]').click();
    await window.waitForTimeout(400);
    await expect(window.locator('aside[data-state="collapsed"]')).toBeVisible();

    // Open settings from the collapsed widget.
    await window.locator('button[aria-label="Settings"]').click();
    const dialog = window.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    // Pick a non-default accent.
    await dialog.locator('nav').getByText('Appearance', { exact: true }).click();
    await dialog
      .locator('[data-testid="accent-preset"][data-accent="#e11d48"]')
      .click();
    await expect
      .poll(() =>
        window.evaluate(
          () => document.documentElement.style.getPropertyValue('--brand'),
        ),
      )
      .not.toBe('');

    await dialog.locator('nav').getByText('General', { exact: true }).click();
    await dialog.getByTestId('reset-settings').click();
    await dialog.getByTestId('reset-settings-confirm').click();
    await expect(dialog.getByTestId('reset-settings')).toBeVisible();

    // Appearance override cleared.
    await expect
      .poll(() =>
        window.evaluate(
          () => document.documentElement.style.getPropertyValue('--brand'),
        ),
      )
      .toBe('');
    // Sidebar re-expanded.
    await expect(window.locator('aside[data-state="expanded"]')).toHaveCount(1);
    // Shortcuts restored to defaults.
    await expect
      .poll(() =>
        window.evaluate(() => window.lychee.invoke('keybindings.getAll', {})),
      )
      .toEqual(defaultBindings);
    // Theme restored.
    await expect
      .poll(() =>
        window.evaluate(() =>
          document.documentElement.classList.contains('dark'),
        ),
      )
      .toBe(false);
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

base.describe('Settings spelling — full app restart persistence', () => {
  let tmpDir: string;

  base.beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-spelling-persist-'));
  });

  base.afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  base('disabled spelling survives a complete Electron process restart', async () => {
    let session = await launchRestartSession(tmpDir);
    try {
      await session.window.evaluate(() =>
        window.lychee.invoke('spellcheck.setEnabled', { enabled: false }),
      );
      expect(
        await session.app.evaluate(({ session: electronSession }) =>
          electronSession.defaultSession.isSpellCheckerEnabled(),
        ),
      ).toBe(false);
      expect(
        await session.window.evaluate(() =>
          window.lychee.invoke('settings.get', { key: 'spellCheckEnabled' }),
        ),
      ).toEqual({ value: 'false' });
    } finally {
      await session.app.close();
    }

    session = await launchRestartSession(tmpDir);
    try {
      expect(
        await session.window.evaluate(() =>
          window.lychee.invoke('spellcheck.getState', {}),
        ),
      ).toMatchObject({ enabled: false });
      expect(
        await session.app.evaluate(({ session: electronSession }) =>
          electronSession.defaultSession.isSpellCheckerEnabled(),
        ),
      ).toBe(false);

      const dialog = await openEditorSettings(session.window);
      await expect(
        dialog.getByRole('switch', { name: 'Check spelling while typing' }),
      ).not.toBeChecked();
    } finally {
      await session.app.close();
    }
  });

  base('general preferences survive a complete Electron process restart', async () => {
    let session = await launchRestartSession(tmpDir);
    try {
      await session.window.evaluate(() =>
        window.lychee.invoke('preferences.setGeneral', { launchAtLogin: true }),
      );
      expect(
        await session.window.evaluate(() =>
          window.lychee.invoke('preferences.getGeneral', {}),
        ),
      ).toMatchObject({ launchAtLogin: true });
    } finally {
      await session.app.close();
    }

    session = await launchRestartSession(tmpDir);
    try {
      expect(
        await session.window.evaluate(() =>
          window.lychee.invoke('preferences.getGeneral', {}),
        ),
      ).toMatchObject({ launchAtLogin: true });

      const dialog = await openGeneralSettings(session.window);
      await expect(dialog.getByTestId('launch-at-login')).toHaveAttribute(
        'aria-checked',
        'true',
      );
    } finally {
      await session.app.close();
    }
  });
});

base.describe('App — workspace and window persistence', () => {
  let tmpDir: string;

  base.beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-workspace-persist-'));
  });

  base.afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  base('restores open tabs and window size after a restart', async () => {
    let session = await launchRestartSession(tmpDir);
    try {
      await session.window.evaluate(() =>
        (window as any).__documentStore.getState().createDocument(null),
      );
      await session.window.waitForFunction(
        () => (window as any).__documentStore.getState().openTabs.length > 0,
      );

      await session.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1024, 720);
      });
      // Let the debounced session + window-bounds writers flush before quitting.
      await session.window.waitForTimeout(700);
    } finally {
      await session.app.close();
    }

    session = await launchRestartSession(tmpDir);
    try {
      await session.window.waitForFunction(
        () => (window as any).__documentStore.getState().openTabs.length > 0,
        undefined,
        { timeout: 10_000 },
      );

      const size = await session.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getSize(),
      );
      expect(size?.[0]).toBeGreaterThanOrEqual(1000);
    } finally {
      await session.app.close();
    }
  });

  base('does not restore tabs when restore-last-session is disabled', async () => {
    let session = await launchRestartSession(tmpDir);
    try {
      await session.window.evaluate(() =>
        window.lychee.invoke('preferences.setGeneral', { restoreLastSession: false }),
      );
      await session.window.evaluate(() =>
        (window as any).__documentStore.getState().createDocument(null),
      );
      await session.window.waitForFunction(
        () => (window as any).__documentStore.getState().openTabs.length > 0,
      );
      await session.window.waitForTimeout(700);
    } finally {
      await session.app.close();
    }

    session = await launchRestartSession(tmpDir);
    try {
      // Give restore a chance to (incorrectly) run before asserting.
      await session.window.waitForTimeout(800);
      const openTabs = await session.window.evaluate(
        () => (window as any).__documentStore.getState().openTabs.length,
      );
      expect(openTabs).toBe(0);
    } finally {
      await session.app.close();
    }
  });

  base('drops tabs whose note was trashed before the restart', async () => {
    let session = await launchRestartSession(tmpDir);
    let keepId = '';
    try {
      const ids = await session.window.evaluate(async () => {
        const lychee = (window as any).lychee;
        const keep = await lychee.invoke('documents.create', {
          parentId: null,
          title: 'Keep me',
        });
        const drop = await lychee.invoke('documents.create', {
          parentId: null,
          title: 'Trash me',
        });
        await lychee.invoke('documents.trash', { id: drop.document.id });
        // Point the persisted session at both docs; only the live one should
        // come back after restart.
        await lychee.invoke('settings.set', {
          key: 'workspace.session',
          value: JSON.stringify({
            version: 1,
            tabs: [drop.document.id, keep.document.id],
            selectedIndex: 0,
          }),
        });
        return { keep: keep.document.id, drop: drop.document.id };
      });
      keepId = ids.keep;
      await session.window.waitForTimeout(700);
    } finally {
      await session.app.close();
    }

    session = await launchRestartSession(tmpDir);
    try {
      await session.window.waitForFunction(
        () => (window as any).__documentStore.getState().openTabs.length > 0,
        undefined,
        { timeout: 10_000 },
      );
      const openTabs = await session.window.evaluate(() =>
        (window as any).__documentStore.getState().openTabs.map((tab: { docId: string }) => tab.docId),
      );
      expect(openTabs).toEqual([keepId]);
    } finally {
      await session.app.close();
    }
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

  async function resizeWindow(
    electronApp: import('@playwright/test').ElectronApplication,
    window: import('@playwright/test').Page,
    width: number,
    height: number,
  ) {
    await electronApp.evaluate(({ BrowserWindow }, { w, h }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(w, h);
    }, { w: width, h: height });
    // Wait until the renderer reports dimensions close to the requested size.
    // On CI (Xvfb) there are no window decorations, so inner ≈ outer.
    await window.waitForFunction(
      ({ w }) => globalThis.innerWidth <= w,
      { w: width },
      { timeout: 5_000 },
    );
  }

  function getViewport(window: import('@playwright/test').Page) {
    return window.evaluate(() => ({ width: globalThis.innerWidth, height: globalThis.innerHeight }));
  }

  test('dialog stays within viewport at minimum window size', async ({ electronApp, window }) => {
    await resizeWindow(electronApp, window, 680, 480);

    const dialog = await openSettingsDialog(window);
    const dialogBox = await dialog.boundingBox();
    const viewport = await getViewport(window);

    expect(dialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('dialog height shrinks with a small viewport', async ({ electronApp, window }) => {
    await resizeWindow(electronApp, window, 800, 500);

    const dialog = await openSettingsDialog(window);
    const dialogBox = await dialog.boundingBox();
    const viewport = await getViewport(window);

    expect(dialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    // Dialog height should be less than the viewport height (capped by 100vh - 6rem)
    expect(dialogBox!.height).toBeLessThan(viewport!.height);
    // And it must not overflow the bottom
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('dialog uses full height (34rem) when viewport is large', async ({ electronApp, window }) => {
    await resizeWindow(electronApp, window, 1200, 900);

    const dialog = await openSettingsDialog(window);
    const dialogBox = await dialog.boundingBox();

    expect(dialogBox).toBeTruthy();

    // 34rem = 544px at default 16px root font size
    expect(dialogBox!.height).toBeGreaterThanOrEqual(530);
    expect(dialogBox!.height).toBeLessThanOrEqual(555);
  });

  test('nav and content remain visible at small viewport', async ({ electronApp, window }) => {
    await resizeWindow(electronApp, window, 680, 480);

    const dialog = await openSettingsDialog(window);

    const nav = dialog.locator('nav');
    await expect(nav).toBeVisible();
    await expect(nav.getByText('General', { exact: true })).toBeVisible();
    await expect(nav.getByText('Appearance', { exact: true })).toBeVisible();
    await expect(nav.getByText('Editor', { exact: true })).toBeVisible();

    await expect(dialog.getByText('App-wide preferences and startup options.')).toBeVisible();
  });

  test('section switching works at small viewport', async ({ electronApp, window }) => {
    await resizeWindow(electronApp, window, 680, 480);

    const dialog = await openSettingsDialog(window);

    await dialog.getByText('Appearance', { exact: true }).click();
    await expect(dialog.getByText('Customize how Lychee looks on your screen.')).toBeVisible();

    await dialog.getByText('Editor', { exact: true }).click();
    await expect(dialog.getByText('Tune writing behavior, shortcuts, and editor defaults.')).toBeVisible();
  });

  test('dialog width respects viewport margins', async ({ electronApp, window }) => {
    await resizeWindow(electronApp, window, 680, 480);

    const dialog = await openSettingsDialog(window);
    const dialogBox = await dialog.boundingBox();
    const viewport = await getViewport(window);

    expect(dialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    // Should have at least 1rem (16px) margin on each side
    const leftMargin = dialogBox!.x;
    const rightMargin = viewport!.width - (dialogBox!.x + dialogBox!.width);
    expect(leftMargin).toBeGreaterThanOrEqual(12);
    expect(rightMargin).toBeGreaterThanOrEqual(12);
  });
});
