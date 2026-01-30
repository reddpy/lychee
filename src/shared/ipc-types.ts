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
    res: { document: DocumentRow };
  };
};

export type IpcChannel = keyof IpcContract;

export type IpcInvoke = <C extends IpcChannel>(
  channel: C,
  payload: IpcContract[C]['req'],
) => Promise<IpcContract[C]['res']>;

