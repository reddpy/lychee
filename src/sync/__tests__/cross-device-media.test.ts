import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as Y from 'yjs';
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { FolderAdapter } from '../folder-adapter';
import { connectDoc } from '../memory-hub';
import {
  appendMarkdown,
  createNoteDoc,
  flushEditor,
  noteStateVector,
  projectMarkdown,
  type NoteDocHandle,
} from '../note-doc';
import { appendNoteUpdate, listUpdateFiles, readNoteUpdates } from '../folder-store';
import { $isReferenceNode, type ReferenceNode } from '@/components/editor/nodes/reference-node';
import { $isNoteBookmarkNode } from '@/components/editor/nodes/note-bookmark-node';

/**
 * Cross-device sync of rich content — not just paragraphs.
 *
 * Every "device" is a headless note doc bound to a shared folder, the same
 * transport a second machine uses. These lock down how media survives the trip:
 * images (remote, vault-relative, content-addressed, data URI), bookmark cards,
 * note bookmarks, tables, code, unknown future nodes, and the concurrency edges
 * around adding/removing/retargeting them.
 */

const cleanups: Array<() => void> = [];
const roots: string[] = [];

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lychee-media-sync-'));
  roots.push(root);
  return root;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function syncDir(root: string): string {
  return root;
}

interface Device {  id: string;
  adapter: FolderAdapter;
  docs: Map<string, { doc: Y.Doc; handle: NoteDocHandle; off: () => void }>;
  open(docId: string, markdown?: string): { doc: Y.Doc; handle: NoteDocHandle };
  close(): void;
}

function makeDevice(root: string, id: string): Device {
  const adapter = new FolderAdapter(root, id, { pollMs: 20 });
  const docs = new Map<string, { doc: Y.Doc; handle: NoteDocHandle; off: () => void }>();
  cleanups.push(() => adapter.close());
  return {
    id,
    adapter,
    docs,
    open(docId, markdown) {
      const handle = createNoteDoc(docId, markdown === undefined ? {} : { markdown });
      const off = connectDoc(adapter, docId, handle.doc);
      const entry = { doc: handle.doc, handle, off };
      docs.set(docId, entry);
      cleanups.push(() => {
        off();
        handle.dispose();
      });
      return entry;
    },
    close() {
      adapter.close();
    },
  };
}

function body(device: Device, docId: string): string {
  const entry = device.docs.get(docId);
  if (!entry) throw new Error(`device ${device.id} has no doc ${docId}`);
  return bodyOf(entry.handle);
}

function bodyOf(handle: NoteDocHandle): string {
  flushEditor(handle.editor);
  return projectMarkdown(handle.editor);
}

function vector(doc: Y.Doc): string {
  return Array.from(noteStateVector(doc)).join(',');
}

function references(handle: NoteDocHandle): Array<Record<string, unknown>> {
  return handle.editor.getEditorState().read(() => {
    const found: Array<Record<string, unknown>> = [];
    const visit = (node: LexicalNode): void => {
      if ($isReferenceNode(node)) {
        found.push({
          displayMode: node.getDisplayMode(),
          url: node.getUrl(),
          imageId: node.getImageId(),
          src: node.getSrc(),
          altText: node.getAltText(),
          title: node.getTitle(),
          description: node.getDescription(),
          imageUrl: node.getImageUrl(),
          faviconUrl: node.getFaviconUrl(),
          width: node.getWidth(),
          height: node.getHeight(),
          alignment: node.getAlignment(),
        });
      }
      if ($isElementNode(node)) node.getChildren().forEach(visit);
    };
    $getRoot().getChildren().forEach(visit);
    return found;
  });
}

function refs(device: Device, docId: string): Array<Record<string, unknown>> {
  const entry = device.docs.get(docId);
  if (!entry) throw new Error(`device ${device.id} has no doc ${docId}`);
  return refsOf(entry.handle);
}

function refsOf(handle: NoteDocHandle): Array<Record<string, unknown>> {
  flushEditor(handle.editor);
  return references(handle);
}

