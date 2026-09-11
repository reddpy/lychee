import { test, expect } from './electron-app';
import type { Locator, Page } from '@playwright/test';
import type { LexicalEditor } from 'lexical';
import { clearIpcMocks, mockIpcResolve } from './ipc-mock';

const metadata = { title: 'Example bookmark', description: '', imageUrl: '', faviconUrl: '' };
const bookmark = { type: 'reference', displayMode: 'card', version: 1, url: 'https://example.com', ...metadata, imageId: '', altText: '', hydrationAttempted: true };
const image = { type: 'reference', displayMode: 'image', version: 1, imageId: '', altText: 'Test image', url: '' };
const divider = { type: 'horizontalrule', version: 1 };
const paragraph = { type: 'paragraph', version: 1, children: [], direction: null, format: '', indent: 0 };

function editor(window: Page) {
  return window.locator('main:visible .ContentEditable__root');
}

async function seedNote(window: Page, title: string, blocks: object[]) {
  const id = await window.evaluate(async ({ title, children }) => {
    const result = await window.lychee.invoke('documents.create', {
      title,
      content: JSON.stringify({ root: {
        type: 'root', version: 1, direction: null, format: '', indent: 0,
        children: [
          { type: 'title', version: 1, direction: null, format: '', indent: 0,
            children: [{ type: 'text', version: 1, text: title, format: 0, style: '', mode: 'normal', detail: 0 }] },
          ...children,
        ],
      } }),
    });
    const store = (window as any).__documentStore;
    await store.getState().loadDocuments(true);
    store.getState().openOrSelectTab(result.document.id);
    return result.document.id;
  }, { title, children: blocks });
  await expect(editor(window).locator('h1.editor-title')).toHaveText(title);
  return id;
}

async function blockTypes(window: Page) {
  return editor(window).evaluate((root) => {
    const lexical = (root as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
    return lexical.getEditorState().toJSON().root.children.map((node) => node.type);
  });
}

async function expectParagraphCaret(window: Page) {
  await expect.poll(() => editor(window).evaluate((root) => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    return document.activeElement === root && selection?.isCollapsed && !!element?.closest('p');
  })).toBe(true);
}

async function clickBelow(window: Page, block: Locator, insideEditor = false) {
  const box = await block.boundingBox();
  const root = await editor(window).boundingBox();
  if (!box || !root) throw new Error('Missing editor/block bounds');
  // The first-block bug occurs inside the editor's min-height, where clicking
  // below the block used to do nothing because the editor still had room.
  if (insideEditor) expect(box.y + box.height + 16).toBeLessThan(root.y + root.height);
  await window.mouse.click(root.x + 64, box.y + box.height + 16);
}

test.afterEach(async ({ window }) => clearIpcMocks(window));

for (const action of ['Convert to bookmark', 'Embed content']) {
  test(`first URL: ${action}, then click immediately below to keep writing`, async ({ window }) => {
    await mockIpcResolve(window, 'url.fetchMetadata', metadata);
    await mockIpcResolve(window, 'url.resolve', { type: 'bookmark', ...metadata });
    await window.getByRole('button', { name: 'New note', exact: true }).click();
    await editor(window).locator('h1.editor-title').fill('First bookmark');
    await editor(window).locator('p').click();
    await window.keyboard.type('https://example.com ');
    await editor(window).locator('a').hover();
    await window.getByTitle(action, { exact: true }).click();
    const card = editor(window).locator('.bookmark-card');
    await expect(card).toBeVisible();
    await expect.poll(() => blockTypes(window)).toEqual(['title', 'reference']);

    await clickBelow(window, card, true);
    await expectParagraphCaret(window);
    await expect.poll(() => blockTypes(window)).toEqual(['title', 'reference', 'paragraph']);
    await window.keyboard.type('Keep writing');
    await expect(editor(window).locator('p')).toHaveText('Keep writing');
    await expect(card).toBeVisible();
  });
}

test('clicking below the last block appends a paragraph and reuses it', async ({ window }) => {
  await seedNote(window, 'After media', [image, divider]);
  const hr = editor(window).locator('hr');
  await clickBelow(window, hr);
  await expectParagraphCaret(window);
  await expect.poll(() => blockTypes(window)).toEqual(['title', 'reference', 'horizontalrule', 'paragraph']);
  await clickBelow(window, editor(window).locator('p'));
  await expectParagraphCaret(window);
  await expect.poll(() => blockTypes(window)).toEqual(['title', 'reference', 'horizontalrule', 'paragraph']);
  await window.keyboard.type('After media');
  await expect(editor(window).locator('p')).toHaveText('After media');
});

test('clicking a block or its text does not append a paragraph', async ({ window }) => {
  await seedNote(window, 'No append', [{ ...paragraph, children: [
    { type: 'text', version: 1, text: 'Existing text', format: 0, style: '', mode: 'normal', detail: 0 },
  ] }, bookmark]);
  await editor(window).locator('p').click();
  await editor(window).locator('.bookmark-card').click();
  await expect(editor(window).locator('.bookmark-card')).toHaveClass(/selected/);
  await expect.poll(() => blockTypes(window)).toEqual(['title', 'paragraph', 'reference']);
  await expect(editor(window).locator('p')).toHaveText('Existing text');
});

test('dragging a text selection into blank space does not append a paragraph', async ({ window }) => {
  await seedNote(window, 'No drag append', [{ ...paragraph, children: [
    { type: 'text', version: 1, text: 'Select this text', format: 0, style: '', mode: 'normal', detail: 0 },
  ] }, bookmark]);
  const text = await editor(window).locator('p').boundingBox();
  const card = await editor(window).locator('.bookmark-card').boundingBox();
  if (!text || !card) throw new Error('Missing selection bounds');
  await window.mouse.move(text.x + 4, text.y + text.height / 2);
  await window.mouse.down();
  await window.mouse.move(card.x + 100, card.y + card.height + 16, { steps: 8 });
  await window.mouse.up();
  await expect.poll(() => blockTypes(window)).toEqual(['title', 'paragraph', 'reference']);
  await expect.poll(() => window.evaluate(() => window.getSelection()?.toString())).toContain('Select this text');
});
