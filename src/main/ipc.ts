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

  handle('documents.update', (payload) => ({
    document: updateDocument(payload.id, payload),
  }));

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

  handle('documents.move', (payload) => ({
    document: moveDocument(payload.id, payload.parentId, payload.sortOrder),
  }));

  handle('shell.openExternal', async (payload) => {
    await shell.openExternal(payload.url);
    return { ok: true };
  });

  handle('images.save', (payload) => saveImage(payload.data, payload.mimeType));

  handle('images.getPath', (payload) => getImagePath(payload.id));

  handle('images.download', (payload) => downloadImage(payload.url));

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

  // AI streaming — lazy import to avoid crashing other handlers if openai fails to load
  ipcMain.handle('ai.chatStart', async (event, payload: { requestId: string; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> }) => {
    const { streamChat } = await import('./repos/ai');
    const { requestId, messages } = payload;
    const sender = event.sender;

    streamChat(requestId, messages, {
      onChunk: (text) => {
        if (!sender.isDestroyed()) {
          sender.send('ai.stream', { requestId, chunk: text });
        }
      },
      onDone: () => {
        if (!sender.isDestroyed()) {
          sender.send('ai.stream', { requestId, done: true });
        }
      },
      onError: (error) => {
        if (!sender.isDestroyed()) {
          sender.send('ai.stream', { requestId, error });
        }
      },
    });

    return { ok: true as const };
  });

  ipcMain.handle('ai.chatStop', async (_event, payload: { requestId: string }) => {
    const { stopStream } = await import('./repos/ai');
    stopStream(payload.requestId);
    return { ok: true as const };
  });
}

