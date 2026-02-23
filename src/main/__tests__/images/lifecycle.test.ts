/**
 * Tests for image round-trip lifecycle, bulk & stress operations,
 * DB consistency checks, concurrent download simulation, and
 * data integrity edge cases.
 *
 * Covers the full save->get->delete flow, bulk operations, schema
 * constraints, race conditions, and binary data preservation.
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

describe('Round-trip Lifecycle', () => {
  setupImageDb();

  // save -> get -> delete -> get should work end-to-end.
  it('save then get returns matching filename', () => {
    const saved = saveImage(
      Buffer.from('test data').toString('base64'),
      'image/png',
    );
    const got = getImagePath(saved.id);
    expect(got.filePath).toBe(saved.filePath);
  });

  // After delete, get should throw — the image is gone.
  it('save then delete then get throws', () => {
    const saved = saveImage(
      Buffer.from('test data').toString('base64'),
      'image/png',
    );
    deleteImage(saved.id);
    expect(() => getImagePath(saved.id)).toThrow('Image not found');
  });

  // Full lifecycle for each MIME type — save, retrieve, delete, verify gone.
  it('full lifecycle works for all 4 MIME types', () => {
    const types = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    for (const mime of types) {
      const saved = saveImage(Buffer.from(`${mime} data`).toString('base64'), mime);
      const got = getImagePath(saved.id);
      expect(got.filePath).toBe(saved.filePath);

      deleteImage(saved.id);
      expect(() => getImagePath(saved.id)).toThrow('Image not found');
    }
  });

  // download -> get -> delete -> get lifecycle.
  it('download then get then delete then get throws', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/webp') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const downloaded = await downloadImage('https://example.com/photo.webp');
    const got = getImagePath(downloaded.id);
    expect(got.filePath).toBe(downloaded.filePath);

    deleteImage(downloaded.id);
    expect(() => getImagePath(downloaded.id)).toThrow('Image not found');
  });

  // Save multiple, delete one, verify the rest are unaffected.
  it('deleting one image does not affect others in a batch', () => {
    const images = Array.from({ length: 5 }, (_, i) =>
      saveImage(Buffer.from(`image ${i}`).toString('base64'), 'image/png'),
    );

    // Delete the middle one
    deleteImage(images[2].id);

    // Others should still be accessible
    for (let i = 0; i < 5; i++) {
      if (i === 2) {
        expect(() => getImagePath(images[i].id)).toThrow('Image not found');
      } else {
        expect(getImagePath(images[i].id).filePath).toBe(images[i].filePath);
      }
    }
  });

  // Interleaved save and delete — simulates a user pasting images and
  // removing them rapidly. DB state should stay consistent.
  it('interleaved save and delete maintains DB consistency', () => {
    const db = getDb();
    const a = saveImage(Buffer.from('a').toString('base64'), 'image/png');
    const b = saveImage(Buffer.from('b').toString('base64'), 'image/jpeg');
    deleteImage(a.id);
    const c = saveImage(Buffer.from('c').toString('base64'), 'image/gif');
    deleteImage(b.id);
    const d = saveImage(Buffer.from('d').toString('base64'), 'image/webp');

    // Only c and d should remain
    expect(() => getImagePath(a.id)).toThrow();
    expect(() => getImagePath(b.id)).toThrow();
    expect(getImagePath(c.id).filePath).toBe(c.filePath);
    expect(getImagePath(d.id).filePath).toBe(d.filePath);

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(2);
  });
});

describe('Bulk & Stress Tests', () => {
  setupImageDb();

  // Save 100 images and verify all are retrievable with unique IDs.
  // This simulates a note with many pasted images.
  it('saves 100 images with unique IDs and all are retrievable', () => {
    const db = getDb();
    const images: { id: string; filePath: string }[] = [];

    for (let i = 0; i < 100; i++) {
      const result = saveImage(
        Buffer.from(`image data ${i}`).toString('base64'),
        'image/png',
      );
      images.push(result);
    }

    // Verify all unique IDs
    const ids = new Set(images.map((img) => img.id));
    expect(ids.size).toBe(100);

    // Verify all filenames are unique
    const filenames = new Set(images.map((img) => img.filePath));
    expect(filenames.size).toBe(100);

    // Verify all are retrievable
    for (const img of images) {
      expect(getImagePath(img.id).filePath).toBe(img.filePath);
    }

    // Verify DB count
    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(100);
  });

  // Save 50 images, then delete all of them. DB should be empty.
  it('save 50 then delete all — DB is clean', () => {
    const db = getDb();
    const images = Array.from({ length: 50 }, (_, i) =>
      saveImage(Buffer.from(`img ${i}`).toString('base64'), 'image/png'),
    );

    for (const img of images) {
      deleteImage(img.id);
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(0);

    // All should throw
    for (const img of images) {
      expect(() => getImagePath(img.id)).toThrow('Image not found');
    }
  });

  // Save-and-delete churn: create and immediately delete 50 images.
  // DB should be empty at the end.
  it('rapid save-and-delete churn (50 cycles) leaves clean DB', () => {
    const db = getDb();
    for (let i = 0; i < 50; i++) {
      const result = saveImage(
        Buffer.from(`churn ${i}`).toString('base64'),
        'image/png',
      );
      deleteImage(result.id);
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(0);
  });

  // Mixed MIME types in bulk — save 25 of each type (100 total).
  // Verify each has the correct extension in the DB.
  it('100 images across 4 MIME types all have correct extensions', () => {
    const db = getDb();
    const types = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
    };

    const images: { id: string; filePath: string; mime: string }[] = [];

    for (let i = 0; i < 100; i++) {
      const mime = types[i % 4];
      const result = saveImage(
        Buffer.from(`data ${i}`).toString('base64'),
        mime,
      );
      images.push({ ...result, mime });
    }

    for (const img of images) {
      const ext = extMap[img.mime];
      expect(img.filePath).toMatch(new RegExp(`\\${ext}$`));

      // Verify DB mimeType matches
      const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(img.id) as { mimeType: string };
      expect(row.mimeType).toBe(img.mime);
    }
  });

  // Delete every other image from a batch of 100 — verify only 50 remain
  // and each remaining one is the correct record.
  it('delete every other image from 100 — exactly 50 remain', () => {
    const db = getDb();
    const images = Array.from({ length: 100 }, (_, i) =>
      saveImage(Buffer.from(`img ${i}`).toString('base64'), 'image/png'),
    );

    // Delete even-indexed images
    for (let i = 0; i < 100; i += 2) {
      deleteImage(images[i].id);
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(50);

    // Verify correct images remain
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        expect(() => getImagePath(images[i].id)).toThrow('Image not found');
      } else {
        expect(getImagePath(images[i].id).filePath).toBe(images[i].filePath);
      }
    }
  });

  // Reverse-order delete: save 50 images, delete them from last to first.
  // This tests that the deletion order doesn't matter.
  it('reverse-order delete works correctly', () => {
    const db = getDb();
    const images = Array.from({ length: 50 }, (_, i) =>
      saveImage(Buffer.from(`rev ${i}`).toString('base64'), 'image/png'),
    );

    for (let i = images.length - 1; i >= 0; i--) {
      deleteImage(images[i].id);

      // All remaining should still be accessible
      for (let j = 0; j < i; j++) {
        expect(getImagePath(images[j].id).filePath).toBe(images[j].filePath);
      }
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(0);
  });

  // Multiple downloads in sequence — verify each gets its own DB record.
  it('10 sequential downloads each get unique DB records', async () => {
    const db = getDb();
    const results: { id: string; filePath: string }[] = [];

    for (let i = 0; i < 10; i++) {
      const mockResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(i + 1)),
        headers: { get: vi.fn().mockReturnValue('image/png') },
      };
      (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await downloadImage(`https://example.com/img${i}.png`);
      results.push(result);
    }

    // All unique
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(10);

    // All retrievable
    for (const r of results) {
      expect(getImagePath(r.id).filePath).toBe(r.filePath);
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(10);
  });

  // Mix of save and download — verify they coexist in the same DB table.
  it('saved and downloaded images coexist in DB', async () => {
    const db = getDb();
    // Save 5
    const saved = Array.from({ length: 5 }, (_, i) =>
      saveImage(Buffer.from(`saved ${i}`).toString('base64'), 'image/png'),
    );

    // Download 5
    const downloaded: { id: string; filePath: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const mockResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
        headers: { get: vi.fn().mockReturnValue('image/jpeg') },
      };
      (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
      downloaded.push(await downloadImage(`https://example.com/dl${i}.jpg`));
    }

    // All 10 should be in the DB
    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(10);

    // Verify MIME types are preserved
    for (const s of saved) {
      const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(s.id) as { mimeType: string };
      expect(row.mimeType).toBe('image/png');
    }
    for (const d of downloaded) {
      const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(d.id) as { mimeType: string };
      expect(row.mimeType).toBe('image/jpeg');
    }
  });

  // Bulk save with varying payload sizes — 0 bytes to 100KB.
  // Verifies no size-dependent issues.
  it('saves images of varying sizes (0B to 100KB) without issues', () => {
    const sizes = [0, 1, 100, 1024, 10240, 102400]; // 0B, 1B, 100B, 1KB, 10KB, 100KB

    for (const size of sizes) {
      const data = Buffer.alloc(size, 0xAB);
      const result = saveImage(data.toString('base64'), 'image/png');
      expect(result.id).toBeDefined();

      const writeCalls = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls;
      const lastWrite = writeCalls[writeCalls.length - 1][1] as Buffer;
      expect(lastWrite.length).toBe(size);
    }
  });

  // writeFileSync call count should match the number of saves exactly.
  it('writeFileSync called exactly once per save', () => {
    for (let i = 0; i < 20; i++) {
      saveImage(Buffer.from(`img ${i}`).toString('base64'), 'image/png');
    }

    expect(fs.writeFileSync).toHaveBeenCalledTimes(20);
  });

  // unlinkSync call count matches only successful deletes (not no-ops).
  it('unlinkSync called once per existing image delete, not for no-ops', () => {
    const images = Array.from({ length: 10 }, (_, i) =>
      saveImage(Buffer.from(`img ${i}`).toString('base64'), 'image/png'),
    );

    // Delete 5 real images + 5 nonexistent IDs
    for (let i = 0; i < 5; i++) {
      deleteImage(images[i].id);
    }
    for (let i = 0; i < 5; i++) {
      deleteImage(`fake-id-${i}`);
    }

    // Only the 5 real deletes should call unlinkSync
    expect(fs.unlinkSync).toHaveBeenCalledTimes(5);
  });
});

describe('DB Consistency', () => {
  setupImageDb();

  // Verify the images table schema has all expected columns.
  it('images table has all expected columns', () => {
    const db = getDb();
    const columns = db
      .prepare(`PRAGMA table_info(images)`)
      .all() as { name: string; type: string }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('filename');
    expect(colNames).toContain('mimeType');
    expect(colNames).toContain('width');
    expect(colNames).toContain('height');
    expect(colNames).toContain('createdAt');
    expect(colNames).toHaveLength(6);
  });

  // Verify that id is the primary key.
  it('id is the primary key', () => {
    const db = getDb();
    const columns = db
      .prepare(`PRAGMA table_info(images)`)
      .all() as { name: string; pk: number }[];
    const pkCol = columns.find((c) => c.pk === 1);
    expect(pkCol).toBeDefined();
    expect(pkCol!.name).toBe('id');
  });

  // Attempting to insert a duplicate ID via direct SQL should fail.
  // This ensures the primary key constraint is enforced.
  it('rejects duplicate IDs (primary key constraint)', () => {
    const db = getDb();
    const id = 'test-duplicate-id';
    db.prepare(
      `INSERT INTO images (id, filename, mimeType, createdAt) VALUES (?, ?, ?, ?)`,
    ).run(id, 'test.png', 'image/png', new Date().toISOString());

    expect(() =>
      db.prepare(
        `INSERT INTO images (id, filename, mimeType, createdAt) VALUES (?, ?, ?, ?)`,
      ).run(id, 'test2.png', 'image/png', new Date().toISOString()),
    ).toThrow();
  });

  // filename and mimeType are NOT NULL — inserting without them should fail.
  it('filename is NOT NULL', () => {
    const db = getDb();
    expect(() =>
      db.prepare(
        `INSERT INTO images (id, filename, mimeType, createdAt) VALUES (?, NULL, ?, ?)`,
      ).run('x', 'image/png', new Date().toISOString()),
    ).toThrow();
  });

  it('mimeType is NOT NULL', () => {
    const db = getDb();
    expect(() =>
      db.prepare(
        `INSERT INTO images (id, filename, mimeType, createdAt) VALUES (?, ?, NULL, ?)`,
      ).run('x', 'test.png', new Date().toISOString()),
    ).toThrow();
  });

  it('createdAt is NOT NULL', () => {
    const db = getDb();
    expect(() =>
      db.prepare(
        `INSERT INTO images (id, filename, mimeType, createdAt) VALUES (?, ?, ?, NULL)`,
      ).run('x', 'test.png', 'image/png'),
    ).toThrow();
  });

  // After saving 50 images and deleting 30, exactly 20 should remain.
  it('count after bulk save and partial delete is accurate', () => {
    const db = getDb();
    const images = Array.from({ length: 50 }, (_, i) =>
      saveImage(Buffer.from(`img ${i}`).toString('base64'), 'image/png'),
    );

    for (let i = 0; i < 30; i++) {
      deleteImage(images[i].id);
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(20);

    // Verify the remaining 20 are the right ones
    const remaining = db.prepare(`SELECT id FROM images`).all() as { id: string }[];
    const remainingIds = new Set(remaining.map((r) => r.id));
    for (let i = 30; i < 50; i++) {
      expect(remainingIds.has(images[i].id)).toBe(true);
    }
  });

  // Direct SQL insertion should be visible via getImagePath.
  // This verifies getImagePath reads from the same DB.
  it('directly inserted DB record is visible via getImagePath', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO images (id, filename, mimeType, createdAt) VALUES (?, ?, ?, ?)`,
    ).run('direct-insert', 'manual.png', 'image/png', new Date().toISOString());

    const result = getImagePath('direct-insert');
    expect(result.filePath).toBe('manual.png');
  });

  // Direct SQL deletion should make getImagePath throw.
  it('directly deleted DB record makes getImagePath throw', () => {
    const db = getDb();
    const saved = saveImage(Buffer.from('data').toString('base64'), 'image/png');

    db.prepare(`DELETE FROM images WHERE id = ?`).run(saved.id);

    expect(() => getImagePath(saved.id)).toThrow('Image not found');
  });
});

describe('Concurrent Download Simulation', () => {
  setupImageDb();

  // Simulate multiple sequential downloads — each gets its own DB record.
  it('5 sequential downloads produce 5 unique DB records', async () => {
    const db = getDb();
    const results: { id: string; filePath: string }[] = [];

    for (let i = 0; i < 5; i++) {
      (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(i + 1)),
        headers: { get: vi.fn().mockReturnValue('image/png') },
      });

      results.push(await downloadImage(`https://example.com/img${i}.png`));
    }

    // All unique IDs
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(5);

    // DB has exactly 5 records
    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(5);
  });

  // Mix of successful and failed downloads.
  // Successful ones should be saved; failed ones should not affect the DB.
  it('partial failures only save successful downloads', async () => {
    const db = getDb();
    const outcomes: boolean[] = [true, false, true, false, true]; // success pattern
    const results: PromiseSettledResult<{ id: string; filePath: string }>[] = [];

    for (let i = 0; i < 5; i++) {
      if (outcomes[i]) {
        (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
          headers: { get: vi.fn().mockReturnValue('image/png') },
        });
      } else {
        (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: { get: vi.fn() },
        });
      }

      const result = await downloadImage(`https://example.com/img${i}.png`)
        .then((v) => ({ status: 'fulfilled' as const, value: v }))
        .catch((e) => ({ status: 'rejected' as const, reason: e }));
      results.push(result);
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(2);

    // DB should only have the 3 successful downloads
    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(3);
  });

  // Save and delete racing — save an image then immediately delete it.
  // The delete should win (it runs after save completes synchronously).
  it('save then immediate delete leaves no trace', () => {
    const db = getDb();
    for (let i = 0; i < 20; i++) {
      const saved = saveImage(Buffer.from(`race ${i}`).toString('base64'), 'image/png');
      deleteImage(saved.id);
    }

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(0);
  });
});

describe('Data Integrity Edge Cases', () => {
  setupImageDb();

  // PNG magic bytes — verify the full binary signature is preserved.
  it('preserves PNG magic bytes through save', () => {
    // Real PNG starts with these 8 bytes
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const base64 = pngSignature.toString('base64');

    saveImage(base64, 'image/png');

    const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Buffer;
    expect(Buffer.compare(writtenBuffer, pngSignature)).toBe(0);
  });

  // JPEG magic bytes (FFD8FF) — verify they survive the base64 round-trip.
  it('preserves JPEG magic bytes through save', () => {
    const jpegSignature = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const base64 = jpegSignature.toString('base64');

    saveImage(base64, 'image/jpeg');

    const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Buffer;
    expect(Buffer.compare(writtenBuffer, jpegSignature)).toBe(0);
  });

  // GIF magic bytes (GIF89a).
  it('preserves GIF magic bytes through save', () => {
    const gifSignature = Buffer.from('GIF89a');
    const base64 = gifSignature.toString('base64');

    saveImage(base64, 'image/gif');

    const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Buffer;
    expect(writtenBuffer.toString('ascii').startsWith('GIF89a')).toBe(true);
  });

  // All-zeros data — edge case for blank/corrupted images.
  it('preserves all-zeros data', () => {
    const zeros = Buffer.alloc(256, 0x00);
    const base64 = zeros.toString('base64');

    saveImage(base64, 'image/png');

    const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Buffer;
    expect(writtenBuffer.length).toBe(256);
    expect(writtenBuffer.every((b) => b === 0)).toBe(true);
  });

  // All-ones (0xFF) data.
  it('preserves all-0xFF data', () => {
    const ones = Buffer.alloc(256, 0xFF);
    const base64 = ones.toString('base64');

    saveImage(base64, 'image/png');

    const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Buffer;
    expect(writtenBuffer.length).toBe(256);
    expect(writtenBuffer.every((b) => b === 0xFF)).toBe(true);
  });

  // Download preserves binary data from ArrayBuffer -> Buffer -> file.
  it('download preserves binary data through ArrayBuffer->Buffer conversion', async () => {
    const sourceData = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0xAB, 0xCD]);
    const arrayBuffer = sourceData.buffer.slice(
      sourceData.byteOffset,
      sourceData.byteOffset + sourceData.byteLength,
    );

    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await downloadImage('https://example.com/binary.png');

    const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Buffer;
    expect(writtenBuffer.length).toBe(8);
    expect(writtenBuffer[0]).toBe(0x89);
    expect(writtenBuffer[7]).toBe(0xCD);
  });
});
