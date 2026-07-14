/**
 * Edge cases for the URL resolver handler chain.
 *
 * These test weird, real-world URLs and tricky scenarios that could
 * break image detection, bookmark fallback, or handler priority.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/lychee-test") },
  net: { fetch: (...args: unknown[]) => mockFetch(...args) },
}));

vi.mock("fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

import { getTestDb } from "../helpers";
vi.mock("../../db", () => ({
  getDb: () => getTestDb(),
}));

const mockDownloadImage = vi.fn();
vi.mock("../../repos/images", () => ({
  downloadImage: (...args: unknown[]) => mockDownloadImage(...args),
  saveImage: vi.fn(),
  getImagePath: vi.fn(),
  deleteImage: vi.fn(),
}));

import { setupResolverDb, resolveUrl } from "./setup";

describe("URL Resolver — Edge Cases", () => {
  setupResolverDb();

  beforeEach(() => {
    mockDownloadImage.mockResolvedValue({
      id: "mock-id",
      filePath: "mock-id.png",
    });
  });

  // ────────────────────────────────────────────────────────
  // URL with fragment (#) — fragments are part of the URL string
  // ────────────────────────────────────────────────────────

  it("handles image URL with fragment identifier", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => "image/png" },
    });

    const result = await resolveUrl("https://example.com/image.png#section");
    expect(result.type).toBe("image");
  });

  // ────────────────────────────────────────────────────────
  // URL with authentication credentials (user:pass@host)
  // ────────────────────────────────────────────────────────

  it("handles URL with embedded credentials in image path", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => "image/jpeg" },
    });

    const result = await resolveUrl(
      "https://user:pass@cdn.example.com/photo.jpg",
    );
    expect(result.type).toBe("image");
  });

  // ────────────────────────────────────────────────────────
  // URL with non-standard port
  // ────────────────────────────────────────────────────────

  it("detects image extension on URL with port", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => "image/png" },
    });

    const result = await resolveUrl(
      "https://localhost:3000/uploads/avatar.png",
    );
    expect(result.type).toBe("image");
  });

  // ────────────────────────────────────────────────────────
  // Content-type probe: server lies about content-type
  // ────────────────────────────────────────────────────────

  it("trusts HEAD content-type even if body would be different", async () => {
    // Server says image/png on HEAD but would serve HTML on GET.
    // Our probe trusts the HEAD response — that's the HTTP contract.
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => "image/png" },
    });

    const result = await resolveUrl("https://example.com/api/sneaky");
    expect(result.type).toBe("image");
  });

  // ────────────────────────────────────────────────────────
  // Bookmark: page with huge OG content
  // ────────────────────────────────────────────────────────

  it("handles bookmark with extremely long OG title", async () => {
    const longTitle = "A".repeat(5000);
    let consumed = false;
    const reader = {
      read: vi.fn().mockImplementation(() => {
        if (consumed) return Promise.resolve({ done: true, value: undefined });
        consumed = true;
        const html = `<html><head><meta property="og:title" content="${longTitle}"></head></html>`;
        return Promise.resolve({
          done: false,
          value: new TextEncoder().encode(html),
        });
      }),
      cancel: vi.fn(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === "content-type") return "text/html";
          return null;
        }),
      },
      body: { getReader: () => reader },
    });

    const result = await resolveUrl("https://example.com/article");
    expect(result.type).toBe("bookmark");
    if (result.type === "bookmark") {
      expect(result.title).toBe(longTitle);
    }
  });

  // ────────────────────────────────────────────────────────
  // Bookmark: empty body
  // ────────────────────────────────────────────────────────

  it("returns bookmark with empty metadata when HTML body is empty", async () => {
    const reader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === "content-type") return "text/html";
          return null;
        }),
      },
      body: { getReader: () => reader },
    });

    const result = await resolveUrl("https://example.com/empty");
    expect(result.type).toBe("bookmark");
    if (result.type === "bookmark") {
      expect(result.title).toBe("");
    }
  });

  // ────────────────────────────────────────────────────────
  // Bookmark: server returns 200 but no body reader
  // ────────────────────────────────────────────────────────

  it("returns bookmark with empty metadata when response has no body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockImplementation((name: string) => {
          if (name === "content-type") return "text/html";
          return null;
        }),
      },
      body: null,
    });

    const result = await resolveUrl("https://example.com/nobody");
    expect(result.type).toBe("bookmark");
    if (result.type === "bookmark") {
      expect(result.title).toBe("");
    }
  });

  // ────────────────────────────────────────────────────────
  // URL encoding
  // ────────────────────────────────────────────────────────

  it("handles URL-encoded image path", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => "image/jpeg" },
    });

    const result = await resolveUrl("https://example.com/my%20photo.jpg");
    expect(result.type).toBe("image");
  });

  it("handles URL with unicode in path that has image extension", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => "image/png" },
    });

    const result = await resolveUrl(
      "https://example.com/%E5%9B%BE%E7%89%87.png",
    );
    expect(result.type).toBe("image");
  });

  // ────────────────────────────────────────────────────────
  // Redirect scenarios (probe follows redirects)
  // ────────────────────────────────────────────────────────

  it("passes redirect: follow to probe requests", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => "text/html" },
    });

    await resolveUrl("https://bit.ly/shortened");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  // ────────────────────────────────────────────────────────
  // Content-type with unusual casing
  // ────────────────────────────────────────────────────────

  it("detects IMAGE/PNG with unusual casing via probe (case-insensitive)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => "IMAGE/PNG" },
    });

    const result = await resolveUrl("https://example.com/api/avatar");
    // Content-type is lowercased before matching — unusual casing is handled
    expect(result.type).toBe("image");
  });

  // ────────────────────────────────────────────────────────
  // Concurrent resolution of same URL
  // ────────────────────────────────────────────────────────

  it("handles concurrent resolution of different URL types", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => "text/html" },
    });

    const [youtubeBookmark, img, bm] = await Promise.all([
      resolveUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      resolveUrl("https://example.com/photo.png"),
      resolveUrl("https://example.com/article"),
    ]);

    expect(youtubeBookmark.type).toBe("bookmark");
    expect(img.type).toBe("image");
    expect(bm.type).toBe("bookmark");
  });
});
