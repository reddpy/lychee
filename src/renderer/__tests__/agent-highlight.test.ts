import { describe, it, expect, afterEach } from 'vitest';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { bootstrapFromMarkdown, createNoteDoc, type NoteDocHandle } from '@/sync/note-doc';
import { changedTopLevelKeys } from '../agent-highlight';
import { $createReferenceNode } from '@/components/editor/nodes/reference-node';

const handles: NoteDocHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

function textOfKey(handle: NoteDocHandle, key: string): string | null {
  return handle.editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) {
      if (child.getKey() === key) return child.getTextContent();
    }
    return null;
  });
}

describe('changedTopLevelKeys', () => {
  it('flags only the appended block after a full document replace', () => {
    // The agent edits via `bootstrapFromMarkdown` (clear + re-import), so every
    // block gets a new node key even though most content is untouched.
    const note = createNoteDoc('h', { markdown: 'first\n\nsecond\n' });
    handles.push(note);
    const prev = note.editor.getEditorState();

    bootstrapFromMarkdown(note.editor, 'first\n\nsecond\n\nthird\n');
    const next = note.editor.getEditorState();

    const changed = changedTopLevelKeys(prev, next);
    expect(changed).toHaveLength(1);
    expect(textOfKey(note, changed[0])).toBe('third');
  });

  it('flags a block whose text changed, not its unchanged neighbours', () => {
    const note = createNoteDoc('h2', { markdown: 'alpha\n\nbeta\n' });
    handles.push(note);
    const prev = note.editor.getEditorState();

    bootstrapFromMarkdown(note.editor, 'alpha\n\nbeta edited\n');
    const changed = changedTopLevelKeys(prev, note.editor.getEditorState());

    expect(changed).toHaveLength(1);
    expect(textOfKey(note, changed[0])).toBe('beta edited');
  });

  it('flags nothing when the content is identical (new keys, same content)', () => {
    const note = createNoteDoc('h3', { markdown: 'same\n' });
    handles.push(note);
    const prev = note.editor.getEditorState();

    bootstrapFromMarkdown(note.editor, 'same\n');

    expect(changedTopLevelKeys(prev, note.editor.getEditorState())).toEqual([]);
  });

  it('flags a newly added block', () => {
    const note = createNoteDoc('h4', { markdown: 'first\n' });
    handles.push(note);
    const prev = note.editor.getEditorState();

    note.editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('added')));
      },
      { discrete: true },
    );

    const changed = changedTopLevelKeys(prev, note.editor.getEditorState());
    expect(changed).toHaveLength(1);
    expect(textOfKey(note, changed[0])).toBe('added');
  });

  it('does not flag unchanged media across a full replace (volatile fields ignored)', () => {
    const note = createNoteDoc('img', {});
    handles.push(note);
    note.editor.update(
      () => {
        $getRoot().append(
          $createReferenceNode({
            displayMode: 'image',
            url: 'https://example.com/a.png',
            altText: 'a',
          }),
        );
      },
      { discrete: true },
    );
    const prev = note.editor.getEditorState();

    // Re-imports the same image (now with `loading` set by the importer) plus a
    // new text block. Only the text block should be flagged.
    bootstrapFromMarkdown(note.editor, '![a](https://example.com/a.png)\n\nnew text\n');
    const changed = changedTopLevelKeys(prev, note.editor.getEditorState());

    expect(changed).toHaveLength(1);
    expect(textOfKey(note, changed[0])).toBe('new text');
  });

  it('flags an added image block', () => {
    const note = createNoteDoc('img2', { markdown: 'hello\n' });
    handles.push(note);
    const prev = note.editor.getEditorState();

    note.editor.update(
      () => {
        $getRoot().append(
          $createReferenceNode({
            displayMode: 'image',
            url: 'https://example.com/b.png',
            altText: 'b',
          }),
        );
      },
      { discrete: true },
    );

    const changed = changedTopLevelKeys(prev, note.editor.getEditorState());
    expect(changed).toHaveLength(1);
  });

  it('flags added structural blocks (heading, list, quote, table, code)', () => {
    const note = createNoteDoc('struct', { markdown: 'base\n' });
    handles.push(note);
    const prev = note.editor.getEditorState();

    bootstrapFromMarkdown(
      note.editor,
      'base\n\n## Heading\n\n- a\n- b\n\n> quoted\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```\n',
    );

    const changed = changedTopLevelKeys(prev, note.editor.getEditorState());
    // `base` is unchanged; the five new blocks are all flagged.
    expect(changed).toHaveLength(5);
  });
});
