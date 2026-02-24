import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  getLatestDocumentFromDb,
} from './electron-app';

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

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const hasHeading = content.root.children.some((c: any) => c.type === 'heading' && c.tag === 'h1');
    expect(hasHeading).toBe(true);
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
    await expect(editorRoot.locator('ul.editor-list-ul > li')).toHaveCount(1);
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
    await expect(editorRoot.locator('ol.editor-list-ol > li')).toHaveCount(1);
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
    await expect(editorRoot.locator('li.editor-list-item-unchecked')).toHaveCount(1);
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
    await expect(editorRoot.locator('ol.editor-list-ol > li')).toHaveCount(1);
  });

  test('[ ] converts to check list', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('Unchecked task');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Unchecked task');
    await expect(editorRoot.locator('li.editor-list-item-unchecked')).toHaveCount(1);
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
    await expect(editorRoot.locator('ul.editor-list-ul > li')).toHaveCount(2);
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

    const checkItem = window.locator('.ContentEditable__root li.editor-list-item-unchecked');
    await expect(checkItem).toHaveCount(1);
    await checkItem.click({ position: { x: 10, y: 10 } });
    await window.waitForTimeout(200);

    await expect(window.locator('.ContentEditable__root li.editor-list-item-checked')).toHaveCount(1);
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
    // Enter on empty list item exits the list
    await window.keyboard.press('Enter');
    await window.keyboard.type('> Quote');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Doc Title');
    await expect(editorRoot).toContainText('Section');
    await expect(editorRoot).toContainText('Bullet');
    await expect(editorRoot).toContainText('Quote');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const types = content.root.children.map((c: any) => c.type);
    expect(types).toContain('heading');
    expect(types).toContain('list');
    expect(types).toContain('quote');
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

test.describe('Editor — Edge Cases', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  test('backspace on empty paragraph merges with previous', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('First');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Second');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('Backspace');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('FirstSecond');
  });

  test('slash command at document start shows menu', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('/');

    await expect(window.getByRole('option', { name: 'Text' })).toBeVisible();
  });

  test('formatting on empty selection applies to next typed text', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.press(`${mod}+b`);
    await window.keyboard.type('bold');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('strong, .font-bold').first()).toContainText('bold');
  });

  test('undo reverts last edit', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('Original Gone');
    await window.keyboard.press(`${mod}+z`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).not.toContainText('Original');
    await expect(editorRoot).not.toContainText('Gone');
  });

  test('redo restores undone edit', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('Text');
    await window.keyboard.press(`${mod}+z`);
    await window.keyboard.press(`${mod}+Shift+z`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Text');
  });

  test('paste plain text inserts at cursor', async ({ window }) => {
    await window.evaluate(async () => {
      await navigator.clipboard.writeText('Pasted content');
    });
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.press(`${mod}+v`);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Pasted content');
  });

  test('paste image inserts image node', async ({ window }) => {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await window.evaluate(async (base64: string) => {
      const resp = await fetch(`data:image/png;base64,${base64}`);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }, pngBase64);

    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.press(`${mod}+v`);
    await window.waitForTimeout(2000);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('.image-container').or(editorRoot.locator('img')).first()).toBeVisible();

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const hasImage = content.root.children.some((c: any) => c.type === 'image');
    expect(hasImage).toBe(true);
  });

  test('link insertion via Cmd+K', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('link text');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('ArrowLeft');
    await window.keyboard.press('Shift+Home');
    await window.keyboard.press(`${mod}+k`);
    await window.waitForTimeout(300);

    await window.getByPlaceholder('Enter URL...').fill('https://example.com');
    await window.getByRole('button', { name: 'Apply' }).click();
    await window.waitForTimeout(300);

    const editorRoot = window.locator('.ContentEditable__root');
    const link = editorRoot.locator('a[href*="example.com"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('link');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const contentStr = JSON.stringify(content);
    expect(contentStr).toContain('example.com');
    expect(contentStr).toContain('link');
  });

  test('markdown image ![](url) inserts image', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('![alt](https://example.com/image.png)');
    await window.waitForTimeout(1500);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('.image-container').or(editorRoot.locator('img')).first()).toBeVisible();

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const hasImage = content.root.children.some((c: any) => c.type === 'image');
    expect(hasImage).toBe(true);
  });

  test('code block: markdown shortcut creates code block', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    // ``` creates Lexical CodeNode (pre/code), slash creates same
    await window.keyboard.type('```');
    await window.keyboard.press('Enter');
    await window.keyboard.type('const x = 1');
    await window.keyboard.press('Enter');
    await window.keyboard.type('```');
    await window.waitForTimeout(300);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('const x = 1');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const hasCode = content.root.children.some(
      (c: any) => c.type === 'code' || c.type === 'code-block',
    );
    expect(hasCode).toBe(true);
    expect(JSON.stringify(content)).toContain('const x = 1');
  });

  test('code block: Escape exits edit mode', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('```');
    await window.keyboard.press('Enter');
    await window.keyboard.type('code');
    await window.keyboard.press('Enter');
    await window.keyboard.type('```');
    await window.waitForTimeout(200);
    await window.keyboard.press('Escape');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('code');
  });

  test('document with only empty blocks', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('Title');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Title');
    await expect(window.locator('h1.editor-title')).toContainText('Title');
  });

  test('long content persists', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.type('Long');
    await window.keyboard.press('Enter');
    const longText = 'x'.repeat(500);
    await window.keyboard.type(longText);
    await window.waitForTimeout(1000);

    const { listDocumentsFromDb } = await import('./electron-app');
    const docs = await listDocumentsFromDb(window);
    const doc = docs.find((d) => d.title === 'Long');
    expect(doc).toBeTruthy();
    expect(doc!.content).toContain(longText);
  });

  test('paste markdown image syntax ![](url) inserts image', async ({ window }) => {
    await window.evaluate(async () => {
      await navigator.clipboard.writeText('![pasted](https://example.com/pic.png)');
    });
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.press(`${mod}+v`);
    await window.waitForTimeout(1500);

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('.image-container').or(editorRoot.locator('img')).first()).toBeVisible();

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const hasImage = content.root.children.some((c: any) => c.type === 'image');
    expect(hasImage).toBe(true);
  });
});

