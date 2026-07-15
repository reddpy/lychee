import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserWindow,
  ContextMenuParams,
  MenuItemConstructorOptions,
  WebContents,
} from 'electron';

const mocks = vi.hoisted(() => ({
  getSpellCheckState: vi.fn(),
  setSpellCheckEnabled: vi.fn(),
  replaceMisspelling: vi.fn(),
  addWord: vi.fn(),
  buildFromTemplate: vi.fn(),
  popup: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
}));

vi.mock('../spellcheck', () => ({
  getSpellCheckState: mocks.getSpellCheckState,
  setSpellCheckEnabled: mocks.setSpellCheckEnabled,
}));

import {
  buildEditorContextMenuTemplate,
  installEditorContextMenu,
} from '../editor-context-menu';

function params(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    x: 10,
    y: 20,
    frame: null,
    linkURL: '',
    linkText: '',
    pageURL: 'file:///lychee',
    frameURL: 'file:///lychee',
    srcURL: '',
    mediaType: 'none',
    hasImageContents: false,
    isEditable: true,
    selectionText: '',
    titleText: '',
    altText: '',
    suggestedFilename: '',
    selectionRect: { x: 0, y: 0, width: 0, height: 0 },
    selectionStartOffset: 0,
    referrerPolicy: { policy: 'default', url: '' },
    misspelledWord: '',
    dictionarySuggestions: [],
    frameCharset: 'UTF-8',
    formControlType: 'none',
    spellcheckEnabled: true,
    menuSourceType: 'mouse',
    mediaFlags: {
      inError: false,
      isPaused: false,
      isMuted: false,
      hasAudio: false,
      isLooping: false,
      isControlsVisible: false,
      canToggleControls: false,
      canPrint: false,
      canSave: false,
      canShowPictureInPicture: false,
      isShowingPictureInPicture: false,
      canRotate: false,
      canLoop: false,
    },
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: true,
      canDelete: false,
      canSelectAll: true,
      canEditRichly: true,
    },
    ...overrides,
  };
}

function contents(): WebContents {
  return {
    replaceMisspelling: mocks.replaceMisspelling,
    session: { addWordToSpellCheckerDictionary: mocks.addWord },
  } as unknown as WebContents;
}

function actionable(template: MenuItemConstructorOptions[]) {
  return template.filter((item) => item.type !== 'separator');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildFromTemplate.mockReturnValue({ popup: mocks.popup });
  mocks.getSpellCheckState.mockReturnValue({
    enabled: true,
    canChooseLanguages: true,
    languages: ['en-US'],
    availableLanguages: ['en-US'],
  });
});

describe('editor context-menu copy and states', () => {
  it('keeps standard edit commands stable and disables unavailable actions', () => {
    const template = buildEditorContextMenuTemplate(contents(), params(), 'win32');
    const items = actionable(template);

    expect(items.slice(0, 5).map((item) => item.role)).toEqual([
      'cut',
      'copy',
      'paste',
      'pasteAndMatchStyle',
      'selectAll',
    ]);
    expect(items[0].enabled).toBe(false);
    expect(items[2].enabled).toBe(true);
    expect(items[3].label).toBe('Paste as Plain Text');
    expect(items[items.length - 1]?.label).toBe('Spelling and Grammar');
  });

  it('uses macOS-native wording', () => {
    const template = buildEditorContextMenuTemplate(contents(), params(), 'darwin');
    const items = actionable(template);
    expect(items.find((item) => item.role === 'pasteAndMatchStyle')?.label).toBe(
      'Paste and Match Style',
    );
    const spelling = items[items.length - 1]?.submenu as MenuItemConstructorOptions[];
    expect(spelling[0].label).toBe('Check Spelling While Typing');
  });

  it('shows word-scoped suggestions and dictionary copy ahead of editing commands', () => {
    const template = buildEditorContextMenuTemplate(
      contents(),
      params({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'tech'] }),
      'darwin',
    );
    const items = actionable(template);

    expect(items.slice(0, 3).map((item) => item.label)).toEqual([
      'the',
      'tech',
      'Learn Spelling',
    ]);
    (items[0].click as () => void)();
    (items[2].click as () => void)();
    expect(mocks.replaceMisspelling).toHaveBeenCalledWith('the');
    expect(mocks.addWord).toHaveBeenCalledWith('teh');
  });

  it('omits spelling actions when checking is disabled but leaves the toggle reachable', () => {
    mocks.getSpellCheckState.mockReturnValue({
      enabled: false,
      canChooseLanguages: true,
      languages: ['en-US'],
      availableLanguages: ['en-US'],
    });
    const template = buildEditorContextMenuTemplate(
      contents(),
      params({ misspelledWord: 'teh', dictionarySuggestions: ['the'] }),
      'linux',
    );
    const items = actionable(template);

    expect(items.some((item) => item.label === 'the')).toBe(false);
    const spelling = items[items.length - 1]?.submenu as MenuItemConstructorOptions[];
    expect(spelling[0]).toMatchObject({
      label: 'Check spelling while typing',
      checked: false,
    });
    (spelling[0].click as (item: { checked: boolean }) => void)({ checked: true });
    expect(mocks.setSpellCheckEnabled).toHaveBeenCalledWith(true);
  });

  it('offers only copy/select-all for selected read-only text', () => {
    const template = buildEditorContextMenuTemplate(
      contents(),
      params({
        isEditable: false,
        selectionText: 'read only',
        editFlags: { ...params().editFlags, canCopy: true },
      }),
      'linux',
    );
    const items = actionable(template);

    expect(items.filter((item) => item.role).map((item) => item.role)).toEqual([
      'copy',
      'selectAll',
    ]);
    expect(items.some((item) => item.label === 'Spelling and Grammar')).toBe(false);
    expect(items.some((item) => String(item.label).includes('Search'))).toBe(false);
  });
});

describe('native menu integration', () => {
  it('wires Electron context-menu events and notifies the renderer on close', () => {
    let contextMenuHandler:
      | ((event: unknown, context: ContextMenuParams) => void)
      | undefined;
    const webContents = {
      on: vi.fn((event: string, handler: typeof contextMenuHandler) => {
        if (event === 'context-menu') contextMenuHandler = handler;
      }),
      isDestroyed: () => false,
      send: mocks.send,
      replaceMisspelling: mocks.replaceMisspelling,
      session: { addWordToSpellCheckerDictionary: mocks.addWord },
    } as unknown as WebContents;
    const win = { webContents } as BrowserWindow;

    installEditorContextMenu(win);
    contextMenuHandler?.({}, params());

    expect(mocks.buildFromTemplate).toHaveBeenCalledOnce();
    expect(mocks.popup).toHaveBeenCalledOnce();
    const popupOptions = mocks.popup.mock.calls[0][0] as { callback: () => void };
    popupOptions.callback();
    expect(mocks.send).toHaveBeenCalledWith('context-menu:closed');
  });
});
