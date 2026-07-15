import type { Page } from '@playwright/test';

import { test, expect } from './electron-app';
import {
  capturedNativeMenus,
  chooseNativeSpellCheckState,
  closeCapturedNativeMenu,
  emitSpellingContextMenu,
  flattenNativeMenu,
  installNativeMenuCapture,
} from './native-menu-helpers';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

function activeMain(window: Page) {
  return window.locator('main:not([style*="display: none"])').first();
}

async function selectedTabId(window: Page): Promise<string> {
  return window.evaluate(() => {
    const store = (window as typeof window & {
      __documentStore: { getState: () => { selectedId: string } };
    }).__documentStore;
    return store.getState().selectedId;
  });
}

async function selectTab(window: Page, tabId: string): Promise<void> {
  await window.evaluate((id) => {
    const store = (window as typeof window & {
      __documentStore: {
        getState: () => { selectDocument: (nextId: string) => void };
      };
    }).__documentStore;
    store.getState().selectDocument(id);
  }, tabId);
  await window.waitForTimeout(200);
}

async function selectElementContents(element: ReturnType<Page['locator']>): Promise<void> {
  await element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

async function createBodyText(window: Page, text: string) {
  await window.locator('[aria-label="New note"]').click();
  const title = activeMain(window).locator('h1.editor-title');
  await expect(title).toBeVisible();
  await title.click();
  await window.keyboard.press('Enter');
  await window.keyboard.type(text);

  const paragraph = activeMain(window)
    .locator('.ContentEditable__root p')
    .filter({ hasText: text })
    .first();
  await expect(paragraph).toHaveText(text);
  return paragraph;
}

async function waitForMenuCount(
  electronApp: Parameters<typeof capturedNativeMenus>[0],
  count: number,
) {
  await expect
    .poll(async () => (await capturedNativeMenus(electronApp)).length)
    .toBe(count);
}

function spellingCheckbox(items: Awaited<ReturnType<typeof capturedNativeMenus>>[number]['items']) {
  const spellingMenu = items.find((item) => item.label === 'Spelling and Grammar');
  return spellingMenu?.submenu?.find((item) => item.type === 'checkbox');
}

test.describe('Editor native context menu', () => {
  test('editable text exposes native edit roles and spelling controls without Search', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: true }),
    );
    const paragraph = await createBodyText(window, 'native editing menu');

    await paragraph.click({ button: 'right' });
    await waitForMenuCount(electronApp, 1);

    const [menu] = await capturedNativeMenus(electronApp);
    const roles = menu.items
      .filter((item) => item.role)
      .map((item) => item.role);
    expect(roles).toEqual([
      'cut',
      'copy',
      'paste',
      'pasteandmatchstyle',
      'selectall',
    ]);
    expect(menu.sourceType).toBe('mouse');
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.y).toBeGreaterThanOrEqual(0);

    const platform = await window.evaluate(() => window.lychee.platform);
    const plainPaste = menu.items.find((item) => item.role === 'pasteandmatchstyle');
    expect(plainPaste?.label).toBe(
      platform === 'darwin' ? 'Paste and Match Style' : 'Paste as Plain Text',
    );

    const checkbox = spellingCheckbox(menu.items);
    expect(checkbox).toMatchObject({
      label:
        platform === 'darwin'
          ? 'Check Spelling While Typing'
          : 'Check spelling while typing',
      checked: true,
      type: 'checkbox',
    });

    const everyLabel = flattenNativeMenu(menu.items).map((item) => item.label);
    expect(everyLabel.some((label) => /search/i.test(label))).toBe(false);
    await closeCapturedNativeMenu(electronApp);
  });

  test('selected read-only UI text receives only Copy and Select All', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window
      .locator('aside[data-state="expanded"]')
      .getByText('Settings')
      .click();
    const dialog = window.locator('[data-slot="dialog-content"]');
    await dialog.getByText('Editor', { exact: true }).click();
    const heading = dialog.getByRole('heading', { name: 'Editor', exact: true });

    await heading.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await heading.click({ button: 'right' });
    await waitForMenuCount(electronApp, 1);

    const [menu] = await capturedNativeMenus(electronApp);
    expect(menu.items.filter((item) => item.role).map((item) => item.role)).toEqual([
      'copy',
      'selectall',
    ]);
    const allItems = flattenNativeMenu(menu.items);
    expect(allItems.some((item) => item.label === 'Spelling and Grammar')).toBe(false);
    expect(allItems.some((item) => item.role === 'cut')).toBe(false);
    expect(allItems.some((item) => item.role === 'paste')).toBe(false);
    expect(allItems.some((item) => /search/i.test(item.label))).toBe(false);
    await closeCapturedNativeMenu(electronApp);
  });

  test('ordinary non-editable UI with no selection does not open an editor menu', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.evaluate(() => getSelection()?.removeAllRanges());

    await window.locator('[aria-label="New note"]').click({ button: 'right' });
    await window.waitForTimeout(250);

    expect(await capturedNativeMenus(electronApp)).toEqual([]);
  });

  test('suggestions are word-scoped, capped at five, and disappear when checking is off', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: true }),
    );
    const suggestions = ['the', 'tech', 'ten', 'tea', 'them', 'then', 'there'];

    await emitSpellingContextMenu(electronApp, 'teh', suggestions);
    await waitForMenuCount(electronApp, 1);
    const [enabledMenu] = await capturedNativeMenus(electronApp);
    const enabledItems = enabledMenu.items.filter((item) => item.type !== 'separator');
    expect(enabledItems.slice(0, 5).map((item) => item.label)).toEqual(
      suggestions.slice(0, 5),
    );
    expect(enabledItems.some((item) => item.label === suggestions[5])).toBe(false);
    expect(enabledItems.some((item) => item.label === suggestions[6])).toBe(false);

    const platform = await window.evaluate(() => window.lychee.platform);
    expect(enabledItems[5]?.label).toBe(
      platform === 'darwin' ? 'Learn Spelling' : 'Add to dictionary',
    );
    await closeCapturedNativeMenu(electronApp);

    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: false }),
    );
    await emitSpellingContextMenu(electronApp, 'teh', suggestions);
    await waitForMenuCount(electronApp, 2);
    const disabledMenu = (await capturedNativeMenus(electronApp))[1];
    const disabledLabels = flattenNativeMenu(disabledMenu.items).map(
      (item) => item.label,
    );
    for (const suggestion of suggestions) {
      expect(disabledLabels).not.toContain(suggestion);
    }
    expect(disabledLabels).not.toContain('Learn Spelling');
    expect(disabledLabels).not.toContain('Add to dictionary');
    expect(spellingCheckbox(disabledMenu.items)?.checked).toBe(false);
    await closeCapturedNativeMenu(electronApp);
  });

  test('native spelling toggle, Chromium session, persistence, and Settings stay synchronized', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.evaluate(() =>
      window.lychee.invoke('spellcheck.setEnabled', { enabled: true }),
    );
    const paragraph = await createBodyText(window, 'synchronized spelling state');

    await paragraph.click({ button: 'right' });
    await waitForMenuCount(electronApp, 1);
    const [firstMenu] = await capturedNativeMenus(electronApp);
    expect(spellingCheckbox(firstMenu.items)?.checked).toBe(true);

    await chooseNativeSpellCheckState(electronApp, false);
    await expect
      .poll(() =>
        window.evaluate(async () =>
          (await window.lychee.invoke('spellcheck.getState', {})).enabled,
        ),
      )
      .toBe(false);
    expect(
      await window.evaluate(() =>
        window.lychee.invoke('settings.get', { key: 'spellCheckEnabled' }),
      ),
    ).toEqual({ value: 'false' });
    expect(
      await electronApp.evaluate(({ session }) =>
        session.defaultSession.isSpellCheckerEnabled(),
      ),
    ).toBe(false);

    await window
      .locator('aside[data-state="expanded"]')
      .getByText('Settings')
      .click();
    const dialog = window.locator('[data-slot="dialog-content"]');
    await dialog.getByText('Editor', { exact: true }).click();
    const setting = dialog.getByRole('switch', {
      name: 'Check spelling while typing',
    });
    await expect(setting).not.toBeChecked();
    await setting.click();
    await expect(setting).toBeChecked();
    expect(
      await electronApp.evaluate(({ session }) =>
        session.defaultSession.isSpellCheckerEnabled(),
      ),
    ).toBe(true);

    await window.keyboard.press('Escape');
    await paragraph.click({ button: 'right' });
    await waitForMenuCount(electronApp, 2);
    const secondMenu = (await capturedNativeMenus(electronApp))[1];
    expect(spellingCheckbox(secondMenu.items)?.checked).toBe(true);
    await closeCapturedNativeMenu(electronApp);
  });
});

