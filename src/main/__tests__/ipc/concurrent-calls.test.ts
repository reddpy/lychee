/**
 * Hardened tests for concurrent and rapid-fire IPC calls.
 *
 * The Lychee frontend is heavy — React + Zustand + Lexical editor all firing
 * IPC calls constantly and concurrently:
 *
 * - Autosave content every 600ms while typing (documents.update)
 * - Autosave title every 500ms while renaming (documents.update)
 * - Both debounce timers can fire at the same time for the same doc
 * - Drag-drop reorder fires documents.move then loadDocuments (2 calls)
 * - Pasting N images fires N concurrent images.save calls
 * - Opening a note with N images fires N concurrent images.getPath calls
 * - Hovering over links fires url.resolve, then url.fetchMetadata
 * - Trashing a note fires documents.trash then filters descendants from UI
 * - Restore fires documents.restore then loadDocuments + loadTrashedDocuments (3 calls)
 * - moveDocument fires documents.move then reloads on BOTH success and error
 *
 * These tests verify the handler layer survives all of this without:
 * - Lost responses (handler resolves with wrong data)
 * - Interleaved state (call A's mock polluting call B's result)
 * - Poisoned batches (one failure bringing down sibling calls)
 * - Ordering violations (out-of-order completion corrupting state)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// All handlers are async because ipcMain.handle wraps them in async (_event, payload) => fn(payload)
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
  getDocumentById: vi.fn().mockReturnValue(null),
  createDocument: vi.fn().mockReturnValue({ id: '1', title: '' }),
  updateDocument: vi.fn().mockReturnValue({ id: '1', title: '', updatedAt: '' }),
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
  registerIpcHandlers,
  docs,
  images,
  urlResolver,
  urlMetadata,
} from './setup';

/** Helper: resolve after N ms */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Wrap arbitrary text in minimal valid editor state JSON. */
const editorJson = (text: string) => JSON.stringify({ root: { children: [{ type: 'text', text }] } });

