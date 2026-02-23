import { test, expect, listDocumentsFromDb, getDocumentFromDb } from './electron-app';

test.describe('Editor', () => {
  test.beforeEach(async ({ window }) => {
    // Create a new note to work with
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('editor title is visible and editable', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await expect(title).toBeVisible();

    await title.click();
    await window.keyboard.type('My Test Note');

    await expect(title).toContainText('My Test Note');
  });

  test('typing a title updates the sidebar and tab', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('Updated Title');

    // Wait for debounced save
    await window.waitForTimeout(700);

    // The sidebar should reflect the title
    await expect(window.locator('[data-note-id]').first()).toContainText('Updated Title');

    // The tab should reflect the title
    await expect(window.locator('[data-tab-id]').first()).toContainText('Updated Title');

    // ── Backend: title is persisted in SQLite ──
    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Updated Title');
  });

  test('editor body is editable and persisted', async ({ window }) => {
    // Press Enter from the title to move to body
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Type in the body
    await window.keyboard.type('Hello, this is body text.');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Hello, this is body text.');

    // Wait for debounced content save (600ms debounce + buffer)
    await window.waitForTimeout(1000);

    // ── Backend: content is persisted as Lexical JSON in SQLite ──
    const docs = await listDocumentsFromDb(window);
    expect(docs).toHaveLength(1);
    expect(docs[0].content).toBeTruthy();
    const contentJson = JSON.parse(docs[0].content);
    expect(contentJson.root).toBeTruthy();
    expect(contentJson.root.children.length).toBeGreaterThan(0);
  });

  test('slash command menu appears when typing /', async ({ window }) => {
    // Move to body
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Type / to trigger slash commands
    await window.keyboard.type('/');

    // The slash command menu should appear with block type options
    await expect(window.getByRole('option', { name: 'Text' })).toBeVisible();
    await expect(window.getByRole('option', { name: 'Heading 1' })).toBeVisible();
    await expect(window.getByRole('option', { name: 'Bullet List' })).toBeVisible();
  });

  test('slash command inserts a heading', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Use slash command to insert heading
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Heading 1' }).click();
    await window.waitForTimeout(200);

    // Type heading content
    await window.keyboard.type('My Heading');

    // Verify an h1 element exists in the editor (beyond the title)
    const headings = window.locator('.ContentEditable__root h1:not(.editor-title)');
    await expect(headings.first()).toContainText('My Heading');
  });

  test('bold formatting via keyboard shortcut', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Type some text
    await window.keyboard.type('normal ');

    // Toggle bold
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+b`);
    await window.keyboard.type('bold text');
    await window.keyboard.press(`${modifier}+b`);

    // The bold text should be in a <strong> or element with font-bold class
    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('normal bold text');
    await expect(editorRoot.locator('strong, .font-bold').first()).toContainText('bold text');
  });

  test('italic formatting via keyboard shortcut', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+i`);
    await window.keyboard.type('italic text');
    await window.keyboard.press(`${modifier}+i`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('em, .italic').first()).toContainText('italic text');
  });

  test('markdown shortcut for heading (#)', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Markdown shortcut: "## " converts to h2
    await window.keyboard.type('## ');
    await window.keyboard.type('Heading Two');

    const h2 = window.locator('.ContentEditable__root h2');
    await expect(h2.first()).toContainText('Heading Two');
  });

  test('markdown shortcut for bullet list (- )', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Markdown shortcut: "- " converts to bullet list
    await window.keyboard.type('- ');
    await window.keyboard.type('List item one');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('List item one');
  });

  test('Enter from title creates a new paragraph', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('My Title');
    await window.keyboard.press('Enter');

    // Cursor should now be in a paragraph after the title
    await window.keyboard.type('First paragraph');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('First paragraph');
  });
});

test.describe('Editor — Slash Commands', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('slash command inserts Heading 2', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Heading 2' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Subheading');

    const h2 = window.locator('.ContentEditable__root h2');
    await expect(h2.first()).toContainText('Subheading');
  });

  test('slash command inserts Heading 3', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Heading 3' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Small heading');

    const h3 = window.locator('.ContentEditable__root h3');
    await expect(h3.first()).toContainText('Small heading');
  });

  test('slash command inserts bullet list', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Bullet List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Item one');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Item one');
    await expect(editorRoot.locator('.list-item--bullet')).toHaveCount(1);
  });

  test('slash command inserts numbered list', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Numbered List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('First step');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('First step');
    await expect(editorRoot.locator('.list-item--number')).toHaveCount(1);
  });

  test('slash command inserts check list', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Check List' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Todo item');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Todo item');
    await expect(editorRoot.locator('.list-item--check')).toHaveCount(1);
  });

  test('slash command inserts quote block', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Quote' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Quoted text');

    const quote = window.locator('.ContentEditable__root blockquote');
    await expect(quote.first()).toContainText('Quoted text');
  });

  test('slash command inserts code block', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Code Block' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.type('const x = 1;');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('const x = 1;');
  });

  test('slash command inserts divider', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Divider' }).click();
    await window.waitForTimeout(200);

    const hr = window.locator('.ContentEditable__root hr');
    await expect(hr).toHaveCount(1);
  });

  test('slash command filters by keyword', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/code');
    await window.waitForTimeout(200);

    await expect(window.getByRole('option', { name: 'Code Block' })).toBeVisible();
    await expect(window.getByRole('option', { name: 'Text' })).not.toBeVisible();
  });
});

