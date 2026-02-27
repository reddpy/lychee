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
  validImageBase64, validImageArrayBuffer,
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
  it('should reject HTML content even with image/png MIME type', () => {
    const html = Buffer.from('<html><body>XSS</body></html>');
    expect(() => saveImage(html.toString('base64'), 'image/png'))
      .toThrow('Content does not match image/png magic bytes');
  });

  // PDF content disguised as image — should not be silently saved as .png.
  it('should reject PDF content even with image/png MIME type', () => {
    const pdf = Buffer.from('%PDF-1.4 fake pdf content');
    expect(() => saveImage(pdf.toString('base64'), 'image/png'))
      .toThrow('Content does not match image/png magic bytes');
  });

  // JavaScript source saved as image — potential code execution vector.
  it('should reject JavaScript content even with image/jpeg MIME type', () => {
    const js = Buffer.from('alert("pwned")');
    expect(() => saveImage(js.toString('base64'), 'image/jpeg'))
      .toThrow('Content does not match image/jpeg magic bytes');
  });

  // ELF binary (Linux executable) saved as image — dangerous content.
  it('should reject ELF binary content even with image/png MIME type', () => {
    const elf = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(() => saveImage(elf.toString('base64'), 'image/png'))
      .toThrow('Content does not match image/png magic bytes');
  });

  // ZIP file disguised as image — could contain malware.
  it('should reject ZIP content even with image/gif MIME type', () => {
    const zip = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x0A, 0x00, 0x00, 0x00]);
    expect(() => saveImage(zip.toString('base64'), 'image/gif'))
      .toThrow('Content does not match image/gif magic bytes');
  });

  // Plain text should never be stored as an image file.
  it('should reject plain text content even with image/webp MIME type', () => {
    const text = Buffer.from('Just some plain text, not an image at all');
    expect(() => saveImage(text.toString('base64'), 'image/webp'))
      .toThrow('Content does not match image/webp magic bytes');
  });

  // ── downloadImage: server lies about content-type ──
  // When a server returns HTML/JSON/binary with an image content-type,
  // downloadImage SHOULD validate the response body and reject it.

  // Server returns HTML with image/png content-type — common when a CDN
  // redirects to a login page but keeps the original content-type.
  it('download should reject HTML body even with image/png content-type', async () => {
    const htmlBody = Buffer.from('<html><head><title>Login</title></head><body>Please log in</body></html>');
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(htmlBody.buffer.slice(htmlBody.byteOffset, htmlBody.byteOffset + htmlBody.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://cdn.example.com/photo.png'))
      .rejects.toThrow('Content does not match image/png magic bytes');
  });

  // Server returns JSON error response with image content-type.
  // Common when an API endpoint returns an error but the content-type
  // was set before the error handler ran.
  it('download should reject JSON body even with image/jpeg content-type', async () => {
    const jsonBody = Buffer.from('{"error": "not found", "status": 404}');
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(jsonBody.buffer.slice(jsonBody.byteOffset, jsonBody.byteOffset + jsonBody.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/jpeg') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://api.example.com/images/123'))
      .rejects.toThrow('Content does not match image/jpeg magic bytes');
  });

  // Server returns executable bytes with image content-type — malicious server.
  it('download should reject executable bytes even with image/gif content-type', async () => {
    const elfBinary = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(elfBinary.buffer.slice(elfBinary.byteOffset, elfBinary.byteOffset + elfBinary.byteLength)),
      headers: { get: vi.fn().mockReturnValue('image/gif') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://evil.example.com/malware.gif'))
      .rejects.toThrow('Content does not match image/gif magic bytes');
  });

  // Zero-byte files are rejected — a zero-byte file is never a valid image.
  it('should reject zero-byte content as invalid image', () => {
    expect(() => saveImage('', 'image/png'))
      .toThrow('Image data is empty (zero bytes)');
  });

  // Zero-byte download — empty response body is rejected.
  it('download should reject zero-byte response as invalid image', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/empty.png'))
      .rejects.toThrow('Image data is empty (zero bytes)');
  });

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

  // downloadImage rejects unsupported content-types instead of defaulting to PNG.
  it('download should reject image/svg+xml content-type (not a supported format)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/svg+xml') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/icon.svg'))
      .rejects.toThrow('Unsupported content-type');
  });

  it('download should reject image/bmp content-type (not a supported format)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/bmp') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/old.bmp'))
      .rejects.toThrow('Unsupported content-type');
  });

  it('download should reject text/html content-type (not an image)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('text/html') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/page'))
      .rejects.toThrow('Unsupported content-type');
  });

  it('download should reject application/octet-stream (ambiguous binary)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('application/octet-stream') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/binary'))
      .rejects.toThrow('Unsupported content-type');
  });

  // Uppercase content-type "Image/JPEG" — normalized to lowercase before matching.
  it('download should handle uppercase content-type Image/JPEG as jpeg', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(validImageArrayBuffer('image/jpeg')),
      headers: { get: vi.fn().mockReturnValue('Image/JPEG') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/photo');
    expect(result.filePath).toMatch(/\.jpg$/);
  });
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
    const png = saveImage(validImageBase64('image/png'), 'image/png');
    const gif = saveImage(validImageBase64('image/gif'), 'image/gif');
    const jpg = saveImage(validImageBase64('image/jpeg'), 'image/jpeg');
    const webp = saveImage(validImageBase64('image/webp'), 'image/webp');

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
    const rawBase64 = validImageBase64('image/png');
    const dataUrl = `data:image/png;base64,${rawBase64}`;
    saveImage(dataUrl, 'image/png');

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written[0]).toBe(0x89); // PNG magic
    expect(written[1]).toBe(0x50);
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
    const rawBase64 = validImageBase64('image/gif');
    const dataUrl = `data:image/png;base64,${rawBase64}`;
    const result = saveImage(dataUrl, 'image/gif');

    expect(result.filePath).toMatch(/\.gif$/);
  });

  // Malformed data URL — no ;base64 part, just has a comma.
  // The code splits on comma and takes [1], so it gets whatever is after the comma.
  it('handles malformed data URL with comma but no base64 marker', () => {
    const rawBase64 = validImageBase64('image/png');
    const malformed = `data:weird/format,${rawBase64}`;
    // The comma split still works — it takes everything after first comma
    saveImage(malformed, 'image/png');

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written[0]).toBe(0x89); // PNG magic preserved
  });

  // Data URL with no prefix at all — just raw base64.
  it('raw base64 string without any prefix', () => {
    const base64 = validImageBase64('image/png');
    // No comma in the string → code uses the whole string as base64
    expect(base64.includes(',')).toBe(false);

    saveImage(base64, 'image/png');

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as Buffer;
    expect(written[0]).toBe(0x89); // PNG magic
  });

  // Invalid base64 — Buffer.from with 'base64' encoding handles gracefully
  // by ignoring non-base64 characters. But the decoded bytes won't have
  // valid magic bytes, so it should be rejected.
  it('invalid base64 characters produce non-image content and are rejected', () => {
    // Node's Buffer.from('...', 'base64') ignores non-base64 chars
    expect(() => saveImage('!!!not-valid-base64!!!', 'image/png'))
      .toThrow('Content does not match image/png magic bytes');
  });
});

