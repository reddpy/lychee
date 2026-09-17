import fs from 'fs';
import path from 'path';
import { expect, type Page } from '@playwright/test';
import { createNote, noteItem } from './vault-helpers';
import { editNoteLive, type LiveEditResult } from '../src/mcp/live-edit';

/**
 * Shared helpers for the MCP live-edit e2e suites.
 *
 * These drive the SAME code path the MCP server uses: resolve the note in the
 * vault, join its live Y.Doc over the bridge socket, apply a transform, publish.
 * See `src/mcp/server.ts` for how each tool builds its transform.
 */

export function syncSocketPath(testDir: string): string {
  return path.join(testDir, 'userdata', 'lychee-sync.sock');
}

export async function waitForSyncSocket(socket: string, timeout = 10_000): Promise<void> {
  await expect.poll(() => fs.existsSync(socket), { timeout }).toBe(true);
}

/** Create + open a note and wait until its live doc is bound. */
export async function openLiveNote(
  window: Page,
  title: string,
): Promise<{ docId: string; body: ReturnType<Page['locator']> }> {
  await createNote(window, title);
  const docId = await noteItem(window, title).getAttribute('data-note-id');
  if (!docId) throw new Error(`note "${title}" has no data-note-id`);
  await expect
    .poll(
      () =>
        window.evaluate(
          (id) => Boolean((window as any).__lycheeNoteSync?.isReady(id)),
          docId,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  return { docId, body: window.locator('main:visible .ContentEditable__root') };
}

/** Mirror of the `append_to_note` tool transform. */
export function appendLive(
  vaultDir: string,
  socket: string,
  id: string,
  markdown: string,
): Promise<LiveEditResult | null> {
  return editNoteLive({
    vault: vaultDir,
    socket,
    idOrPath: id,
    transform: (current) => `${current.replace(/\s+$/, '')}\n\n${markdown.trim()}\n`,
  });
}

/** Mirror of the `replace_in_note` tool transform. */
export function replaceLive(
  vaultDir: string,
  socket: string,
  id: string,
  find: string,
  replace: string,
): Promise<LiveEditResult | null> {
  return editNoteLive({
    vault: vaultDir,
    socket,
    idOrPath: id,
    transform: (current) => (current.includes(find) ? current.split(find).join(replace) : null),
    allowFenceChanges: true,
  });
}

/** Mirror of the `update_note` tool transform (whole-body replace). */
export function updateLive(
  vaultDir: string,
  socket: string,
  id: string,
  markdown: string,
  allowFenceChanges = false,
): Promise<LiveEditResult | null> {
  return editNoteLive({
    vault: vaultDir,
    socket,
    idOrPath: id,
    transform: () => markdown,
    allowFenceChanges,
  });
}

/**
 * A compact description of the editor's top-level blocks, in order:
 * `img`, `table`, `quote`, `ul`, `ol`, `h2`, `pre`, `hr`, or the trimmed text.
 * Used to assert structure and ordering after agent edits.
 */
export async function editorBlocks(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const root = document.querySelector('main .ContentEditable__root');
    if (!root) return [];
    return Array.from(root.children).map((el) => {
      const tag = el.tagName.toLowerCase();
      // Decorators / wrappers don't map 1:1 to tags, so detect by content.
      if (el.classList.contains('editor-image') || el.querySelector('.editor-image')) return 'img';
      if (el.querySelector('table')) return 'table';
      if (tag === 'code' || el.classList.contains('editor-code') || el.querySelector('code')) {
        return 'pre';
      }
      if (tag === 'ul') return 'ul';
      if (tag === 'ol') return 'ol';
      if (tag === 'blockquote') return 'quote';
      if (tag === 'pre') return 'pre';
      if (tag === 'hr') return 'hr';
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') return tag;
      return (el.textContent ?? '').trim().slice(0, 40);
    });
  });
}

/**
 * Number of reference image blocks. Counts the decorator container
 * (`.editor-image`), which exists before a remote image finishes loading.
 */
export async function imageCount(window: Page): Promise<number> {
  return window.locator('main:visible .editor-image').count();
}

/**
 * Number of images that actually rendered an `<img>` (i.e. are *viewable*),
 * not just an image block. Remote URLs that fail to load show a placeholder
 * instead, so this is the assertion that distinguishes "present" from "usable".
 */
export async function renderedImageCount(window: Page): Promise<number> {
  return window.locator('main:visible .editor-image img').count();
}

/**
 * A tiny inline image. Unlike a remote URL this loads synchronously (no
 * network / hydration), so it renders a real `<img>` regardless of connectivity.
 */
export const INLINE_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