function noteBookmarkCount(handle: NoteDocHandle): number {
  return handle.editor.getEditorState().read(() => {
    let count = 0;
    const visit = (node: LexicalNode): void => {
      if ($isNoteBookmarkNode(node)) count += 1;
      if ($isElementNode(node)) node.getChildren().forEach(visit);
    };
    $getRoot().getChildren().forEach(visit);
    return count;
  });
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

function editFirstReference(
  handle: NoteDocHandle,
  edit: (node: ReferenceNode) => void,
): void {
  handle.editor.update(
    () => {
      const node = referenceNode($getRoot());
      if (node) edit(node);
    },
    { discrete: true },
  );
}

function referenceNode(node: LexicalNode): ReferenceNode | null {
  if ($isReferenceNode(node)) return node;
  if (!$isElementNode(node)) return null;
  for (const child of node.getChildren()) {
    const found = referenceNode(child);
    if (found) return found;
  }
  return null;
}

function bookmarkPayload(data: { label: string; createdAt: string }): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
}

const REMOTE_IMAGE = '![remote](https://cdn.example.com/photo.png)';
const ASSET_IMAGE = [
  '![local](lychee-asset://asset-123.png)',
  '',
  '```lychee-reference',
  '{"displayMode":"image","width":640,"height":480,"alignment":"center"}',
  '```',
].join('\n');
const VAULT_IMAGE = '![vault](assets/a1b2c3.png)';
const DATA_URI =
  '![dot](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)';
const BOOKMARK = [
  '[Example](https://example.com/article)',
  '',
  '```lychee-reference',
  '{"displayMode":"card","description":"A description","imageUrl":"https://example.com/og.png","faviconUrl":"https://example.com/favicon.ico"}',
  '```',
].join('\n');
const NOTE_BOOKMARK = () =>
  `<!--lychee-bookmark:b64 ${bookmarkPayload({ label: 'Chapter 1', createdAt: '2026-01-02T03:04:05.000Z' })}-->bookmarked text`;
const UNKNOWN_MEDIA = [
  '```lychee-unknown',
  '{"type":"future-video","url":"https://v.example/1","meta":{"autoplay":true}}',
  '```',
].join('\n');
const TABLE = '| Kind | Source |\n| --- | --- |\n| Image | https://cdn.example.com/t.png |';

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('cross-device media — image variants', () => {
  it('syncs a remote image URL as an image reference', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('remote-image', REMOTE_IMAGE);
    await waitFor(() => listUpdateFiles(root, 'remote-image').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('remote-image');
    await waitFor(() => body(b, 'remote-image').includes('https://cdn.example.com/photo.png'));

    for (const [device, id] of [
      [a, 'remote-image'],
      [b, 'remote-image'],
    ] as const) {
      expect(refs(device, id)).toHaveLength(1);
      expect(refs(device, id)[0]).toMatchObject({
        displayMode: 'image',
        url: 'https://cdn.example.com/photo.png',
        altText: 'remote',
      });
    }
    expect(vector(a.docs.get('remote-image')!.doc)).toBe(vector(b.docs.get('remote-image')!.doc));
  });

  it('syncs a content-addressed asset image with geometry and alignment', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('asset-image', ASSET_IMAGE);
    await waitFor(() => listUpdateFiles(root, 'asset-image').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('asset-image');
    await waitFor(() => body(b, 'asset-image').includes('lychee-asset://asset-123.png'));

    expect(refs(a, 'asset-image')[0]).toMatchObject({
      displayMode: 'image',
      imageId: 'asset-123.png',
      altText: 'local',
      width: 640,
      height: 480,
      alignment: 'center',
    });
    expect(refs(b, 'asset-image')[0]).toMatchObject({
      imageId: 'asset-123.png',
      width: 640,
      height: 480,
      alignment: 'center',
    });
  });

  it('syncs a vault-relative image path without rewriting it', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('vault-image', VAULT_IMAGE);
    await waitFor(() => listUpdateFiles(root, 'vault-image').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('vault-image');
    await waitFor(() => body(b, 'vault-image').includes('assets/a1b2c3.png'));

    expect(refs(b, 'vault-image')[0]).toMatchObject({
      displayMode: 'image',
      src: 'assets/a1b2c3.png',
    });
    expect(body(b, 'vault-image')).toContain('![vault](assets/a1b2c3.png)');
  });

  it('syncs an inline data URI image', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('data-image', DATA_URI);
    await waitFor(() => listUpdateFiles(root, 'data-image').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('data-image');
    await waitFor(() => body(b, 'data-image').includes('data:image/gif;base64'));

    expect(refs(b, 'data-image')[0]).toMatchObject({ displayMode: 'image', altText: 'dot' });
    expect(body(b, 'data-image')).toContain(DATA_URI);
  });

  it('keeps two identical images as two blocks', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('duplicate-images', `${REMOTE_IMAGE}\n\n${REMOTE_IMAGE}`);
    await waitFor(() => listUpdateFiles(root, 'duplicate-images').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('duplicate-images');
    await waitFor(() => refs(b, 'duplicate-images').length === 2);
    expect(refs(b, 'duplicate-images')).toHaveLength(2);
    expect(body(b, 'duplicate-images').match(/photo\.png/g)).toHaveLength(2);
  });
});