test.describe('Editor — Focus Behavior', () => {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /** Paste a 1×1 PNG into the editor from the clipboard. */
  async function pasteImage(window: any) {
    await window.evaluate(async (base64: string) => {
      const resp = await fetch(`data:image/png;base64,${base64}`);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }, PNG_1x1);
    await window.keyboard.press(`${mod}+v`);
    await window.waitForTimeout(2000);
  }

  /** Returns true if activeElement is inside the visible editor's ContentEditable__root. */
  async function editorBodyHasFocus(window: any): Promise<boolean> {
    return window.evaluate(() => {
      const visibleMain = Array.from(document.querySelectorAll('main'))
        .find((m) => m.style.display !== 'none');
      if (!visibleMain) return false;
      const root = visibleMain.querySelector('.ContentEditable__root');
      return root?.contains(document.activeElement) ?? false;
    });
  }

  /** Returns the visible (non-hidden) <main> scroll container. */
  function visibleMain(window: any) {
    return window.locator('main:not([style*="display: none"])').first();
  }

  /** Returns the .ContentEditable__root inside the visible <main>. */
  function visibleEditor(window: any) {
    return visibleMain(window).locator('.ContentEditable__root');
  }

  /** Returns the h1.editor-title inside the visible <main>. */
  function visibleTitle(window: any) {
    return visibleMain(window).locator('h1.editor-title');
  }

  /**
   * Close the active tab. This unmounts the editor so that reopening
   * the note from the sidebar triggers a fresh deserialize from DB,
   * which exercises the image path-resolution editor.update() calls.
   */
  async function closeActiveTab(window: any) {
    const activeTab = window.locator('[data-tab-id]').first();
    await activeTab.hover();
    await activeTab.locator('[aria-label="Close tab"]').click();
    await window.waitForTimeout(400);
  }

  // ─── Auto-focus prevention ────────────────────────────────────────
  //
  // The image node serializes only `imageId` (not `src`). Every fresh
  // mount resolves `imageId → filePath` via IPC, then calls
  // editor.update() to write `src` back. Without our fix this
  // editor.update() would silently re-focus the editor.
  //
  // To exercise this code path the tests CLOSE the tab (unmounting
  // the editor) and REOPEN from the sidebar (fresh deserialize).

  test('reopening a note with an image from sidebar does not auto-focus editor body', async ({ window }) => {
    // Create a note with an image
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Reopen Img');
    await window.keyboard.press('Enter');
    await pasteImage(window);
    await expect(visibleEditor(window).locator('.image-container').first()).toBeVisible();

    // Wait for debounced save to persist content + image to DB
    await window.waitForTimeout(1500);

    // Close the tab — unmounts the editor entirely
    await closeActiveTab(window);

    // Reopen from sidebar — fresh deserialize, triggers image path resolution
    await window.locator('[data-note-id]').filter({ hasText: 'Reopen Img' }).click();
    await window.waitForTimeout(2000);

    // Image container present — path resolution editor.update() has fired
    // (actual <img> rendering broken after reopen, tracked in #83)
    await expect(visibleEditor(window).locator('.image-container')).toBeVisible();

    // But the editor body should NOT have focus
    expect(await editorBodyHasFocus(window)).toBe(false);
  });

  test('reopening a note with multiple images does not auto-focus', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Multi Img');
    await window.keyboard.press('Enter');

    // Paste three images — each will trigger a separate path resolution on reopen
    for (let i = 0; i < 3; i++) {
      await pasteImage(window);
      await window.keyboard.press('Enter');
    }
    await expect(visibleEditor(window).locator('.image-container')).toHaveCount(3);
    await window.waitForTimeout(1500);

    await closeActiveTab(window);

    await window.locator('[data-note-id]').filter({ hasText: 'Multi Img' }).click();
    await window.waitForTimeout(3000); // Extra time for 3 path resolutions

    // All image containers present — path resolution fired for each (#83)
    await expect(visibleEditor(window).locator('.image-container')).toHaveCount(3);

    expect(await editorBodyHasFocus(window)).toBe(false);
  });

  test('reopening a note with only an image and no text does not auto-focus', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Lone Image');
    await window.keyboard.press('Enter');
    await pasteImage(window);
    await window.waitForTimeout(1500);

    await closeActiveTab(window);

    await window.locator('[data-note-id]').filter({ hasText: 'Lone Image' }).click();
    await window.waitForTimeout(2000);

    // Image container present — path resolution fired (#83)
    await expect(visibleEditor(window).locator('.image-container')).toBeVisible();
    expect(await editorBodyHasFocus(window)).toBe(false);
  });

  // ─── Checkbox + scroll stability ──────────────────────────────────

  test('toggling a checkbox does not jump scroll after reopening a note with images', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Scroll Stability');
    await window.keyboard.press('Enter');

    // Image at top
    await pasteImage(window);
    await window.keyboard.press('Enter');

    // Filler to make the document scrollable
    for (let i = 0; i < 15; i++) {
      await window.keyboard.type(`Line ${i + 1} of filler content for scrolling test.`);
      await window.keyboard.press('Enter');
    }

    // Checkbox near the bottom
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('Bottom checkbox');
    await window.waitForTimeout(1500);

    // Close tab, reopen — fresh mount with path resolution
    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'Scroll Stability' }).click();
    await window.waitForTimeout(2000);

    // Scroll to bottom where the checkbox is
    const main = visibleMain(window);
    await main.evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight; });
    await window.waitForTimeout(300);

    const scrollBefore = await main.evaluate((el: HTMLElement) => el.scrollTop);

    // Toggle the checkbox — no prior click in editor text
    const checkbox = visibleEditor(window).locator('li.editor-list-item-unchecked').last();
    await expect(checkbox).toBeVisible();
    await checkbox.click({ position: { x: 10, y: 10 } });
    await window.waitForTimeout(500);

    await expect(visibleEditor(window).locator('li.editor-list-item-checked').last()).toBeVisible();
    const scrollAfter = await main.evaluate((el: HTMLElement) => el.scrollTop);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(50);
  });

  test('toggling multiple checkboxes in sequence after reopening an image note', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Multi Check');
    await window.keyboard.press('Enter');

    await pasteImage(window);
    await window.keyboard.press('Enter');

    // Create three checklist items
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('First task');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Second task');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Third task');
    await window.waitForTimeout(1500);

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'Multi Check' }).click();
    await window.waitForTimeout(2000);

    const editor = visibleEditor(window);
    await expect(editor.locator('li.editor-list-item-unchecked')).toHaveCount(3);

    // Toggle all three in sequence — never clicking editor text
    await editor.locator('li.editor-list-item-unchecked').first().click({ position: { x: 10, y: 10 } });
    await window.waitForTimeout(300);
    await editor.locator('li.editor-list-item-unchecked').first().click({ position: { x: 10, y: 10 } });
    await window.waitForTimeout(300);
    await editor.locator('li.editor-list-item-unchecked').first().click({ position: { x: 10, y: 10 } });
    await window.waitForTimeout(300);

    await expect(editor.locator('li.editor-list-item-checked')).toHaveCount(3);
  });

  test('checkbox at top of note with image at bottom does not scroll down', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Check Top Img Bottom');
    await window.keyboard.press('Enter');

    // Checkbox first
    await window.keyboard.type('[ ] ');
    await window.keyboard.type('Top checkbox');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter'); // exit checklist

    // Filler
    for (let i = 0; i < 10; i++) {
      await window.keyboard.type(`Paragraph ${i + 1} filler text.`);
      await window.keyboard.press('Enter');
    }

    // Image at bottom
    await pasteImage(window);
    await window.waitForTimeout(1500);

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'Check Top Img Bottom' }).click();
    await window.waitForTimeout(2000);

    // Ensure scroll is at top
    const main = visibleMain(window);
    await main.evaluate((el: HTMLElement) => { el.scrollTop = 0; });
    await window.waitForTimeout(200);

    const scrollBefore = await main.evaluate((el: HTMLElement) => el.scrollTop);

    // Toggle the top checkbox
    await visibleEditor(window).locator('li.editor-list-item-unchecked').first()
      .click({ position: { x: 10, y: 10 } });
    await window.waitForTimeout(500);

    await expect(visibleEditor(window).locator('li.editor-list-item-checked').first()).toBeVisible();
    const scrollAfter = await main.evaluate((el: HTMLElement) => el.scrollTop);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(50);
  });

  // ─── Intentional focus still works ────────────────────────────────

  test('clicking editor body on a reopened image note gives focus', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Click Focus');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Click here to focus');
    await window.keyboard.press('Enter');
    await pasteImage(window);
    await window.waitForTimeout(1500);

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'Click Focus' }).click();
    await window.waitForTimeout(2000);

    // NOT focused yet
    expect(await editorBodyHasFocus(window)).toBe(false);

    // Explicitly click in text
    await visibleEditor(window).locator('p').filter({ hasText: 'Click here to focus' }).click();
    await window.waitForTimeout(200);

    // NOW focused
    expect(await editorBodyHasFocus(window)).toBe(true);
  });

  test('typing works after clicking into a reopened image note', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Type After');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Existing text');
    await window.keyboard.press('Enter');
    await pasteImage(window);
    await window.waitForTimeout(1500);

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'Type After' }).click();
    await window.waitForTimeout(2000);

    const editor = visibleEditor(window);
    await editor.locator('p').filter({ hasText: 'Existing text' }).click();
    await window.keyboard.press('End');
    await window.keyboard.type(' and new text');
    await window.waitForTimeout(200);

    await expect(editor).toContainText('Existing text and new text');
  });

  test('arrow keys work after toggling a checkbox on a reopened image note', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Arrow Nav');
    await window.keyboard.press('Enter');

    await pasteImage(window);
    await window.keyboard.press('Enter');

    await window.keyboard.type('[ ] ');
    await window.keyboard.type('Check item');
    await window.keyboard.press('Enter');
    await window.keyboard.press('Enter'); // exit checklist
    await window.keyboard.type('Paragraph after checklist');
    await window.waitForTimeout(1500);

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'Arrow Nav' }).click();
    await window.waitForTimeout(2000);

    const editor = visibleEditor(window);

    // Toggle checkbox
    await editor.locator('li.editor-list-item-unchecked').first().click({ position: { x: 10, y: 10 } });
    await window.waitForTimeout(300);
    await expect(editor.locator('li.editor-list-item-checked').first()).toBeVisible();

    // Click paragraph, arrow up, type to verify cursor moves correctly
    await editor.locator('p').filter({ hasText: 'Paragraph after checklist' }).click();
    await window.waitForTimeout(200);
    await window.keyboard.press('ArrowUp');
    await window.waitForTimeout(200);
    await window.keyboard.type('!');
    await window.waitForTimeout(200);
    await expect(editor).toContainText('!');
  });

  test('clicking title on a reopened image note focuses the title', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('Title Focus');
    await window.keyboard.press('Enter');
    await pasteImage(window);
    await window.waitForTimeout(1500);

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'Title Focus' }).click();
    await window.waitForTimeout(2000);

    // Click the title — user expects to be able to type in it immediately
    await visibleTitle(window).click();
    await window.waitForTimeout(200);

    // Verify the editor received focus (title is inside the ContentEditable)
    expect(await editorBodyHasFocus(window)).toBe(true);

    // Typing should land in the title, not jump elsewhere
    await window.keyboard.press('End');
    await window.keyboard.type(' Edited');
    await expect(visibleTitle(window)).toContainText('Title Focus Edited');
  });

  // ─── Tab / note switching ─────────────────────────────────────────

  test('switching tabs between text and image notes preserves focus behavior', async ({ window }) => {
    // Note A: text only
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('TextOnly');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Just text here');
    await window.waitForTimeout(500);

    // Note B: has image
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('WithImage');
    await window.keyboard.press('Enter');
    await pasteImage(window);
    await window.waitForTimeout(500);

    // Switch to text note via tab — should not auto-focus
    await window.locator('[data-tab-id]').filter({ hasText: 'TextOnly' }).click();
    await window.waitForTimeout(500);
    expect(await editorBodyHasFocus(window)).toBe(false);

    // Switch to image note via tab — should not auto-focus
    await window.locator('[data-tab-id]').filter({ hasText: 'WithImage' }).click();
    await window.waitForTimeout(1500);
    expect(await editorBodyHasFocus(window)).toBe(false);

    // Switch back to text note, click in it, verify typing works
    await window.locator('[data-tab-id]').filter({ hasText: 'TextOnly' }).click();
    await window.waitForTimeout(500);
    await visibleEditor(window).locator('p').filter({ hasText: 'Just text here' }).click();
    await window.waitForTimeout(200);
    expect(await editorBodyHasFocus(window)).toBe(true);
    await window.keyboard.type(' appended');
    await expect(visibleEditor(window)).toContainText('Just text here appended');
  });

  // ─── Image interactions after reopen ──────────────────────────────

  test('clicking an image selects it on a reopened note', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('ImgSelect');
    await window.keyboard.press('Enter');
    await pasteImage(window);
    await expect(visibleEditor(window).locator('.image-container').first()).toBeVisible();
    await window.waitForTimeout(1500);

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'ImgSelect' }).click();
    await window.waitForTimeout(2000);

    // Image container present after path resolution (#83: img render broken on reopen)
    const img = visibleEditor(window).locator('.image-container').first();
    await expect(img).toBeVisible();

    // Click image — should get selected
    await img.click();
    await window.waitForTimeout(300);
    await expect(img).toHaveClass(/selected/);
  });

  test('Enter after selecting an image creates a paragraph on a reopened note', async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
    await visibleTitle(window).click();
    await window.keyboard.type('ImgEnter');
    await window.keyboard.press('Enter');
    await pasteImage(window);
    await window.waitForTimeout(1500);

    await closeActiveTab(window);
    await window.locator('[data-note-id]').filter({ hasText: 'ImgEnter' }).click();
    await window.waitForTimeout(2000);

    await visibleEditor(window).locator('.image-container').first().click();
    await window.waitForTimeout(300);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(300);

    await window.keyboard.type('New paragraph after image');
    await expect(visibleEditor(window)).toContainText('New paragraph after image');
  });
});
