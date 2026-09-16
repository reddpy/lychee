import { describe, it, expect } from 'vitest';
import { $createParagraphNode, $getRoot, COLLABORATION_TAG } from 'lexical';
import { createNoteDoc, flushEditor, reseedBindingFromEditor } from '../note-doc';

function docRootLength(note: ReturnType<typeof createNoteDoc>): number {
  return (note.doc.get('root') as { length?: number }).length ?? 0;
}

describe('reseedBindingFromEditor', () => {
  it('repairs an editor node a collaboration-tagged update left out of the doc', () => {
    const note = createNoteDoc('reseed');

    // A node added under a collaboration-tagged update is deliberately not
    // synced back to the doc (that is how @lexical/yjs applies remote changes),
    // leaving the editor holding a paragraph the doc never received. This is the
    // state an emptied note ends up in, and the next full-body edit throws
    // "could not find collab element node".
    note.editor.update(
      () => {
        $getRoot().append($createParagraphNode());
      },
      { discrete: true, tag: COLLABORATION_TAG },
    );
    flushEditor(note.editor);
    expect(docRootLength(note)).toBe(0);
    expect(note.editor.getEditorState().read(() => $getRoot().getChildrenSize())).toBe(1);

    reseedBindingFromEditor(note.editor, note.binding);

    expect(docRootLength(note)).toBe(1);
    note.dispose();
  });
});
