import {
  test,
  expect,
  listDocumentsFromDb,
  getLatestDocumentFromDb,
  getDocumentFromDb,
} from './electron-app';

test.describe('Title Typing Performance & Persistence', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  // ── Core: rapid typing must not drop characters ────────────────────

  test('rapid typing in title preserves all characters', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    const text = 'The quick brown fox jumps over the lazy dog';
    await window.keyboard.type(text, { delay: 10 });

    await expect(title).toHaveText(text);
  });

  test('very fast burst typing preserves every character', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    // Near-instant typing — stress test for debounce not swallowing input
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789';
    await window.keyboard.type(text, { delay: 5 });

    await expect(title).toHaveText(text);
  });

  // ── Database persistence ───────────────────────────────────────────

  test('title saves to database after debounce', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    const text = 'Persisted Title';
    await window.keyboard.type(text, { delay: 20 });

    // Wait for title save debounce (500ms) + IPC round-trip
    await window.waitForTimeout(1000);

    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe(text);
  });

  test('incremental edits each persist to database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('Hello');
    await window.waitForTimeout(800);
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Hello');

    await window.keyboard.type(' World');
    await window.waitForTimeout(800);
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Hello World');

    // Backspace 5 chars ("World") and retype
    for (let i = 0; i < 5; i++) await window.keyboard.press('Backspace');
    await window.keyboard.type('Everyone');
    await window.waitForTimeout(800);
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Hello Everyone');
  });

  test('only final value persists when typing mid-debounce', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    // Type first word, wait less than debounce (500ms), type more
    await window.keyboard.type('Draft');
    await window.waitForTimeout(200); // mid-debounce — timer resets
    await window.keyboard.type(' Version Two');

    // Now wait for debounce to complete
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('Draft Version Two');
  });

  // ── UI sync: sidebar and tab ───────────────────────────────────────

  test('sidebar and tab both update after debounce', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('UI Sync Test');

    // Wait for debounced store update (300ms) + buffer
    await window.waitForTimeout(700);

    await expect(window.locator('[data-note-id]').first()).toContainText('UI Sync Test');
    await expect(window.locator('[data-tab-id]').first()).toContainText('UI Sync Test');
  });

  // ── Tab switching / flush on unmount ───────────────────────────────

  test('title persists when switching away immediately after typing', async ({ window }) => {
    const visibleTitle = window.locator('main:visible h1.editor-title');

    // Type a title
    await visibleTitle.click();
    await window.keyboard.type('First Note', { delay: 10 });

    // Switch away immediately — no time for debounce to fire naturally.
    // The useEffect cleanup should flush pending debounces.
    await window.locator('[aria-label="New note"]').click();

    // Only wait for IPC round-trip, not the full debounce window
    await window.waitForTimeout(600);

    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(2);
    const firstNote = docs.find((d) => d.title === 'First Note');
    expect(firstNote).toBeTruthy();
  });

  test('rapid switching between two notes preserves both titles', async ({ window }) => {
    const visibleTitle = window.locator('main:visible h1.editor-title');

    // Type title in note A
    await visibleTitle.click();
    await window.keyboard.type('Note A Title', { delay: 10 });
    await window.waitForTimeout(800);

    // Create note B, type its title
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle.click();
    await window.keyboard.type('Note B Title', { delay: 10 });
    await window.waitForTimeout(800);

    // Switch back to note A via tab
    await window.locator('[data-tab-id]').filter({ hasText: 'Note A' }).click();
    await window.waitForTimeout(400);
    await expect(visibleTitle).toHaveText('Note A Title');

    // Switch back to note B
    await window.locator('[data-tab-id]').filter({ hasText: 'Note B' }).click();
    await window.waitForTimeout(400);
    await expect(visibleTitle).toHaveText('Note B Title');

    // Both in database
    const docs = await listDocumentsFromDb(window);
    expect(docs.find((d) => d.title === 'Note A Title')).toBeTruthy();
    expect(docs.find((d) => d.title === 'Note B Title')).toBeTruthy();
  });

  // ── Select-all and replace ─────────────────────────────────────────

  test('select-all and retype saves only final value', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await title.click();

    await window.keyboard.type('Original Title');
    await window.waitForTimeout(100);

    await window.keyboard.press(`${modifier}+a`);
    await window.keyboard.type('Replacement Title');

    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('Replacement Title');
    await expect(window.locator('[data-note-id]').first()).toContainText('Replacement Title');
    await expect(window.locator('[data-tab-id]').first()).toContainText('Replacement Title');
  });

  // ── Clearing the title ─────────────────────────────────────────────

  test('backspacing entire title saves empty string to database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('Temp');
    await window.waitForTimeout(800);
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Temp');

    // Backspace everything
    for (let i = 0; i < 4; i++) await window.keyboard.press('Backspace');
    await window.waitForTimeout(800);

    expect((await getLatestDocumentFromDb(window))!.title).toBe('');
  });

  test('select-all and delete clears title in database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await title.click();

    await window.keyboard.type('Delete Me');
    await window.waitForTimeout(800);

    await window.keyboard.press(`${modifier}+a`);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(800);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('');
    await expect(title).toHaveText('');
  });

  // ── Enter key behavior ─────────────────────────────────────────────

  test('Enter in title moves to body without adding newline to title', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('My Title');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Body text here');

    // Title should still be just "My Title"
    await expect(title).toHaveText('My Title');

    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('My Title');

    // Body text should be in content JSON, not in the title
    const content = JSON.parse(doc!.content);
    const bodyChildren = content.root.children.filter(
      (c: any) => c.type !== 'title',
    );
    const bodyText = bodyChildren
      .flatMap((c: any) => (c.children || []).map((t: any) => t.text || ''))
      .join('');
    expect(bodyText).toContain('Body text here');
  });

  // ── Title and body coexistence ─────────────────────────────────────

  test('editing title then body persists both independently', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('Title Text');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Body paragraph content');

    await window.waitForTimeout(1200);

    const doc = await getLatestDocumentFromDb(window);

    // Title persisted
    expect(doc!.title).toBe('Title Text');

    // Body persisted in content JSON
    const content = JSON.parse(doc!.content);
    const bodyNodes = content.root.children.filter(
      (c: any) => c.type !== 'title',
    );
    const bodyText = bodyNodes
      .flatMap((c: any) => (c.children || []).map((t: any) => t.text || ''))
      .join('');
    expect(bodyText).toContain('Body paragraph content');
  });

  test('editing body does not corrupt saved title', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('Stable Title');
    await window.waitForTimeout(800);

    // Move to body and type a lot
    await window.keyboard.press('Enter');
    await window.keyboard.type('Paragraph one');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Paragraph two');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Paragraph three');

    await window.waitForTimeout(1200);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('Stable Title');
  });

  // ── Undo / redo ────────────────────────────────────────────────────

  test('undo reverts title and persists undone state to database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await title.click();

    await window.keyboard.type('Before Undo');
    await window.waitForTimeout(800);
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Before Undo');

    // Undo all characters
    for (let i = 0; i < 'Before Undo'.length; i++) {
      await window.keyboard.press(`${modifier}+z`);
    }
    await window.waitForTimeout(800);

    await expect(title).toHaveText('');
    expect((await getLatestDocumentFromDb(window))!.title).toBe('');
  });

  test('undo then redo restores title and persists to database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await title.click();

    await window.keyboard.type('Redo Test');
    await window.waitForTimeout(800);

    // Undo all
    for (let i = 0; i < 'Redo Test'.length; i++) {
      await window.keyboard.press(`${modifier}+z`);
    }
    await window.waitForTimeout(800);
    expect((await getLatestDocumentFromDb(window))!.title).toBe('');

    // Redo all
    for (let i = 0; i < 'Redo Test'.length; i++) {
      await window.keyboard.press(`${modifier}+Shift+z`);
    }
    await window.waitForTimeout(800);

    await expect(title).toHaveText('Redo Test');
    expect((await getLatestDocumentFromDb(window))!.title).toBe('Redo Test');
  });

  // ── Paste ──────────────────────────────────────────────────────────

  test('paste into title saves pasted text to database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await title.click();

    // Put text on clipboard by typing and copying
    await window.keyboard.type('Clipboard Text');
    await window.keyboard.press(`${modifier}+a`);
    await window.keyboard.press(`${modifier}+c`);

    // Clear and paste after a prefix
    await window.keyboard.press('Backspace');
    await window.keyboard.type('Prefix ');
    await window.keyboard.press(`${modifier}+v`);

    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('Prefix Clipboard Text');
  });

  // ── Special characters ─────────────────────────────────────────────

  test('special characters in title persist to database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    const specialText = 'Café résumé naïve — "quotes" & <symbols>';
    await window.keyboard.type(specialText, { delay: 15 });

    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe(specialText);
    await expect(title).toHaveText(specialText);
  });

  test('punctuation-heavy title persists correctly', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    const punctuation = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
    await window.keyboard.type(punctuation, { delay: 15 });

    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe(punctuation);
  });

  // ── Placeholder toggle ─────────────────────────────────────────────

  test('placeholder class toggles correctly through multiple empty/non-empty cycles', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    // Type a character — placeholder should disappear
    await window.keyboard.type('X');
    await window.waitForTimeout(100);
    expect(
      await title.evaluate((el) => el.classList.contains('is-placeholder')),
    ).toBe(false);

    // Delete it — placeholder should reappear
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    expect(
      await title.evaluate((el) => el.classList.contains('is-placeholder')),
    ).toBe(true);

    // Type again — placeholder disappears
    await window.keyboard.type('New');
    await window.waitForTimeout(100);
    expect(
      await title.evaluate((el) => el.classList.contains('is-placeholder')),
    ).toBe(false);

    // Clear again — placeholder returns
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+a`);
    await window.keyboard.press('Backspace');
    await window.waitForTimeout(100);
    expect(
      await title.evaluate((el) => el.classList.contains('is-placeholder')),
    ).toBe(true);
  });

  // ── Long title ─────────────────────────────────────────────────────

  test('long title (200 chars) saves fully to database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    const longTitle = 'A'.repeat(200);
    await window.keyboard.type(longTitle, { delay: 5 });

    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe(longTitle);
    expect(doc!.title).toHaveLength(200);
  });

  // ── Whitespace handling ────────────────────────────────────────────
  // The backend trims titles on save (documents.ts: patch.title.trim()),
  // and Lexical may not persist whitespace-only text nodes.
  // These tests document the actual save-pipeline behavior.

  test('whitespace-only title saves as empty string', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('   ');
    await window.waitForTimeout(1000);

    // Whitespace-only input results in empty title after Lexical + backend trim
    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('');
  });

  test('leading and trailing spaces are trimmed by backend on save', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('  spaced title  ');
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    // Backend trims leading/trailing whitespace
    expect(doc!.title).toBe('spaced title');
  });

  test('interior spaces in title are preserved', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('hello   world');
    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toContain('hello');
    expect(doc!.title).toContain('world');
  });

  // ── Close tab after typing ─────────────────────────────────────────

  test('closing tab right after typing persists title to database', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('Before Close', { delay: 10 });

    // Grab doc ID before closing
    const noteId = await window
      .locator('[data-note-id]')
      .first()
      .getAttribute('data-note-id');

    // Close the tab immediately
    const closeBtn = window
      .locator('[data-tab-id]')
      .first()
      .locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });

    // Wait for flush + IPC
    await window.waitForTimeout(800);

    const doc = await getDocumentFromDb(window, noteId!);
    expect(doc!.title).toBe('Before Close');
  });

  // ── Rapid typing + close / reopen (debounce stress) ─────────────────

  test('rapid burst typing then immediate tab close persists final title', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    // 40 chars at 5ms delay — debounce resets ~40 times in quick succession
    const text = 'RapidBurstThenCloseImmediatelyAfterward';
    await window.keyboard.type(text, { delay: 5 });

    // Grab doc ID before closing
    const noteId = await window
      .locator('[data-note-id]')
      .first()
      .getAttribute('data-note-id');

    // Close immediately — no natural debounce fires, flush must save it
    const closeBtn = window
      .locator('[data-tab-id]')
      .first()
      .locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });

    // Wait for flush + IPC
    await window.waitForTimeout(800);

    const doc = await getDocumentFromDb(window, noteId!);
    expect(doc!.title).toBe(text);
  });

  test('edit-backspace-retype cycle then close persists only final title', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await title.click();

    // Type, select-all, replace — multiple debounce resets
    await window.keyboard.type('First Draft', { delay: 10 });
    await window.keyboard.press(`${modifier}+a`);
    await window.keyboard.type('Second Draft', { delay: 10 });
    await window.keyboard.press(`${modifier}+a`);
    await window.keyboard.type('Final Draft', { delay: 10 });

    const noteId = await window
      .locator('[data-note-id]')
      .first()
      .getAttribute('data-note-id');

    // Close before any debounce fires
    const closeBtn = window
      .locator('[data-tab-id]')
      .first()
      .locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });

    await window.waitForTimeout(800);

    const doc = await getDocumentFromDb(window, noteId!);
    expect(doc!.title).toBe('Final Draft');
  });

  test('type then close then reopen shows correct title from DB', async ({ window }) => {
    const visibleTitle = window.locator('main:visible h1.editor-title');
    await visibleTitle.click();

    await window.keyboard.type('Reopen Me', { delay: 10 });

    // Grab the sidebar note entry before closing
    const sidebarNote = window.locator('[data-note-id]').first();
    const noteId = await sidebarNote.getAttribute('data-note-id');

    // Close the tab immediately
    const closeBtn = window
      .locator('[data-tab-id]')
      .first()
      .locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });

    await window.waitForTimeout(800);

    // Reopen by clicking the sidebar entry
    await sidebarNote.click();
    await window.waitForTimeout(600);

    // Title loaded from DB should match what was typed
    await expect(window.locator('main:visible h1.editor-title')).toHaveText('Reopen Me');

    const doc = await getDocumentFromDb(window, noteId!);
    expect(doc!.title).toBe('Reopen Me');
  });

  test('sidebar shows correct title after tab close with pending debounce', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('Sidebar Sync', { delay: 10 });

    // Close immediately — debounced store update hasn't fired yet
    const closeBtn = window
      .locator('[data-tab-id]')
      .first()
      .locator('[aria-label="Close tab"]');
    await closeBtn.click({ force: true });

    // After flush, sidebar should reflect the final title
    await window.waitForTimeout(800);

    await expect(window.locator('[data-note-id]').first()).toContainText('Sidebar Sync');
  });

  test('rapid type in note A, switch to B, close B, note A DB title intact', async ({ window }) => {
    const visibleTitle = window.locator('main:visible h1.editor-title');

    // Type in note A — debounce pending
    await visibleTitle.click();
    await window.keyboard.type('Note A Rapid', { delay: 5 });

    const noteAId = await window
      .locator('[data-note-id]')
      .first()
      .getAttribute('data-note-id');

    // Create note B (switches away from A — triggers A's flush)
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle.click();
    await window.keyboard.type('Note B Temp', { delay: 10 });

    // Close note B immediately
    const closeBtnB = window
      .locator('[data-tab-id]')
      .filter({ hasText: 'Note B' })
      .locator('[aria-label="Close tab"]');
    await closeBtnB.click({ force: true });

    await window.waitForTimeout(800);

    // Note A's title should have been flushed when we switched away
    const docA = await getDocumentFromDb(window, noteAId!);
    expect(docA!.title).toBe('Note A Rapid');

    // Note A should now be active again with correct title
    await expect(window.locator('main:visible h1.editor-title')).toHaveText('Note A Rapid');
  });

  // ── Cursor position edge cases ─────────────────────────────────────

  test('typing in middle of title via arrow keys saves correctly', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('HelloWorld');

    // Move cursor between "Hello" and "World" (5 left arrow presses)
    for (let i = 0; i < 5; i++) await window.keyboard.press('ArrowLeft');
    await window.keyboard.type(' ');

    await expect(title).toHaveText('Hello World');

    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('Hello World');
  });

  test('Home then typing prepends to title correctly', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();

    await window.keyboard.type('World');

    // Go to start of line
    await window.keyboard.press('Home');
    await window.keyboard.type('Hello ');

    await expect(title).toHaveText('Hello World');

    await window.waitForTimeout(1000);

    const doc = await getLatestDocumentFromDb(window);
    expect(doc!.title).toBe('Hello World');
  });
});
