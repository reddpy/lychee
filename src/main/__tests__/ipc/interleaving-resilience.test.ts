import { describe, it, expect, beforeEach, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../repos/documents', () => ({
  listDocuments: vi.fn().mockReturnValue([]),
  findDocumentByTitle: vi.fn().mockReturnValue(null),
  getDocumentById: vi.fn().mockReturnValue(null),
  createDocument: vi.fn().mockReturnValue({ id: 'doc-1', title: '' }),
  updateDocument: vi.fn().mockImplementation((id: string, patch: Record<string, unknown>) => ({
    id,
    ...patch,
    updatedAt: new Date().toISOString(),
  })),
  deleteDocument: vi.fn(),
  trashDocument: vi.fn().mockReturnValue({ document: { id: 'doc-1' }, trashedIds: ['doc-1'] }),
  restoreDocument: vi.fn().mockReturnValue({ document: { id: 'doc-1' }, restoredIds: ['doc-1'] }),
  listTrashedDocuments: vi.fn().mockReturnValue([]),
  permanentDeleteDocument: vi.fn().mockReturnValue({ deletedIds: ['doc-1'] }),
  moveDocument: vi.fn().mockReturnValue({ id: 'doc-1' }),
}));

vi.mock('../../repos/images', () => ({
  saveImage: vi.fn().mockReturnValue({ id: 'img1', filePath: 'img1.png' }),
  getImagePath: vi.fn().mockReturnValue({ filePath: 'img1.png' }),
  downloadImage: vi.fn().mockResolvedValue({ id: 'img1', filePath: 'img1.png' }),
  deleteImage: vi.fn(),
}));

vi.mock('../../repos/url-resolver', () => ({
  resolveUrl: vi.fn().mockResolvedValue({ type: 'unsupported', url: '', reason: '' }),
}));

vi.mock('../../repos/url-metadata', () => ({
  fetchUrlMetadata: vi.fn().mockResolvedValue({ title: '', description: '', imageUrl: '', faviconUrl: '', url: '' }),
}));

vi.mock('../../repos/settings', () => ({
  getSetting: vi.fn().mockReturnValue('true'),
  setSetting: vi.fn(),
  getAllSettings: vi.fn().mockReturnValue({}),
}));

import { registerIpcHandlers, docs } from './setup';

describe('IPC — Interleaving Resilience', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  it('markdown update payloads all persist and interleave safely', async () => {
    const update = handlers.get('documents.update')!;

    const results = await Promise.allSettled([
      update(null, { id: 'doc-1', content: '# one' }),
      update(null, { id: 'doc-1', content: 'two' }),
      update(null, { id: 'doc-1', content: 'three' }),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(docs.updateDocument).toHaveBeenCalledTimes(3);
  });

  it('mixed create payloads remain isolated under burst', async () => {
    const create = handlers.get('documents.create')!;
    const payloads = [
      { content: '# a' },
      { content: 'b' },
      { content: 'c' },
      { content: 'd' },
      { content: 'e' },
    ];

    const results = await Promise.allSettled(payloads.map((p) => create(null, p)));
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(docs.createDocument).toHaveBeenCalledTimes(5);
  });

  it('settings get/set burst remains stable while document handlers are active', async () => {
    const settingsSet = handlers.get('settings.set')!;
    const settingsGet = handlers.get('settings.get')!;
    const update = handlers.get('documents.update')!;

    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 40; i += 1) {
      ops.push(settingsSet(null, { key: 'searchPalettePreviewOpen', value: i % 2 === 0 ? 'true' : 'false' }));
      ops.push(settingsGet(null, { key: 'searchPalettePreviewOpen' }));
      ops.push(update(null, { id: 'doc-1', content: `v-${i}` }));
    }
    const results = await Promise.allSettled(ops);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});
