/**
 * Tests for image CRUD operations: saveImage, getImagePath, deleteImage.
 *
 * These are the core synchronous operations — base64 parsing, MIME mapping,
 * DB insertion, filesystem writes, and deletion with cleanup.
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
  setupImageDb, getDb, fs,
  saveImage, getImagePath, deleteImage,
} from './setup';

describe('Image CRUD', () => {
  setupImageDb();

  // ────────────────────────────────────────────────────────
  // saveImage
  // ────────────────────────────────────────────────────────

  describe('saveImage', () => {
    // Raw base64 without a data URL prefix — the simplest case.
    // If the code incorrectly tries to split on comma, it would
    // lose the first part of the base64 string.
    it('saves raw base64 data (no data URL prefix)', () => {
      const base64 = Buffer.from('fake png data').toString('base64');

      const result = saveImage(base64, 'image/png');

      expect(result.id).toBeDefined();
      expect(result.filePath).toMatch(/\.png$/);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

      // Verify the buffer passed to writeFileSync is the decoded base64
      const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as Buffer;
      expect(writtenBuffer.toString()).toBe('fake png data');
    });

    // Data URLs include a prefix like "data:image/png;base64,".
    // The code splits on comma and takes [1]. If this logic breaks,
    // the saved image would be corrupted.
    it('strips data URL prefix correctly', () => {
      const rawBase64 = Buffer.from('fake png data').toString('base64');
      const dataUrl = `data:image/png;base64,${rawBase64}`;

      const result = saveImage(dataUrl, 'image/png');

      const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as Buffer;
      expect(writtenBuffer.toString()).toBe('fake png data');
      expect(result.filePath).toMatch(/\.png$/);
    });

    // The return value is the filename (e.g. "uuid.png"), NOT the full path.
    // The lychee-image:// protocol handler needs just the filename to serve files.
    it('returns filename (not full path)', () => {
      const result = saveImage(
        Buffer.from('data').toString('base64'),
        'image/png',
      );
      expect(result.filePath).not.toContain('/');
      expect(result.filePath).toMatch(/^[0-9a-f-]+\.png$/);
    });

    // SVG and other unsupported types should be rejected.
    // Without this check, the app could try to serve a file with no extension.
    it('throws on unsupported MIME type', () => {
      expect(() =>
        saveImage(Buffer.from('data').toString('base64'), 'image/svg+xml'),
      ).toThrow('Unsupported image type: image/svg+xml');
    });

    // "image/jpeg" → "jpg" (not "jpeg"). This is a common gotcha.
    it('maps image/jpeg to .jpg extension', () => {
      const result = saveImage(
        Buffer.from('data').toString('base64'),
        'image/jpeg',
      );
      expect(result.filePath).toMatch(/\.jpg$/);
    });

    // Verify all 4 supported MIME types produce correct extensions.
    it('maps all supported MIME types to correct extensions', () => {
      const types: [string, string][] = [
        ['image/png', '.png'],
        ['image/jpeg', '.jpg'],
        ['image/gif', '.gif'],
        ['image/webp', '.webp'],
      ];

      for (const [mime, ext] of types) {
        const result = saveImage(
          Buffer.from('data').toString('base64'),
          mime,
        );
        expect(result.filePath).toMatch(new RegExp(`\\${ext}$`));
      }
    });

    // Verify the image is inserted into the DB with correct metadata.
    it('inserts image record into database', () => {
      const db = getDb();
      const result = saveImage(
        Buffer.from('data').toString('base64'),
        'image/png',
      );

      const row = db
        .prepare(`SELECT * FROM images WHERE id = ?`)
        .get(result.id) as { id: string; filename: string; mimeType: string };
      expect(row).toBeDefined();
      expect(row.filename).toBe(result.filePath);
      expect(row.mimeType).toBe('image/png');
    });

    // Data URL with JPEG MIME — the prefix says "image/jpeg" not "image/png".
    // Code should still parse correctly regardless of the prefix MIME.
    it('strips data URL prefix with jpeg MIME type', () => {
      const rawBase64 = Buffer.from('jpeg data').toString('base64');
      const dataUrl = `data:image/jpeg;base64,${rawBase64}`;

      const result = saveImage(dataUrl, 'image/jpeg');

      const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as Buffer;
      expect(writtenBuffer.toString()).toBe('jpeg data');
      expect(result.filePath).toMatch(/\.jpg$/);
    });

    // Data URL where the MIME in the prefix doesn't match the mimeType argument.
    // The code ignores the prefix MIME and uses the argument — this is intentional
    // because the caller knows the true type.
    it('uses mimeType argument regardless of data URL prefix MIME', () => {
      const db = getDb();
      const rawBase64 = Buffer.from('actually a gif').toString('base64');
      // prefix says png, but caller says gif
      const dataUrl = `data:image/png;base64,${rawBase64}`;

      const result = saveImage(dataUrl, 'image/gif');

      expect(result.filePath).toMatch(/\.gif$/);
      const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(result.id) as { mimeType: string };
      expect(row.mimeType).toBe('image/gif');
    });

    // Empty base64 string results in a zero-byte file. A zero-byte file is
    // never a valid image — it can't be rendered and indicates a broken upload.
    // The system SHOULD reject this rather than creating an unrenderable file.
    // TODO: implement zero-byte rejection in saveImage
    it.todo('should reject empty base64 data (zero-byte image is never valid)');

    // Large payload — simulate a 1MB image to verify no truncation or crash.
    it('saves a large base64 payload without truncation', () => {
      const largeData = Buffer.alloc(1024 * 1024, 0xAB); // 1MB of 0xAB bytes
      const base64 = largeData.toString('base64');

      const result = saveImage(base64, 'image/png');

      const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as Buffer;
      expect(writtenBuffer.length).toBe(1024 * 1024);
      // Verify first and last bytes are preserved
      expect(writtenBuffer[0]).toBe(0xAB);
      expect(writtenBuffer[writtenBuffer.length - 1]).toBe(0xAB);
      expect(result.id).toBeDefined();
    });

    // Each call should produce a unique ID — two saves of identical data
    // should result in two separate DB records.
    it('generates unique IDs for identical data', () => {
      const db = getDb();
      const base64 = Buffer.from('same data').toString('base64');
      const r1 = saveImage(base64, 'image/png');
      const r2 = saveImage(base64, 'image/png');

      expect(r1.id).not.toBe(r2.id);
      expect(r1.filePath).not.toBe(r2.filePath);

      // Both should exist in DB
      const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
      expect(count.c).toBe(2);
    });

    // Verify createdAt is set to a valid ISO timestamp.
    it('sets createdAt to a valid ISO timestamp', () => {
      const db = getDb();
      const result = saveImage(Buffer.from('data').toString('base64'), 'image/png');

      const row = db.prepare(`SELECT createdAt FROM images WHERE id = ?`).get(result.id) as { createdAt: string };
      // Should be a valid ISO string (parseable by Date)
      const parsed = new Date(row.createdAt);
      expect(parsed.getTime()).not.toBeNaN();
      // Should be recent (within the last minute)
      expect(Date.now() - parsed.getTime()).toBeLessThan(60_000);
    });

    // Various unsupported MIME types — application/pdf, text/plain, image/tiff, etc.
    // All should throw with the MIME type in the error message.
    it('rejects various unsupported MIME types with descriptive errors', () => {
      const unsupported = [
        'image/svg+xml',
        'image/tiff',
        'image/bmp',
        'image/x-icon',
        'application/pdf',
        'text/plain',
        'video/mp4',
        '',
      ];

      for (const mime of unsupported) {
        expect(
          () => saveImage(Buffer.from('data').toString('base64'), mime),
          `Expected ${mime} to be rejected`,
        ).toThrow(`Unsupported image type: ${mime}`);
      }
    });

    // Data URL with additional commas in the base64 portion.
    // Base64 never contains commas, but data:...;base64, splits on first comma.
    // data.split(',')[1] takes everything after the FIRST comma, which is correct.
    it('handles data URL correctly (split only on first comma)', () => {
      const rawBase64 = Buffer.from('test payload').toString('base64');
      const dataUrl = `data:image/png;base64,${rawBase64}`;

      saveImage(dataUrl, 'image/png');

      const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as Buffer;
      expect(writtenBuffer.toString()).toBe('test payload');
    });

    // Binary data with null bytes — images are binary, so this must work.
    it('preserves binary data with null bytes', () => {
      const binaryData = Buffer.from([0x00, 0xFF, 0x00, 0xAB, 0x00]);
      const base64 = binaryData.toString('base64');

      saveImage(base64, 'image/png');

      const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as Buffer;
      expect(Buffer.compare(writtenBuffer, binaryData)).toBe(0);
    });

    // mkdirSync is called with { recursive: true } to create the images directory.
    // If this fails, all saves would fail.
    it('creates images directory via mkdirSync with recursive flag', () => {
      saveImage(Buffer.from('data').toString('base64'), 'image/png');

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('images'),
        { recursive: true },
      );
    });

    // writeFileSync is called with the correct full path (not just filename).
    it('writes to the correct full path under images directory', () => {
      const result = saveImage(Buffer.from('data').toString('base64'), 'image/png');

      const writePath = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // Should contain /tmp/lychee-test/images/ prefix
      expect(writePath).toContain('/tmp/lychee-test/images/');
      // Should end with the filename
      expect(writePath).toMatch(new RegExp(`${result.filePath}$`));
    });

    // width and height are null in the DB since saveImage doesn't extract dimensions.
    it('stores null for width and height (dimensions not extracted by saveImage)', () => {
      const db = getDb();
      const result = saveImage(Buffer.from('data').toString('base64'), 'image/png');

      const row = db.prepare(`SELECT width, height FROM images WHERE id = ?`).get(result.id) as { width: number | null; height: number | null };
      expect(row.width).toBeNull();
      expect(row.height).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────
  // getImagePath
  // ────────────────────────────────────────────────────────

  describe('getImagePath', () => {
    // Standard retrieval — the most common operation when rendering images.
    it('returns filename for existing image', () => {
      const saved = saveImage(
        Buffer.from('data').toString('base64'),
        'image/png',
      );

      const result = getImagePath(saved.id);
      expect(result.filePath).toBe(saved.filePath);
    });

    // Missing image should throw with the ID in the message so developers
    // can trace which image reference is broken.
    it('throws with ID in message for non-existent image', () => {
      expect(() => getImagePath('missing-id-123')).toThrow(
        'Image not found: missing-id-123',
      );
    });

    // Empty string ID — should throw, not return some random row.
    it('throws for empty string ID', () => {
      expect(() => getImagePath('')).toThrow('Image not found: ');
    });

    // After saving multiple images, getImagePath should return the correct one
    // for each — no cross-contamination between image records.
    it('returns correct filename when multiple images exist', () => {
      const saved1 = saveImage(Buffer.from('img1').toString('base64'), 'image/png');
      const saved2 = saveImage(Buffer.from('img2').toString('base64'), 'image/jpeg');
      const saved3 = saveImage(Buffer.from('img3').toString('base64'), 'image/gif');

      expect(getImagePath(saved1.id).filePath).toBe(saved1.filePath);
      expect(getImagePath(saved2.id).filePath).toBe(saved2.filePath);
      expect(getImagePath(saved3.id).filePath).toBe(saved3.filePath);
    });

    // Verify the returned filePath includes the correct extension matching the MIME type.
    it('returned filePath extension matches the saved MIME type', () => {
      const png = saveImage(Buffer.from('d').toString('base64'), 'image/png');
      const jpg = saveImage(Buffer.from('d').toString('base64'), 'image/jpeg');
      const gif = saveImage(Buffer.from('d').toString('base64'), 'image/gif');
      const webp = saveImage(Buffer.from('d').toString('base64'), 'image/webp');

      expect(getImagePath(png.id).filePath).toMatch(/\.png$/);
      expect(getImagePath(jpg.id).filePath).toMatch(/\.jpg$/);
      expect(getImagePath(gif.id).filePath).toMatch(/\.gif$/);
      expect(getImagePath(webp.id).filePath).toMatch(/\.webp$/);
    });

    // Calling getImagePath multiple times on the same ID should be idempotent.
    it('is idempotent — repeated calls return the same result', () => {
      const saved = saveImage(Buffer.from('data').toString('base64'), 'image/png');

      const r1 = getImagePath(saved.id);
      const r2 = getImagePath(saved.id);
      const r3 = getImagePath(saved.id);

      expect(r1.filePath).toBe(r2.filePath);
      expect(r2.filePath).toBe(r3.filePath);
    });
  });

  // ────────────────────────────────────────────────────────
  // deleteImage
  // ────────────────────────────────────────────────────────

  describe('deleteImage', () => {
    // Normal flow: file exists on disk and in DB, both get removed.
    it('deletes file and DB record', () => {
      const db = getDb();
      const saved = saveImage(
        Buffer.from('data').toString('base64'),
        'image/png',
      );

      deleteImage(saved.id);

      // DB record should be gone
      const row = db
        .prepare(`SELECT * FROM images WHERE id = ?`)
        .get(saved.id);
      expect(row).toBeUndefined();

      // fs.unlinkSync should have been called
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    // If the file was already deleted from disk (e.g., user manually removed it),
    // the DB record should still be cleaned up without throwing.
    it('handles missing file gracefully (still deletes DB record)', () => {
      const db = getDb();
      const saved = saveImage(
        Buffer.from('data').toString('base64'),
        'image/png',
      );

      // Simulate file already gone
      (fs.unlinkSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      expect(() => deleteImage(saved.id)).not.toThrow();

      // DB record should still be removed
      const row = db
        .prepare(`SELECT * FROM images WHERE id = ?`)
        .get(saved.id);
      expect(row).toBeUndefined();
    });

    // Deleting a non-existent image should be a silent no-op.
    // This handles race conditions where the same delete request arrives twice.
    it('silently returns for non-existent image', () => {
      expect(() => deleteImage('nonexistent')).not.toThrow();
    });

    // Double delete: deleting the same image twice should not throw.
    // First delete removes the record; second delete is a no-op.
    it('double delete is safe (second call is a no-op)', () => {
      const saved = saveImage(Buffer.from('data').toString('base64'), 'image/png');

      deleteImage(saved.id);
      expect(() => deleteImage(saved.id)).not.toThrow();

      // fs.unlinkSync should only be called once (first delete)
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    });

    // Deleting one image should not affect other images in the DB.
    it('only deletes the specified image, not others', () => {
      const db = getDb();
      const img1 = saveImage(Buffer.from('img1').toString('base64'), 'image/png');
      const img2 = saveImage(Buffer.from('img2').toString('base64'), 'image/jpeg');
      const img3 = saveImage(Buffer.from('img3').toString('base64'), 'image/gif');

      deleteImage(img2.id);

      // img1 and img3 should still exist
      expect(getImagePath(img1.id).filePath).toBe(img1.filePath);
      expect(getImagePath(img3.id).filePath).toBe(img3.filePath);

      // img2 should be gone
      expect(() => getImagePath(img2.id)).toThrow('Image not found');

      const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
      expect(count.c).toBe(2);
    });

    // unlinkSync is called with the correct full path based on the stored filename.
    it('calls unlinkSync with correct full path', () => {
      const saved = saveImage(Buffer.from('data').toString('base64'), 'image/png');

      deleteImage(saved.id);

      const unlinkPath = (fs.unlinkSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(unlinkPath).toContain('/tmp/lychee-test/images/');
      expect(unlinkPath).toMatch(new RegExp(`${saved.filePath}$`));
    });

    // EACCES (permission denied) error on unlink — DB record should still be deleted.
    // The code catches ALL errors from unlinkSync, not just ENOENT.
    it('handles EACCES error on unlink gracefully', () => {
      const db = getDb();
      const saved = saveImage(Buffer.from('data').toString('base64'), 'image/png');

      (fs.unlinkSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => deleteImage(saved.id)).not.toThrow();

      // DB record should still be removed even though file deletion failed
      const row = db.prepare(`SELECT * FROM images WHERE id = ?`).get(saved.id);
      expect(row).toBeUndefined();
    });

    // Deleting with empty string ID — should be a no-op (no row matches).
    it('empty string ID is a no-op', () => {
      const db = getDb();
      saveImage(Buffer.from('data').toString('base64'), 'image/png');

      expect(() => deleteImage('')).not.toThrow();

      // Original image should still exist
      const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
      expect(count.c).toBe(1);
    });
  });
});
