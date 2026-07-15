import { expect, test } from './electron-app';
import type { ElectronApplication, Page } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openKeyboardSettings(window: Page) {
  await window.locator('aside[data-state="expanded"]').getByText('Settings').click();
  const dialog = window.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await dialog.getByText('Shortcuts', { exact: true }).click();
  await expect(dialog.getByTestId('keyboard-settings')).toBeVisible();
  return dialog;
}

async function rebind(window: Page, label: string, playwrightShortcut: string) {
  const button = window.getByRole('button', { name: `Change shortcut for ${label}` });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.press(playwrightShortcut);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
}

async function storedBindings(window: Page): Promise<Record<string, string>> {
  const result = await window.evaluate(() =>
    window.lychee.invoke('settings.get', { key: 'keyboard.shortcuts.v1' }),
  );
  return JSON.parse(result.value!).bindings as Record<string, string>;
}

async function closeSettings(window: Page) {
  await window.getByRole('button', { name: 'Close settings' }).click();
  await expect(window.locator('[data-slot="dialog-content"]')).not.toBeVisible();
}

async function menuAccelerator(electronApp: ElectronApplication, label: string): Promise<string | undefined> {
  return electronApp.evaluate(({ Menu }, wantedLabel) => {
    const walk = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.label === wantedLabel) return item;
        if (item.submenu) {
          const found = walk(item.submenu.items);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(Menu.getApplicationMenu()?.items ?? [])?.accelerator;
  }, label);
}

