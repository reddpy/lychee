/**
 * Shared setup for all URL metadata test files.
 *
 * Provides the mockFetch reference, mockHtmlResponse helper, and re-exports.
 *
 * IMPORTANT: Each test file must also include this vi.mock() call
 * at the top level (Vitest hoists them, so they must be in the test file):
 *
 *   const mockFetch = vi.fn();
 *   vi.mock('electron', () => ({
 *     net: { fetch: (...args: unknown[]) => mockFetch(...args) },
 *   }));
 */

import { vi } from 'vitest';
import { fetchUrlMetadata } from '../../repos/url-metadata';

/** Helper: create a mock fetch response with HTML body streamed in chunks */
function createMockHtmlResponse(
  mockFetch: ReturnType<typeof vi.fn>,
  html: string,
  ok = true,
  contentType = 'text/html',
) {
  let consumed = false;
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (consumed) return Promise.resolve({ done: true, value: undefined });
      consumed = true;
      return Promise.resolve({
        done: false,
        value: new TextEncoder().encode(html),
      });
    }),
    cancel: vi.fn(),
  };

  mockFetch.mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    headers: {
      get: vi.fn().mockImplementation((name: string) => {
        if (name === 'content-type') return contentType;
        return null;
      }),
    },
    body: { getReader: () => reader },
  });
}

export { fetchUrlMetadata, createMockHtmlResponse };