describe('URL Extension vs Content-Type', () => {
  setupImageDb();

  // URL says .gif but server returns image/png content-type.
  // downloadImage trusts the content-type header, not the URL.
  it('.gif URL with image/png content-type: saved as .png', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(validImageArrayBuffer('image/png')),
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
      arrayBuffer: vi.fn().mockResolvedValue(validImageArrayBuffer('image/gif')),
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
      arrayBuffer: vi.fn().mockResolvedValue(validImageArrayBuffer('image/webp')),
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
      arrayBuffer: vi.fn().mockResolvedValue(validImageArrayBuffer('image/gif')),
      headers: { get: vi.fn().mockReturnValue('image/gif') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/api/v1/image/12345');

    expect(result.filePath).toMatch(/\.gif$/);
  });

  // URL with .svg extension — SVG content-type is rejected by downloadImage.
  it('.svg URL should be rejected (SVG not a supported raster format)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/svg+xml') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/icon.svg'))
      .rejects.toThrow('Unsupported content-type');
  });

  // URL with .bmp extension — BMP content-type is rejected.
  it('.bmp URL should be rejected (BMP not a supported format)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/bmp') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/old.bmp'))
      .rejects.toThrow('Unsupported content-type');
  });

  // URL with .ico extension — ICO content-type is rejected.
  it('.ico URL should be rejected (ICO not a supported format)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('image/x-icon') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/favicon.ico'))
      .rejects.toThrow('Unsupported content-type');
  });
});
