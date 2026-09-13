import { test, expect } from './electron-app';
import { clearIpcMocks } from './ipc-mock';

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

test.describe('Settings Modal — Editor preferences', () => {
  test.afterEach(async ({ window }) => {
    await clearIpcMocks(window);
  });

  async function selectSetting(
    window: import('@playwright/test').Page,
    testId: string,
    label: string,
  ) {
    await window.getByTestId(testId).click();
    await window.getByRole('option', { name: label }).click();
  }

  async function chooseOption(
    window: import('@playwright/test').Page,
    testId: string,
    option: string,
  ) {
    await window
      .locator(`[data-testid="${testId}"][data-option="${option}"]`)
      .click();
  }

  async function storedEditor(window: import('@playwright/test').Page) {
    return window.evaluate(async () => {
      const result = await window.lychee.invoke('settings.get', { key: 'ui.editor' });
      return result.value ? JSON.parse(result.value) : null;
    });
  }

  /** Create a note and focus an empty body paragraph so hints can render. */
  async function newNoteWithBody(window: import('@playwright/test').Page) {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
  }

  test('typography, page width, and code tab size apply and persist', async ({
    window,
  }) => {
    const dialog = await openEditorSettings(window);
    await chooseOption(window, 'editor-font-family', 'serif');
    await chooseOption(window, 'editor-font-size', '18');
    await chooseOption(window, 'editor-page-width', 'wide');
    await chooseOption(window, 'editor-line-height', 'relaxed');
    await selectSetting(window, 'editor-code-tab-size', '4 spaces');

    await expect
      .poll(() =>
        window.evaluate(
          () => document.documentElement.style.getPropertyValue('--editor-font-size'),
        ),
      )
      .toBe('18px');
    await expect
      .poll(() =>
        window.evaluate(() =>
          document.documentElement.style.getPropertyValue('--editor-content-max-width'),
        ),
      )
      .toBe('1100px');
    await expect
      .poll(() =>
        window.evaluate(() =>
          document.documentElement.style.getPropertyValue('--editor-line-height'),
        ),
      )
      .toBe('2');
    await expect
      .poll(() =>
        window.evaluate(() =>
          document.documentElement.style.getPropertyValue('--editor-code-tab-size'),
        ),
      )
      .toBe('4');
    expect(
      await window.evaluate(() =>
        document.documentElement.style.getPropertyValue('--editor-font-family'),
      ),
    ).toContain('Georgia');

    await expect
      .poll(() => storedEditor(window))
      .toMatchObject({
        fontFamily: 'serif',
        fontSize: 18,
        pageWidth: 'wide',
        lineHeight: 'relaxed',
        codeTabSize: 4,
      });
    await expect(dialog).toBeVisible();
  });

  test('writing aids and reduce motion apply and persist', async ({ window }) => {
    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-word-count').click();
    await dialog.getByTestId('editor-focus-mode').click();
    await dialog.getByTestId('editor-typewriter-mode').click();
    await dialog.getByTestId('editor-reduce-motion').click();
    await dialog.getByTestId('editor-autolink').click();
    await dialog.getByTestId('editor-slash-menu').click();

    await expect
      .poll(() => window.evaluate(() => document.documentElement.dataset.reduceMotion))
      .toBe('true');
    await expect
      .poll(() => window.evaluate(() => document.documentElement.dataset.focusMode))
      .toBe('true');

    await expect
      .poll(() => storedEditor(window))
      .toMatchObject({
        showWordCount: true,
        focusMode: true,
        typewriterMode: true,
        reduceMotion: true,
        autolink: false,
        slashMenu: false,
      });
  });

  test('typography settings visibly affect the editor', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('Hello typography');

    const dialog = await openEditorSettings(window);
    await chooseOption(window, 'editor-font-family', 'serif');
    await chooseOption(window, 'editor-font-size', '18');
    await chooseOption(window, 'editor-line-height', 'relaxed');
    await chooseOption(window, 'editor-page-width', 'wide');
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    const root = window.locator('main:visible .ContentEditable__root');
    await expect
      .poll(() => root.evaluate((el) => getComputedStyle(el).fontSize))
      .toBe('18px');
    await expect
      .poll(() => root.evaluate((el) => getComputedStyle(el).fontFamily))
      .toContain('Georgia');
    await expect
      .poll(() =>
        root.locator('p').first().evaluate((el) => getComputedStyle(el).lineHeight),
      )
      .toBe('36px');
    await expect
      .poll(() =>
        window
          .getByTestId('editor-content')
          .evaluate((el) => getComputedStyle(el).maxWidth),
      )
      .toBe('1100px');
    await expect(dialog).not.toBeVisible();
  });

  test('a fully customized editor survives a reload', async ({ window }) => {
    const dialog = await openEditorSettings(window);
    await chooseOption(window, 'editor-font-family', 'mono');
    await chooseOption(window, 'editor-font-size', '20');
    await chooseOption(window, 'editor-line-height', 'relaxed');
    await dialog.getByTestId('editor-show-hint').click();
    await dialog.getByTestId('editor-block-placeholders').click();
    await dialog.getByTestId('editor-autolink').click();
    await dialog.getByTestId('editor-slash-menu').click();
    await dialog.getByTestId('editor-reduce-motion').click();
    await selectSetting(window, 'editor-code-tab-size', '4 spaces');

    // Wait for the write to land before reloading.
    await expect.poll(() => storedEditor(window)).toMatchObject({
      fontFamily: 'mono',
      fontSize: 20,
      lineHeight: 'relaxed',
      showHint: false,
      showBlockPlaceholders: false,
      autolink: false,
      slashMenu: false,
      reduceMotion: true,
      codeTabSize: 4,
    });

    await window.reload();
    await window.waitForSelector('aside[data-state]', { timeout: 15_000 });

    const rootProp = (name: string) =>
      window.evaluate(
        (prop) => document.documentElement.style.getPropertyValue(prop),
        name,
      );
    await expect.poll(() => rootProp('--editor-font-size')).toBe('20px');
    await expect.poll(() => rootProp('--editor-line-height')).toBe('2');
    await expect.poll(() => rootProp('--editor-code-tab-size')).toBe('4');
    await expect.poll(() => rootProp('--editor-font-family')).toContain('Menlo');
    await expect
      .poll(() => window.evaluate(() => document.documentElement.dataset.reduceMotion))
      .toBe('true');
    await expect
      .poll(() => window.evaluate(() => document.documentElement.dataset.focusMode))
      .toBe('false');
  });

  test('slash command menu can be disabled and re-enabled', async ({ window }) => {
    // Default is on: the placeholder advertises it and the menu appears for "/".
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
    await expect
      .poll(() =>
        window
          .locator('main:visible .ContentEditable__root p.is-placeholder')
          .first()
          .getAttribute('data-placeholder'),
      )
      .toContain("press '/'");
    await window.keyboard.type('/');
    await expect(window.getByRole('option', { name: 'Heading 2' })).toBeVisible();
    await window.keyboard.press('Escape');

    // Disable it: a fresh note shows no menu, and the placeholder drops the hint.
    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-slash-menu').click();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await expect(window.getByRole('option', { name: 'Heading 2' })).toHaveCount(0);

    await window.keyboard.press('Enter');
    await expect
      .poll(() =>
        window
          .locator('main:visible .ContentEditable__root p.is-placeholder')
          .first()
          .getAttribute('data-placeholder'),
      )
      .toBe('Type something...');
  });

  test('typing hint can be customized and hidden, separately from block placeholders', async ({
    window,
  }) => {
    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-hint-text').fill('Start writing');
    await window.keyboard.press('Escape');
    await expect.poll(() => storedEditor(window)).toMatchObject({
      hintText: 'Start writing',
    });

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
    await expect
      .poll(() =>
        window
          .locator('main:visible .ContentEditable__root p.is-placeholder')
          .first()
          .getAttribute('data-placeholder'),
      )
      .toBe('Start writing');

    // Turn off only the typing hint; empty paragraphs stop showing a hint.
    const dialog2 = await openEditorSettings(window);
    await dialog2.getByTestId('editor-show-hint').click();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await window.locator('main:visible .ContentEditable__root p').last().click();
    await window.waitForTimeout(150);
    await expect(
      window.locator('main:visible .ContentEditable__root p.is-placeholder'),
    ).toHaveCount(0);
    await expect.poll(() => storedEditor(window)).toMatchObject({ showHint: false });
  });

  test('block placeholders can be hidden independently of the typing hint', async ({
    window,
  }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.getByRole('option', { name: 'Heading 1' }).click();
    await expect(
      window.locator(
        'main:visible .ContentEditable__root h1.is-placeholder:not(.editor-title)',
      ),
    ).toHaveCount(1);

    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-block-placeholders').click();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    await expect(
      window.locator(
        'main:visible .ContentEditable__root h1.is-placeholder:not(.editor-title)',
      ),
    ).toHaveCount(0);
    await expect.poll(() => storedEditor(window)).toMatchObject({
      showBlockPlaceholders: false,
    });
  });

  test('reset restores editor defaults', async ({ window }) => {
    const dialog = await openEditorSettings(window);
    await chooseOption(window, 'editor-font-size', '20');
    await chooseOption(window, 'editor-font-family', 'mono');
    await dialog.getByTestId('editor-hint-text').fill('Custom hint');
    await dialog.getByTestId('editor-show-hint').click();
    await dialog.getByTestId('editor-block-placeholders').click();
    await expect.poll(() => storedEditor(window)).toMatchObject({
      fontSize: 20,
      fontFamily: 'mono',
      showHint: false,
      hintText: 'Custom hint',
      showBlockPlaceholders: false,
    });

    // Confirmation gate: Cancel leaves the custom values in place.
    await dialog.getByTestId('editor-reset').click();
    const resetPopover = window.getByTestId('editor-reset-popover');
    await expect(resetPopover).toBeVisible();
    await resetPopover.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => storedEditor(window)).toMatchObject({
      fontSize: 20,
      hintText: 'Custom hint',
    });

    await dialog.getByTestId('editor-reset').click();
    await window.getByTestId('editor-reset-confirm').click();

    await expect.poll(() => storedEditor(window)).toMatchObject({
      fontFamily: 'sans',
      fontSize: 16,
      lineHeight: 'normal',
      showHint: true,
      hintText: '',
      showBlockPlaceholders: true,
      autolink: true,
      slashMenu: true,
    });
    await expect
      .poll(() =>
        window.evaluate(
          () => document.documentElement.style.getPropertyValue('--editor-font-size'),
        ),
      )
      .toBe('16px');
    await expect(dialog.getByTestId('editor-show-hint')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('automatic links can be disabled and re-enabled', async ({ window }) => {
    // Disable autolink, then a typed URL stays plain text.
    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-autolink').click();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('https://example.com', { delay: 10 });
    await window.keyboard.press('Space');
    await expect(
      window.locator('main:visible .ContentEditable__root a'),
    ).toHaveCount(0);

    // Re-enable, then the same input links up.
    const dialog2 = await openEditorSettings(window);
    await dialog2.getByTestId('editor-autolink').click();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('https://example.com', { delay: 10 });
    await window.keyboard.press('Space');
    await expect(
      window.locator('main:visible .ContentEditable__root a').first(),
    ).toHaveAttribute('href', 'https://example.com');
  });

  test('focus mode dims every block except the caret block', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Focus Mode Test');
    await window.keyboard.press('Enter');
    await window.keyboard.type('First block');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Second block');

    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-focus-mode').click();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    await expect
      .poll(() => window.locator('main:visible .editor-focus-dim').count())
      .toBeGreaterThan(0);
    await expect(window.locator('main:visible .editor-focus-active')).toHaveCount(1);
  });

  test('word count is hidden by default, then shows and updates live', async ({
    window,
  }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.type('Word Count Test');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Hello world');
    await window.keyboard.press('Enter');
    await window.keyboard.type('One two three');
    await window.waitForTimeout(300);

    // Hidden until the preference is enabled.
    await expect(window.getByTestId('word-count')).toHaveCount(0);

    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-word-count').click();
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);

    const counter = window.getByTestId('word-count');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('5 words');
    await expect(counter).toContainText(/characters/);

    // Typing more updates the count live.
    await window.locator('main:visible .ContentEditable__root p').last().click();
    await window.keyboard.press('End');
    await window.keyboard.type(' four');
    await expect(counter).toContainText('6 words');
  });

  test('word count shows zero for an empty note and decreases when text is removed', async ({
    window,
  }) => {
    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-word-count').click();
    await window.keyboard.press('Escape');

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    const counter = window.getByTestId('word-count');
    await expect(counter).toContainText('0 words');

    await window.locator('main:visible h1.editor-title').click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('one two three four');
    await expect(counter).toContainText('4 words');

    // Delete the last word; the count drops.
    await window.keyboard.press('End');
    for (let i = 0; i < 4; i += 1) {
      await window.keyboard.press('Backspace');
    }
    await expect(counter).toContainText('3 words');
  });

  test('every typography option applies to the editor', async ({ window }) => {
    await newNoteWithBody(window);
    await window.keyboard.type('Typography');
    const editorRoot = () => window.locator('main:visible .ContentEditable__root');

    const dialog = await openEditorSettings(window);

    for (const [option, needle] of [
      ['sans', 'Inter'],
      ['serif', 'Georgia'],
      ['mono', 'Menlo'],
    ] as const) {
      await chooseOption(window, 'editor-font-family', option);
      await expect
        .poll(() => editorRoot().evaluate((el) => getComputedStyle(el).fontFamily))
        .toContain(needle);
    }

    for (const [option, px] of [
      ['14', '14px'],
      ['20', '20px'],
    ] as const) {
      await chooseOption(window, 'editor-font-size', option);
      await expect
        .poll(() => editorRoot().evaluate((el) => getComputedStyle(el).fontSize))
        .toBe(px);
    }

    // Line height is relative to the 20px body size picked above.
    for (const [option, expected] of [
      ['compact', '30px'],
      ['relaxed', '40px'],
    ] as const) {
      await chooseOption(window, 'editor-line-height', option);
      await expect
        .poll(() =>
          editorRoot()
            .locator('p')
            .first()
            .evaluate((el) => getComputedStyle(el).lineHeight),
        )
        .toBe(expected);
    }

    await expect(dialog).toBeVisible();
  });

  test('custom hint overrides the slash hint and survives turning the slash menu off', async ({
    window,
  }) => {
    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-hint-text').fill('Write a thought');
    await dialog.getByTestId('editor-slash-menu').click();
    await window.keyboard.press('Escape');

    await newNoteWithBody(window);
    await expect
      .poll(() =>
        window
          .locator('main:visible .ContentEditable__root p.is-placeholder')
          .first()
          .getAttribute('data-placeholder'),
      )
      .toBe('Write a thought');

    // Clearing the custom hint falls back to the slash-disabled default.
    const dialog2 = await openEditorSettings(window);
    await dialog2.getByTestId('editor-hint-text').fill('');
    await window.keyboard.press('Escape');
    await window.locator('main:visible .ContentEditable__root p').last().click();
    await expect
      .poll(() =>
        window
          .locator('main:visible .ContentEditable__root p.is-placeholder')
          .first()
          .getAttribute('data-placeholder'),
      )
      .toBe('Type something...');
  });

  test('whitespace-only custom hint falls back to the default', async ({ window }) => {
    const dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-hint-text').fill('   ');
    await window.keyboard.press('Escape');

    await newNoteWithBody(window);
    await expect
      .poll(() =>
        window
          .locator('main:visible .ContentEditable__root p.is-placeholder')
          .first()
          .getAttribute('data-placeholder'),
      )
      .toContain("press '/'");
  });

  test('hints re-apply when turned back on', async ({ window }) => {
    let dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-show-hint').click();
    await dialog.getByTestId('editor-block-placeholders').click();
    await window.keyboard.press('Escape');

    await newNoteWithBody(window);
    await window.waitForTimeout(150);
    await expect(
      window.locator('main:visible .ContentEditable__root p.is-placeholder'),
    ).toHaveCount(0);

    dialog = await openEditorSettings(window);
    await dialog.getByTestId('editor-show-hint').click();
    await window.keyboard.press('Escape');
    await window.locator('main:visible .ContentEditable__root p').last().click();
    await expect
      .poll(() =>
        window.locator('main:visible .ContentEditable__root p.is-placeholder').count(),
      )
      .toBeGreaterThan(0);
  });

  test('code tab size applies to code blocks', async ({ window }) => {
    await newNoteWithBody(window);
    await window.keyboard.type('/');
    await window.getByRole('option', { name: 'Code Block' }).click();
    await expect(window.locator('main:visible .editor-code')).toBeVisible();

    const codeTabSize = () =>
      window
        .locator('main:visible .editor-code')
        .evaluate((el) => getComputedStyle(el).tabSize);

    const dialog = await openEditorSettings(window);
    await selectSetting(window, 'editor-code-tab-size', '8 spaces');
    await window.keyboard.press('Escape');
    await expect.poll(codeTabSize).toBe('8');

    const dialog2 = await openEditorSettings(window);
    await selectSetting(window, 'editor-code-tab-size', '2 spaces');
    await window.keyboard.press('Escape');
    await expect.poll(codeTabSize).toBe('2');
  });
});