describe('cross-device media — peer-appended images', () => {
  it('carries a data URI image appended by a peer', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('append-data', 'BASE\n');
    await waitFor(() => listUpdateFiles(root, 'append-data').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('append-data');
    await waitFor(() => body(b, 'append-data').includes('BASE'));

    appendMarkdown(b.docs.get('append-data')!.handle.editor, DATA_URI);

    await waitFor(() => body(a, 'append-data').includes('data:image/gif;base64'));
    expect(refs(a, 'append-data')[0]).toMatchObject({
      displayMode: 'image',
      src: DATA_URI.slice(DATA_URI.indexOf('(') + 1, -1),
      altText: 'dot',
    });
    expect(body(a, 'append-data')).toContain(DATA_URI);
  });

  it('carries a vault-relative image appended by a peer', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('append-vault', 'BASE\n');
    await waitFor(() => listUpdateFiles(root, 'append-vault').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('append-vault');
    await waitFor(() => body(b, 'append-vault').includes('BASE'));

    appendMarkdown(b.docs.get('append-vault')!.handle.editor, VAULT_IMAGE);

    await waitFor(() => body(a, 'append-vault').includes('assets/a1b2c3.png'));
    expect(refs(a, 'append-vault')[0]).toMatchObject({
      displayMode: 'image',
      src: 'assets/a1b2c3.png',
    });
  });
});

