/**
 * Tests for real user flow scenarios: clipboard paste, URL image
 * download, notes with many images, and edge cases in real usage.
 *
 * These test the scenarios a real user encounters when using Lychee:
 * pasting images from clipboard, dropping URLs into the editor,
 * downloading images from the web. Each test asserts what SHOULD
 * happen from the user's perspective.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/lychee-test') },
  net: { fetch: vi.fn() },
}));
vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
import { getTestDb } from '../helpers';
vi.mock('../../db', () => ({
  getDb: () => getTestDb(),
}));

import {
  setupImageDb, getDb, fs, net,
  saveImage, getImagePath, downloadImage, deleteImage,
} from './setup';

describe('User Flow: Clipboard Paste', () => {
  setupImageDb();

  // User copies a screenshot and pastes it — browser sends it as a
  // data:image/png;base64,... URL. This is the most common image input path.
  it('screenshot paste: data URL with real PNG bytes is saved correctly', () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]); // PNG header + IHDR start
    const dataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`;

    const result = saveImage(dataUrl, 'image/png');

    expect(result.filePath).toMatch(/\.png$/);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    expect(getImagePath(result.id).filePath).toBe(result.filePath);
  });

  // User copies a JPEG photo from a website and pastes it.
  it('web photo paste: data URL with JPEG bytes is saved correctly', () => {
    const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10,
      0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]); // JPEG JFIF header
    const dataUrl = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;

    const result = saveImage(dataUrl, 'image/jpeg');

    expect(result.filePath).toMatch(/\.jpg$/);
    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written[0]).toBe(0xFF);
    expect(written[1]).toBe(0xD8);
  });

  // User copies an animated GIF (e.g., from Giphy) and pastes it.
  it('animated GIF paste: data URL with GIF89a bytes is saved correctly', () => {
    const gifBytes = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xFF\xFF\xFF\x00\x00\x00');
    const dataUrl = `data:image/gif;base64,${gifBytes.toString('base64')}`;

    const result = saveImage(dataUrl, 'image/gif');

    expect(result.filePath).toMatch(/\.gif$/);
    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString('ascii', 0, 6)).toBe('GIF89a');
  });

  // User pastes multiple images in rapid succession (e.g., pasting 5 screenshots).
  // Each should get its own unique entry in the DB.
  it('rapid multi-paste: 5 images pasted quickly all get unique IDs', () => {
    const results: { id: string; filePath: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, i]);
      results.push(saveImage(pngBytes.toString('base64'), 'image/png'));
    }

    const ids = new Set(results.map(r => r.id));
    expect(ids.size).toBe(5);

    // All retrievable
    for (const r of results) {
      expect(getImagePath(r.id).filePath).toBe(r.filePath);
    }
  });

  // User pastes a very large screenshot (e.g., 4K display, ~10MB).
  it('large screenshot paste: 10MB PNG data is saved without corruption', () => {
    const largeData = Buffer.alloc(10 * 1024 * 1024);
    // Write real PNG magic at the start
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(largeData);
    // Fill the rest with pattern data
    for (let i = 8; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }

    const result = saveImage(largeData.toString('base64'), 'image/png');

    expect(result.id).toBeDefined();
    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.length).toBe(10 * 1024 * 1024);
    expect(written[0]).toBe(0x89); // PNG magic preserved
    expect(written[7]).toBe(0x0A);
  });

  // User pastes an image, then deletes it, then pastes again.
  // The old image should be gone, the new one should work.
  it('paste → delete → re-paste: old image gone, new one saved', () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    const first = saveImage(pngBytes.toString('base64'), 'image/png');
    deleteImage(first.id);
    expect(() => getImagePath(first.id)).toThrow('Image not found');

    const second = saveImage(pngBytes.toString('base64'), 'image/png');
    expect(second.id).not.toBe(first.id);
    expect(getImagePath(second.id).filePath).toBe(second.filePath);
  });
});

describe('User Flow: URL Image Download', () => {
  setupImageDb();

  // User drops an image URL into the editor (e.g., right-click → copy image link).
  // The system downloads the image and stores it locally.
  it('URL drop: downloads PNG from web and stores locally', async () => {
    const db = getDb();
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://cdn.example.com/photos/sunset.png');

    expect(result.filePath).toMatch(/\.png$/);
    expect(getImagePath(result.id).filePath).toBe(result.filePath);
    const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(result.id) as { mimeType: string };
    expect(row.mimeType).toBe('image/png');
  });

  // User drops a GIF URL from a messaging app (Slack, Discord).
  it('GIF URL drop: downloads and stores as .gif', async () => {
    const db = getDb();
    const gifBytes = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00');
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(gifBytes.buffer.slice(gifBytes.byteOffset, gifBytes.byteOffset + gifBytes.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/gif') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://media.giphy.com/media/abc123/giphy.gif');

    expect(result.filePath).toMatch(/\.gif$/);
    const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(result.id) as { mimeType: string };
    expect(row.mimeType).toBe('image/gif');
  });

  // User drops a URL that requires authentication — CDN returns a login page
  // instead of the image. The download SHOULD fail, not save HTML as .png.
  // TODO: reject non-image content-types in downloadImage
  it.todo('auth-gated URL: server returns login page HTML — should fail gracefully');

  // User drops a URL to a file that no longer exists (404).
  it('broken URL: server returns 404 — throws HTTP error', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      headers: { get: vi.fn() },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/deleted-photo.png'))
      .rejects.toThrow('HTTP 404');
  });

  // User drops a URL that times out (slow/unreachable server).
  it('timeout URL: network error during download — propagates error', async () => {
    (net.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('net::ERR_CONNECTION_TIMED_OUT')
    );

    await expect(downloadImage('https://slow-server.example.com/huge-image.png'))
      .rejects.toThrow('net::ERR_CONNECTION_TIMED_OUT');
  });

  // User drops multiple image URLs at once (batch download).
  // Each should be independently downloaded and stored.
  it('batch URL drop: 3 sequential downloads all stored independently', async () => {
    const urls = [
      { url: 'https://example.com/a.png', ct: 'image/png' },
      { url: 'https://example.com/b.jpg', ct: 'image/jpeg' },
      { url: 'https://example.com/c.gif', ct: 'image/gif' },
    ];

    const results: { id: string; filePath: string }[] = [];
    for (const { url, ct } of urls) {
      (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        headers: { get: vi.fn().mockReturnValue(ct) },
      });
      results.push(await downloadImage(url));
    }

    expect(results[0].filePath).toMatch(/\.png$/);
    expect(results[1].filePath).toMatch(/\.jpg$/);
    expect(results[2].filePath).toMatch(/\.gif$/);

    // All retrievable
    for (const r of results) {
      expect(getImagePath(r.id).filePath).toBe(r.filePath);
    }
  });

  // After downloading an image, user deletes it from the note.
  // The image should be cleanly removed from both DB and disk.
  it('download → delete: image is fully cleaned up', async () => {
    const db = getDb();
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const downloaded = await downloadImage('https://example.com/photo.png');
    expect(getImagePath(downloaded.id).filePath).toBe(downloaded.filePath);

    deleteImage(downloaded.id);

    expect(() => getImagePath(downloaded.id)).toThrow('Image not found');
    expect(fs.unlinkSync).toHaveBeenCalled();
    const count = db.prepare(`SELECT COUNT(*) as c FROM images WHERE id = ?`).all(downloaded.id);
    expect(count).toHaveLength(1);
    expect((count[0] as { c: number }).c).toBe(0);
  });
});

describe('User Flow: Note with Many Images', () => {
  setupImageDb();

  // User creates a note with many embedded images (e.g., a photo album note).
  // All images should be individually stored and retrievable.
  it('album note: 30 images of mixed types all stored and retrievable', () => {
    const db = getDb();
    const mimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const images: { id: string; filePath: string; mime: string }[] = [];

    for (let i = 0; i < 30; i++) {
      const mime = mimeTypes[i % 4];
      const result = saveImage(
        Buffer.from(`image content ${i}`).toString('base64'),
        mime,
      );
      images.push({ ...result, mime });
    }

    // All 30 stored
    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(30);

    // All individually retrievable with correct extension
    const extMap: Record<string, string> = {
      'image/png': '.png', 'image/jpeg': '.jpg',
      'image/gif': '.gif', 'image/webp': '.webp',
    };
    for (const img of images) {
      expect(getImagePath(img.id).filePath).toBe(img.filePath);
      expect(img.filePath.endsWith(extMap[img.mime])).toBe(true);
    }
  });

  // User deletes a note — all images in that note should be deletable.
  // In the real app, the IPC handler would call deleteImage for each image
  // in the note's content. This tests that batch deletion works.
  it('note deletion: all 20 images from a note can be batch deleted', () => {
    const db = getDb();
    const images = Array.from({ length: 20 }, (_, i) =>
      saveImage(Buffer.from(`note img ${i}`).toString('base64'), 'image/png'),
    );

    // Simulate note deletion cleaning up all images
    for (const img of images) {
      deleteImage(img.id);
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(0);

    // All throw
    for (const img of images) {
      expect(() => getImagePath(img.id)).toThrow('Image not found');
    }
  });

  // User has images spread across multiple notes.
  // Deleting images from one note should not affect images in other notes.
  it('multi-note isolation: deleting images from note A does not affect note B', () => {
    const db = getDb();
    // Note A images
    const noteA = Array.from({ length: 5 }, (_, i) =>
      saveImage(Buffer.from(`noteA img ${i}`).toString('base64'), 'image/png'),
    );

    // Note B images
    const noteB = Array.from({ length: 5 }, (_, i) =>
      saveImage(Buffer.from(`noteB img ${i}`).toString('base64'), 'image/jpeg'),
    );

    // Delete all Note A images
    for (const img of noteA) {
      deleteImage(img.id);
    }

    // Note B images should be untouched
    for (const img of noteB) {
      expect(getImagePath(img.id).filePath).toBe(img.filePath);
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(5);
  });
});

describe('User Flow: Edge Cases in Real Usage', () => {
  setupImageDb();

  // User pastes an image, then the app crashes before saving the note.
  // On restart, the image is in the DB but may not be referenced by any note.
  // The image should still be retrievable by ID (orphan cleanup is a separate concern).
  it('orphaned image is still retrievable by ID', () => {
    const saved = saveImage(
      Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString('base64'),
      'image/png',
    );

    // Image exists in DB even though no note references it
    expect(getImagePath(saved.id).filePath).toBe(saved.filePath);
  });

  // User undoes an image paste — the image was already saved to DB.
  // The undo should trigger a delete to clean up the unused image.
  it('undo after paste: deleting the just-saved image cleans up properly', () => {
    const db = getDb();
    const saved = saveImage(
      Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString('base64'),
      'image/png',
    );

    // Simulating undo: delete the image that was just pasted
    deleteImage(saved.id);

    expect(() => getImagePath(saved.id)).toThrow('Image not found');
    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(0);
  });

  // User replaces one image with another in the same position.
  // The old image should be deletable, and the new one should work.
  it('image replacement: delete old image and save new one', () => {
    const db = getDb();
    const oldImg = saveImage(
      Buffer.from([0xFF, 0xD8, 0xFF]).toString('base64'),
      'image/jpeg',
    );
    deleteImage(oldImg.id);

    const newImg = saveImage(
      Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString('base64'),
      'image/png',
    );

    expect(() => getImagePath(oldImg.id)).toThrow();
    expect(getImagePath(newImg.id).filePath).toBe(newImg.filePath);

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  // User pastes the same image content multiple times (e.g., copy-paste the same screenshot).
  // Each paste SHOULD create a separate DB entry (no deduplication) because each
  // image node in the editor is independent.
  it('duplicate content paste: each paste creates a separate DB entry', () => {
    const sameContent = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).toString('base64');

    const img1 = saveImage(sameContent, 'image/png');
    const img2 = saveImage(sameContent, 'image/png');
    const img3 = saveImage(sameContent, 'image/png');

    expect(img1.id).not.toBe(img2.id);
    expect(img2.id).not.toBe(img3.id);

    // Deleting one doesn't affect the others
    deleteImage(img2.id);
    expect(getImagePath(img1.id).filePath).toBe(img1.filePath);
    expect(getImagePath(img3.id).filePath).toBe(img3.filePath);
    expect(() => getImagePath(img2.id)).toThrow();
  });

  // User pastes images of different formats in the same note.
  // The DB and filesystem should handle mixed formats correctly.
  it('mixed format note: PNG, JPEG, GIF, and WebP in the same note', () => {
    const db = getDb();
    const png = saveImage(Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString('base64'), 'image/png');
    const jpg = saveImage(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]).toString('base64'), 'image/jpeg');
    const gif = saveImage(Buffer.from('GIF89a').toString('base64'), 'image/gif');
    const webp = saveImage(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]).toString('base64'), 'image/webp');

    // All stored with correct extensions
    expect(png.filePath).toMatch(/\.png$/);
    expect(jpg.filePath).toMatch(/\.jpg$/);
    expect(gif.filePath).toMatch(/\.gif$/);
    expect(webp.filePath).toMatch(/\.webp$/);

    // All retrievable
    expect(getImagePath(png.id).filePath).toBe(png.filePath);
    expect(getImagePath(jpg.id).filePath).toBe(jpg.filePath);
    expect(getImagePath(gif.id).filePath).toBe(gif.filePath);
    expect(getImagePath(webp.id).filePath).toBe(webp.filePath);

    // DB has correct MIME types
    for (const [img, mime] of [[png, 'image/png'], [jpg, 'image/jpeg'], [gif, 'image/gif'], [webp, 'image/webp']] as const) {
      const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(img.id) as { mimeType: string };
      expect(row.mimeType).toBe(mime);
    }
  });

  // User has the same image downloaded via URL AND pasted from clipboard.
  // Both should coexist in the DB as separate entries.
  it('same image from URL and clipboard: both entries coexist', async () => {
    const db = getDb();
    // Clipboard paste
    const pasted = saveImage(
      Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString('base64'),
      'image/png',
    );

    // URL download
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
    const downloaded = await downloadImage('https://example.com/same-photo.png');

    // Both exist
    expect(pasted.id).not.toBe(downloaded.id);
    expect(getImagePath(pasted.id).filePath).toBe(pasted.filePath);
    expect(getImagePath(downloaded.id).filePath).toBe(downloaded.filePath);

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(2);
  });
});
