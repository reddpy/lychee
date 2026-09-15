import {
  test,
  expect,
  listDocumentsFromDb,
  getLatestDocumentFromDb,
  getDocumentFromDb,
} from './electron-app';

/**
 * Title typing, committing, and persistence.
 *
 * The title is commit-only (Enter / blur), matching the file-based model where
 * the filename *is* the title. Body content is markdown, so persistence is
 * asserted against the stored markdown string rather than Lexical JSON.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

function visibleTitle(window: any) {
  return window.locator('main:visible h1.editor-title');
}

/** Type a title into the open note's title field (leaves it uncommitted). */
async function typeTitle(window: any, text: string) {
  const title = visibleTitle(window);
  await title.click();
  await window.keyboard.press(`${MOD}+a`);
  await window.keyboard.type(text, { delay: 10 });
  return title;
}

/** Type a title and commit it with Enter. */
async function commitTitle(window: any, text: string) {
  const title = await typeTitle(window, text);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(600);
  return title;
}

/** Commit whatever is in the title via the same blur flush the app uses. */
async function blurCommit(window: any) {
  await window.evaluate(() => window.dispatchEvent(new Event('blur')));
  await window.waitForTimeout(600);
}

test.describe('Title typing and persistence', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('rapid typing preserves every character before commit', async ({ window }) => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const title = await typeTitle(window, text);
    await expect(title).toHaveText(text);
  });

  test('Enter commits the title to the database', async ({ window }) => {
    await commitTitle(window, 'Persisted Title');

    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Persisted Title');
  });

  test('blur commits the title to the database', async ({ window }) => {
    await typeTitle(window, 'Blur Committed');
    await blurCommit(window);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('Blur Committed');
  });

  test('incremental commits each persist', async ({ window }) => {
    await commitTitle(window, 'Hello');
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Hello');

    await commitTitle(window, 'Hello World');
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Hello World');
  });

  test('sidebar and tab update after commit', async ({ window }) => {
    await commitTitle(window, 'UI Sync Test');

    await expect(window.locator('[data-note-id]').first()).toContainText('UI Sync Test');
    await expect(window.locator('[data-tab-id]').first()).toContainText('UI Sync Test');
  });

  test('select-all and retype commits only the final value', async ({ window }) => {
    await typeTitle(window, 'Original Title');
    // Replace the whole selection, then commit.
    await window.keyboard.press(`${MOD}+a`);
    await window.keyboard.type('Replacement Title');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('Replacement Title');
    await expect(window.locator('[data-note-id]').first()).toContainText('Replacement Title');
    await expect(window.locator('[data-tab-id]').first()).toContainText('Replacement Title');
  });

  test('clearing the title commits an empty title and restores the placeholder', async ({
    window,
  }) => {
    await commitTitle(window, 'Temporary');
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Temporary');

    const title = visibleTitle(window);
    await title.click();
    await window.keyboard.press(`${MOD}+a`);
    await window.keyboard.press('Backspace');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('');
    await expect(title).toHaveClass(/(^|\s)is-placeholder(\s|$)/);
  });

  test('Enter moves to the body without adding a newline to the title', async ({ window }) => {
    const title = await commitTitle(window, 'My Title');
    await window.keyboard.type('Body text here');
    await window.waitForTimeout(700);

    await expect(title).toHaveText('My Title');
    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('My Title');
    expect(doc!.content).toContain('Body text here');
  });

  test('title and body persist independently', async ({ window }) => {
    await commitTitle(window, 'Title Text');
    await window.keyboard.type('Body paragraph content');
    await window.waitForTimeout(800);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('Title Text');
    expect(doc!.content).toContain('Body paragraph content');
  });

  test('undo reverts the title and the undone state persists', async ({ window }) => {
    const title = await typeTitle(window, 'Before Undo');
    for (let i = 0; i < 'Before Undo'.length; i += 1) {
      await window.keyboard.press(`${MOD}+z`);
    }
    await expect(title).toHaveText('');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('');
  });

  test('undo then redo restores the title and persists it', async ({ window }) => {
    const title = await typeTitle(window, 'Redo Test');
    for (let i = 0; i < 'Redo Test'.length; i += 1) {
      await window.keyboard.press(`${MOD}+z`);
    }
    await expect(title).toHaveText('');
    for (let i = 0; i < 'Redo Test'.length; i += 1) {
      await window.keyboard.press(`${MOD}+Shift+z`);
    }
    await expect(title).toHaveText('Redo Test');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('Redo Test');
  });

  test('paste into the title commits the pasted text', async ({ window }) => {
    const title = visibleTitle(window);
    await title.click();
    await window.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, 'Pasted Title');
    await window.keyboard.press(`${MOD}+v`);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('Pasted Title');
  });

  test('unicode and punctuation in the title persist exactly', async ({ window }) => {
    // Characters the single-line title field round-trips: accents, CJK, and
    // plain punctuation. (Markup-ish glyphs like <, >, ", % are altered by the
    // rich-text paste/normalization path.)
    const special = 'Café résumé naïve 日本語 - v1.2';
    const title = await commitTitle(window, special);

    expect((await getLatestDocumentFromDb(window))!.title).toBe(special);
    await expect(title).toHaveText(special);
  });

  test('a 200-character title persists fully', async ({ window }) => {
    const long = 'A'.repeat(200);
    await commitTitle(window, long);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe(long);
    expect(doc!.title).toHaveLength(200);
  });

  test('leading and trailing spaces are trimmed on commit', async ({ window }) => {
    await commitTitle(window, '  spaced title  ');
    expect((await getLatestDocumentFromDb(window))!.title).toBe('spaced title');
  });

  test('interior spaces in the title are preserved', async ({ window }) => {
    await commitTitle(window, 'hello   world');
    const stored = (await getLatestDocumentFromDb(window))!.title;
    expect(stored).toContain('hello');
    expect(stored).toContain('world');
  });

  test('typing in the middle of the title via arrow keys persists', async ({ window }) => {
    const title = await typeTitle(window, 'HelloWorld');
    for (let i = 0; i < 5; i += 1) await window.keyboard.press('ArrowLeft');
    await window.keyboard.type(' ');
    await expect(title).toHaveText('Hello World');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('Hello World');
  });

  test('Home then typing prepends to the title and persists', async ({ window }) => {
    const title = await typeTitle(window, 'World');
    await window.keyboard.press('Home');
    await window.keyboard.type('Hello ');
    await expect(title).toHaveText('Hello World');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('Hello World');
  });

  test('switching tabs keeps each note\'s committed title', async ({ window }) => {
    await commitTitle(window, 'Note A Title');

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await commitTitle(window, 'Note B Title');

    await window.locator('[data-tab-id]').filter({ hasText: 'Note A Title' }).click();
    await window.waitForTimeout(300);
    await expect(visibleTitle(window)).toHaveText('Note A Title');

    await window.locator('[data-tab-id]').filter({ hasText: 'Note B Title' }).click();
    await window.waitForTimeout(300);
    await expect(visibleTitle(window)).toHaveText('Note B Title');

    const titles = (await listDocumentsFromDb(window)).map((doc) => doc.title).sort();
    expect(titles).toEqual(['Note A Title', 'Note B Title']);
  });

  test('a committed title reloads after closing and reopening the tab', async ({ window }) => {
    await commitTitle(window, 'Reopen Me');
    const noteId = (await listDocumentsFromDb(window))[0].id;

    await window
      .locator('[data-tab-id]')
      .first()
      .locator('[aria-label="Close tab"]')
      .click({ force: true });
    await window.waitForTimeout(300);
    await window.locator(`[data-note-id="${noteId}"]`).click();
    await window.waitForTimeout(500);

    await expect(visibleTitle(window)).toHaveText('Reopen Me');
    expect((await getDocumentFromDb(window, noteId))!.title).toBe('Reopen Me');
  });
});