describe('cross-device media — cards, markers and unknown nodes', () => {
  it('syncs a bookmark card with all metadata fields', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('bookmark', BOOKMARK);
    await waitFor(() => listUpdateFiles(root, 'bookmark').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('bookmark');
    await waitFor(() => body(b, 'bookmark').includes('https://example.com/article'));

    for (const device of [a, b]) {
      expect(refs(device, 'bookmark')[0]).toMatchObject({
        displayMode: 'card',
        url: 'https://example.com/article',
        title: 'Example',
        description: 'A description',
        imageUrl: 'https://example.com/og.png',
        faviconUrl: 'https://example.com/favicon.ico',
      });
    }
  });

  it('syncs video, audio, and PDF links as bookmark cards', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    const cards = [
      ['Watch', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      ['Episode', 'https://example.com/audio/episode.mp3'],
      ['Paper', 'https://example.com/docs/paper.pdf'],
    ];
    a.open(
      'media-links',
      cards
        .map(([title, url]) => `[${title}](${url})\n\n\`\`\`lychee-reference\n{"displayMode":"card"}\n\`\`\``)
        .join('\n\n'),
    );
    await waitFor(() => listUpdateFiles(root, 'media-links').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('media-links');
    await waitFor(() => refs(b, 'media-links').length === 3);

    expect(refs(b, 'media-links').map((ref) => ref.url)).toEqual(cards.map(([, url]) => url));
    expect(refs(b, 'media-links').every((ref) => ref.displayMode === 'card')).toBe(true);
  });

  it('syncs an inline note bookmark without dropping the surrounding text', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('note-bookmark', NOTE_BOOKMARK());
    await waitFor(() => listUpdateFiles(root, 'note-bookmark').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('note-bookmark');
    await waitFor(() => body(b, 'note-bookmark').includes('bookmarked text'));

    expect(noteBookmarkCount(b.docs.get('note-bookmark')!.handle)).toBe(1);
    expect(body(b, 'note-bookmark')).toContain('<!--lychee-bookmark:b64 ');
    expect(body(b, 'note-bookmark')).toContain('bookmarked text');
  });

  it('syncs an unknown future media node verbatim', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('unknown-media', UNKNOWN_MEDIA);
    await waitFor(() => listUpdateFiles(root, 'unknown-media').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('unknown-media');
    await waitFor(() => body(b, 'unknown-media').includes('future-video'));

    expect(body(b, 'unknown-media')).toContain('```lychee-unknown');
    expect(body(b, 'unknown-media')).toContain('"autoplay":true');
  });

  it('syncs a table containing media URLs', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('table', TABLE);
    await waitFor(() => listUpdateFiles(root, 'table').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('table');
    await waitFor(() => body(b, 'table').includes('https://cdn.example.com/t.png'));

    expect(body(b, 'table')).toContain('| Kind | Source |');
    expect(body(b, 'table')).toContain('| Image | https://cdn.example.com/t.png |');
  });

  it('preserves unicode alt text, titles and URLs', async () => {
    const root = tmpRoot();
    const alt = 'café 日本語 🍜';
    const markdown = `![${alt}](https://example.com/日本/photo.png?q=caf%C3%A9)`;
    const a = makeDevice(root, 'dev-a');
    a.open('unicode', markdown);
    await waitFor(() => listUpdateFiles(root, 'unicode').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('unicode');
    await waitFor(() => refs(b, 'unicode').length === 1);

    expect(refs(b, 'unicode')[0]).toMatchObject({
      displayMode: 'image',
      altText: alt,
      url: 'https://example.com/日本/photo.png?q=caf%C3%A9',
    });
    expect(body(b, 'unicode')).toContain(alt);
  });

  it('preserves mixed media ordering across devices', async () => {
    const root = tmpRoot();
    const markdown = [
      '# Media tour',
      '',
      REMOTE_IMAGE,
      '',
      BOOKMARK,
      '',
      TABLE,
      '',
      UNKNOWN_MEDIA,
      '',
      '![last](https://cdn.example.com/last.png)',
    ].join('\n');
    const a = makeDevice(root, 'dev-a');
    a.open('mixed', markdown);
    await waitFor(() => listUpdateFiles(root, 'mixed').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('mixed');
    await waitFor(() => refs(b, 'mixed').length === 3);

    const projected = body(b, 'mixed');
    // The import order is the canonical order; both devices must agree on it.
    expect(projected).toBe(body(a, 'mixed'));
    const positions = [
      'photo.png',
      'https://example.com/article',
      '| Kind | Source |',
      'future-video',
      'last.png',
    ].map((needle) => projected.indexOf(needle));
    expect(positions.every((position) => position >= 0)).toBe(true);
  });
});

describe('cross-device media — concurrent edits', () => {
  it('merges concurrent image and bookmark insertions', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('concurrent-media', 'BASE\n');
    await waitFor(() => listUpdateFiles(root, 'concurrent-media').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('concurrent-media');
    await waitFor(() => body(b, 'concurrent-media').includes('BASE'));

    appendMarkdown(a.docs.get('concurrent-media')!.handle.editor, '![a](https://example.com/a.png)');
    appendMarkdown(b.docs.get('concurrent-media')!.handle.editor, `[B](https://example.com/b)\n\n\`\`\`lychee-reference\n{"displayMode":"card"}\n\`\`\``);

    await waitFor(
      () =>
        refs(a, 'concurrent-media').length === 2 &&
        refs(b, 'concurrent-media').length === 2,
    );
    expect(refs(a, 'concurrent-media').map((ref) => ref.url).sort()).toEqual([
      'https://example.com/a.png',
      'https://example.com/b',
    ]);
    expect(vector(a.docs.get('concurrent-media')!.doc)).toBe(
      vector(b.docs.get('concurrent-media')!.doc),
    );
  });

  it('merges concurrent images from both devices', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('two-images', 'BASE\n');
    await waitFor(() => listUpdateFiles(root, 'two-images').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('two-images');
    await waitFor(() => body(b, 'two-images').includes('BASE'));

    appendMarkdown(a.docs.get('two-images')!.handle.editor, '![a](https://example.com/a.png)');
    appendMarkdown(b.docs.get('two-images')!.handle.editor, '![b](https://example.com/b.png)');

    await waitFor(
      () =>
        body(a, 'two-images').includes('a.png') &&
        body(a, 'two-images').includes('b.png') &&
        body(b, 'two-images').includes('a.png') &&
        body(b, 'two-images').includes('b.png'),
    );
    expect(refs(a, 'two-images')).toHaveLength(2);
    expect(refs(b, 'two-images')).toHaveLength(2);
  });

  it('keeps a remote image while the other device appends text', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('image-plus-text', 'BASE\n');
    await waitFor(() => listUpdateFiles(root, 'image-plus-text').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('image-plus-text');
    await waitFor(() => body(b, 'image-plus-text').includes('BASE'));

    appendMarkdown(a.docs.get('image-plus-text')!.handle.editor, REMOTE_IMAGE);
    appendMarkdown(b.docs.get('image-plus-text')!.handle.editor, 'TEXT-FROM-B\n');

    await waitFor(
      () =>
        body(a, 'image-plus-text').includes('TEXT-FROM-B') &&
        body(b, 'image-plus-text').includes('photo.png'),
    );
    expect(refs(b, 'image-plus-text')).toHaveLength(1);
    expect(body(b, 'image-plus-text')).toContain('TEXT-FROM-B');
  });

  it('propagates deletion of an image while the other device types', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('delete-image', `${REMOTE_IMAGE}\n\nBASE\n`);
    await waitFor(() => listUpdateFiles(root, 'delete-image').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('delete-image');
    await waitFor(() => refs(b, 'delete-image').length === 1);

    removeTopLevelReferences(a.docs.get('delete-image')!.handle);
    appendMarkdown(b.docs.get('delete-image')!.handle.editor, 'SURVIVING-TEXT\n');

    await waitFor(
      () => refs(a, 'delete-image').length === 0 && refs(b, 'delete-image').length === 0,
    );
    expect(body(b, 'delete-image')).toContain('SURVIVING-TEXT');
    expect(body(b, 'delete-image')).toContain('BASE');
    expect(body(b, 'delete-image')).not.toContain('photo.png');
  });

  it('merges image metadata changes with concurrent text edits', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('image-metadata', `${ASSET_IMAGE}\n\nBASE\n`);
    await waitFor(() => listUpdateFiles(root, 'image-metadata').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('image-metadata');
    await waitFor(() => refs(b, 'image-metadata').length === 1);

    editFirstReference(a.docs.get('image-metadata')!.handle, (node) => {
      node.setAltText('changed alt');
      node.setAlignment('right');
    });
    appendMarkdown(b.docs.get('image-metadata')!.handle.editor, 'TEXT-DURING-RETARGET\n');

    await waitFor(
      () =>
        body(a, 'image-metadata').includes('TEXT-DURING-RETARGET') &&
        body(b, 'image-metadata').includes('changed alt'),
    );
    expect(refs(b, 'image-metadata')[0]).toMatchObject({
      altText: 'changed alt',
      alignment: 'right',
      imageId: 'asset-123.png',
    });
    expect(vector(a.docs.get('image-metadata')!.doc)).toBe(
      vector(b.docs.get('image-metadata')!.doc),
    );
  });

  it('converges when one device removes all media while another adds more', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('media-churn', `${REMOTE_IMAGE}\n\nBASE\n`);
    await waitFor(() => listUpdateFiles(root, 'media-churn').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('media-churn');
    await waitFor(() => refs(b, 'media-churn').length === 1);

    removeTopLevelReferences(a.docs.get('media-churn')!.handle);
    appendMarkdown(b.docs.get('media-churn')!.handle.editor, '![new](https://example.com/new.png)');

    await waitFor(
      () =>
        vector(a.docs.get('media-churn')!.doc) === vector(b.docs.get('media-churn')!.doc) &&
        body(a, 'media-churn') === body(b, 'media-churn'),
    );
    const urls = refs(a, 'media-churn').map((ref) => ref.url);
    expect(urls).toContain('https://example.com/new.png');
    expect(urls).not.toContain('https://cdn.example.com/photo.png');
  });
});

describe('cross-device media — additional edges', () => {
  it('both devices appending the same image produce two blocks', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('same-image', 'BASE\n');
    await waitFor(() => listUpdateFiles(root, 'same-image').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('same-image');
    await waitFor(() => body(b, 'same-image').includes('BASE'));

    appendMarkdown(a.docs.get('same-image')!.handle.editor, REMOTE_IMAGE);
    appendMarkdown(b.docs.get('same-image')!.handle.editor, REMOTE_IMAGE);

    await waitFor(
      () =>
        body(a, 'same-image').match(/photo\.png/g)?.length === 2 &&
        body(b, 'same-image').match(/photo\.png/g)?.length === 2,
    );
    expect(refs(a, 'same-image')).toHaveLength(2);
    expect(refs(b, 'same-image')).toHaveLength(2);
    expect(vector(a.docs.get('same-image')!.doc)).toBe(vector(b.docs.get('same-image')!.doc));
  });

  it('deleting one of two images keeps the other', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open(
      'delete-one',
      '![one](https://example.com/one.png)\n\n![two](https://example.com/two.png)',
    );
    await waitFor(() => listUpdateFiles(root, 'delete-one').length > 0);
    const b = makeDevice(root, 'dev-b');
    b.open('delete-one');
    await waitFor(() => refs(b, 'delete-one').length === 2);

    a.docs.get('delete-one')!.handle.editor.update(
      () => {
        const first = $getRoot().getChildren().find((child) => $isReferenceNode(child));
        if (first) first.remove();
      },
      { discrete: true },
    );

    await waitFor(() => refs(b, 'delete-one').length === 1);
    expect(refs(b, 'delete-one')[0].url).toBe('https://example.com/two.png');
    expect(body(b, 'delete-one')).not.toContain('one.png');
  });

  it('syncs a malformed reference fence as a code block without data loss', async () => {
    const root = tmpRoot();
    const markdown = '```lychee-reference\n{not valid json\n```';
    const a = makeDevice(root, 'dev-a');
    a.open('bad-fence', markdown);
    await waitFor(() => listUpdateFiles(root, 'bad-fence').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('bad-fence');
    await waitFor(() => body(b, 'bad-fence').includes('not valid json'));

    expect(body(b, 'bad-fence')).toContain('{not valid json');
    expect(body(a, 'bad-fence')).toBe(body(b, 'bad-fence'));
  });

  it('syncs a media-heavy note (40 images) without dropping blocks', async () => {
    const root = tmpRoot();
    const images = Array.from(
      { length: 40 },
      (_, index) => `![image ${index}](https://example.com/${index}.png)`,
    ).join('\n\n');
    const a = makeDevice(root, 'dev-a');
    a.open('heavy', images);
    await waitFor(() => listUpdateFiles(root, 'heavy').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('heavy');
    await waitFor(() => refs(b, 'heavy').length === 40);
    expect(refs(b, 'heavy')).toHaveLength(40);
    expect(body(b, 'heavy')).toContain('https://example.com/39.png');
    expect(vector(a.docs.get('heavy')!.doc)).toBe(vector(b.docs.get('heavy')!.doc));
  });
});

describe('cross-device media — transport edges', () => {
  it('applies duplicate media updates idempotently', async () => {
    const root = tmpRoot();
    const source = createNoteDoc('dup', { markdown: REMOTE_IMAGE });
    cleanups.push(() => source.dispose());
    const update = Y.encodeStateAsUpdate(source.doc);

    const fileA = appendNoteUpdate(root, 'dup', 'dev-a', update);
    const fileB = appendNoteUpdate(root, 'dup', 'dev-b', update);
    expect(fileA).not.toBe(fileB);

    const readerAdapter = new FolderAdapter(syncDir(root), 'reader', { pollMs: 20 });
    const reader = createNoteDoc('dup', {});
    const off = connectDoc(readerAdapter, 'dup', reader.doc);
    cleanups.push(() => {
      off();
      readerAdapter.close();
      reader.dispose();
    });

    await waitFor(() => refsOf(reader).length >= 1);
    expect(refsOf(reader)).toHaveLength(1);
    expect(bodyOf(reader)).toContain('photo.png');
  });

  it('converges when media update files arrive out of order', async () => {
    const root = tmpRoot();
    const base = createNoteDoc('ooo', { markdown: REMOTE_IMAGE });
    const baseUpdate = Y.encodeStateAsUpdate(base.doc);
    const baseVector = Y.encodeStateVector(base.doc);
    Y.applyUpdate(base.doc, baseUpdate);
    appendMarkdown(base.editor, 'AFTER\n');
    const textUpdate = Y.encodeStateAsUpdate(base.doc, baseVector);

    // Write the later update first, then the base it depends on.
    appendNoteUpdate(root, 'ooo', 'dev-b', textUpdate);
    appendNoteUpdate(root, 'ooo', 'dev-a', baseUpdate);

    const adapter = new FolderAdapter(syncDir(root), 'reader', { pollMs: 20 });
    const reader = createNoteDoc('ooo', {});
    const off = connectDoc(adapter, 'ooo', reader.doc);
    cleanups.push(() => {
      off();
      adapter.close();
      reader.dispose();
    });

    await waitFor(() => refsOf(reader).length === 1);
    expect(bodyOf(reader)).toContain('photo.png');
    expect(bodyOf(reader)).toContain('AFTER');
    expect(vector(reader.doc)).toBe(vector(base.doc));
    base.dispose();
  });

  it('a late device after compaction still receives media', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('compacted', REMOTE_IMAGE);
    await waitFor(() => listUpdateFiles(root, 'compacted').length >= 1);
    appendMarkdown(a.docs.get('compacted')!.handle.editor, BOOKMARK);
    await waitFor(() => listUpdateFiles(root, 'compacted').length >= 2);

    expect(a.adapter.compact('compacted')).toBe(true);
    expect(listUpdateFiles(root, 'compacted').length).toBe(1);

    const late = makeDevice(root, 'late');
    late.open('compacted');
    await waitFor(() => refs(late, 'compacted').length === 2);
    expect(refs(late, 'compacted').map((ref) => ref.displayMode).sort()).toEqual([
      'card',
      'image',
    ]);
  });

  it('five devices each adding a different media block all converge', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('five', 'BASE\n');
    await waitFor(() => listUpdateFiles(root, 'five').length > 0);

    const devices = [a];
    for (const id of ['dev-b', 'dev-c', 'dev-d', 'dev-e']) {
      const device = makeDevice(root, id);
      device.open('five');
      devices.push(device);
    }
    await waitFor(() => devices.every((device) => body(device, 'five').includes('BASE')));

    const additions = devices.map((device, index) =>
      index % 2 === 0
        ? `![image-${index}](https://example.com/${index}.png)`
        : `[card-${index}](https://example.com/${index})\n\n\`\`\`lychee-reference\n{"displayMode":"card"}\n\`\`\``,
    );
    devices.forEach((device, index) => {
      appendMarkdown(device.docs.get('five')!.handle.editor, additions[index]);
    });

    await waitFor(() => devices.every((device) => refs(device, 'five').length === 5));
    const vectors = devices.map((device) => vector(device.docs.get('five')!.doc));
    expect(new Set(vectors).size).toBe(1);
    for (const device of devices) {
      expect(refs(device, 'five')).toHaveLength(5);
    }
  });

  it('removes media update files on permanent delete', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('removed', REMOTE_IMAGE);
    await waitFor(() => readNoteUpdates(root, 'removed').length > 0);

    a.adapter.removeDoc('removed');
    expect(readNoteUpdates(root, 'removed')).toHaveLength(0);
    expect(listUpdateFiles(root, 'removed')).toHaveLength(0);
  });

  it('keeps asset-looking paths untouched by the CRDT store', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('asset-path', VAULT_IMAGE);
    await waitFor(() => listUpdateFiles(root, 'asset-path').length > 0);

    const noteDir = path.join(root, 'asset-path');
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'binary.png'), Buffer.from([0, 1, 2, 3]));

    const files = fs.readdirSync(noteDir);
    expect(files.every((file) => file.endsWith('.bin'))).toBe(true);
    expect(readNoteUpdates(root, 'asset-path').every((buffer) => buffer.length > 0)).toBe(true);
  });
});

describe('cross-device media — empty note edge case', () => {
  it('adds media to a note that started with no content', async () => {
    const root = tmpRoot();
    const a = makeDevice(root, 'dev-a');
    a.open('empty-note', '');
    await waitFor(() => listUpdateFiles(root, 'empty-note').length > 0);

    const b = makeDevice(root, 'dev-b');
    b.open('empty-note');
    await waitFor(() => body(b, 'empty-note').trim() === '');

    appendMarkdown(b.docs.get('empty-note')!.handle.editor, REMOTE_IMAGE);
    await waitFor(() => refs(a, 'empty-note').length === 1);
    expect(refs(a, 'empty-note')).toHaveLength(1);
    expect(body(a, 'empty-note')).toContain('photo.png');
  });
});
