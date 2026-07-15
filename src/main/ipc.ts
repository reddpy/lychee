import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent } from 'electron';
import path from 'path';
import type { IpcContract, IpcChannel } from '../shared/ipc-types';
import { applyChromeToAllWindows, setChromeColors, setOverlayDimmed } from './window-chrome';
import {
  createDocument,
  deleteDocument,
  getDocumentById,
  listDocuments,
  listTrashedDocuments,
  moveDocument,
  permanentDeleteDocument,
  restoreDocument,
  trashDocument,
  updateDocument,
} from './repos/documents';
import { saveImage, getImagePath, getImageDataUrl, deleteImage, downloadImage } from './repos/images';
import { resolveUrl } from './repos/url-resolver';
import { fetchUrlMetadata } from './repos/url-metadata';
import { getSetting, setSetting, getAllSettings } from './repos/settings';
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater';
import { isAllowedExternal } from './url-policy';
import {
  getSpellCheckState,
  setSpellCheckEnabled,
  setSpellCheckLanguages,
} from './spellcheck';
import { createDatabaseBackup } from './db';

type Handler<C extends IpcChannel> = (
  payload: IpcContract[C]['req'],
) => Promise<IpcContract[C]['res']> | IpcContract[C]['res'];

function handle<C extends IpcChannel>(channel: C, fn: Handler<C>) {
  ipcMain.handle(channel, async (_event, payload: IpcContract[C]['req']) => fn(payload));
}

function validateContentJson(content: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('content is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || !('root' in parsed)) {
    throw new Error('content must have a root key');
  }
  const root = (parsed as Record<string, unknown>).root;
  if (typeof root !== 'object' || root === null || !Array.isArray((root as Record<string, unknown>).children)) {
    throw new Error('content root.children must be an array');
  }
}

