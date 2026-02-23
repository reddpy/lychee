/**
 * Tests for IPC handler wiring.
 *
 * These tests verify that registerIpcHandlers():
 * 1. Registers exactly the right number of channels
 * 2. Each channel calls the correct repo function with the right args
 * 3. Response shapes match the IPC contract (wrapping in { documents }, { document }, { ok }, etc.)
 * 4. Errors from repo functions propagate (aren't silently swallowed)
 *
 * We mock ipcMain.handle to capture registrations, and mock all repo functions
 * to verify they're called correctly without touching the database.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Collect all registered handlers so we can invoke them in tests
const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock all repo modules
vi.mock('../../repos/documents', () => ({
  listDocuments: vi.fn().mockReturnValue([{ id: '1', title: 'Test' }]),
  getDocumentById: vi.fn().mockReturnValue({ id: '1', title: 'Test' }),
  createDocument: vi.fn().mockReturnValue({ id: 'new', title: 'Created' }),
  updateDocument: vi.fn().mockReturnValue({ id: '1', title: 'Updated' }),
  deleteDocument: vi.fn(),
  trashDocument: vi.fn().mockReturnValue({ document: { id: '1' }, trashedIds: ['1'] }),
  restoreDocument: vi.fn().mockReturnValue({ document: { id: '1' }, restoredIds: ['1'] }),
  listTrashedDocuments: vi.fn().mockReturnValue([]),
  permanentDeleteDocument: vi.fn().mockReturnValue({ deletedIds: ['1'] }),
  moveDocument: vi.fn().mockReturnValue({ id: '1', title: 'Moved' }),
}));

vi.mock('../../repos/images', () => ({
  saveImage: vi.fn().mockReturnValue({ id: 'img1', filePath: 'img1.png' }),
  getImagePath: vi.fn().mockReturnValue({ filePath: 'img1.png' }),
  downloadImage: vi.fn().mockResolvedValue({ id: 'img1', filePath: 'img1.png' }),
  deleteImage: vi.fn(),
}));

vi.mock('../../repos/url-resolver', () => ({
  resolveUrl: vi.fn().mockResolvedValue({ type: 'unsupported', url: 'x', reason: 'test' }),
}));

vi.mock('../../repos/url-metadata', () => ({
  fetchUrlMetadata: vi.fn().mockResolvedValue({ title: 'Test', description: '', imageUrl: '', faviconUrl: '', url: 'x' }),
}));

import {
  shell,
  registerIpcHandlers,
  docs,
  images,
  urlResolver,
  urlMetadata,
} from './setup';

describe('IPC Handler Wiring', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  // If a channel is missing, the renderer's invoke() call would hang forever
  // with no response. This is the most basic check.
  it('registers exactly 17 channels', () => {
    expect(handlers.size).toBe(17);
  });

  // Verify every expected channel name exists. A typo in a channel name
  // would silently break that feature with no error at startup.
  it('registers all expected channel names', () => {
    const expectedChannels = [
      'documents.list',
      'documents.get',
      'documents.create',
      'documents.update',
      'documents.delete',
      'documents.trash',
      'documents.restore',
      'documents.listTrashed',
      'documents.permanentDelete',
      'documents.move',
      'shell.openExternal',
      'images.save',
      'images.getPath',
      'images.download',
      'images.delete',
      'url.resolve',
      'url.fetchMetadata',
    ];

    for (const channel of expectedChannels) {
      expect(handlers.has(channel), `Missing channel: ${channel}`).toBe(true);
    }
  });

  // ────────────────────────────────────────────────────────
  // Document Handlers
  // ────────────────────────────────────────────────────────

  // The handler wraps the repo result in { documents: [...] }.
  // If this wrapping is missing, the renderer would get the raw array
  // instead of the expected { documents } shape.
  it('documents.list wraps result in { documents }', async () => {
    const handler = handlers.get('documents.list')!;
    const result = await handler(null, { limit: 10 });
    expect(result).toEqual({ documents: [{ id: '1', title: 'Test' }] });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: 10 });
  });

  it('documents.get wraps result in { document }', async () => {
    const handler = handlers.get('documents.get')!;
    const result = await handler(null, { id: '1' });
    expect(result).toEqual({ document: { id: '1', title: 'Test' } });
    expect(docs.getDocumentById).toHaveBeenCalledWith('1');
  });

  it('documents.create wraps result in { document }', async () => {
    const handler = handlers.get('documents.create')!;
    const result = await handler(null, { title: 'New' });
    expect(result).toEqual({ document: { id: 'new', title: 'Created' } });
    expect(docs.createDocument).toHaveBeenCalledWith({ title: 'New' });
  });

  // SUBTLE: The handler calls updateDocument(payload.id, payload).
  // The payload object includes the `id` field alongside title/content/etc.
  // updateDocument receives the full payload as the patch — the extra `id` field
  // is harmless because updateDocument only reads title/content/parentId/emoji.
  it('documents.update passes (id, payload) to updateDocument', async () => {
    const handler = handlers.get('documents.update')!;
    const payload = { id: '1', title: 'Updated Title' };
    const result = await handler(null, payload);
    expect(result).toEqual({ document: { id: '1', title: 'Updated' } });
    expect(docs.updateDocument).toHaveBeenCalledWith('1', payload);
  });

  // deleteDocument returns void, but the IPC contract expects { ok: true }.
  // The handler must wrap the void return.
  it('documents.delete returns { ok: true }', async () => {
    const handler = handlers.get('documents.delete')!;
    const result = await handler(null, { id: '1' });
    expect(result).toEqual({ ok: true });
    expect(docs.deleteDocument).toHaveBeenCalledWith('1');
  });

  // trashDocument already returns { document, trashedIds } — the handler
  // passes it through without wrapping.
  it('documents.trash passes through result (no extra wrapping)', async () => {
    const handler = handlers.get('documents.trash')!;
    const result = await handler(null, { id: '1' });
    expect(result).toEqual({ document: { id: '1' }, trashedIds: ['1'] });
  });

  it('documents.restore passes through result', async () => {
    const handler = handlers.get('documents.restore')!;
    const result = await handler(null, { id: '1' });
    expect(result).toEqual({ document: { id: '1' }, restoredIds: ['1'] });
  });

  it('documents.listTrashed wraps result in { documents }', async () => {
    const handler = handlers.get('documents.listTrashed')!;
    const result = await handler(null, {});
    expect(result).toEqual({ documents: [] });
  });

  it('documents.permanentDelete passes through result', async () => {
    const handler = handlers.get('documents.permanentDelete')!;
    const result = await handler(null, { id: '1' });
    expect(result).toEqual({ deletedIds: ['1'] });
  });

  // moveDocument returns the doc directly, but the handler wraps in { document }.
  it('documents.move wraps result in { document } and passes correct args', async () => {
    const handler = handlers.get('documents.move')!;
    const result = await handler(null, { id: '1', parentId: null, sortOrder: 2 });
    expect(result).toEqual({ document: { id: '1', title: 'Moved' } });
    expect(docs.moveDocument).toHaveBeenCalledWith('1', null, 2);
  });

  // ────────────────────────────────────────────────────────
  // Shell Handler
  // ────────────────────────────────────────────────────────

  it('shell.openExternal calls electron shell and returns { ok: true }', async () => {
    const handler = handlers.get('shell.openExternal')!;
    const result = await handler(null, { url: 'https://example.com' });
    expect(result).toEqual({ ok: true });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  // ────────────────────────────────────────────────────────
  // Image Handlers
  // ────────────────────────────────────────────────────────

  it('images.save passes (data, mimeType) to saveImage', async () => {
    const handler = handlers.get('images.save')!;
    const result = await handler(null, { data: 'base64data', mimeType: 'image/png' });
    expect(result).toEqual({ id: 'img1', filePath: 'img1.png' });
    expect(images.saveImage).toHaveBeenCalledWith('base64data', 'image/png');
  });

  it('images.getPath passes id to getImagePath', async () => {
    const handler = handlers.get('images.getPath')!;
    const result = await handler(null, { id: 'img1' });
    expect(result).toEqual({ filePath: 'img1.png' });
    expect(images.getImagePath).toHaveBeenCalledWith('img1');
  });

  it('images.download passes url to downloadImage', async () => {
    const handler = handlers.get('images.download')!;
    const result = await handler(null, { url: 'https://example.com/img.png' });
    expect(result).toEqual({ id: 'img1', filePath: 'img1.png' });
    expect(images.downloadImage).toHaveBeenCalledWith('https://example.com/img.png');
  });

  it('images.delete returns { ok: true }', async () => {
    const handler = handlers.get('images.delete')!;
    const result = await handler(null, { id: 'img1' });
    expect(result).toEqual({ ok: true });
    expect(images.deleteImage).toHaveBeenCalledWith('img1');
  });

  // ────────────────────────────────────────────────────────
  // URL Handlers
  // ────────────────────────────────────────────────────────

  it('url.resolve passes url to resolveUrl', async () => {
    const handler = handlers.get('url.resolve')!;
    await handler(null, { url: 'https://example.com' });
    expect(urlResolver.resolveUrl).toHaveBeenCalledWith('https://example.com');
  });

  it('url.fetchMetadata passes url to fetchUrlMetadata', async () => {
    const handler = handlers.get('url.fetchMetadata')!;
    await handler(null, { url: 'https://example.com' });
    expect(urlMetadata.fetchUrlMetadata).toHaveBeenCalledWith('https://example.com');
  });

  // ────────────────────────────────────────────────────────
  // Error Propagation
  // ────────────────────────────────────────────────────────

  // If a repo function throws, the error should propagate through the IPC
  // handler so Electron converts it to a rejected promise on the renderer side.
  // If errors are silently swallowed, the renderer would hang waiting forever.
  it('repo errors propagate through handler (not swallowed)', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Document not found: xyz');
    });

    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { id: 'xyz', title: 'X' })).rejects.toThrow(
      'Document not found: xyz',
    );
  });
});
