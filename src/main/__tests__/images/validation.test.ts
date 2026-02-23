/**
 * Tests for image format validation, MIME allowlist, GIF support,
 * data URL parsing, and URL extension vs content-type behavior.
 *
 * Covers the security boundary: what content is accepted vs rejected,
 * magic byte validation, supported/unsupported MIME types, and
 * content-type resolution from download headers.
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

describe('Image Format Validation', () => {
  setupImageDb();

  // ── Real image magic bytes (valid files) — these SHOULD succeed ──

  // Real PNG: 8-byte signature. This is what every valid PNG starts with.
  it('accepts real PNG magic bytes with image/png MIME', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const result = saveImage(pngHeader.toString('base64'), 'image/png');
    expect(result.filePath).toMatch(/\.png$/);

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written[0]).toBe(0x89);
    expect(written[1]).toBe(0x50); // 'P'
  });

  // Real JPEG: starts with FF D8 FF.
  it('accepts real JPEG magic bytes with image/jpeg MIME', () => {
    const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
    const result = saveImage(jpegHeader.toString('base64'), 'image/jpeg');
    expect(result.filePath).toMatch(/\.jpg$/);

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written[0]).toBe(0xFF);
    expect(written[1]).toBe(0xD8);
  });

  // Real GIF: starts with "GIF89a" or "GIF87a" (6 ASCII bytes).
  it('accepts real GIF89a magic bytes with image/gif MIME', () => {
    const gif89a = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00');
    const result = saveImage(gif89a.toString('base64'), 'image/gif');
    expect(result.filePath).toMatch(/\.gif$/);

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString('ascii', 0, 6)).toBe('GIF89a');
  });

  it('accepts real GIF87a magic bytes with image/gif MIME', () => {
    const gif87a = Buffer.from('GIF87a\x01\x00\x01\x00\x80\x00\x00');
    const result = saveImage(gif87a.toString('base64'), 'image/gif');
    expect(result.filePath).toMatch(/\.gif$/);

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString('ascii', 0, 6)).toBe('GIF87a');
  });

  // Real WebP: RIFF container with "WEBP" at offset 8.
  it('accepts real WebP magic bytes with image/webp MIME', () => {
    const webpHeader = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x24, 0x00, 0x00, 0x00, // file size (placeholder)
      0x57, 0x45, 0x42, 0x50, // "WEBP"
    ]);
    const result = saveImage(webpHeader.toString('base64'), 'image/webp');
    expect(result.filePath).toMatch(/\.webp$/);

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString('ascii', 0, 4)).toBe('RIFF');
    expect(written.toString('ascii', 8, 12)).toBe('WEBP');
  });

  // ── Non-image content with image MIME type — these SHOULD be rejected ──
  // A note-taking app should never store HTML/PDF/executables as "images".
  // These tests assert what SHOULD happen. If they fail, it means the code
  // lacks content validation — which is a real bug to fix.

  // HTML content saved as "image/png" — could inject XSS into local filesystem.
  // A user might paste content from a web page that sends HTML as clipboard data.
  // TODO: implement magic byte validation in saveImage
  it.todo('should reject HTML content even with image/png MIME type');

  // PDF content disguised as image — should not be silently saved as .png.
  // TODO: implement magic byte validation in saveImage
  it.todo('should reject PDF content even with image/png MIME type');

  // JavaScript source saved as image — potential code execution vector.
  // TODO: implement magic byte validation in saveImage
  it.todo('should reject JavaScript content even with image/jpeg MIME type');

  // ELF binary (Linux executable) saved as image — dangerous content.
  // TODO: implement magic byte validation in saveImage
  it.todo('should reject ELF binary content even with image/png MIME type');

  // ZIP file disguised as image — could contain malware.
  // TODO: implement magic byte validation in saveImage
  it.todo('should reject ZIP content even with image/gif MIME type');

  // Plain text should never be stored as an image file.
  // TODO: implement magic byte validation in saveImage
  it.todo('should reject plain text content even with image/webp MIME type');

  // ── downloadImage: server lies about content-type ──
  // When a server returns HTML/JSON/binary with an image content-type,
  // downloadImage SHOULD validate the response body and reject it.

  // Server returns HTML with image/png content-type — common when a CDN
  // redirects to a login page but keeps the original content-type.
  // TODO: implement magic byte validation in downloadImage
  it.todo('download should reject HTML body even with image/png content-type');

  // Server returns JSON error response with image content-type.
  // Common when an API endpoint returns an error but the content-type
  // was set before the error handler ran.
  // TODO: implement magic byte validation in downloadImage
  it.todo('download should reject JSON body even with image/jpeg content-type');

  // Server returns executable bytes with image content-type — malicious server.
  // TODO: implement magic byte validation in downloadImage
  it.todo('download should reject executable bytes even with image/gif content-type');

  // ── Zero-byte images SHOULD be rejected ──
  // A zero-byte file is never a valid image. When a server returns an empty
  // response body, that's a failed download, not a legitimate image.
  // TODO: implement zero-byte rejection in saveImage
  it.todo('should reject zero-byte content as invalid image');

  // TODO: implement zero-byte rejection in downloadImage
  it.todo('download should reject zero-byte response as invalid image');

  // ── Supported vs unsupported MIME types (the allowlist) ──

  // These 4 are the ONLY types the system accepts. Everything else is rejected.
  it('supported MIME types: exactly png, jpeg, gif, webp', () => {
    const supported = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    // Use real-ish magic bytes for each format so content validation passes
    const magicBytes: Record<string, Buffer> = {
      'image/png': Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      'image/jpeg': Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
      'image/gif': Buffer.from('GIF89a\x01\x00\x01\x00'),
      'image/webp': Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
    };

    for (const mime of supported) {
      expect(() => saveImage(magicBytes[mime].toString('base64'), mime)).not.toThrow();
    }
  });

  // Common image formats that are NOT supported — tests document the boundary.
  it('rejects image/svg+xml (vector, can contain scripts)', () => {
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="50"/></svg>');
    expect(() => saveImage(svgContent.toString('base64'), 'image/svg+xml'))
      .toThrow('Unsupported image type: image/svg+xml');
  });

  it('rejects image/bmp (legacy format)', () => {
    const bmpHeader = Buffer.from([0x42, 0x4D]); // "BM"
    expect(() => saveImage(bmpHeader.toString('base64'), 'image/bmp'))
      .toThrow('Unsupported image type: image/bmp');
  });

  it('rejects image/tiff (complex format, not web-friendly)', () => {
    const tiffHeader = Buffer.from([0x49, 0x49, 0x2A, 0x00]); // little-endian TIFF
    expect(() => saveImage(tiffHeader.toString('base64'), 'image/tiff'))
      .toThrow('Unsupported image type: image/tiff');
  });

  it('rejects image/x-icon (favicon format)', () => {
    const icoHeader = Buffer.from([0x00, 0x00, 0x01, 0x00]);
    expect(() => saveImage(icoHeader.toString('base64'), 'image/x-icon'))
      .toThrow('Unsupported image type: image/x-icon');
  });

  it('rejects image/avif (newer format, not yet in allowlist)', () => {
    expect(() => saveImage(Buffer.from('test').toString('base64'), 'image/avif'))
      .toThrow('Unsupported image type: image/avif');
  });

  it('rejects image/heic (Apple format, not web-friendly)', () => {
    expect(() => saveImage(Buffer.from('test').toString('base64'), 'image/heic'))
      .toThrow('Unsupported image type: image/heic');
  });

  // Non-image MIME types that someone might try to sneak through.
  it('rejects application/pdf', () => {
    expect(() => saveImage(Buffer.from('%PDF-1.4').toString('base64'), 'application/pdf'))
      .toThrow('Unsupported image type: application/pdf');
  });

  it('rejects text/html', () => {
    expect(() => saveImage(Buffer.from('<html>').toString('base64'), 'text/html'))
      .toThrow('Unsupported image type: text/html');
  });

  it('rejects application/javascript', () => {
    expect(() => saveImage(Buffer.from('alert(1)').toString('base64'), 'application/javascript'))
      .toThrow('Unsupported image type: application/javascript');
  });

  it('rejects application/octet-stream (generic binary)', () => {
    expect(() => saveImage(Buffer.from([0x00]).toString('base64'), 'application/octet-stream'))
      .toThrow('Unsupported image type: application/octet-stream');
  });

  it('rejects video/mp4', () => {
    expect(() => saveImage(Buffer.from('moov').toString('base64'), 'video/mp4'))
      .toThrow('Unsupported image type: video/mp4');
  });

  it('rejects empty string MIME type', () => {
    expect(() => saveImage(Buffer.from('data').toString('base64'), ''))
      .toThrow('Unsupported image type: ');
  });

  // ── downloadImage: content-type → MIME mapping completeness ──

  // Verify download correctly maps all 4 content-types to the right extensions.
  it('download maps image/gif content-type to .gif extension', async () => {
    const gifData = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00');
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(gifData.buffer.slice(gifData.byteOffset, gifData.byteOffset + gifData.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/gif') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/animated.gif');

    const db = getDb();
    expect(result.filePath).toMatch(/\.gif$/);
    const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(result.id) as { mimeType: string };
    expect(row.mimeType).toBe('image/gif');
  });

  it('download maps image/webp content-type to .webp extension', async () => {
    const webpData = Buffer.from('RIFF\x00\x00\x00\x00WEBP');
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(webpData.buffer.slice(webpData.byteOffset, webpData.byteOffset + webpData.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/webp') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/photo.webp');

    const db = getDb();
    expect(result.filePath).toMatch(/\.webp$/);
    const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(result.id) as { mimeType: string };
    expect(row.mimeType).toBe('image/webp');
  });

  // downloadImage with unsupported content-types SHOULD reject, not silently
  // default to PNG. Saving SVG content as .png is misleading and broken.
  // TODO: reject unsupported content-types in downloadImage instead of defaulting to png
  it.todo('download should reject image/svg+xml content-type (not a supported format)');

  // TODO: reject unsupported content-types in downloadImage
  it.todo('download should reject image/bmp content-type (not a supported format)');

  // Non-image content-types should be rejected by downloadImage, not
  // silently defaulted to PNG. text/html with a .png default is broken.
  // TODO: reject non-image content-types in downloadImage
  it.todo('download should reject text/html content-type (not an image)');

  // application/octet-stream should not be silently defaulted to PNG.
  // The system should require a recognized image content-type.
  // TODO: reject ambiguous content-types in downloadImage
  it.todo('download should reject application/octet-stream (ambiguous binary)');

  // Uppercase content-type "Image/JPEG" — HTTP headers are case-insensitive
  // per RFC 7230. The code SHOULD handle this, not silently fall through to PNG.
  // TODO: normalize content-type to lowercase before matching in downloadImage
  it.todo('download should handle uppercase content-type Image/JPEG as jpeg');
});

describe('GIF Support', () => {
  setupImageDb();

  // Basic GIF save round-trip.
  it('saves and retrieves a GIF image', () => {
    const db = getDb();
    const gifData = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xFF\xFF\xFF\x00\x00\x00');
    const saved = saveImage(gifData.toString('base64'), 'image/gif');

    expect(saved.filePath).toMatch(/\.gif$/);
    expect(getImagePath(saved.id).filePath).toBe(saved.filePath);

    const row = db.prepare(`SELECT mimeType, filename FROM images WHERE id = ?`).get(saved.id) as { mimeType: string; filename: string };
    expect(row.mimeType).toBe('image/gif');
    expect(row.filename).toMatch(/\.gif$/);
  });

  // GIF via data URL (from clipboard paste in browser).
  it('saves GIF from data URL', () => {
    const gifData = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00');
    const dataUrl = `data:image/gif;base64,${gifData.toString('base64')}`;
    const saved = saveImage(dataUrl, 'image/gif');

    expect(saved.filePath).toMatch(/\.gif$/);
    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString('ascii', 0, 6)).toBe('GIF89a');
  });

  // GIF download with correct content-type.
  it('downloads GIF from URL with image/gif content-type', async () => {
    const db = getDb();
    const gifData = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00');
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(gifData.buffer.slice(gifData.byteOffset, gifData.byteOffset + gifData.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/gif') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/reaction.gif');

    expect(result.filePath).toMatch(/\.gif$/);
    const row = db.prepare(`SELECT mimeType FROM images WHERE id = ?`).get(result.id) as { mimeType: string };
    expect(row.mimeType).toBe('image/gif');
  });

  // Animated GIF — larger payload simulating multiple frames.
  // The code doesn't parse GIF frames, it just stores the bytes.
  it('saves large animated GIF payload (simulated multi-frame)', () => {
    // Real animated GIFs are typically 100KB–5MB. Simulate a 500KB one.
    const frameData = Buffer.alloc(500 * 1024);
    // Write GIF89a header
    frameData.write('GIF89a', 0, 'ascii');
    // Fill rest with pseudo-frame data
    for (let i = 6; i < frameData.length; i++) {
      frameData[i] = i % 256;
    }

    const saved = saveImage(frameData.toString('base64'), 'image/gif');
    expect(saved.filePath).toMatch(/\.gif$/);

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.length).toBe(500 * 1024);
    expect(written.toString('ascii', 0, 6)).toBe('GIF89a');
  });

  // Full lifecycle: save GIF → get → delete → verify gone.
  it('full GIF lifecycle: save → get → delete → gone', () => {
    const db = getDb();
    const gifData = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00');
    const saved = saveImage(gifData.toString('base64'), 'image/gif');

    // Retrieve
    const got = getImagePath(saved.id);
    expect(got.filePath).toBe(saved.filePath);

    // Delete
    deleteImage(saved.id);

    // Gone
    expect(() => getImagePath(saved.id)).toThrow('Image not found');
    const row = db.prepare(`SELECT * FROM images WHERE id = ?`).get(saved.id);
    expect(row).toBeUndefined();
  });

  // Multiple GIFs saved at once — simulates a note with several reaction GIFs.
  it('saves 20 GIFs with unique IDs and all retrievable', () => {
    const gifs = Array.from({ length: 20 }, (_, i) => {
      const data = Buffer.from(`GIF89a frame${i}`);
      return saveImage(data.toString('base64'), 'image/gif');
    });

    const ids = new Set(gifs.map((g) => g.id));
    expect(ids.size).toBe(20);

    for (const gif of gifs) {
      expect(gif.filePath).toMatch(/\.gif$/);
      expect(getImagePath(gif.id).filePath).toBe(gif.filePath);
    }
  });

  // Mix of GIF and other formats — they coexist in the same DB table.
  it('GIFs coexist with PNG, JPEG, and WebP in DB', () => {
    const db = getDb();
    const png = saveImage(Buffer.from('png data').toString('base64'), 'image/png');
    const gif = saveImage(Buffer.from('GIF89a').toString('base64'), 'image/gif');
    const jpg = saveImage(Buffer.from('jpeg data').toString('base64'), 'image/jpeg');
    const webp = saveImage(Buffer.from('webp data').toString('base64'), 'image/webp');

    expect(png.filePath).toMatch(/\.png$/);
    expect(gif.filePath).toMatch(/\.gif$/);
    expect(jpg.filePath).toMatch(/\.jpg$/);
    expect(webp.filePath).toMatch(/\.webp$/);

    // All 4 retrievable
    expect(getImagePath(png.id).filePath).toBe(png.filePath);
    expect(getImagePath(gif.id).filePath).toBe(gif.filePath);
    expect(getImagePath(jpg.id).filePath).toBe(jpg.filePath);
    expect(getImagePath(webp.id).filePath).toBe(webp.filePath);

    const count = db.prepare(`SELECT COUNT(*) as c FROM images`).get() as { c: number };
    expect(count.c).toBe(4);
  });

  // GIF download with extra content-type params.
  it('downloads GIF with content-type including charset param', async () => {
    const gifData = Buffer.from('GIF89a\x01\x00\x01\x00');
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(gifData.buffer.slice(gifData.byteOffset, gifData.byteOffset + gifData.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/gif; charset=binary') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/emoji.gif');
    expect(result.filePath).toMatch(/\.gif$/);
  });
});

describe('Data URL Format Edge Cases', () => {
  setupImageDb();

  // Standard data URL with all parts.
  it('parses standard data URL: data:image/png;base64,<data>', () => {
    const raw = Buffer.from('test payload');
    const dataUrl = `data:image/png;base64,${raw.toString('base64')}`;
    saveImage(dataUrl, 'image/png');

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString()).toBe('test payload');
  });

  // Data URL for GIF format.
  it('parses data:image/gif;base64 data URL', () => {
    const gifData = Buffer.from('GIF89a test');
    const dataUrl = `data:image/gif;base64,${gifData.toString('base64')}`;
    const result = saveImage(dataUrl, 'image/gif');

    expect(result.filePath).toMatch(/\.gif$/);
    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString('ascii', 0, 6)).toBe('GIF89a');
  });

  // Data URL where prefix MIME doesn't match the mimeType argument.
  // Code ignores the prefix and trusts the argument.
  it('prefix MIME mismatch: data:image/png but saved as gif', () => {
    const data = Buffer.from('some data');
    const dataUrl = `data:image/png;base64,${data.toString('base64')}`;
    const result = saveImage(dataUrl, 'image/gif');

    expect(result.filePath).toMatch(/\.gif$/);
  });

  // Malformed data URL — no ;base64 part, just has a comma.
  // The code splits on comma and takes [1], so it gets whatever is after the comma.
  it('handles malformed data URL with comma but no base64 marker', () => {
    const raw = Buffer.from('payload');
    const malformed = `data:weird/format,${raw.toString('base64')}`;
    // The comma split still works — it takes everything after first comma
    saveImage(malformed, 'image/png');

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString()).toBe('payload');
  });

  // Data URL with no prefix at all — just raw base64.
  it('raw base64 string without any prefix', () => {
    const data = Buffer.from('raw image bytes');
    const base64 = data.toString('base64');
    // No comma in the string → code uses the whole string as base64
    expect(base64.includes(',')).toBe(false);

    saveImage(base64, 'image/png');

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written.toString()).toBe('raw image bytes');
  });

  // Invalid base64 — Buffer.from with 'base64' encoding handles gracefully
  // by ignoring non-base64 characters.
  it('invalid base64 characters are silently ignored by Buffer.from', () => {
    // Node's Buffer.from('...', 'base64') ignores non-base64 chars
    const result = saveImage('!!!not-valid-base64!!!', 'image/png');

    expect(result.id).toBeDefined();
    // Buffer.from will produce some output (it strips invalid chars)
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
});

describe('URL Extension vs Content-Type', () => {
  setupImageDb();

  // URL says .gif but server returns image/png content-type.
  // downloadImage trusts the content-type header, not the URL.
  it('.gif URL with image/png content-type: saved as .png', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/animation.gif');

    // Content-Type wins over URL extension
    expect(result.filePath).toMatch(/\.png$/);
  });

  // URL says .png but server returns image/gif content-type.
  it('.png URL with image/gif content-type: saved as .gif', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/gif') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/photo.png');

    expect(result.filePath).toMatch(/\.gif$/);
  });

  // URL says .jpg but server returns image/webp content-type.
  it('.jpg URL with image/webp content-type: saved as .webp', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/webp') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/photo.jpg');

    expect(result.filePath).toMatch(/\.webp$/);
  });

  // No extension in URL, content-type is image/gif.
  it('extensionless URL with image/gif content-type: saved as .gif', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/gif') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/api/v1/image/12345');

    expect(result.filePath).toMatch(/\.gif$/);
  });

  // URL with .svg extension — SVG is not a supported raster format and can
  // contain scripts. downloadImage SHOULD reject it, not silently save as PNG.
  // TODO: reject unsupported content-types in downloadImage
  it.todo('.svg URL should be rejected (SVG not a supported raster format)');

  // URL with .bmp extension — BMP is not a supported format.
  // SHOULD reject, not silently save as PNG.
  // TODO: reject unsupported content-types in downloadImage
  it.todo('.bmp URL should be rejected (BMP not a supported format)');

  // URL with .ico extension — ICO is not a supported format.
  // SHOULD reject, not silently save as PNG.
  // TODO: reject unsupported content-types in downloadImage
  it.todo('.ico URL should be rejected (ICO not a supported format)');
});
