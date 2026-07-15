import {
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';

import { getSpellCheckState, setSpellCheckEnabled } from './spellcheck';

function appendGroup(
  template: MenuItemConstructorOptions[],
  group: MenuItemConstructorOptions[],
): void {
  if (group.length === 0) return;
  if (template.length > 0) template.push({ type: 'separator' });
  template.push(...group);
}

export function buildEditorContextMenuTemplate(
  contents: WebContents,
  params: ContextMenuParams,
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  if (!params.isEditable && !params.selectionText) return [];

  const template: MenuItemConstructorOptions[] = [];
  const spellCheckState = getSpellCheckState();
  const misspelledWord = params.misspelledWord.trim();

  if (params.isEditable && spellCheckState.enabled && misspelledWord) {
    const spellingGroup: MenuItemConstructorOptions[] = params.dictionarySuggestions
      .slice(0, 5)
      .map((suggestion) => ({
        label: suggestion,
        click: () => contents.replaceMisspelling(suggestion),
      }));

    spellingGroup.push({
      label: platform === 'darwin' ? 'Learn Spelling' : 'Add to dictionary',
      click: () =>
        contents.session.addWordToSpellCheckerDictionary(misspelledWord),
    });
    appendGroup(template, spellingGroup);
  }

  const editGroup: MenuItemConstructorOptions[] = [];
  if (params.isEditable) {
    editGroup.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      {
        role: 'pasteAndMatchStyle',
        label: platform === 'darwin' ? 'Paste and Match Style' : 'Paste as Plain Text',
        enabled: params.editFlags.canPaste,
      },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    );
  } else {
    editGroup.push(
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    );
  }
  appendGroup(template, editGroup);

  if (params.isEditable) {
    appendGroup(template, [
      {
        label: 'Spelling and Grammar',
        submenu: [
          {
            type: 'checkbox',
            label:
              platform === 'darwin'
                ? 'Check Spelling While Typing'
                : 'Check spelling while typing',
            checked: spellCheckState.enabled,
            click: (item) => setSpellCheckEnabled(item.checked),
          },
        ],
      },
    ]);
  }

  return template;
}

export function installEditorContextMenu(win: BrowserWindow): void {
  const contents = win.webContents;
  contents.on('context-menu', (_event, params) => {
    const template = buildEditorContextMenuTemplate(contents, params);
    if (template.length === 0) return;

    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: win,
      frame: params.frame ?? undefined,
      x: params.x,
      y: params.y,
      sourceType: params.menuSourceType,
      callback: () => {
        if (!contents.isDestroyed()) contents.send('context-menu:closed');
      },
    });
  });
}
