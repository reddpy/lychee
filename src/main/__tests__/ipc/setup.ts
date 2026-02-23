/**
 * Shared setup for all IPC test files.
 *
 * Provides handler capture, mock registration, and re-exports of all repo modules.
 *
 * IMPORTANT: Each test file must also include these vi.mock() calls
 * at the top level (Vitest hoists them, so they must be in the test file):
 *
 *   const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
 *   vi.mock('electron', () => ({
 *     ipcMain: { handle: vi.fn((ch, h) => { handlers.set(ch, h); }) },
 *     shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
 *   }));
 *   vi.mock('../../repos/documents', () => ({ ... }));
 *   vi.mock('../../repos/images', () => ({ ... }));
 *   vi.mock('../../repos/url-resolver', () => ({ ... }));
 *   vi.mock('../../repos/url-metadata', () => ({ ... }));
 */

import { ipcMain, shell } from 'electron';
import { registerIpcHandlers } from '../../ipc';
import * as docs from '../../repos/documents';
import * as images from '../../repos/images';
import * as urlResolver from '../../repos/url-resolver';
import * as urlMetadata from '../../repos/url-metadata';

export {
  ipcMain,
  shell,
  registerIpcHandlers,
  docs,
  images,
  urlResolver,
  urlMetadata,
};
