import { ipcMain } from 'electron';
import type { IpcContract, IpcChannel } from '../shared/ipc-types';
import {
  createDocument,
  deleteDocument,
  getDocumentById,
  listDocuments,
  listTrashedDocuments,
  permanentDeleteDocument,
  restoreDocument,
  trashDocument,
  updateDocument,
} from './repos/documents';

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
}

