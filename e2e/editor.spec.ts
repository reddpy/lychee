import { test, expect } from './electron-app';

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
  });

  test('editor body is editable', async ({ window }) => {
    // Press Enter from the title to move to body
    const title = window.locator('h1.editor-title');
    await title.click();
    await window.keyboard.press('Enter');

    // Type in the body
    await window.keyboard.type('Hello, this is body text.');

    const editorRoot = window.locator('.ContentEditable__root');
    await expect(editorRoot).toContainText('Hello, this is body text.');
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
