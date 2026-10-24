import path from 'path';
import { $getRoot } from 'lexical';
import { test, expect } from './electron-app';
import { openLiveNote } from './mcp-live-helpers';
import { readRaw, typeInBody, waitForContent } from './vault-helpers';
import { FolderAdapter } from '../src/sync/folder-adapter';
import { connectDoc } from '../src/sync/memory-hub';
import { CRDT_SYNC_DIRECTORY, listUpdateFiles } from '../src/sync/folder-store';
import {
  appendMarkdown,
  createNoteDoc,
  flushEditor,
  projectMarkdown,
  type NoteDocHandle,
} from '../src/sync/note-doc';
import { $isReferenceNode } from '../src/components/editor/nodes/reference-node';

/**
 * Cross-device MEDIA in the running app.
 *
 * A second device is a headless Y.Doc + FolderAdapter writing to the app's
 * `.lychee/sync` folder. Each test asserts what the user sees in the live editor
 * AND what lands in the markdown file, for every content kind the editor
 * supports: remote/local/data images, bookmark cards, tables, note bookmarks,
 * unknown future nodes, and deletion while the user is typing.
 */

test.use({ yjsFlag: true });

const DATA_URI =
  '![dot](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)';

function bookmarkCard(title: string, url: string, description = ''): string {
  const extras = JSON.stringify({ displayMode: 'card', description });
  return `[${title}](${url})\n\n\`\`\`lychee-reference\n${extras}\n\`\`\``;
}

function unknownMedia(): string {
  return '```lychee-unknown\n{"type":"future-video","url":"https://v.example/1","meta":{"autoplay":true}}\n```';
}

function noteBookmark(label: string, createdAt = '2026-01-02T03:04:05.000Z'): string {
  const payload = Buffer.from(JSON.stringify({ label, createdAt }), 'utf8').toString('base64');
  return `<!--lychee-bookmark:b64 ${payload}-->`;
}

function removeTopLevelReferences(handle: NoteDocHandle): void {
  handle.editor.update(
    () => {
      for (const child of $getRoot().getChildren()) {
        if ($isReferenceNode(child)) child.remove();
      }
    },
    { discrete: true },
  );
}

interface RemoteDevice {
  root: string;
  adapter: FolderAdapter;
  remote: NoteDocHandle;
  off: () => void;
  markdown(): string;
}

function joinRemote(vaultDir: string, docId: string, deviceId = 'remote-device'): RemoteDevice {
  const root = path.join(vaultDir, CRDT_SYNC_DIRECTORY);
  const adapter = new FolderAdapter(root, deviceId, { pollMs: 80 });
  const remote = createNoteDoc(docId, {});
  const off = connectDoc(adapter, docId, remote.doc);
  return {
    root,
    adapter,
    remote,
    off,
    markdown() {
      flushEditor(remote.editor);
      return projectMarkdown(remote.editor);
    },
  };
}

function closeRemote(device: RemoteDevice): void {
  device.off();
  device.adapter.close();
  device.remote.dispose();
}

async function waitForAppUpload(vaultDir: string, docId: string): Promise<void> {
  const root = path.join(vaultDir, CRDT_SYNC_DIRECTORY);
  await expect.poll(() => listUpdateFiles(root, docId).length, { timeout: 10_000 }).toBeGreaterThan(0);
}

