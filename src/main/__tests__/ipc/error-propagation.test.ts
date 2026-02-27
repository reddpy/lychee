/**
 * Tests for IPC error propagation — verifying that every handler type
 * correctly surfaces errors to the renderer.
 *
 * When the main process throws, Electron serializes the error and sends it
 * back as a rejected promise. If any handler silently swallows an error,
 * the renderer hangs forever waiting for a response it'll never get —
 * or worse, gets { ok: true } when the operation actually failed.
 *
 * This file tests EVERY handler to make sure errors aren't swallowed,
 * covering sync throws, async rejections, and specific error types
 * that the frontend needs to handle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('../../repos/documents', () => ({
  listDocuments: vi.fn().mockReturnValue([]),
  getDocumentById: vi.fn().mockReturnValue(null),
  createDocument: vi.fn().mockReturnValue({ id: '1' }),
  updateDocument: vi.fn().mockReturnValue({ id: '1' }),
  deleteDocument: vi.fn(),
  trashDocument: vi.fn().mockReturnValue({ document: { id: '1' }, trashedIds: ['1'] }),
  restoreDocument: vi.fn().mockReturnValue({ document: { id: '1' }, restoredIds: ['1'] }),
  listTrashedDocuments: vi.fn().mockReturnValue([]),
  permanentDeleteDocument: vi.fn().mockReturnValue({ deletedIds: ['1'] }),
  moveDocument: vi.fn().mockReturnValue({ id: '1' }),
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
  fetchUrlMetadata: vi.fn().mockResolvedValue({ title: '', description: '', imageUrl: '', faviconUrl: '', url: '' }),
}));

import {
  shell,
  registerIpcHandlers,
  docs,
  images,
  urlResolver,
  urlMetadata,
} from './setup';

describe('IPC Error Propagation', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  // ────────────────────────────────────────────────────────
  // Sync Repo Throws (document handlers)
  // ────────────────────────────────────────────────────────

  // The frontend's document-store.ts catches errors from every document call
  // and sets { error }. If the error doesn't propagate, the store never knows
  // the operation failed and the UI shows stale state.

  // listDocuments is called on app init and on every sidebar refresh.
  // A DB corruption error here means the user can't see any notes.
  it('documents.list propagates DB read errors', async () => {
    (docs.listDocuments as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('SQLITE_CORRUPT: database disk image is malformed');
    });

    const handler = handlers.get('documents.list')!;
    await expect(handler(null, {})).rejects.toThrow('SQLITE_CORRUPT');
  });

  // getDocumentById is called when opening a note. "not found" should propagate
  // so the frontend can show an appropriate message instead of a blank editor.
  it('documents.get propagates not-found errors', async () => {
    (docs.getDocumentById as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Document not found: abc123');
    });

    const handler = handlers.get('documents.get')!;
    await expect(handler(null, { id: 'abc123' })).rejects.toThrow(
      'Document not found: abc123',
    );
  });

  // createDocument can fail if the DB is locked (another process writing)
  // or if disk is full. The sidebar needs to know so it doesn't show a
  // phantom untitled note.
  it('documents.create propagates DB write errors', async () => {
    (docs.createDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('SQLITE_FULL: database or disk is full');
    });

    const handler = handlers.get('documents.create')!;
    await expect(handler(null, { title: 'New Note' })).rejects.toThrow('SQLITE_FULL');
  });

  // updateDocument is the most critical — called on every autosave (600ms debounce).
  // lexical-editor.tsx only does .catch(console.error), so if this silently succeeds
  // when it actually failed, the user thinks their note is saved but it's not.
  it('documents.update propagates errors (autosave path)', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });

    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { id: '1', content: '{"root":{"children":[]}}' })).rejects.toThrow(
      'SQLITE_BUSY',
    );
  });

  // deleteDocument wraps void → { ok: true }. If the delete throws,
  // the handler must NOT return { ok: true }.
  it('documents.delete does not return ok:true when delete fails', async () => {
    (docs.deleteDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('SQLITE_CONSTRAINT: foreign key violation');
    });

    const handler = handlers.get('documents.delete')!;
    await expect(handler(null, { id: '1' })).rejects.toThrow('SQLITE_CONSTRAINT');
  });

  // trashDocument is called when user hits Delete/Backspace on a note in sidebar.
  // If it fails, the note should reappear (not vanish from UI).
  it('documents.trash propagates cascade errors', async () => {
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });

    const handler = handlers.get('documents.trash')!;
    await expect(handler(null, { id: '1' })).rejects.toThrow('SQLITE_BUSY');
  });

  // restoreDocument reloads both the doc list and trash list on the frontend.
  // If restore fails, neither list should update.
  it('documents.restore propagates errors', async () => {
    (docs.restoreDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Document not found: gone');
    });

    const handler = handlers.get('documents.restore')!;
    await expect(handler(null, { id: 'gone' })).rejects.toThrow('Document not found');
  });

  it('documents.listTrashed propagates errors', async () => {
    (docs.listTrashedDocuments as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('SQLITE_CORRUPT');
    });

    const handler = handlers.get('documents.listTrashed')!;
    await expect(handler(null, {})).rejects.toThrow('SQLITE_CORRUPT');
  });

  // permanentDeleteDocument is destructive and irreversible. If it fails,
  // the user must know — otherwise they might trash the note again,
  // not realizing the first delete failed and it's still in DB.
  it('documents.permanentDelete propagates errors', async () => {
    (docs.permanentDeleteDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('SQLITE_IOERR: disk I/O error');
    });

    const handler = handlers.get('documents.permanentDelete')!;
    await expect(handler(null, { id: '1' })).rejects.toThrow('SQLITE_IOERR');
  });

  // moveDocument is called on drag-drop reorder in the sidebar.
  // The frontend does optimistic UI then reloads on error — if the error
  // is swallowed, the optimistic state persists but DB has stale order.
  it('documents.move propagates sort order errors', async () => {
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Cannot move document into its own descendant');
    });

    const handler = handlers.get('documents.move')!;
    await expect(
      handler(null, { id: '1', parentId: '2', sortOrder: 0 }),
    ).rejects.toThrow('Cannot move document into its own descendant');
  });

  // ────────────────────────────────────────────────────────
  // Sync Repo Throws (image handlers)
  // ────────────────────────────────────────────────────────

  // saveImage is called when user pastes a screenshot. If it fails,
  // image-plugin.tsx catches the error and leaves a broken placeholder.
  // The error must propagate for the catch block to fire.
  it('images.save propagates write errors', async () => {
    (images.saveImage as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    const handler = handlers.get('images.save')!;
    await expect(
      handler(null, { data: 'abc', mimeType: 'image/png' }),
    ).rejects.toThrow('ENOSPC');
  });

  // getImagePath is called on every image render in the editor.
  // image-component.tsx has NO .catch() on this call — an unhandled
  // rejection would crash the renderer if Electron strict mode is on.
  it('images.getPath propagates not-found errors', async () => {
    (images.getImagePath as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Image not found: deleted-img');
    });

    const handler = handlers.get('images.getPath')!;
    await expect(handler(null, { id: 'deleted-img' })).rejects.toThrow(
      'Image not found',
    );
  });

  // images.delete wraps void → { ok: true }, same pattern as documents.delete.
  it('images.delete does not return ok:true when delete fails', async () => {
    (images.deleteImage as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });

    const handler = handlers.get('images.delete')!;
    await expect(handler(null, { id: 'img1' })).rejects.toThrow('EACCES');
  });

  // ────────────────────────────────────────────────────────
  // Async Repo Rejections (downloadImage, resolveUrl, fetchUrlMetadata)
  // ────────────────────────────────────────────────────────

  // downloadImage is async (does net.fetch). The handler wraps the fn in
  // ipcMain.handle's async callback. Rejections must propagate.
  it('images.download propagates network errors', async () => {
    (images.downloadImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('net::ERR_CONNECTION_REFUSED'),
    );

    const handler = handlers.get('images.download')!;
    await expect(
      handler(null, { url: 'https://example.com/img.png' }),
    ).rejects.toThrow('ERR_CONNECTION_REFUSED');
  });

  // downloadImage can also throw HTTP errors.
  it('images.download propagates HTTP errors', async () => {
    (images.downloadImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('HTTP 403'),
    );

    const handler = handlers.get('images.download')!;
    await expect(
      handler(null, { url: 'https://example.com/private.png' }),
    ).rejects.toThrow('HTTP 403');
  });

  // resolveUrl is async. The frontend checks result.type to decide
  // whether to embed an image or a bookmark. If it rejects, the
  // link-click-plugin catches and removes the placeholder.
  it('url.resolve propagates async errors', async () => {
    (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Invalid URL'),
    );

    const handler = handlers.get('url.resolve')!;
    await expect(
      handler(null, { url: 'not-a-url' }),
    ).rejects.toThrow('Invalid URL');
  });

  // fetchUrlMetadata is async. It can fail due to CORS, DNS, timeout, etc.
  it('url.fetchMetadata propagates fetch errors', async () => {
    (urlMetadata.fetchUrlMetadata as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('net::ERR_NAME_NOT_RESOLVED'),
    );

    const handler = handlers.get('url.fetchMetadata')!;
    await expect(
      handler(null, { url: 'https://nonexistent.test' }),
    ).rejects.toThrow('ERR_NAME_NOT_RESOLVED');
  });

  // ────────────────────────────────────────────────────────
  // Shell handler errors
  // ────────────────────────────────────────────────────────

  // shell.openExternal can reject if the URL scheme is blocked by the OS
  // or if the shell.openExternal call itself fails.
  // bookmark-component.tsx and image-component.tsx have NO .catch() on this.
  it('shell.openExternal propagates shell errors', async () => {
    (shell.openExternal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Failed to open URL'),
    );

    const handler = handlers.get('shell.openExternal')!;
    await expect(
      handler(null, { url: 'https://example.com/broken' }),
    ).rejects.toThrow('Failed to open URL');
  });

  // ────────────────────────────────────────────────────────
  // Non-Error throws (strings, numbers, objects)
  // ────────────────────────────────────────────────────────

  // Some native modules throw non-Error values (strings, numbers).
  // better-sqlite3 occasionally throws string messages. The handler
  // wrapper must not eat these.
  it('propagates non-Error thrown values (string throw)', async () => {
    (docs.createDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'database is locked'; // eslint-disable-line no-throw-literal
    });

    const handler = handlers.get('documents.create')!;
    await expect(handler(null, { title: 'Test' })).rejects.toBe('database is locked');
  });

  // A repo function might throw an object with a code property
  // (common in Node.js fs errors).
  it('propagates error objects with custom code property', async () => {
    const fsError = new Error('ENOENT: no such file or directory');
    (fsError as NodeJS.ErrnoException).code = 'ENOENT';
    (images.deleteImage as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw fsError;
    });

    const handler = handlers.get('images.delete')!;
    try {
      await handler(null, { id: 'img1' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
      expect((err as Error).message).toContain('ENOENT');
    }
  });

  // ────────────────────────────────────────────────────────
  // Error message preservation
  // ────────────────────────────────────────────────────────

  // The frontend uses error.message for display — the exact message
  // must survive the handler wrapper without being transformed.
  it('preserves exact error message through handler', async () => {
    const exactMessage = 'Document not found: 550e8400-e29b-41d4-a716-446655440000';
    (docs.getDocumentById as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error(exactMessage);
    });

    const handler = handlers.get('documents.get')!;
    try {
      await handler(null, { id: '550e8400' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).toBe(exactMessage);
    }
  });

  // Stack traces are important for debugging — the handle() wrapper
  // uses async/await which preserves the stack.
  it('preserves error stack trace through handler', async () => {
    const error = new Error('deep stack error');
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw error;
    });

    const handler = handlers.get('documents.update')!;
    try {
      await handler(null, { id: '1', title: 'X' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).stack).toContain('deep stack error');
    }
  });
});
