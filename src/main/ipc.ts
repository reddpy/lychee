import { ipcMain, shell } from 'electron';
import type { IpcContract, IpcChannel } from '../shared/ipc-types';
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
import { saveImage, getImagePath, deleteImage, downloadImage } from './repos/images';
import { resolveUrl } from './repos/url-resolver';
import { fetchUrlMetadata } from './repos/url-metadata';
import { getSetting, setSetting, getAllSettings } from './repos/settings';

type Handler<C extends IpcChannel> = (
  payload: IpcContract[C]['req'],
) => Promise<IpcContract[C]['res']> | IpcContract[C]['res'];

function handle<C extends IpcChannel>(channel: C, fn: Handler<C>) {
  ipcMain.handle(channel, async (_event, payload: IpcContract[C]['req']) => fn(payload));
}

export function registerIpcHandlers() {
  handle('documents.list', (payload) => ({
    documents: listDocuments(payload),
  }));

  handle('documents.get', (payload) => ({
    document: getDocumentById(payload.id),
  }));

  handle('documents.create', (payload) => ({
    document: createDocument(payload),
  }));

  handle('documents.update', (payload) => {
    if (!payload.id) throw new Error('Missing required field: id');
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
    const url = payload.url;
    const scheme = url.split(':')[0]?.toLowerCase();
    const allowedSchemes = ['http', 'https', 'mailto'];
    if (!scheme || !allowedSchemes.includes(scheme)) {
      throw new Error(`Blocked URL scheme: ${scheme}`);
    }
    await shell.openExternal(payload.url);
    return { ok: true };
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
}

