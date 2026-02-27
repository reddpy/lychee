/**
 * Tests for downloadImage — network-based image acquisition.
 *
 * Covers content-type detection, HTTP error handling, large/zero-byte
 * downloads, unique ID generation, and RFC 7230 compliance.
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
  downloadImage, getImagePath,
} from './setup';

describe('downloadImage', () => {
  setupImageDb();

  // Standard download with recognized content-type.
  it('downloads image and detects MIME from content-type header', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: {
        get: vi.fn().mockReturnValue('image/jpeg'),
      },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/photo.jpg');

    expect(result.id).toBeDefined();
    expect(result.filePath).toMatch(/\.jpg$/);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  // downloadImage rejects unrecognized content-types instead of defaulting to PNG.
  it('should reject unrecognized content-type instead of defaulting to png', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('application/json') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/api/data'))
      .rejects.toThrow('Unsupported content-type');
  });

  // Real content-type headers often include charset: "image/jpeg; charset=utf-8".
  // The code uses .includes() to match, so "image/jpeg; charset=utf-8" should
  // match "image/jpeg".
  it('detects MIME from content-type with extra params', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: {
        get: vi.fn().mockReturnValue('image/jpeg; charset=utf-8'),
      },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/photo');
    expect(result.filePath).toMatch(/\.jpg$/);
  });

  // HTTP errors should propagate so the caller can show an error to the user.
  it('throws on non-OK HTTP status', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      headers: { get: vi.fn() },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(
      downloadImage('https://example.com/missing.png'),
    ).rejects.toThrow('HTTP 404');
  });

  // Verify the downloaded image is saved to DB.
  it('inserts downloaded image into database', async () => {
    const db = getDb();
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: {
        get: vi.fn().mockReturnValue('image/png'),
      },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/img.png');

    const row = db
      .prepare(`SELECT * FROM images WHERE id = ?`)
      .get(result.id) as { id: string; mimeType: string };
    expect(row).toBeDefined();
    expect(row.mimeType).toBe('image/png');
  });

  // All 4 supported content-types produce the correct extension.
  it('detects all supported MIME types from content-type headers', async () => {
    const cases: [string, RegExp][] = [
      ['image/png', /\.png$/],
      ['image/jpeg', /\.jpg$/],
      ['image/gif', /\.gif$/],
      ['image/webp', /\.webp$/],
    ];

    for (const [contentType, extPattern] of cases) {
      const mockResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
        headers: { get: vi.fn().mockReturnValue(contentType) },
      };
      (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await downloadImage(`https://example.com/img`);
      expect(result.filePath).toMatch(extPattern);
    }
  });

  // Null content-type header — rejected as missing content-type.
  it('should reject when content-type header is null (unknown content)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue(null) },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/mystery'))
      .rejects.toThrow('Missing content-type header');
  });

  // Empty string content-type — rejected as missing content-type.
  it('should reject when content-type header is empty string', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/unknown'))
      .rejects.toThrow('Missing content-type header');
  });

  // Various HTTP error codes — all should throw with the status code.
  it('throws with status code for various HTTP errors', async () => {
    for (const status of [400, 401, 403, 500, 502, 503]) {
      const mockResponse = {
        ok: false,
        status,
        headers: { get: vi.fn() },
      };
      (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(
        downloadImage('https://example.com/img.png'),
      ).rejects.toThrow(`HTTP ${status}`);
    }
  });

  // Network failure (fetch rejects with TypeError) should propagate.
  it('propagates network errors (fetch rejection)', async () => {
    (net.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('Failed to fetch'),
    );

    await expect(
      downloadImage('https://example.com/img.png'),
    ).rejects.toThrow('Failed to fetch');
  });

  // Content-type with boundary parameter (multipart style) — should still match.
  it('detects MIME from content-type with boundary parameter', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      headers: { get: vi.fn().mockReturnValue('image/gif; boundary=something') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/animated');
    expect(result.filePath).toMatch(/\.gif$/);
  });

  // Large download — 5MB buffer. Verify nothing crashes and the full buffer is written.
  it('handles large download (5MB) without truncation', async () => {
    const bigBuffer = new ArrayBuffer(5 * 1024 * 1024);
    new Uint8Array(bigBuffer).fill(0xCD);

    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(bigBuffer),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/huge.png');

    expect(result.id).toBeDefined();
    const writtenBuffer = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Buffer;
    expect(writtenBuffer.length).toBe(5 * 1024 * 1024);
  });

  // Zero-byte download — the server returns an empty body. Rejected.
  it('should reject zero-byte download (empty response is not a valid image)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/empty.png'))
      .rejects.toThrow('Image data is empty (zero bytes)');
  });

  // Each download should produce a unique ID, even for the same URL.
  it('generates unique IDs for downloads of the same URL', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    };

    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
    const r1 = await downloadImage('https://example.com/same.png');

    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      headers: { get: vi.fn().mockReturnValue('image/png') },
    });
    const r2 = await downloadImage('https://example.com/same.png');

    expect(r1.id).not.toBe(r2.id);
  });

  // Downloaded image should be retrievable via getImagePath.
  it('downloaded image is retrievable via getImagePath', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      headers: { get: vi.fn().mockReturnValue('image/jpeg') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const downloaded = await downloadImage('https://example.com/photo.jpg');
    const got = getImagePath(downloaded.id);

    expect(got.filePath).toBe(downloaded.filePath);
  });

  // Uppercase content-type normalized to lowercase before matching.
  it('uppercase content-type Image/JPEG should be detected as jpeg (RFC 7230)', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('Image/JPEG') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await downloadImage('https://example.com/photo');
    expect(result.filePath).toMatch(/\.jpg$/);
  });

  // text/html content-type is rejected — not an image.
  it('should reject non-image content-type text/html', async () => {
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: { get: vi.fn().mockReturnValue('text/html') },
    };
    (net.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(downloadImage('https://example.com/page'))
      .rejects.toThrow('Unsupported content-type');
  });
});
