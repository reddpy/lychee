import { describe, it, expect, afterEach } from 'vitest';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { bootstrapFromMarkdown, createNoteDoc, type NoteDocHandle } from '@/sync/note-doc';
import { changedTopLevelKeys } from '../agent-highlight';

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
});
