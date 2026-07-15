import type { ElectronApplication } from '@playwright/test';

export type CapturedNativeMenuItem = {
  label: string;
  role: string | null;
  type: string;
  enabled: boolean;
  checked: boolean | null;
  submenu: CapturedNativeMenuItem[] | null;
};

export type CapturedNativeMenu = {
  items: CapturedNativeMenuItem[];
  x: number | null;
  y: number | null;
  sourceType: string | null;
};

/**
 * Replace Electron's OS-painted popup with a recorder for the lifetime of one
 * E2E app fixture. The real context-menu listener and Menu construction still
 * run; only the final native painting step is held so Playwright can inspect it.
 */
export async function installNativeMenuCapture(
  electronApp: ElectronApplication,
): Promise<void> {
  await electronApp.evaluate(({ Menu }) => {
    type MenuLike = {
      items: Array<{
        label?: string;
        role?: string;
        type?: string;
        enabled?: boolean;
        checked?: boolean;
        submenu?: MenuLike | null;
        click?: (...args: unknown[]) => void;
      }>;
    };
    type CaptureState = {
      menus: Array<{
        items: unknown[];
        x: number | null;
        y: number | null;
        sourceType: string | null;
      }>;
      lastMenu: MenuLike | null;
      lastTemplate: Array<{
        label?: string;
        type?: string;
        checked?: boolean;
        submenu?: unknown;
        click?: (...args: unknown[]) => void;
      }> | null;
      closeLastMenu: (() => void) | null;
    };

    const serialize = (menu: MenuLike): unknown[] =>
      menu.items.map((item) => ({
        label: item.label ?? '',
        role: item.role ?? null,
        type: item.type ?? 'normal',
        enabled: item.enabled ?? true,
        checked:
          item.type === 'checkbox' || item.type === 'radio'
            ? (item.checked ?? false)
            : null,
        submenu: item.submenu ? serialize(item.submenu) : null,
      }));

    const state: CaptureState = {
      menus: [],
      lastMenu: null,
      lastTemplate: null,
      closeLastMenu: null,
    };
    (globalThis as typeof globalThis & { __lycheeNativeMenuCapture?: CaptureState })
      .__lycheeNativeMenuCapture = state;

    const originalBuildFromTemplate = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = ((template: typeof state.lastTemplate) => {
      // Electron recursively calls buildFromTemplate for submenus. Keep the
      // outer editor template rather than letting the spelling submenu replace it.
      if (template?.some((item) => item.label === 'Spelling and Grammar')) {
        state.lastTemplate = template;
      }
      return originalBuildFromTemplate(template as never);
    }) as typeof Menu.buildFromTemplate;

    const menuPrototype = Menu.prototype as unknown as {
      popup: (options?: {
        x?: number;
        y?: number;
        sourceType?: string;
        callback?: () => void;
      }) => void;
    };
    menuPrototype.popup = function popup(
      this: MenuLike,
      options: {
        x?: number;
        y?: number;
        sourceType?: string;
        callback?: () => void;
      } = {},
    ): void {
      state.lastMenu = this;
      state.closeLastMenu = options.callback ?? null;
      state.menus.push({
        items: serialize(this),
        x: options.x ?? null,
        y: options.y ?? null,
        sourceType: options.sourceType ?? null,
      });
    };
  });
}

export async function capturedNativeMenus(
  electronApp: ElectronApplication,
): Promise<CapturedNativeMenu[]> {
  return electronApp.evaluate(() => {
    const state = (
      globalThis as typeof globalThis & {
        __lycheeNativeMenuCapture?: { menus: CapturedNativeMenu[] };
      }
    ).__lycheeNativeMenuCapture;
    return state?.menus ?? [];
  });
}

/** Complete the held popup and deliver `context-menu:closed` to the renderer. */
export async function closeCapturedNativeMenu(
  electronApp: ElectronApplication,
): Promise<void> {
  await electronApp.evaluate(() => {
    const state = (
      globalThis as typeof globalThis & {
        __lycheeNativeMenuCapture?: {
          closeLastMenu: (() => void) | null;
          lastMenu: unknown;
          lastTemplate: unknown;
        };
      }
    ).__lycheeNativeMenuCapture;
    if (!state) throw new Error('Native menu capture is not installed');
    const close = state.closeLastMenu;
    state.closeLastMenu = null;
    state.lastMenu = null;
    state.lastTemplate = null;
    close?.();
  });
}

/** Invoke the real checkbox callback as if the OS menu changed its state. */
export async function chooseNativeSpellCheckState(
  electronApp: ElectronApplication,
  checked: boolean,
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, nextChecked) => {
    type MenuItemLike = {
      label?: string;
      type?: string;
      checked?: boolean;
      submenu?: { items: MenuItemLike[] } | null;
      click?: (item: MenuItemLike, window: unknown, contents: unknown) => void;
    };
    const state = (
      globalThis as typeof globalThis & {
        __lycheeNativeMenuCapture?: {
          lastMenu: { items: MenuItemLike[] } | null;
          lastTemplate: Array<{
            label?: string;
            submenu?: Array<{
              type?: string;
              click?: (item: { checked: boolean }) => void;
            }>;
          }> | null;
          closeLastMenu: (() => void) | null;
        };
      }
    ).__lycheeNativeMenuCapture;
    if (!state?.lastMenu || !state.lastTemplate) {
      throw new Error('No captured native menu is open');
    }

    const spellingMenu = state.lastTemplate.find(
      (item) => item.label === 'Spelling and Grammar',
    );
    const checkbox = spellingMenu?.submenu?.find(
      (item) => item.type === 'checkbox',
    );
    if (!checkbox?.click) throw new Error('Spellcheck checkbox was not found');

    checkbox.checked = nextChecked;
    checkbox.click({ checked: nextChecked });

    const close = state.closeLastMenu;
    state.closeLastMenu = null;
    state.lastMenu = null;
    state.lastTemplate = null;
    close?.();
  }, checked);
}

/**
 * Emit Chromium-shaped context data into the installed main-process listener.
 * This makes spelling-suggestion cases deterministic even on CI hosts without
 * a downloaded OS dictionary.
 */
export async function emitSpellingContextMenu(
  electronApp: ElectronApplication,
  word: string,
  suggestions: string[],
): Promise<void> {
  await electronApp.evaluate(
    ({ BrowserWindow }, payload) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('No BrowserWindow is available');
      const params = {
        x: 24,
        y: 36,
        frame: null,
        isEditable: true,
        selectionText: '',
        misspelledWord: payload.word,
        dictionarySuggestions: payload.suggestions,
        menuSourceType: 'mouse',
        editFlags: {
          canCut: false,
          canCopy: false,
          canPaste: true,
          canSelectAll: true,
        },
      };
      (win.webContents as unknown as {
        emit: (event: string, eventObject: unknown, context: unknown) => void;
      }).emit('context-menu', {}, params);
    },
    { word, suggestions },
  );
}

export function flattenNativeMenu(
  items: CapturedNativeMenuItem[],
): CapturedNativeMenuItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.submenu ? flattenNativeMenu(item.submenu) : []),
  ]);
}