export function registerIpcHandlers() {
  handle('documents.list', (payload) => ({
    documents: listDocuments(payload),
  }));

  handle('documents.get', (payload) => ({
    document: getDocumentById(payload.id),
  }));

  handle('documents.create', (payload) => {
    if (payload && typeof payload.content === 'string' && payload.content !== '') {
      validateContentJson(payload.content);
    }
    return { document: createDocument(payload) };
  });

  handle('documents.update', (payload) => {
    if (!payload.id) throw new Error('Missing required field: id');
    if (typeof payload.content === 'string' && payload.content !== '') {
      validateContentJson(payload.content);
    }
    return { document: updateDocument(payload.id, payload) };
  });

  handle('documents.delete', (payload) => {
    deleteDocument(payload.id);
    return { ok: true };
  });

  handle('documents.trash', (payload) => trashDocument(payload.id));

  handle('documents.restore', (payload) => restoreDocument(payload.id));

  handle('documents.listTrashed', (payload) => ({
    documents: listTrashedDocuments(payload),
  }));

  handle('documents.permanentDelete', (payload) =>
    permanentDeleteDocument(payload.id),
  );

  handle('documents.move', (payload) => {
    if (payload.sortOrder < 0) throw new Error('sortOrder must be non-negative');
    if (!Number.isInteger(payload.sortOrder)) throw new Error('sortOrder must be an integer');
    return { document: moveDocument(payload.id, payload.parentId, payload.sortOrder) };
  });

  handle('shell.openExternal', async (payload) => {
    if (!isAllowedExternal(payload.url)) {
      const scheme = payload.url.split(':')[0]?.toLowerCase();
      throw new Error(`Blocked URL scheme: ${scheme}`);
    }
    await shell.openExternal(payload.url);
    return { ok: true };
  });

  handle('data.getLocations', () => {
    const userDataPath = app.getPath('userData');
    return {
      userDataPath,
      databasePath: path.join(userDataPath, 'lychee.sqlite3'),
      imagesPath: path.join(userDataPath, 'images'),
    };
  });

  handle('data.openFolder', async () => {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error(error);
    return { ok: true };
  });

  handle('data.revealDatabase', () => {
    shell.showItemInFolder(path.join(app.getPath('userData'), 'lychee.sqlite3'));
    return { ok: true };
  });

  handle('data.createBackup', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: 'Create Lychee Backup',
      defaultPath: path.join(
        app.getPath('documents'),
        `lychee-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`,
      ),
      filters: [{ name: 'SQLite database', extensions: ['sqlite3'] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };

    createDatabaseBackup(result.filePath);
    return { canceled: false, filePath: result.filePath };
  });

  handle('images.save', (payload) => {
    const allowedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(payload.mimeType)) {
      throw new Error(`Unsupported image type: ${payload.mimeType}`);
    }
    return saveImage(payload.data, payload.mimeType);
  });

  handle('images.getPath', (payload) => getImagePath(payload.id));

  handle('images.download', (payload) => {
    const scheme = payload.url.split(':')[0]?.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      throw new Error(`Blocked URL scheme for image download: ${scheme}`);
    }
    return downloadImage(payload.url);
  });

  handle('images.delete', (payload) => {
    deleteImage(payload.id);
    return { ok: true };
  });

  handle('url.resolve', (payload) => resolveUrl(payload.url));

  handle('url.fetchMetadata', (payload) => fetchUrlMetadata(payload.url));

  handle('settings.get', (payload) => ({
    value: getSetting(payload.key),
  }));

  handle('settings.set', (payload) => {
    setSetting(payload.key, payload.value);
    return { ok: true };
  });

  handle('settings.getAll', () => ({
    settings: getAllSettings(),
  }));

  handle('spellcheck.getState', () => getSpellCheckState());

  handle('spellcheck.setEnabled', (payload) =>
    setSpellCheckEnabled(payload.enabled),
  );

  handle('spellcheck.setLanguages', (payload) =>
    setSpellCheckLanguages(payload.languages),
  );

  handle('window.action', (payload) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    switch (payload.action) {
      case 'minimize':
        win?.minimize();
        break;
      case 'close':
        win?.close();
        break;
      case 'toggleFullscreen':
        if (win) win.setFullScreen(!win.isFullScreen());
        break;
      case 'reload':
        win?.webContents.reload();
        break;
      case 'forceReload':
        win?.webContents.reloadIgnoringCache();
        break;
      case 'toggleDevTools':
        win?.webContents.toggleDevTools();
        break;
      case 'zoomIn':
        if (win) win.webContents.zoomLevel = win.webContents.zoomLevel + 0.5;
        break;
      case 'zoomOut':
        if (win) win.webContents.zoomLevel = win.webContents.zoomLevel - 0.5;
        break;
      case 'resetZoom':
        if (win) win.webContents.zoomLevel = 0;
        break;
      case 'quit':
        app.quit();
        break;
    }
    return { ok: true };
  });

  handle('app.updateChrome', (payload) => {
    setChromeColors(payload.resolvedTheme, {
      color: payload.color,
      symbolColor: payload.symbolColor,
    });
    applyChromeToAllWindows(payload.resolvedTheme);
    return { ok: true };
  });

  handle('app.setOverlayDimmed', (payload) => {
    setOverlayDimmed(payload.dimmed);
    return { ok: true };
  });

  handle('update.getStatus', () => getUpdateStatus());

  handle('update.check', () => {
    checkForUpdates();
    return { ok: true };
  });

  handle('update.install', () => {
    installUpdate();
    return { ok: true };
  });
}

export const IMAGE_DATA_URL_SYNC_CHANNEL = 'images.getDataUrlSync';

type ImageDataUrlSyncResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

/**
 * Register the one synchronous bridge needed by clipboard serialization.
 * ClipboardEvent.clipboardData can only be populated during the copy event, so
 * an async ipcRenderer.invoke() would resolve too late for the browser to accept
 * the HTML. Keep this separate from the regular typed invoke contract so sync
 * IPC does not spread to application features that do not require it.
 */
export function registerClipboardIpcHandler(): void {
  ipcMain.on(
    IMAGE_DATA_URL_SYNC_CHANNEL,
    (event: IpcMainEvent, payload: { id?: unknown } | undefined) => {
      let result: ImageDataUrlSyncResult;
      try {
        if (typeof payload?.id !== 'string' || payload.id.length === 0) {
          throw new Error('Missing required field: id');
        }
        result = { ok: true, ...getImageDataUrl(payload.id) };
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to read image',
        };
      }
      event.returnValue = result;
    },
  );
}