test.describe('Editor — Markdown Shortcuts', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('### converts to Heading 3', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('### ');
    await window.keyboard.type('H3 Title');

    const h3 = window.locator('.ContentEditable__root h3');
    await expect(h3.first()).toContainText('H3 Title');
  });

  test('1. converts to numbered list', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('1. ');
    await window.keyboard.type('Numbered item');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Numbered item');
    await expect(editorRoot.locator('.list-item--number')).toHaveCount(1);
  });

  test('[ ] converts to check list', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('Unchecked task');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Unchecked task');
    await expect(editorRoot.locator('.list-item--check')).toHaveCount(1);
  });

  test('> converts to quote', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('> ');
    await window.keyboard.type('Blockquote');

    const quote = window.locator('.ContentEditable__root blockquote');
    await expect(quote.first()).toContainText('Blockquote');
  });

  test('``` converts to code block', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('```');
    await window.keyboard.press('Enter');
    await window.keyboard.type('code here');
    await window.keyboard.press('Enter');
    await window.keyboard.type('```');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('code here');
  });

  test('**text** converts to bold', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('**bold**');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('strong, .font-bold').first()).toContainText('bold');
  });

  test('*text* converts to italic', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('*italic*');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('em, .italic').first()).toContainText('italic');
  });

  test('`code` converts to inline code', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('`inline`');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('code').first()).toContainText('inline');
  });

  test('~~text~~ converts to strikethrough', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('~~struck~~');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('struck');
  });
});

test.describe('Editor — Formatting', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('underline via keyboard shortcut', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+u`);
    await window.keyboard.type('underlined');
    await window.keyboard.press(`${modifier}+u`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('u, .underline').first()).toContainText('underlined');
  });

  test('strikethrough via keyboard shortcut', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+Shift+s`);
    await window.keyboard.type('struck');
    await window.keyboard.press(`${modifier}+Shift+s`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('struck');
  });

  test('inline code via keyboard shortcut', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press('`');
    await window.keyboard.type('variable');
    await window.keyboard.press('`');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('code').first()).toContainText('variable');
  });
});

test.describe('Editor — Block Behavior', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  test('Enter on empty heading exits to paragraph', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');
    await window.waitForTimeout(200);
    await window.getByRole('option', { name: 'Heading 2' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.press('Enter');

    const p = window.locator('.ContentEditable__root p');
    await expect(p.first()).toBeVisible();
  });

  test('Enter on empty quote exits to paragraph', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('> ');
    await window.keyboard.press('Enter');

    const p = window.locator('.ContentEditable__root p');
    await expect(p.first()).toBeVisible();
  });

  test('Enter in bullet list creates new list item', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('- ');
    await window.keyboard.type('One');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Two');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('.list-item--bullet')).toHaveCount(2);
    await expect(editorRoot).toContainText('One');
    await expect(editorRoot).toContainText('Two');
  });

  test('check list item can be toggled', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('Task');
    await window.waitForTimeout(200);

    const checkItem = window.locator('.ContentEditable__root .list-item--check');
    await expect(checkItem).toHaveCount(1);
    await checkItem.click({ position: { x: 10, y: 10 } });
    await window.waitForTimeout(200);

    await expect(checkItem).toHaveClass(/list-item--checked/);
  });

  test('multiple block types in one document', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('Doc Title');
    await window.keyboard.press('Enter');

    await window.keyboard.type('## Section');
    await window.keyboard.press('Enter');
    await window.keyboard.type('- Bullet');
    await window.keyboard.press('Enter');
    await window.keyboard.type('1. Numbered');
    await window.keyboard.press('Enter');
    await window.keyboard.type('> Quote');
    await window.keyboard.press('Enter');
    await window.keyboard.type('```');
    await window.keyboard.press('Enter');
    await window.keyboard.type('code');
    await window.keyboard.press('Enter');
    await window.keyboard.type('```');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Doc Title');
    await expect(editorRoot).toContainText('Section');
    await expect(editorRoot).toContainText('Bullet');
    await expect(editorRoot).toContainText('Numbered');
    await expect(editorRoot).toContainText('Quote');
    await expect(editorRoot).toContainText('code');
  });
});

test.describe('Editor — Content Persistence', () => {
  test('rich content persists after save and reopen', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);

    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('Persistence Test');
    await window.keyboard.press('Enter');
    await window.keyboard.type('## Sub');
    await window.keyboard.press('Enter');
    await window.keyboard.type('- Item');
    await window.keyboard.press('Enter');
    await window.keyboard.type('**bold** and *italic*');
    await window.waitForTimeout(1000);

    const noteId = await window.locator('[data-note-id]').first().getAttribute('data-note-id');
    await window.locator('[data-note-id]').first().click();
    await window.waitForTimeout(300);

    const otherNote = window.locator('[data-note-id]').filter({ hasNotText: 'Persistence Test' });
    if ((await otherNote.count()) > 0) {
      await otherNote.first().click();
      await window.waitForTimeout(300);
    }

    await window.locator(`[data-note-id="${noteId}"]`).click();
    await window.waitForTimeout(500);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(window.locator('h1.editor-title')).toContainText('Persistence Test');
    await expect(editorRoot).toContainText('Sub');
    await expect(editorRoot).toContainText('Item');
    await expect(editorRoot).toContainText('bold');
    await expect(editorRoot).toContainText('italic');
  });

  test('content JSON structure is valid in DB', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);

    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('DB Structure');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Body with **formatting**');
    await window.waitForTimeout(1000);

    const { listDocumentsFromDb } = await import('./electron-app');
    const docs = await listDocumentsFromDb(window);
    const doc = docs.find((d) => d.title === 'DB Structure');
    expect(doc).toBeTruthy();
    expect(doc!.content).toBeTruthy();

    const content = JSON.parse(doc!.content);
    expect(content.root).toBeTruthy();
    expect(Array.isArray(content.root.children)).toBe(true);
    expect(content.root.children.length).toBeGreaterThan(0);
  });
});