test.describe('Keyboard shortcut settings — discovery', () => {
  test('indexes every Lychee action in searchable categories without system bindings', async ({ window }) => {
    const dialog = await openKeyboardSettings(window);
    for (const category of ['Editor', 'Navigation', 'Tabs', 'Formatting']) {
      await expect(dialog.getByRole('heading', { name: category, exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole('button', { name: /^Change shortcut for / })).toHaveCount(15);
    await expect(dialog.getByText('Quit', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Copy', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Reload', { exact: true })).toHaveCount(0);
  });

  test('search filters across action names, descriptions, and categories', async ({ window }) => {
    const dialog = await openKeyboardSettings(window);
    const search = dialog.getByRole('searchbox', { name: 'Search keyboard shortcuts' });
    await search.fill('highlight');
    await expect(dialog.getByRole('button', { name: 'Change shortcut for Highlight' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Change shortcut for Bold' })).toHaveCount(0);
    await search.fill('tabs');
    await expect(dialog.getByRole('button', { name: /^Change shortcut for / })).toHaveCount(2);
    await search.fill('does not exist');
    await expect(dialog.getByText(/No shortcuts match/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Clear shortcut search' }).click();
    await expect(search).toHaveValue('');
    await expect(dialog.getByRole('button', { name: /^Change shortcut for / })).toHaveCount(15);
  });
});

test.describe('Keyboard shortcut settings — validation and persistence', () => {
  test('records, normalizes, and persists a customized binding', async ({ window }) => {
    await openKeyboardSettings(window);
    await rebind(window, 'Bold', `${mod}+Shift+Y`);
    await expect(window.getByRole('button', { name: 'Change shortcut for Bold' })).toContainText(
      process.platform === 'darwin' ? '⌘⇧Y' : 'Ctrl+Shift+Y',
    );
    expect((await storedBindings(window))['format.bold']).toBe('Mod+Shift+Y');
    await expect(window.getByRole('button', { name: 'Reset Bold shortcut' })).toBeVisible();
  });

  test('rejects collisions and leaves the previous persisted state intact', async ({ window }) => {
    await openKeyboardSettings(window);
    const bold = window.getByRole('button', { name: 'Change shortcut for Bold' });
    await bold.click();
    await bold.press(`${mod}+I`);
    await expect(window.getByRole('alert')).toContainText('already assigned to Italic');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    expect((await storedBindings(window))['format.bold']).toBe('Mod+B');
  });

  test('bare keys are rejected and Escape cancels recording without saving', async ({ window }) => {
    const dialog = await openKeyboardSettings(window);
    const bold = window.getByRole('button', { name: 'Change shortcut for Bold' });
    await bold.click();
    await bold.press('Y');
    await expect(window.getByRole('alert')).toContainText('Press a shortcut with');
    await bold.press('Escape');
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await expect(dialog).toBeVisible();
    expect((await storedBindings(window))['format.bold']).toBe('Mod+B');
  });

  test('individual reset preserves other customizations', async ({ window }) => {
    await openKeyboardSettings(window);
    await rebind(window, 'Bold', `${mod}+Shift+G`);
    await rebind(window, 'Search notes', `${mod}+Shift+P`);
    await window.getByRole('button', { name: 'Reset Bold shortcut' }).click();
    const bindings = await storedBindings(window);
    expect(bindings['format.bold']).toBe('Mod+B');
    expect(bindings['navigation.searchNotes']).toBe('Mod+Shift+P');
  });

  test('reset all restores every default and removes per-action reset controls', async ({ window }) => {
    const dialog = await openKeyboardSettings(window);
    await rebind(window, 'Bold', `${mod}+Y`);
    await rebind(window, 'Search notes', `${mod}+Shift+P`);
    await dialog.getByRole('button', { name: 'Reset all' }).click();
    const bindings = await storedBindings(window);
    expect(bindings['format.bold']).toBe('Mod+B');
    expect(bindings['navigation.searchNotes']).toBe('Mod+P');
    await expect(dialog.getByRole('button', { name: /Reset .+ shortcut/ })).toHaveCount(0);
  });

  test('customization survives renderer reload and is rehydrated from SQLite', async ({ window }) => {
    await openKeyboardSettings(window);
    await rebind(window, 'Bold', `${mod}+Y`);
    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });
    await openKeyboardSettings(window);
    await expect(window.getByRole('button', { name: 'Change shortcut for Bold' })).toContainText(
      process.platform === 'darwin' ? '⌘Y' : 'Ctrl+Y',
    );
    expect((await storedBindings(window))['format.bold']).toBe('Mod+Y');
  });
});

test.describe('Keyboard shortcut settings — live behavior', () => {
  test('macOS records physical Control separately from Command', async ({ window }) => {
    test.skip(process.platform !== 'darwin', 'Command and Control are distinct macOS modifiers');
    await openKeyboardSettings(window);
    await rebind(window, 'Bold', 'Control+Shift+B');
    await expect(window.getByRole('button', { name: 'Change shortcut for Bold' })).toContainText('⌃⇧B');
    expect((await storedBindings(window))['format.bold']).toBe('Ctrl+Shift+B');
    await closeSettings(window);

    await window.locator('[aria-label="New note"]').click();
    const title = window.locator('main:visible h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.press('Meta+B');
    await window.keyboard.type('plain ');
    await window.keyboard.press('Control+Shift+B');
    await window.keyboard.type('control bold');
    await window.keyboard.press('Control+Shift+B');

    const root = window.locator('main:visible .ContentEditable__root');
    await expect(root.locator('strong, .font-bold').filter({ hasText: 'control bold' })).toHaveCount(1);
    await expect(root.locator('strong, .font-bold').filter({ hasText: 'plain' })).toHaveCount(0);
  });

  test('custom editor binding works immediately and the old binding stops toggling formatting', async ({ window }) => {
    await openKeyboardSettings(window);
    await rebind(window, 'Bold', `${mod}+Shift+G`);
    await closeSettings(window);

    await window.locator('[aria-label="New note"]').click();
    const title = window.locator('main:visible h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.press(`${mod}+B`);
    await window.keyboard.type('not bold ');
    await window.keyboard.press(`${mod}+Shift+G`);
    await window.keyboard.type('custom bold');
    await window.keyboard.press(`${mod}+Shift+G`);

    const root = window.locator('main:visible .ContentEditable__root');
    await expect(root).toContainText('not bold custom bold');
    await expect(root.locator('strong, .font-bold').filter({ hasText: 'custom bold' })).toHaveCount(1);
    await expect(root.locator('strong, .font-bold').filter({ hasText: 'not bold' })).toHaveCount(0);
  });

  test('custom note-search binding replaces the default without reopening settings', async ({ window }) => {
    await openKeyboardSettings(window);
    await rebind(window, 'Search notes', `${mod}+Shift+P`);
    await closeSettings(window);
    await window.keyboard.press(`${mod}+P`);
    const palette = window.getByRole('dialog', { name: 'Search notes' });
    await expect(palette).not.toBeVisible();
    await window.keyboard.press(`${mod}+Shift+P`);
    await expect(palette).toBeVisible();
  });

  test('custom app command rebuilds the Electron menu accelerator immediately', async ({ electronApp, window }) => {
    await openKeyboardSettings(window);
    await rebind(window, 'New note', `${mod}+Shift+N`);
    await expect.poll(() => menuAccelerator(electronApp, 'New Note')).toBe('CmdOrCtrl+Shift+N');
    expect((await storedBindings(window))['app.newNote']).toBe('Mod+Shift+N');
  });
});