describe('IPC Concurrent & Rapid-Fire Calls', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  // ────────────────────────────────────────────────────────
  // Autosave stress — the #1 source of concurrent IPC calls
  // ────────────────────────────────────────────────────────

  // The editor debounces at 600ms. A user typing for 30 seconds at 60WPM
  // produces ~50 debounce fires. If the DB is slow (10ms each), calls pile up.
  it('50 concurrent autosaves all resolve with correct content', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: { content?: string }) => ({
        id,
        content: patch.content || '',
        updatedAt: new Date().toISOString(),
      }),
    );

    const handler = handlers.get('documents.update')!;
    const promises = Array.from({ length: 50 }, (_, i) =>
      handler(null, { id: 'doc1', content: editorJson(`version-${i}`) }),
    );

    const results = await Promise.all(promises);

    expect(docs.updateDocument).toHaveBeenCalledTimes(50);
    // Every single result must have its own version — no mixing
    results.forEach((result, i) => {
      const doc = (result as { document: { content: string } }).document;
      expect(doc.content).toBe(editorJson(`version-${i}`));
    });
  });

  // Title and content debounce timers are different (500ms vs 600ms).
  // They can overlap for the same document — both arrive at the handler
  // at the same instant. Neither should clobber the other.
  it('interleaved title and content saves for same document (10 of each)', async () => {
    const callLog: Array<{ field: 'title' | 'content'; value: string }> = [];
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: { title?: string; content?: string }) => {
        if (patch.title !== undefined) callLog.push({ field: 'title', value: patch.title });
        if (patch.content !== undefined) callLog.push({ field: 'content', value: patch.content });
        return { id, ...patch, updatedAt: new Date().toISOString() };
      },
    );

    const handler = handlers.get('documents.update')!;

    // Interleave: title, content, title, content, ...
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(handler(null, { id: 'doc1', title: `title-${i}` }));
      promises.push(handler(null, { id: 'doc1', content: editorJson(`content-${i}`) }));
    }

    await Promise.all(promises);

    expect(docs.updateDocument).toHaveBeenCalledTimes(20);
    // All 10 titles and 10 contents must have been recorded
    const titles = callLog.filter(c => c.field === 'title');
    const contents = callLog.filter(c => c.field === 'content');
    expect(titles.length).toBe(10);
    expect(contents.length).toBe(10);
    // Each version is distinct
    for (let i = 0; i < 10; i++) {
      expect(titles[i].value).toBe(`title-${i}`);
      expect(contents[i].value).toBe(editorJson(`content-${i}`));
    }
  });

  // User types in note A, switches to note B and types there too.
  // Both notes have pending autosaves that fire concurrently.
  it('concurrent autosaves for two different documents (10 each)', async () => {
    const savedDocs = new Map<string, string[]>();
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: { content?: string }) => {
        if (!savedDocs.has(id)) savedDocs.set(id, []);
        savedDocs.get(id)!.push(patch.content || '');
        return { id, content: patch.content, updatedAt: new Date().toISOString() };
      },
    );

    const handler = handlers.get('documents.update')!;

    // 10 saves for doc-A interleaved with 10 saves for doc-B
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(handler(null, { id: 'doc-A', content: editorJson(`A-v${i}`) }));
      promises.push(handler(null, { id: 'doc-B', content: editorJson(`B-v${i}`) }));
    }

    await Promise.all(promises);

    expect(savedDocs.get('doc-A')!.length).toBe(10);
    expect(savedDocs.get('doc-B')!.length).toBe(10);
    // No cross-contamination
    savedDocs.get('doc-A')!.forEach(v => expect(v).toContain('A-v'));
    savedDocs.get('doc-B')!.forEach(v => expect(v).toContain('B-v'));
  });

  // Image downloads with varying async delays — simulates real network latency.
  // Some downloads take 1ms, others take 10ms. Results must still match requests.
  // (We use images.download here because it's a truly async handler — unlike
  // documents.update which is synchronous SQLite and doesn't benefit from delay testing.)
  it('downloads with variable latency resolve in correct order', async () => {
    (images.downloadImage as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        // Vary latency: even calls are slow, odd calls are fast
        const version = parseInt(url.split('/').pop() || '0');
        await delay(version % 2 === 0 ? 10 : 1);
        return { id: `img-${version}`, filePath: `img-${version}.png` };
      },
    );

    const handler = handlers.get('images.download')!;
    const promises = Array.from({ length: 10 }, (_, i) =>
      handler(null, { url: `https://example.com/${i}` }),
    );

    const results = await Promise.all(promises);

    // Even though completion order varies, each result matches its request
    results.forEach((result, i) => {
      const res = result as { id: string; filePath: string };
      expect(res.id).toBe(`img-${i}`);
    });
  });

  // User has 5 tabs open and is rapidly switching between them.
  // Each tab switch flushes the previous tab's debounce and starts a new one.
  it('autosave flushes from 5 tab switches all land correctly', async () => {
    const savedByDoc = new Map<string, string>();
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: { content?: string }) => {
        savedByDoc.set(id, patch.content || '');
        return { id, content: patch.content, updatedAt: new Date().toISOString() };
      },
    );

    const handler = handlers.get('documents.update')!;

    // Simulate: type in tab-1, switch to tab-2 (flush tab-1), type, switch, ...
    await Promise.all([
      handler(null, { id: 'tab-1', content: editorJson('final-1') }),
      handler(null, { id: 'tab-2', content: editorJson('final-2') }),
      handler(null, { id: 'tab-3', content: editorJson('final-3') }),
      handler(null, { id: 'tab-4', content: editorJson('final-4') }),
      handler(null, { id: 'tab-5', content: editorJson('final-5') }),
    ]);

    expect(savedByDoc.size).toBe(5);
    for (let i = 1; i <= 5; i++) {
      expect(savedByDoc.get(`tab-${i}`)).toBe(editorJson(`final-${i}`));
    }
  });

  // ────────────────────────────────────────────────────────
  // Error isolation — one failure must not poison the batch
  // ────────────────────────────────────────────────────────

  // 10 autosaves, #3 and #7 fail (SQLITE_BUSY). The other 8 must succeed.
  it('multiple failures in a batch are isolated (2 of 10 fail)', async () => {
    let callCount = 0;
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (_id: string, patch: { content?: string }) => {
        callCount++;
        if (callCount === 3 || callCount === 7) {
          throw new Error(`SQLITE_BUSY on call ${callCount}`);
        }
        return { id: '1', content: patch.content, updatedAt: new Date().toISOString() };
      },
    );

    const handler = handlers.get('documents.update')!;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        handler(null, { id: '1', content: editorJson(`v${i}`) }),
      ),
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(8);
    expect(rejected.length).toBe(2);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe('SQLITE_BUSY on call 3');
    expect((rejected[1] as PromiseRejectedResult).reason.message).toBe('SQLITE_BUSY on call 7');
  });

  // Deterministic failure pattern: every 5th call fails.
  // Fulfilled + rejected must always sum to total.
  it('every 5th call fails in batch of 20 — counts always add up', async () => {
    let callNum = 0;
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callNum++;
      if (callNum % 5 === 0) throw new Error(`fail-${callNum}`);
      return { id: '1', updatedAt: new Date().toISOString() };
    });

    const handler = handlers.get('documents.update')!;
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        handler(null, { id: '1', content: editorJson(`v${i}`) }),
      ),
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.filter(r => r.status === 'rejected').length;
    expect(fulfilled + rejected).toBe(20);
    expect(rejected).toBe(4); // calls 5, 10, 15, 20
    expect(fulfilled).toBe(16);
  });

  // Async rejection isolated from successful handlers.
  // Uses images.download which is truly async (the handler returns downloadImage() directly).
  it('async rejection does not block concurrent async handlers', async () => {
    let callCount = 0;
    (images.downloadImage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      const myNum = callCount;
      if (myNum === 2) {
        await delay(5);
        throw new Error('async download failure');
      }
      return { id: `img-${myNum}`, filePath: `img-${myNum}.png` };
    });

    const handler = handlers.get('images.download')!;
    const results = await Promise.allSettled([
      handler(null, { url: 'https://example.com/1.png' }),
      handler(null, { url: 'https://example.com/2.png' }), // fails async
      handler(null, { url: 'https://example.com/3.png' }),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');
  });

  // First call in a batch fails — the rest must still succeed.
  // (Catches off-by-one in error handling where failure #0 corrupts state.)
  it('first call in batch failing does not corrupt subsequent calls', async () => {
    let callCount = 0;
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('first call died');
      return { id: '1', content: `ok-${callCount}`, updatedAt: '' };
    });

    const handler = handlers.get('documents.update')!;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        handler(null, { id: '1', content: editorJson(`v${i}`) }),
      ),
    );

    expect(results[0].status).toBe('rejected');
    for (let i = 1; i < 5; i++) {
      expect(results[i].status).toBe('fulfilled');
    }
  });

  // Last call in a batch fails — previous results must be unaffected.
  it('last call in batch failing does not retroactively corrupt results', async () => {
    let callCount = 0;
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 5) throw new Error('last call died');
      return { id: '1', content: `ok-${callCount}`, updatedAt: '' };
    });

    const handler = handlers.get('documents.update')!;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        handler(null, { id: '1', content: editorJson(`v${i}`) }),
      ),
    );

    for (let i = 0; i < 4; i++) {
      expect(results[i].status).toBe('fulfilled');
    }
    expect(results[4].status).toBe('rejected');
  });

  // ────────────────────────────────────────────────────────
  // Image paste/drop stress
  // ────────────────────────────────────────────────────────

  // User pastes 10 images at once. image-plugin.tsx fires images.save for each.
  it('10 concurrent image saves all get unique IDs and correct MIME handling', async () => {
    let imgCounter = 0;
    (images.saveImage as ReturnType<typeof vi.fn>).mockImplementation(
      (_data: string, mimeType: string) => {
        imgCounter++;
        const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
        return { id: `img-${imgCounter}`, filePath: `img-${imgCounter}.${ext}` };
      },
    );

    const handler = handlers.get('images.save')!;
    const mimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/png',
      'image/jpeg', 'image/png', 'image/gif', 'image/png', 'image/webp'];

    const results = await Promise.all(
      mimeTypes.map((mime, i) =>
        handler(null, { data: `base64data${i}`, mimeType: mime }),
      ),
    );

    expect(images.saveImage).toHaveBeenCalledTimes(10);
    const ids = results.map(r => (r as { id: string }).id);
    expect(new Set(ids).size).toBe(10);
  });

  // 10 image saves, #4 and #8 fail (ENOSPC). Other 8 must succeed.
  it('image save failures isolated in batch of 10', async () => {
    let imgCount = 0;
    (images.saveImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      imgCount++;
      if (imgCount === 4 || imgCount === 8) {
        throw new Error('ENOSPC: no space left on device');
      }
      return { id: `img-${imgCount}`, filePath: `img-${imgCount}.png` };
    });

    const handler = handlers.get('images.save')!;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        handler(null, { data: `data${i}`, mimeType: 'image/png' }),
      ),
    );

    expect(results.filter(r => r.status === 'fulfilled').length).toBe(8);
    expect(results.filter(r => r.status === 'rejected').length).toBe(2);
  });

  // ────────────────────────────────────────────────────────
  // Image download stress (external URLs)
  // ────────────────────────────────────────────────────────

  // 5 external image URLs pasted. Each download takes different time.
  it('concurrent downloads with staggered latency all resolve correctly', async () => {
    let dlCounter = 0;
    (images.downloadImage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      dlCounter++;
      const myId = dlCounter;
      // Reverse latency: first call is slowest, last is fastest
      await delay((6 - myId) * 2);
      return { id: `dl-${myId}`, filePath: `dl-${myId}.png` };
    });

    const handler = handlers.get('images.download')!;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        handler(null, { url: `https://cdn.example.com/img-${i}.png` }),
      ),
    );

    expect(images.downloadImage).toHaveBeenCalledTimes(5);
    const ids = results.map(r => (r as { id: string }).id);
    expect(new Set(ids).size).toBe(5);
  });

  // Mixed success and failure: download #2 (404), #4 (timeout), rest succeed.
  it('download failures isolated — correct error messages preserved', async () => {
    let dlCount = 0;
    (images.downloadImage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      dlCount++;
      const myNum = dlCount;
      await delay(Math.random() * 5);
      if (myNum === 2) throw new Error('HTTP 404');
      if (myNum === 4) throw new Error('net::ERR_CONNECTION_TIMED_OUT');
      return { id: `dl-${myNum}`, filePath: `dl-${myNum}.png` };
    });

    const handler = handlers.get('images.download')!;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        handler(null, { url: `https://example.com/img-${i}.png` }),
      ),
    );

    expect(results.filter(r => r.status === 'fulfilled').length).toBe(3);
    expect(results.filter(r => r.status === 'rejected').length).toBe(2);
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason.message);
    expect(errors).toContain('HTTP 404');
    expect(errors).toContain('net::ERR_CONNECTION_TIMED_OUT');
  });

  // ────────────────────────────────────────────────────────
  // Opening a note with many images (getPath stress)
  // ────────────────────────────────────────────────────────

  // A media-heavy note can have 50+ images. image-component.tsx fires
  // images.getPath for each one on mount — all concurrent.
  it('50 concurrent images.getPath calls all resolve with correct path', async () => {
    (images.getImagePath as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => ({ filePath: `${id}.png` }),
    );

    const handler = handlers.get('images.getPath')!;
    const ids = Array.from({ length: 50 }, (_, i) => `img-${i}`);
    const results = await Promise.all(
      ids.map(id => handler(null, { id })),
    );

    expect(images.getImagePath).toHaveBeenCalledTimes(50);
    results.forEach((result, i) => {
      expect((result as { filePath: string }).filePath).toBe(`img-${i}.png`);
    });
  });

  // Some images were deleted (orphaned references in the note JSON).
  // getImagePath throws for those. The successful ones must still resolve.
  it('getPath failures for deleted images isolated from valid ones', async () => {
    (images.getImagePath as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => {
        const num = parseInt(id.split('-')[1]);
        if (num % 3 === 0) throw new Error(`Image not found: ${id}`);
        return { filePath: `${id}.png` };
      },
    );

    const handler = handlers.get('images.getPath')!;
    const ids = Array.from({ length: 15 }, (_, i) => `img-${i}`);
    const results = await Promise.allSettled(
      ids.map(id => handler(null, { id })),
    );

    // img-0, img-3, img-6, img-9, img-12 = 5 failures
    expect(results.filter(r => r.status === 'rejected').length).toBe(5);
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(10);
  });

  // ────────────────────────────────────────────────────────
  // URL resolution + metadata fetch pipeline
  // ────────────────────────────────────────────────────────

  // link-click-plugin.tsx: first calls url.resolve, and if type='unsupported',
  // calls url.fetchMetadata. Multiple links can be resolved in parallel.
  it('parallel resolve→fetchMetadata pipelines for 5 different URLs', async () => {
    (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      await delay(Math.random() * 5);
      if (url.includes('img')) {
        return { type: 'image', id: 'x', filePath: 'x.png', sourceUrl: url };
      }
      return { type: 'unsupported', url, reason: 'text/html' };
    });
    (urlMetadata.fetchUrlMetadata as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      await delay(Math.random() * 5);
      return { title: `Title for ${url}`, description: '', imageUrl: '', faviconUrl: '', url };
    });

    const resolveHandler = handlers.get('url.resolve')!;
    const metadataHandler = handlers.get('url.fetchMetadata')!;

    const urls = [
      'https://example.com/article-1',
      'https://example.com/img.png',
      'https://example.com/article-2',
      'https://example.com/img2.png',
      'https://example.com/article-3',
    ];

    // Step 1: resolve all URLs in parallel
    const resolveResults = await Promise.all(
      urls.map(url => resolveHandler(null, { url })),
    );

    // Step 2: for unsupported results, fetch metadata in parallel
    const metadataPromises: Promise<unknown>[] = [];
    const metadataIndices: number[] = [];
    resolveResults.forEach((result, i) => {
      if ((result as { type: string }).type === 'unsupported') {
        metadataPromises.push(metadataHandler(null, { url: urls[i] }));
        metadataIndices.push(i);
      }
    });

    const metadataResults = await Promise.all(metadataPromises);

    // 2 images, 3 articles
    expect(resolveResults.filter(r => (r as { type: string }).type === 'image').length).toBe(2);
    expect(metadataResults.length).toBe(3);
    metadataResults.forEach((result, i) => {
      const meta = result as { title: string; url: string };
      expect(meta.url).toBe(urls[metadataIndices[i]]);
      expect(meta.title).toContain(urls[metadataIndices[i]]);
    });
  });

  // url.resolve failure for one URL isolated from concurrent resolves.
  it('url.resolve failure isolated from concurrent resolves', async () => {
    (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url === 'bad-url') throw new Error('Invalid URL');
      return { type: 'unsupported', url, reason: 'text/html' };
    });

    const handler = handlers.get('url.resolve')!;
    const results = await Promise.allSettled([
      handler(null, { url: 'https://example.com/a' }),
      handler(null, { url: 'bad-url' }),
      handler(null, { url: 'https://example.com/b' }),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');
  });

  // ────────────────────────────────────────────────────────
  // Store cascade patterns (multi-step frontend flows)
  // ────────────────────────────────────────────────────────

  // Trash fires, then the frontend does loadDocuments to refresh the sidebar.
  it('trash then immediate loadDocuments (store cascade)', async () => {
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'doc-1' }, trashedIds: ['doc-1', 'child-1', 'child-2'],
    });
    (docs.listDocuments as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'doc-2', title: 'Remaining' },
    ]);

    const trashResult = await handlers.get('documents.trash')!(null, { id: 'doc-1' });
    const listResult = await handlers.get('documents.list')!(null, { limit: 500 });

    const trash = trashResult as { trashedIds: string[] };
    expect(trash.trashedIds).toEqual(['doc-1', 'child-1', 'child-2']);
    const list = listResult as { documents: Array<{ id: string }> };
    expect(list.documents.length).toBe(1);
    expect(list.documents[0].id).toBe('doc-2');
  });

  // Restore cascade: restore → loadDocuments(silent) → loadTrashedDocuments
  // Three sequential IPC calls triggered by one user action.
  it('restore triggers 3 sequential IPC calls (store cascade)', async () => {
    (docs.restoreDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'doc-1' }, restoredIds: ['doc-1'],
    });
    (docs.listDocuments as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'doc-1', title: 'Restored' },
      { id: 'doc-2', title: 'Existing' },
    ]);
    (docs.listTrashedDocuments as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const restoreResult = await handlers.get('documents.restore')!(null, { id: 'doc-1' });
    expect((restoreResult as { restoredIds: string[] }).restoredIds).toEqual(['doc-1']);

    const listResult = await handlers.get('documents.list')!(null, { limit: 500 });
    expect((listResult as { documents: unknown[] }).documents.length).toBe(2);

    const trashResult = await handlers.get('documents.listTrashed')!(null, { limit: 200 });
    expect((trashResult as { documents: unknown[] }).documents.length).toBe(0);
  });

  // Move cascade: moveDocument → loadDocuments(silent).
  // On error: moveDocument rejects → loadDocuments(silent) still fires.
  it('move error still triggers reload (store error recovery)', async () => {
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Cannot move document into its own descendant');
    });
    (docs.listDocuments as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'doc-1', sortOrder: 0 },
      { id: 'doc-2', sortOrder: 1 },
    ]);

    await expect(
      handlers.get('documents.move')!(null, { id: 'doc-1', parentId: 'doc-2', sortOrder: 0 }),
    ).rejects.toThrow('Cannot move document into its own descendant');

    // Frontend calls loadDocuments in the catch block — it must still work
    const listResult = await handlers.get('documents.list')!(null, { limit: 500 });
    expect((listResult as { documents: unknown[] }).documents.length).toBe(2);
  });

  // Create + immediately trash (user changes their mind).
  it('create then immediate trash for same document', async () => {
    (docs.createDocument as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'new-doc', title: '' });
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'new-doc' }, trashedIds: ['new-doc'],
    });

    const createResult = await handlers.get('documents.create')!(null, {});
    const docId = (createResult as { document: { id: string } }).document.id;

    const trashResult = await handlers.get('documents.trash')!(null, { id: docId });
    expect((trashResult as { trashedIds: string[] }).trashedIds).toContain(docId);
  });

  // ────────────────────────────────────────────────────────
  // Rapid-fire create
  // ────────────────────────────────────────────────────────

  it('20 rapid creates all produce distinct document IDs', async () => {
    let count = 0;
    (docs.createDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      count++;
      return { id: `doc-${count}`, title: '' };
    });

    const handler = handlers.get('documents.create')!;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => handler(null, {})),
    );

    expect(docs.createDocument).toHaveBeenCalledTimes(20);
    const ids = results.map(r => (r as { document: { id: string } }).document.id);
    expect(new Set(ids).size).toBe(20);
  });

  // ────────────────────────────────────────────────────────
  // Permanent delete stress
  // ────────────────────────────────────────────────────────

  // User empties 5 items from trash sequentially.
  it('5 sequential permanent deletes', async () => {
    const deletedSoFar: string[] = [];
    (docs.permanentDeleteDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => {
        deletedSoFar.push(id);
        return { deletedIds: [id] };
      },
    );

    const handler = handlers.get('documents.permanentDelete')!;
    for (let i = 0; i < 5; i++) {
      const result = await handler(null, { id: `trash-${i}` });
      expect((result as { deletedIds: string[] }).deletedIds).toEqual([`trash-${i}`]);
    }
    expect(deletedSoFar).toEqual(['trash-0', 'trash-1', 'trash-2', 'trash-3', 'trash-4']);
  });

  // Permanent delete of a parent with children returns all descendant IDs.
  it('permanent delete cascading returns all descendant IDs', async () => {
    (docs.permanentDeleteDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      deletedIds: ['parent', 'child-1', 'child-2', 'grandchild-1'],
    });

    const result = await handlers.get('documents.permanentDelete')!(null, { id: 'parent' });
    const { deletedIds } = result as { deletedIds: string[] };
    expect(deletedIds).toHaveLength(4);
    expect(deletedIds).toContain('parent');
    expect(deletedIds).toContain('grandchild-1');
  });

  // ────────────────────────────────────────────────────────
  // Mixed cross-channel stress (realistic user sessions)
  // ────────────────────────────────────────────────────────

  // Real scenario: user is typing (autosave), pastes 3 images,
  // and there's a link being resolved — all at the same instant.
  it('autosave + 3 image saves + url resolve all concurrent', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'doc1', content: 'saved', updatedAt: new Date().toISOString(),
    });
    let imgNum = 0;
    (images.saveImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      imgNum++;
      return { id: `img-${imgNum}`, filePath: `img-${imgNum}.png` };
    });
    (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: 'unsupported', url: 'https://example.com', reason: 'text/html',
    });

    const results = await Promise.all([
      handlers.get('documents.update')!(null, { id: 'doc1', content: editorJson('saved') }),
      handlers.get('images.save')!(null, { data: 'd1', mimeType: 'image/png' }),
      handlers.get('images.save')!(null, { data: 'd2', mimeType: 'image/jpeg' }),
      handlers.get('images.save')!(null, { data: 'd3', mimeType: 'image/gif' }),
      handlers.get('url.resolve')!(null, { url: 'https://example.com' }),
    ]);

    expect(results.length).toBe(5);
    expect(docs.updateDocument).toHaveBeenCalledTimes(1);
    expect(images.saveImage).toHaveBeenCalledTimes(3);
    expect(urlResolver.resolveUrl).toHaveBeenCalledTimes(1);
  });

  // Worst case: 5 different channel types all concurrent.
  it('update + move + trash + download + metadata all concurrent', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'doc-a', updatedAt: new Date().toISOString(),
    });
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'doc-b' });
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'doc-c' }, trashedIds: ['doc-c'],
    });
    (images.downloadImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'dl-1', filePath: 'dl-1.png',
    });
    (urlMetadata.fetchUrlMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: 'Page', description: '', imageUrl: '', faviconUrl: '', url: 'https://example.com',
    });

    const results = await Promise.all([
      handlers.get('documents.update')!(null, { id: 'doc-a', content: editorJson('saved') }),
      handlers.get('documents.move')!(null, { id: 'doc-b', parentId: null, sortOrder: 0 }),
      handlers.get('documents.trash')!(null, { id: 'doc-c' }),
      handlers.get('images.download')!(null, { url: 'https://cdn.example.com/img.png' }),
      handlers.get('url.fetchMetadata')!(null, { url: 'https://example.com' }),
    ]);

    expect(results.length).toBe(5);
    expect(docs.updateDocument).toHaveBeenCalledTimes(1);
    expect(docs.moveDocument).toHaveBeenCalledTimes(1);
    expect(docs.trashDocument).toHaveBeenCalledTimes(1);
    expect(images.downloadImage).toHaveBeenCalledTimes(1);
    expect(urlMetadata.fetchUrlMetadata).toHaveBeenCalledTimes(1);
  });

  // ────────────────────────────────────────────────────────
  // High-volume stress tests
  // ────────────────────────────────────────────────────────

  // Simulate 30 seconds of active use: 50 autosaves + 10 image saves + 5 URL resolves
  // + 3 moves + 2 trashes — all fired as fast as possible.
  it('70 concurrent mixed operations all resolve', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: { content?: string }) => ({
        id, content: patch.content, updatedAt: new Date().toISOString(),
      }),
    );
    let imgC = 0;
    (images.saveImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      imgC++;
      return { id: `img-${imgC}`, filePath: `img-${imgC}.png` };
    });
    (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: 'unsupported', url: '', reason: '',
    });
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'moved' });
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'trashed' }, trashedIds: ['trashed'],
    });

    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 50; i++) promises.push(handlers.get('documents.update')!(null, { id: 'doc1', content: editorJson(`v${i}`) }));
    for (let i = 0; i < 10; i++) promises.push(handlers.get('images.save')!(null, { data: `d${i}`, mimeType: 'image/png' }));
    for (let i = 0; i < 5; i++) promises.push(handlers.get('url.resolve')!(null, { url: `https://example.com/${i}` }));
    for (let i = 0; i < 3; i++) promises.push(handlers.get('documents.move')!(null, { id: `m${i}`, parentId: null, sortOrder: i }));
    for (let i = 0; i < 2; i++) promises.push(handlers.get('documents.trash')!(null, { id: `t${i}` }));

    const results = await Promise.allSettled(promises);

    expect(results.length).toBe(70);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    expect(docs.updateDocument).toHaveBeenCalledTimes(50);
    expect(images.saveImage).toHaveBeenCalledTimes(10);
    expect(urlResolver.resolveUrl).toHaveBeenCalledTimes(5);
    expect(docs.moveDocument).toHaveBeenCalledTimes(3);
    expect(docs.trashDocument).toHaveBeenCalledTimes(2);
  });

  // Same as above but with ~10% failure rate.
  // fulfilled + rejected must always equal 70 — no lost promises.
  it('70 mixed operations with 10% failure rate — no lost promises', async () => {
    let globalCount = 0;
    const failEvery = 7;

    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      globalCount++;
      if (globalCount % failEvery === 0) throw new Error(`fail-${globalCount}`);
      return { id: '1', updatedAt: new Date().toISOString() };
    });
    (images.saveImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      globalCount++;
      if (globalCount % failEvery === 0) throw new Error(`fail-${globalCount}`);
      return { id: 'i', filePath: 'i.png' };
    });
    (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      globalCount++;
      if (globalCount % failEvery === 0) throw new Error(`fail-${globalCount}`);
      return { type: 'unsupported', url: '', reason: '' };
    });
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      globalCount++;
      if (globalCount % failEvery === 0) throw new Error(`fail-${globalCount}`);
      return { id: 'm' };
    });
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      globalCount++;
      if (globalCount % failEvery === 0) throw new Error(`fail-${globalCount}`);
      return { document: { id: 't' }, trashedIds: ['t'] };
    });

    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 50; i++) promises.push(handlers.get('documents.update')!(null, { id: '1', content: editorJson(`v${i}`) }));
    for (let i = 0; i < 10; i++) promises.push(handlers.get('images.save')!(null, { data: `d${i}`, mimeType: 'image/png' }));
    for (let i = 0; i < 5; i++) promises.push(handlers.get('url.resolve')!(null, { url: `u${i}` }));
    for (let i = 0; i < 3; i++) promises.push(handlers.get('documents.move')!(null, { id: `m${i}`, parentId: null, sortOrder: i }));
    for (let i = 0; i < 2; i++) promises.push(handlers.get('documents.trash')!(null, { id: `t${i}` }));

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.filter(r => r.status === 'rejected').length;

    // No lost promises
    expect(fulfilled + rejected).toBe(70);
    // failEvery=7 over 70 calls = 10 failures (7,14,21,...,70)
    expect(rejected).toBe(10);
    expect(fulfilled).toBe(60);
  });

  // ────────────────────────────────────────────────────────
  // Double registration guard
  // ────────────────────────────────────────────────────────

  it('calling registerIpcHandlers twice overwrites handlers (no duplicates)', () => {
    expect(handlers.size).toBe(20);
    registerIpcHandlers();
    expect(handlers.size).toBe(20);
  });

  // ────────────────────────────────────────────────────────
  // Cross-channel concurrent interactions
  //
  // The frontend doesn't coordinate between channels. A user can:
  //   - Type (autosave) while a drag-drop move is in flight
  //   - Paste an image while a title save is pending
  //   - Trash a doc while its content is being autosaved
  //   - Click a link (url.resolve) while images are downloading
  //
  // These tests verify that concurrent calls to DIFFERENT channels
  // on the SAME document don't interfere with each other.
  // ────────────────────────────────────────────────────────

  // User is typing in a note (autosave fires) and simultaneously
  // drags it to a new position (move fires). Both target the same doc.
  // The update should see the content, the move should see the position.
  it('concurrent update and move on same document both resolve independently', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: { content?: string }) => ({
        id, content: patch.content, updatedAt: new Date().toISOString(),
      }),
    );
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, parentId: string | null, sortOrder: number) => ({
        id, parentId, sortOrder,
      }),
    );

    const [updateResult, moveResult] = await Promise.all([
      handlers.get('documents.update')!(null, { id: 'doc-1', content: editorJson('typing...') }),
      handlers.get('documents.move')!(null, { id: 'doc-1', parentId: null, sortOrder: 3 }),
    ]);

    const updated = (updateResult as { document: { content: string } }).document;
    expect(updated.content).toBe(editorJson('typing...'));
    const moved = (moveResult as { document: { sortOrder: number } }).document;
    expect(moved.sortOrder).toBe(3);
  });

  // User trashes a note while its autosave is still in flight.
  // The autosave should still resolve (even if the doc is now trashed),
  // and the trash should still resolve with the correct trashedIds.
  it('concurrent update and trash on same document both resolve', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => ({ id, updatedAt: new Date().toISOString() }),
    );
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'doc-1' }, trashedIds: ['doc-1', 'child-1'],
    });

    const [updateResult, trashResult] = await Promise.all([
      handlers.get('documents.update')!(null, { id: 'doc-1', content: editorJson('last save') }),
      handlers.get('documents.trash')!(null, { id: 'doc-1' }),
    ]);

    expect(updateResult).toHaveProperty('document');
    expect((trashResult as { trashedIds: string[] }).trashedIds).toContain('doc-1');
    expect(docs.updateDocument).toHaveBeenCalledTimes(1);
    expect(docs.trashDocument).toHaveBeenCalledTimes(1);
  });

  // Autosave fires for content while the user also changes the emoji.
  // Both are documents.update calls but with different fields.
  // They hit the same handler and the same repo function.
  it('concurrent content save and emoji save on same document', async () => {
    const calls: Array<{ field: string; value: unknown }> = [];
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: Record<string, unknown>) => {
        if ('content' in patch) calls.push({ field: 'content', value: patch.content });
        if ('emoji' in patch) calls.push({ field: 'emoji', value: patch.emoji });
        return { id, ...patch, updatedAt: new Date().toISOString() };
      },
    );

    await Promise.all([
      handlers.get('documents.update')!(null, { id: 'doc-1', content: editorJson('test') }),
      handlers.get('documents.update')!(null, { id: 'doc-1', emoji: '🎉' }),
    ]);

    expect(calls).toHaveLength(2);
    expect(calls.find(c => c.field === 'content')!.value).toBe(editorJson('test'));
    expect(calls.find(c => c.field === 'emoji')!.value).toBe('🎉');
  });

  // User pastes an image while an autosave is in flight.
  // images.save and documents.update are completely different channels
  // hitting different repos. They should never interfere.
  it('concurrent image save and document update on different channels', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'doc-1', content: 'saved', updatedAt: new Date().toISOString(),
    });
    (images.saveImage as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'img-new', filePath: 'img-new.png',
    });

    const [docResult, imgResult] = await Promise.all([
      handlers.get('documents.update')!(null, { id: 'doc-1', content: editorJson('saved') }),
      handlers.get('images.save')!(null, { data: 'base64data', mimeType: 'image/png' }),
    ]);

    expect((docResult as { document: { id: string } }).document.id).toBe('doc-1');
    expect((imgResult as { id: string }).id).toBe('img-new');
  });

  // Trash a document while simultaneously attempting to move it.
  // Both operations target the same document. In real SQLite, one would
  // succeed first and the other might fail (doc not found / already trashed).
  // The handler layer must not mix up the results.
  it('concurrent trash and move on same document are isolated', async () => {
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'doc-1' }, trashedIds: ['doc-1'],
    });
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'doc-1', parentId: 'p', sortOrder: 0,
    });

    const [trashResult, moveResult] = await Promise.all([
      handlers.get('documents.trash')!(null, { id: 'doc-1' }),
      handlers.get('documents.move')!(null, { id: 'doc-1', parentId: 'p', sortOrder: 0 }),
    ]);

    // Both resolve with their own results — no cross-contamination
    expect((trashResult as { trashedIds: string[] }).trashedIds).toEqual(['doc-1']);
    expect((moveResult as { document: { parentId: string } }).document.parentId).toBe('p');
  });

  // Trash one doc while updating a different doc concurrently.
  // Completely independent operations that happen to fire at the same time.
  it('trash doc-A while updating doc-B — no interference', async () => {
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'doc-A' }, trashedIds: ['doc-A'],
    });
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: { content?: string }) => ({
        id, content: patch.content, updatedAt: new Date().toISOString(),
      }),
    );

    const [trashResult, updateResult] = await Promise.all([
      handlers.get('documents.trash')!(null, { id: 'doc-A' }),
      handlers.get('documents.update')!(null, { id: 'doc-B', content: editorJson('still alive') }),
    ]);

    expect((trashResult as { trashedIds: string[] }).trashedIds).toContain('doc-A');
    expect((updateResult as { document: { content: string } }).document.content).toBe(editorJson('still alive'));
  });

  // One channel errors, the other succeeds. The error must not poison
  // the successful result or cause it to also reject.
  it('trash fails while concurrent move succeeds — errors isolated across channels', async () => {
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Document not found: ghost');
    });
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'doc-2', parentId: null, sortOrder: 0,
    });

    const results = await Promise.allSettled([
      handlers.get('documents.trash')!(null, { id: 'ghost' }),
      handlers.get('documents.move')!(null, { id: 'doc-2', parentId: null, sortOrder: 0 }),
    ]);

    expect(results[0].status).toBe('rejected');
    expect((results[0] as PromiseRejectedResult).reason.message).toBe('Document not found: ghost');
    expect(results[1].status).toBe('fulfilled');
    const moved = (results[1] as PromiseFulfilledResult<{ document: { id: string } }>).value;
    expect(moved.document.id).toBe('doc-2');
  });

  // Image download fails (network error) while document update succeeds.
  it('download fails while concurrent update succeeds — errors isolated', async () => {
    (images.downloadImage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('net::ERR_INTERNET_DISCONNECTED'),
    );
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'doc-1', content: 'saved', updatedAt: new Date().toISOString(),
    });

    const results = await Promise.allSettled([
      handlers.get('images.download')!(null, { url: 'https://broken.com/img.png' }),
      handlers.get('documents.update')!(null, { id: 'doc-1', content: editorJson('saved') }),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
  });

  // Ultimate stress: 6 different channels all firing simultaneously on
  // the same document, with 2 of them failing. Every result must be
  // correct — the right type for its channel, the right error for failures.
  it('6 channels on same doc, 2 fail — all results correct per channel', async () => {
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'doc-1', updatedAt: new Date().toISOString(),
    });
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Cannot move: circular reference');
    });
    (docs.trashDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'doc-1' }, trashedIds: ['doc-1'],
    });
    (images.saveImage as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'img-1', filePath: 'img-1.png',
    });
    (images.downloadImage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('HTTP 500'),
    );
    (urlResolver.resolveUrl as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: 'unsupported', url: 'https://example.com', reason: 'text/html',
    });

    const results = await Promise.allSettled([
      handlers.get('documents.update')!(null, { id: 'doc-1', content: editorJson('saved') }),
      handlers.get('documents.move')!(null, { id: 'doc-1', parentId: 'p', sortOrder: 0 }),
      handlers.get('documents.trash')!(null, { id: 'doc-1' }),
      handlers.get('images.save')!(null, { data: 'x', mimeType: 'image/png' }),
      handlers.get('images.download')!(null, { url: 'https://example.com/img.png' }),
      handlers.get('url.resolve')!(null, { url: 'https://example.com' }),
    ]);

    // update, trash, images.save, url.resolve succeed
    expect(results[0].status).toBe('fulfilled');
    expect(results[2].status).toBe('fulfilled');
    expect(results[3].status).toBe('fulfilled');
    expect(results[5].status).toBe('fulfilled');

    // move and download fail
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('Cannot move: circular reference');
    expect(results[4].status).toBe('rejected');
    expect((results[4] as PromiseRejectedResult).reason.message).toBe('HTTP 500');

    // Verify response shapes for successful ones
    expect((results[0] as PromiseFulfilledResult<unknown>).value).toHaveProperty('document');
    expect((results[2] as PromiseFulfilledResult<unknown>).value).toHaveProperty('trashedIds');
    expect((results[3] as PromiseFulfilledResult<unknown>).value).toHaveProperty('id');
    expect((results[5] as PromiseFulfilledResult<unknown>).value).toHaveProperty('type');
  });

  // Rapid sequence: create → immediately update → immediately move.
  // This is the exact flow when a user creates a note, types, and drags it.
  it('create → update → move rapid sequence on same doc', async () => {
    let createdId = '';
    (docs.createDocument as ReturnType<typeof vi.fn>).mockImplementation(() => {
      createdId = 'new-doc';
      return { id: createdId, title: '', content: '' };
    });
    (docs.updateDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, patch: { content?: string }) => ({
        id, content: patch.content, updatedAt: new Date().toISOString(),
      }),
    );
    (docs.moveDocument as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string, parentId: string | null, sortOrder: number) => ({
        id, parentId, sortOrder,
      }),
    );

    // Sequential because each depends on the previous
    const createResult = await handlers.get('documents.create')!(null, { parentId: null });
    const docId = (createResult as { document: { id: string } }).document.id;

    const updateResult = await handlers.get('documents.update')!(null, { id: docId, content: editorJson('first draft') });
    const moveResult = await handlers.get('documents.move')!(null, { id: docId, parentId: 'folder-1', sortOrder: 0 });

    expect(docId).toBe('new-doc');
    expect((updateResult as { document: { content: string } }).document.content).toBe(editorJson('first draft'));
    expect((moveResult as { document: { parentId: string } }).document.parentId).toBe('folder-1');
  });

  // permanentDelete while a restore is in flight for the same doc.
  // In practice this shouldn't happen (UI prevents it), but if two
  // windows are open on the trash view, both could act simultaneously.
  it('concurrent permanentDelete and restore on same document both resolve', async () => {
    (docs.permanentDeleteDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      deletedIds: ['doc-1'],
    });
    (docs.restoreDocument as ReturnType<typeof vi.fn>).mockReturnValue({
      document: { id: 'doc-1' }, restoredIds: ['doc-1'],
    });

    const [deleteResult, restoreResult] = await Promise.all([
      handlers.get('documents.permanentDelete')!(null, { id: 'doc-1' }),
      handlers.get('documents.restore')!(null, { id: 'doc-1' }),
    ]);

    expect((deleteResult as { deletedIds: string[] }).deletedIds).toContain('doc-1');
    expect((restoreResult as { restoredIds: string[] }).restoredIds).toContain('doc-1');
  });
});
