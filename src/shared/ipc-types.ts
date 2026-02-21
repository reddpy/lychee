import type { DocumentRow } from './documents';

export type IpcContract = {
  'documents.list': {
    req: { limit?: number; offset?: number };
    res: { documents: DocumentRow[] };
  };
  'documents.get': {
    req: { id: string };
    res: { document: DocumentRow | null };
  };
  'documents.create': {
    req: {
      title?: string;
      content?: string;
      parentId?: string | null;
      emoji?: string | null;
    };
    res: { document: DocumentRow };
  };
  'documents.update': {
    req: {
      id: string;
      title?: string;
      content?: string;
      parentId?: string | null;
      emoji?: string | null;
    };
    res: { document: DocumentRow };
  };
  'documents.delete': {
    req: { id: string };
    res: { ok: true };
  };
  'documents.trash': {
    req: { id: string };
    res: { document: DocumentRow; trashedIds: string[] };
  };
  'documents.restore': {
    req: { id: string };
    res: { document: DocumentRow; restoredIds: string[] };
  };
  'documents.listTrashed': {
    req: { limit?: number; offset?: number };
    res: { documents: DocumentRow[] };
  };
  'documents.permanentDelete': {
    req: { id: string };
    res: { deletedIds: string[] };
  };
  'documents.move': {
    req: { id: string; parentId: string | null; sortOrder: number };
    res: { document: DocumentRow };
  };
  'shell.openExternal': {
    req: { url: string };
    res: { ok: true };
  };
  'images.save': {
    req: { data: string; mimeType: string };
    res: { id: string; filePath: string };
  };
  'images.getPath': {
    req: { id: string };
    res: { filePath: string };
  };
  'images.delete': {
    req: { id: string };
    res: { ok: true };
  };
};

export type IpcChannel = keyof IpcContract;

export type IpcInvoke = <C extends IpcChannel>(
  channel: C,
  payload: IpcContract[C]['req'],
) => Promise<IpcContract[C]['res']>;

// ── Event-based IPC (main → renderer push) ─────────────────────────

export type IpcEvents = {
};

export type IpcEventChannel = keyof IpcEvents;

export type IpcOn = <C extends IpcEventChannel>(
  channel: C,
  callback: (payload: IpcEvents[C]) => void,
) => () => void; // returns unsubscribe function