test.describe('cross-device media — app receives remote content', () => {
  test('a remote image URL appears in the editor and markdown file', async ({
    window,
    vaultDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Remote Image');
    await typeInBody(window, 'IMAGE-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('IMAGE-BASE');

      appendMarkdown(remote.remote.editor, '![remote](https://cdn.example.com/photo.png)');

      await expect(body.locator('.editor-image')).toHaveCount(1, { timeout: 10_000 });
      await expect(body).toContainText('IMAGE-BASE');
      await waitForContent(vaultDir, 'Remote Image.md', 'cdn.example.com/photo.png');
      expect(readRaw(vaultDir, 'Remote Image.md')).toContain('![remote](https://cdn.example.com/photo.png)');
    } finally {
      closeRemote(remote);
    }
  });

  test('an inline data URI image renders a real <img>', async ({ window, vaultDir }) => {
    const { docId, body } = await openLiveNote(window, 'Data Image');
    await typeInBody(window, 'DATA-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('DATA-BASE');
      appendMarkdown(remote.remote.editor, DATA_URI);

      await expect(body.locator('.editor-image')).toHaveCount(1, { timeout: 10_000 });
      await expect.poll(() => body.locator('.editor-image img').count(), { timeout: 10_000 }).toBe(1);
      await expect(body).toContainText('DATA-BASE');
      await waitForContent(vaultDir, 'Data Image.md', 'data:image/gif;base64');
    } finally {
      closeRemote(remote);
    }
  });

  test('a remote bookmark card renders as a card and keeps its metadata', async ({
    window,
    vaultDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Remote Bookmark');
    await typeInBody(window, 'BOOKMARK-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('BOOKMARK-BASE');      appendMarkdown(
        remote.remote.editor,
        bookmarkCard('Example', 'https://example.com/article', 'A description'),
      );

      await expect(body.locator('.editor-bookmark')).toHaveCount(1, { timeout: 10_000 });
      await expect(body).toContainText('Example');
      await waitForContent(vaultDir, 'Remote Bookmark.md', 'https://example.com/article');
      await waitForContent(vaultDir, 'Remote Bookmark.md', 'A description');
    } finally {
      closeRemote(remote);
    }
  });

  test('a remote table renders as a table', async ({ window, vaultDir }) => {
    const { docId, body } = await openLiveNote(window, 'Remote Table');
    await typeInBody(window, 'TABLE-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('TABLE-BASE');      appendMarkdown(
        remote.remote.editor,
        '| Kind | Source |\n| --- | --- |\n| Image | https://cdn.example.com/t.png |',
      );

      await expect(body.locator('table')).toBeVisible({ timeout: 10_000 });
      await expect(body).toContainText('https://cdn.example.com/t.png');
      await waitForContent(vaultDir, 'Remote Table.md', '| Kind | Source |');
    } finally {
      closeRemote(remote);
    }
  });

  test('an unknown future media node is preserved verbatim', async ({ window, vaultDir }) => {
    const { docId, body } = await openLiveNote(window, 'Unknown Media');
    await typeInBody(window, 'UNKNOWN-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('UNKNOWN-BASE');      appendMarkdown(remote.remote.editor, unknownMedia());

      await expect(body.locator('[data-unknown-type="future-video"]')).toHaveCount(1, {
        timeout: 10_000,
      });
      await waitForContent(vaultDir, 'Unknown Media.md', '"future-video"');
      expect(readRaw(vaultDir, 'Unknown Media.md')).toContain('"autoplay":true');
    } finally {
      closeRemote(remote);
    }
  });

  test('a remote inline note bookmark survives with its text', async ({ window, vaultDir }) => {
    const { docId, body } = await openLiveNote(window, 'Remote Note Bookmark');
    await typeInBody(window, 'NOTE-BOOKMARK-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('NOTE-BOOKMARK-BASE');      appendMarkdown(remote.remote.editor, `${noteBookmark('Chapter 1')}bookmarked text`);

      await expect(body.locator('.editor-note-bookmark')).toHaveCount(1, { timeout: 10_000 });
      await expect(body).toContainText('bookmarked text');
      await waitForContent(vaultDir, 'Remote Note Bookmark.md', '<!--lychee-bookmark:b64 ');
      await waitForContent(vaultDir, 'Remote Note Bookmark.md', 'bookmarked text');
    } finally {
      closeRemote(remote);
    }
  });

  test('video, audio, and PDF links arrive as bookmark cards', async ({ window, vaultDir }) => {
    const { docId, body } = await openLiveNote(window, 'Media Links');
    await typeInBody(window, 'LINKS-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('LINKS-BASE');      appendMarkdown(
        remote.remote.editor,
        [
          bookmarkCard('Watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
          bookmarkCard('Episode', 'https://example.com/audio/episode.mp3'),
          bookmarkCard('Paper', 'https://example.com/docs/paper.pdf'),
        ].join('\n\n'),
      );

      await expect(body.locator('.editor-bookmark')).toHaveCount(3, { timeout: 10_000 });
      const file = () => readRaw(vaultDir, 'Media Links.md');
      await waitForContent(vaultDir, 'Media Links.md', 'youtube.com/watch');
      await waitForContent(vaultDir, 'Media Links.md', 'episode.mp3');
      await waitForContent(vaultDir, 'Media Links.md', 'paper.pdf');
      expect(file()).toContain('dQw4w9WgXcQ');
    } finally {
      closeRemote(remote);
    }
  });

  test('multiple media kinds in one remote update all land together', async ({
    window,
    vaultDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Mixed Media');
    await typeInBody(window, 'MIXED-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('MIXED-BASE');      appendMarkdown(
        remote.remote.editor,
        [
          'INTRO',
          '',
          '![remote](https://cdn.example.com/photo.png)',
          '',
          bookmarkCard('Example', 'https://example.com/article'),
          '',
          '| A | B |\n| --- | --- |\n| 1 | 2 |',
          '',
          unknownMedia(),
        ].join('\n'),
      );

      await expect(body.locator('.editor-image')).toHaveCount(1, { timeout: 10_000 });
      await expect(body.locator('.editor-bookmark')).toHaveCount(1, { timeout: 10_000 });
      await expect(body.locator('table')).toBeVisible({ timeout: 10_000 });
      await expect(body.locator('[data-unknown-type="future-video"]')).toHaveCount(1, {
        timeout: 10_000,
      });
      await expect(body).toContainText('INTRO');
      await waitForContent(vaultDir, 'Mixed Media.md', 'future-video');
    } finally {
      closeRemote(remote);
    }
  });
});

