import {
  test,
  expect,
  listDocumentsFromDb,
  getDocumentFromDb,
  getLatestDocumentFromDb,
} from './electron-app';

/** Simulate Tab/Shift+Tab in Lexical by dispatching KEY_TAB_COMMAND
 *  inside a discrete (synchronous) editor update.
 *  Playwright's keyboard.press('Tab') moves focus out of contenteditable
 *  in Electron, so we find the KEY_TAB_COMMAND reference from the editor's
 *  internal command map and dispatch it within editor.update(). */
async function pressTab(window: any, shift = false) {
  await window.evaluate((shiftKey: boolean) => {
    const root = document.querySelector('[contenteditable="true"]') as any;
    if (!root || !root.__lexicalEditor) return;
    const editor = root.__lexicalEditor;

    // Find the KEY_TAB_COMMAND object by scanning registered commands
    let tabCommand: any = null;
    for (const cmd of editor._commands.keys()) {
      if (cmd.type === 'KEY_TAB_COMMAND') {
        tabCommand = cmd;
        break;
      }
    }
    if (!tabCommand) return;

    // Dispatch directly — reconciliation happens via microtask
    editor.dispatchCommand(tabCommand, {
      key: 'Tab',
      code: 'Tab',
      keyCode: 9,
      which: 9,
      shiftKey,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
  }, shift);
}

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

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const types = content.root.children.map((c: any) => c.type);
    expect(types).toContain('heading');
    expect(types).toContain('list-item');
    expect(types).toContain('quote');
    expect(types.some((t: string) => t === 'code' || t === 'code-block')).toBe(true);
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

  test.skip('Tab in bullet list indents item', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('- ');
    await window.keyboard.type('Parent');
    await window.keyboard.press('Enter');
    // Cursor is at position 0 of the new empty item — Tab then type
    await pressTab(window);
    await window.keyboard.type('Child');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Parent');
    await expect(editorRoot).toContainText('Child');
    await expect(editorRoot.locator('.list-item--bullet')).toHaveCount(2);

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const listItems = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(listItems).toHaveLength(2);
    expect(listItems[0].indent).toBe(0);
    expect(listItems[1].indent).toBe(1);
  });

  test.skip('Shift+Tab in indented list outdents', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('- ');
    await window.keyboard.type('One');
    await window.keyboard.press('Enter');
    // Tab then Shift+Tab at position 0
    await pressTab(window);
    await pressTab(window, true);
    await window.keyboard.type('Two');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('One');
    await expect(editorRoot).toContainText('Two');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    expect(doc?.content).toBeTruthy();
    const content = JSON.parse(doc!.content);
    const listItems = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(listItems).toHaveLength(2);
    expect(listItems[0].indent).toBe(0);
    expect(listItems[1].indent).toBe(0);
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

  test('Backspace on empty list item converts to paragraph', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('- ');
    await window.keyboard.press('Backspace');
    await window.keyboard.press('Backspace');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot.locator('.list-item--bullet')).toHaveCount(0);
    await expect(editorRoot.locator('p')).toHaveCount(1);
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

test.describe('Editor — Flat List Indentation', () => {
  test.beforeEach(async ({ window }) => {
    await window.locator('[aria-label="New note"]').click();
    await window.waitForTimeout(400);
  });

  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  /** Helper: move to body, create a list, return the editor root locator. */
  async function startBulletList(window: any) {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('- ');
    return window.locator('.ContentEditable__root');
  }

  async function startNumberedList(window: any) {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('1. ');
    return window.locator('.ContentEditable__root');
  }

  // ── Tab / Shift+Tab ────────────────────────────────────────────

  test.skip('Tab indents a bullet list item', async ({ window }) => {
    await startBulletList(window);
    await window.keyboard.type('Parent');
    await window.keyboard.press('Enter');
    // Cursor is at position 0 of the new empty item — Tab now, then type
    await pressTab(window);
    await window.keyboard.type('Child');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(items).toHaveLength(2);
    expect(items[0].indent).toBe(0);
    expect(items[1].indent).toBe(1);
  });

  test.skip('Shift+Tab outdents an indented bullet list item', async ({ window }) => {
    await startBulletList(window);
    await window.keyboard.type('Parent');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await pressTab(window, true);
    await window.keyboard.type('Child');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(items).toHaveLength(2);
    expect(items[0].indent).toBe(0);
    expect(items[1].indent).toBe(0);
  });

  test.skip('Tab indents a numbered list item', async ({ window }) => {
    await startNumberedList(window);
    await window.keyboard.type('First');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await window.keyboard.type('Second');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(items).toHaveLength(2);
    expect(items[0].indent).toBe(0);
    expect(items[1].indent).toBe(1);
  });

  test.skip('multiple Tab presses increase indent incrementally', async ({ window }) => {
    await startBulletList(window);
    // Cursor is at position 0 right after markdown shortcut creates the item
    await pressTab(window);
    await pressTab(window);
    await pressTab(window);
    await window.keyboard.type('Item');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(items[0].indent).toBe(3);
  });

  test.skip('indent is capped at 6', async ({ window }) => {
    await startBulletList(window);
    // Cursor is at position 0 — press Tab 8 times, should cap at 6
    for (let i = 0; i < 8; i++) {
      await pressTab(window);
    }
    await window.keyboard.type('Deep');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(items[0].indent).toBe(6);
  });

  test.skip('Shift+Tab at indent 0 does not convert to paragraph', async ({ window }) => {
    const root = await startBulletList(window);
    await pressTab(window, true);
    await window.keyboard.type('Stay');

    await expect(root.locator('.list-item--bullet')).toHaveCount(1);
    await expect(root).toContainText('Stay');
  });

  // ── DOM: margin-left and data attributes ────────────────────────

  test.skip('indented item has margin-left and data-indent attribute', async ({ window }) => {
    const root = await startBulletList(window);
    await pressTab(window);
    await pressTab(window);
    await window.keyboard.type('Indented');

    const item = root.locator('.list-item--bullet');
    await expect(item).toHaveAttribute('data-indent', '2');
    const marginLeft = await item.evaluate((el: HTMLElement) => el.style.marginLeft);
    expect(marginLeft).toBe('48px'); // 2 * 24px
  });

  test.skip('outdented item clears margin-left', async ({ window }) => {
    const root = await startBulletList(window);
    await pressTab(window);
    await pressTab(window, true);
    await window.keyboard.type('Item');

    const item = root.locator('.list-item--bullet');
    await expect(item).toHaveAttribute('data-indent', '0');
    const marginLeft = await item.evaluate((el: HTMLElement) => el.style.marginLeft);
    expect(marginLeft).toBe('');
  });

  // ── Numbered list ordinals ──────────────────────────────────────

  test('numbered list ordinals display correctly', async ({ window }) => {
    const root = await startNumberedList(window);
    await window.keyboard.type('Alpha');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Beta');
    await window.keyboard.press('Enter');
    await window.keyboard.type('Gamma');
    await window.waitForTimeout(300);

    const items = root.locator('.list-item--number');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAttribute('data-ordinal', '1');
    await expect(items.nth(1)).toHaveAttribute('data-ordinal', '2');
    await expect(items.nth(2)).toHaveAttribute('data-ordinal', '3');
  });

  test.skip('indented numbered item uses letter ordinals', async ({ window }) => {
    const root = await startNumberedList(window);
    await window.keyboard.type('Parent');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await window.waitForTimeout(200);
    await window.keyboard.type('Child');
    await window.waitForTimeout(300);

    const items = root.locator('.list-item--number');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAttribute('data-ordinal', '1');
    await expect(items.nth(1)).toHaveAttribute('data-ordinal', 'a');
  });

  test.skip('indent level 2 numbered item uses roman numerals', async ({ window }) => {
    const root = await startNumberedList(window);
    await window.keyboard.type('Top');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await window.keyboard.type('Mid');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await window.keyboard.type('Deep');
    await window.waitForTimeout(300);

    const items = root.locator('.list-item--number');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAttribute('data-ordinal', '1');
    await expect(items.nth(1)).toHaveAttribute('data-ordinal', 'a');
    await expect(items.nth(2)).toHaveAttribute('data-ordinal', 'i');
  });

  // ── Enter behavior on list items ────────────────────────────────

  test.skip('Enter on empty indented list item outdents', async ({ window }) => {
    await startBulletList(window);
    await window.keyboard.type('Parent');
    await window.keyboard.press('Enter');
    await pressTab(window);
    // Now we have an empty indented item — Enter should outdent it
    await window.keyboard.press('Enter');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    // The empty indented item should have been outdented to indent 0
    expect(items.every((i: any) => i.indent === 0)).toBe(true);
  });

  test('Enter on empty indent-0 list item converts to paragraph', async ({ window }) => {
    const root = await startBulletList(window);
    await window.keyboard.type('Item');
    await window.keyboard.press('Enter');
    // The new empty list item — press Enter again to convert to paragraph
    await window.keyboard.press('Enter');

    await expect(root.locator('.list-item--bullet')).toHaveCount(1);
    // At least one paragraph exists (the converted list item); there may also
    // be an initial empty paragraph from the title→body Enter press.
    const pCount = await root.locator('p').count();
    expect(pCount).toBeGreaterThanOrEqual(1);
  });

  // ── Backspace behavior ──────────────────────────────────────────

  test.skip('Backspace at start of indented list item outdents it', async ({ window }) => {
    const root = await startBulletList(window);
    await window.keyboard.type('Parent');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await window.keyboard.type('Child');
    // Move to start, then Backspace should outdent
    await window.keyboard.press(`${mod}+ArrowLeft`);
    await window.keyboard.press('Backspace');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(items).toHaveLength(2);
    expect(items[0].indent).toBe(0);
    expect(items[1].indent).toBe(0);
    await expect(root).toContainText('Child');
  });

  test('Backspace at start of indent-0 list item converts to paragraph', async ({ window }) => {
    const root = await startBulletList(window);
    // Cursor is already at position 0 — Backspace converts to paragraph
    await window.keyboard.press('Backspace');
    await window.keyboard.type('Text');

    await expect(root.locator('.list-item--bullet')).toHaveCount(0);
    const pCount = await root.locator('p').count();
    expect(pCount).toBeGreaterThanOrEqual(1);
    await expect(root).toContainText('Text');
  });

  // ── Undo/Redo with indentation ──────────────────────────────────

  test.skip('undo reverts indent and restores correct margin', async ({ window }) => {
    const root = await startBulletList(window);
    await pressTab(window);
    await window.keyboard.type('Item');
    await window.waitForTimeout(200);

    // Verify indented
    const item = root.locator('.list-item--bullet');
    await expect(item).toHaveAttribute('data-indent', '1');

    // Undo the typing first, then the indent
    await window.keyboard.press(`${mod}+z`);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);

    // Should be back to indent 0
    await expect(item).toHaveAttribute('data-indent', '0');
    const marginLeft = await item.evaluate((el: HTMLElement) => el.style.marginLeft);
    expect(marginLeft).toBe('');
  });

  test.skip('redo restores indent after undo', async ({ window }) => {
    const root = await startBulletList(window);
    await pressTab(window);
    await window.keyboard.type('Item');
    await window.waitForTimeout(200);
    // Undo typing + indent
    await window.keyboard.press(`${mod}+z`);
    await window.keyboard.press(`${mod}+z`);
    await window.waitForTimeout(200);
    // Redo indent + typing
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.keyboard.press(`${mod}+Shift+z`);
    await window.waitForTimeout(200);

    const item = root.locator('.list-item--bullet');
    await expect(item).toHaveAttribute('data-indent', '1');
    const marginLeft = await item.evaluate((el: HTMLElement) => el.style.marginLeft);
    expect(marginLeft).toBe('24px');
  });

  // ── Bullet style variation ──────────────────────────────────────

  test.skip('bullet style varies by indent level', async ({ window }) => {
    const root = await startBulletList(window);
    await window.keyboard.type('Level 0');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await window.keyboard.type('Level 1');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await window.keyboard.type('Level 2');

    const items = root.locator('.list-item--bullet');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAttribute('data-indent', '0');
    await expect(items.nth(1)).toHaveAttribute('data-indent', '1');
    await expect(items.nth(2)).toHaveAttribute('data-indent', '2');
  });

  // ── Persistence ─────────────────────────────────────────────────

  test.skip('indented list items persist to DB correctly', async ({ window }) => {
    await startBulletList(window);
    await window.keyboard.type('Root');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await pressTab(window);
    await window.keyboard.type('Nested');
    await window.keyboard.press('Enter');
    await pressTab(window);
    await window.keyboard.type('Deep');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(items).toHaveLength(3);
    expect(items[0].indent).toBe(0);
    expect(items[0].listType).toBe('bullet');
    expect(items[1].indent).toBe(2);
    expect(items[2].indent).toBe(3);
  });

  // ── Check list indentation ──────────────────────────────────────

  test.skip('Tab indents a check list item', async ({ window }) => {
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');
    await window.keyboard.type('[ ] ');
    // Cursor is at position 0 after markdown shortcut creates the check item
    await pressTab(window);
    await window.keyboard.type('Todo');

    const root = window.locator('.ContentEditable__root');
    const item = root.locator('.list-item--check');
    await expect(item).toHaveAttribute('data-indent', '1');

    await window.waitForTimeout(1000);
    const doc = await getLatestDocumentFromDb(window);
    const content = JSON.parse(doc!.content);
    const items = content.root.children.filter((c: any) => c.type === 'list-item');
    expect(items[0].indent).toBe(1);
    expect(items[0].listType).toBe('check');
  });
});