test.describe('Editor native context menu — cross-feature overlap', () => {
  test('sidebar keeps its renderer-owned note menu without opening the editor menu', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.locator('[aria-label="New note"]').click();

    const note = window.locator('[data-note-id]').first();
    await note.click({ button: 'right' });

    await expect(window.getByText('Open in new tab')).toBeVisible();
    await expect(window.getByText('Move to Trash Bin')).toBeVisible();
    expect(await capturedNativeMenus(electronApp)).toEqual([]);
  });

  test('title editing gets native commands without triggering the body formatting toolbar', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.locator('[aria-label="New note"]').click();

    const title = activeMain(window).locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('Editable title');
    await selectElementContents(title);
    await title.click({ button: 'right' });
    await waitForMenuCount(electronApp, 1);

    const [menu] = await capturedNativeMenus(electronApp);
    expect(menu.items.filter((item) => item.role).map((item) => item.role)).toEqual([
      'cut',
      'copy',
      'paste',
      'pasteandmatchstyle',
      'selectall',
    ]);
    await expect(
      window.getByRole('toolbar', { name: 'Text formatting' }),
    ).not.toBeVisible();

    await closeCapturedNativeMenu(electronApp);
    await expect(title).toHaveText('Editable title');
  });

  test('global and in-note search retain query, focus, and parent overlay state', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await createBodyText(window, 'needle in searchable text');

    await window.getByRole('button', { name: /^Search/ }).first().click();
    const palette = window.getByRole('dialog');
    const paletteInput = window.getByPlaceholder('Search notes...');
    await paletteInput.fill('needle');
    await paletteInput.click({ button: 'right' });
    await waitForMenuCount(electronApp, 1);

    await expect(palette).toBeVisible();
    await expect(paletteInput).toHaveValue('needle');
    await expect(paletteInput).toBeFocused();
    await closeCapturedNativeMenu(electronApp);
    await expect(palette).toBeVisible();
    await expect(paletteInput).toBeFocused();

    // Search intentionally uses the first Escape to clear a non-empty query;
    // a second Escape closes the now-empty palette.
    await window.keyboard.press('Escape');
    await expect(paletteInput).toHaveValue('');
    await expect(palette).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(palette).not.toBeVisible();
    await activeMain(window).getByTestId('note-find-trigger').click();
    const findInput = activeMain(window).getByTestId('note-find-input');
    await findInput.fill('searchable');
    await findInput.click({ button: 'right' });
    await waitForMenuCount(electronApp, 2);

    await expect(findInput).toHaveValue('searchable');
    await expect(findInput).toBeFocused();
    await closeCapturedNativeMenu(electronApp);
    await expect(findInput).toBeVisible();
    await expect(findInput).toHaveValue('searchable');
    await expect(findInput).toBeFocused();
  });

  test('table cells keep their structure and content around the native menu', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.locator('[aria-label="New note"]').click();
    const title = activeMain(window).locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.getByRole('option', { name: 'Table' }).click();

    await window.keyboard.type('cell context');
    const cell = activeMain(window)
      .locator('.ContentEditable__root th, .ContentEditable__root td')
      .filter({ hasText: 'cell context' })
      .first();
    await expect(cell).toHaveText('cell context');
    await cell.click({ button: 'right' });
    await waitForMenuCount(electronApp, 1);

    const [menu] = await capturedNativeMenus(electronApp);
    expect(menu.items.some((item) => item.role === 'paste')).toBe(true);
    await closeCapturedNativeMenu(electronApp);
    await expect(activeMain(window).locator('.ContentEditable__root table')).toHaveCount(1);
    await expect(cell).toHaveText('cell context');
  });

  test('link hover actions yield to the native menu without changing the link', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.locator('[aria-label="New note"]').click();
    const title = activeMain(window).locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('https://example.com', { delay: 10 });
    await window.keyboard.press('Space');

    const link = activeMain(window).locator('.ContentEditable__root a').first();
    await expect(link).toHaveAttribute('href', 'https://example.com');
    await link.hover();
    const openButton = window.locator('button[title="Open in browser"]');
    await expect(openButton).toBeVisible();

    await link.click({ button: 'right' });
    await waitForMenuCount(electronApp, 1);
    await expect(openButton).not.toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://example.com');

    await closeCapturedNativeMenu(electronApp);
    await expect(link).toHaveAttribute('href', 'https://example.com');
  });

  test('images remain owned by their renderer controls instead of getting a text menu', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    await window.locator('[aria-label="New note"]').click();
    await window.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context is unavailable');
      context.fillStyle = '#c94f5d';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error('PNG encoding failed')),
          'image/png',
        ),
      );
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    });

    const title = activeMain(window).locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.press(`${mod}+v`);
    const image = activeMain(window).locator('.image-container img').first();
    await expect(image).toBeVisible({ timeout: 15_000 });

    await image.click({ button: 'right' });
    await window.waitForTimeout(250);
    expect(await capturedNativeMenus(electronApp)).toEqual([]);
    await expect(image).toBeVisible();
    await expect(activeMain(window).locator('.image-container')).toHaveCount(1);
  });

  test('closing a held native menu after a tab switch cannot revive stale toolbar UI', async ({
    electronApp,
    window,
  }) => {
    await installNativeMenuCapture(electronApp);
    const firstParagraph = await createBodyText(window, 'first tab selection');
    const firstTab = await selectedTabId(window);
    await createBodyText(window, 'second tab content');
    const secondTab = await selectedTabId(window);

    await selectTab(window, firstTab);
    const firstText = activeMain(window)
      .locator('.ContentEditable__root p')
      .filter({ hasText: 'first tab selection' })
      .first();
    await selectElementContents(firstText);
    const toolbar = window.getByRole('toolbar', { name: 'Text formatting' });
    await expect(toolbar).toBeVisible();

    await firstParagraph.click({ button: 'right' });
    await waitForMenuCount(electronApp, 1);
    await expect(toolbar).not.toBeVisible();
    await selectTab(window, secondTab);
    await closeCapturedNativeMenu(electronApp);

    await expect(activeMain(window)).toContainText('second tab content');
    await expect(toolbar).not.toBeVisible();
    await window.waitForTimeout(200);
    await expect(toolbar).not.toBeVisible();
  });
});