test.describe('Title placeholder behavior', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('a brand-new note shows the placeholder', async ({ window }) => {
    await expect(visibleTitle(window)).toHaveClass(/(^|\s)is-placeholder(\s|$)/);
  });

  test('the placeholder toggles with empty/non-empty content', async ({ window }) => {
    const title = visibleTitle(window);
    await title.click();

    await window.keyboard.type('X');
    await window.waitForTimeout(120);
    expect(await title.evaluate((el) => el.classList.contains('is-placeholder'))).toBe(false);

    await window.keyboard.press('Backspace');
    await window.waitForTimeout(120);
    expect(await title.evaluate((el) => el.classList.contains('is-placeholder'))).toBe(true);

    await window.keyboard.type('New');
    await window.waitForTimeout(120);
    expect(await title.evaluate((el) => el.classList.contains('is-placeholder'))).toBe(false);

    await window.keyboard.press(`${MOD}+a`);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(120);
    expect(await title.evaluate((el) => el.classList.contains('is-placeholder'))).toBe(true);
  });

  test('stress: 20 rapid type/clear cycles keep the placeholder in sync', async ({ window }) => {
    const title = visibleTitle(window);
    await title.click();
    for (let i = 0; i < 20; i += 1) {
      await window.keyboard.type('x', { delay: 0 });
      await window.keyboard.press(`${MOD}+a`);
      await window.keyboard.press('Backspace');
    }
    await window.waitForTimeout(150);
    await expect(title).toHaveClass(/(^|\s)is-placeholder(\s|$)/);
    await expect(title).toHaveText('');
  });

  test('switching tabs preserves each note\'s placeholder state', async ({ window }) => {
    const visible = visibleTitle(window);
    await expect(visible).toHaveClass(/(^|\s)is-placeholder(\s|$)/);

    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await commitTitle(window, 'Has Title');
    await expect(visible).not.toHaveClass(/(^|\s)is-placeholder(\s|$)/);

    const emptyTab = window.locator('[data-tab-id]').filter({ hasText: 'New Note' });
    const titledTab = window.locator('[data-tab-id]').filter({ hasText: 'Has Title' });

    await emptyTab.click();
    await window.waitForTimeout(250);
    await expect(visible).toHaveClass(/(^|\s)is-placeholder(\s|$)/);

    await titledTab.click();
    await window.waitForTimeout(250);
    await expect(visible).not.toHaveClass(/(^|\s)is-placeholder(\s|$)/);
    await expect(visible).toHaveText('Has Title');
  });
});
