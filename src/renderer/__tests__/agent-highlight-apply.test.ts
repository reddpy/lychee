import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { COLLABORATION_TAG, $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { applyRemoteUpdate, createNoteDoc, flushEditor, type NoteDocHandle } from '@/sync/note-doc';
import { changedTopLevelKeys } from '../agent-highlight';

const handles: NoteDocHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.dispose();
});

describe('agent highlight on the real apply path', () => {
  it('flags the new block when a peer update is applied (collaboration-tagged)', () => {
    const app = createNoteDoc('x', { markdown: 'base\n' });
    const peer = createNoteDoc('x');
    handles.push(app, peer);
    Y.applyUpdate(peer.doc, Y.encodeStateAsUpdate(app.doc));
    flushEditor(peer.editor);
    peer.editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('NEW BLOCK')));
      },
      { discrete: true },
    );
    const update = Y.encodeStateAsUpdate(peer.doc);

    const changedInCollab: string[][] = [];
    const unregister = app.editor.registerUpdateListener(
      ({ prevEditorState, editorState, tags }) => {
        if (tags.has(COLLABORATION_TAG)) {
          changedInCollab.push(changedTopLevelKeys(prevEditorState, editorState));
        }
      },
    );

    applyRemoteUpdate(app.doc, update);
    flushEditor(app.editor);
    unregister();

    // Exactly one collaboration apply, flagging exactly the new block.
    expect(changedInCollab).toHaveLength(1);
    expect(changedInCollab[0]).toHaveLength(1);
  });
});