test.describe('cross-device media — concurrent and destructive edits', () => {
  test('a remote image inserted mid-typing loses neither side', async ({ window, vaultDir }) => {
    const { docId, body } = await openLiveNote(window, 'Typing And Image');
    await typeInBody(window, 'TYPING-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('TYPING-BASE');

      await body.click();
      const typing = window.keyboard.type('LOCAL-TYPED-ACROSS-IMAGE', { delay: 60 });
      setTimeout(
        () => appendMarkdown(remote.remote.editor, '![remote](https://cdn.example.com/photo.png)'),
        300,
      );
      await typing;
      await window.waitForTimeout(700);

      await expect(body.locator('.editor-image')).toHaveCount(1, { timeout: 10_000 });
      await expect(body).toContainText('LOCAL-TYPED-ACROSS-IMAGE');
      await expect(body).toContainText('TYPING-BASE');
      await waitForContent(vaultDir, 'Typing And Image.md', 'LOCAL-TYPED-ACROSS-IMAGE');
      await waitForContent(vaultDir, 'Typing And Image.md', 'photo.png');
    } finally {
      closeRemote(remote);
    }
  });

  test('a remotely deleted image disappears while local typing survives', async ({
    window,
    vaultDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Delete Remote Image');
    await typeInBody(window, 'DELETE-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('DELETE-BASE');
      appendMarkdown(remote.remote.editor, '![remote](https://cdn.example.com/photo.png)');
      await expect(body.locator('.editor-image')).toHaveCount(1, { timeout: 10_000 });

      await body.getByText('DELETE-BASE').click();
      await window.keyboard.press('End');
      const typing = window.keyboard.type('LOCAL-AFTER-DELETE', { delay: 60 });
      setTimeout(() => removeTopLevelReferences(remote.remote), 300);
      await typing;
      await window.waitForTimeout(700);

      await expect(body.locator('.editor-image')).toHaveCount(0, { timeout: 10_000 });
      await expect(body).toContainText('LOCAL-AFTER-DELETE');
      await expect(body).toContainText('DELETE-BASE');
      await waitForContent(vaultDir, 'Delete Remote Image.md', 'LOCAL-AFTER-DELETE');
      await expect
        .poll(() => readRaw(vaultDir, 'Delete Remote Image.md').includes('photo.png'), {
          timeout: 10_000,
        })
        .toBe(false);
    } finally {
      closeRemote(remote);
    }
  });

  test('a remote bookmark added while the user types survives', async ({ window, vaultDir }) => {
    const { docId, body } = await openLiveNote(window, 'Typing And Bookmark');
    await typeInBody(window, 'BOOKMARK-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('BOOKMARK-BASE');

      await body.click();
      const typing = window.keyboard.type('LOCAL-TYPED-WITH-BOOKMARK', { delay: 60 });
      setTimeout(
        () =>
          appendMarkdown(
            remote.remote.editor,
            bookmarkCard('Example', 'https://example.com/article'),
          ),
        300,
      );
      await typing;
      await window.waitForTimeout(700);

      await expect(body.locator('.editor-bookmark')).toHaveCount(1, { timeout: 10_000 });
      await expect(body).toContainText('LOCAL-TYPED-WITH-BOOKMARK');
      await waitForContent(vaultDir, 'Typing And Bookmark.md', 'https://example.com/article');
      await waitForContent(vaultDir, 'Typing And Bookmark.md', 'LOCAL-TYPED-WITH-BOOKMARK');
    } finally {
      closeRemote(remote);
    }
  });

  test('remote media persists after the app writes the markdown file', async ({
    window,
    vaultDir,
  }) => {
    const { docId, body } = await openLiveNote(window, 'Persisted Media');
    await typeInBody(window, 'PERSISTED-BASE');
    await waitForAppUpload(vaultDir, docId);

    const remote = joinRemote(vaultDir, docId);
    try {
      await expect.poll(() => remote.markdown(), { timeout: 10_000 }).toContain('PERSISTED-BASE');      appendMarkdown(
        remote.remote.editor,
        `![remote](https://cdn.example.com/photo.png)\n\n${bookmarkCard(
          'Example',
          'https://example.com/article',
        )}`,
      );

      await expect(body.locator('.editor-image')).toHaveCount(1, { timeout: 10_000 });
      await expect(body.locator('.editor-bookmark')).toHaveCount(1, { timeout: 10_000 });

      // Force a normal app-side write-through.
      await window.evaluate(
        async (id) => {
          await (window as any).lychee.invoke('documents.update', { id, emoji: '📎' });
        },
        docId,
      );
      await window.waitForTimeout(700);

      const file = readRaw(vaultDir, 'Persisted Media.md');
      expect(file).toContain('cdn.example.com/photo.png');
      expect(file).toContain('https://example.com/article');
    } finally {
      closeRemote(remote);
    }
  });
});
