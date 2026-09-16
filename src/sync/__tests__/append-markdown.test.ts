import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { MemoryHub, connectDoc } from '../memory-hub';
import {
  appendMarkdown,
  createNoteDoc,
  flushEditor,
  projectMarkdown,
} from '../note-doc';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

/** Reference blocks (images/media) in document order, by url. */
function referenceUrls(doc: Y.Doc): string[] {
  const root = doc.get('root') as Y.XmlText;
  const urls: string[] = [];
  for (const d of root.toDelta()) {
    const ins = d.insert as {
      constructor?: { name?: string };
      getAttribute?: (name: string) => unknown;
    };
    if (ins?.constructor?.name === 'YXmlElement') {
      urls.push(String(ins.getAttribute?.('__url') ?? ''));
    }
  }
  return urls;
}

describe('appendMarkdown', () => {
  it('keeps existing images and their order across repeated appends', () => {
    const app = createNoteDoc('n', { markdown: 'start text\n' });
    const peer = createNoteDoc('n');
    cleanups.push(() => app.dispose(), () => peer.dispose());
    Y.applyUpdate(peer.doc, Y.encodeStateAsUpdate(app.doc));
    flushEditor(peer.editor);

    const hub = new MemoryHub();
    cleanups.push(connectDoc(hub, 'n', app.doc));
    cleanups.push(connectDoc(hub, 'n', peer.doc));

    for (const n of [1, 2, 3]) {
      appendMarkdown(peer.editor, `![img${n}](https://example.com/${n}.png)\n`);
      flushEditor(app.editor);
    }

    expect(referenceUrls(app.doc)).toEqual([
      'https://example.com/1.png',
      'https://example.com/2.png',
      'https://example.com/3.png',
    ]);
    // The app's editor and doc agree.
    expect(projectMarkdown(app.editor)).toContain('example.com/3.png');
  });

  it('handles many mixed text/image appends without duplication or loss', () => {
    const app = createNoteDoc('n', { markdown: 'start\n' });
    const peer = createNoteDoc('n');
    cleanups.push(() => app.dispose(), () => peer.dispose());
    Y.applyUpdate(peer.doc, Y.encodeStateAsUpdate(app.doc));
    flushEditor(peer.editor);

    const hub = new MemoryHub();
    cleanups.push(connectDoc(hub, 'n', app.doc));
    cleanups.push(connectDoc(hub, 'n', peer.doc));

    const expectedRefs: string[] = [];
    const expectedParagraphs: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      if (i % 3 === 1) {
        const url = `https://example.com/m${i}.png`;
        expectedRefs.push(url);
        appendMarkdown(peer.editor, `![m${i}](${url})\n`);
      } else {
        expectedParagraphs.push(`paragraph ${i}`);
        appendMarkdown(peer.editor, `paragraph ${i}\n`);
      }
      flushEditor(app.editor);
    }

    // Every reference, in order, exactly once.
    expect(referenceUrls(app.doc)).toEqual(expectedRefs);
    // Every paragraph, in order, exactly once — not just the last one.
    const paragraphs = projectMarkdown(app.editor)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('paragraph '));
    expect(paragraphs).toEqual(expectedParagraphs);
  });
});
