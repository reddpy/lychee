import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { $createParagraphNode, $createTextNode, $getRoot, $isParagraphNode } from 'lexical';
import {
  applyRemoteUpdate,
  bootstrapFromMarkdown,
  createNoteDoc,
  encodeNoteUpdate,
  flushEditor,
  noteStateVector,
  projectDocMarkdown,
  projectMarkdown,
  type NoteDocHandle,
} from '../note-doc';
import { MemoryHub, connectDoc } from '../memory-hub';
import {
  $createReferenceNode,
  $isReferenceNode,
  ReferenceNode,
} from '@/components/editor/nodes/reference-node';

/**
 * Custom-binding + transport tests. These prove the pieces the local
 * "AI/MCP edits show up live" flow depends on, at the data layer:
 * bootstrap → Y.Doc → markdown projection, two-peer exchange, and merge.
 *
 * A joining peer must bind an EMPTY doc first and then receive the state; the
 * binding hydrates its editor from the changes.
 */
function joinPeer(handle: NoteDocHandle, source: NoteDocHandle): void {
  Y.applyUpdate(handle.doc, Y.encodeStateAsUpdate(source.doc));
  flushEditor(handle.editor);
}

const handles: NoteDocHandle[] = [];
function track(handle: NoteDocHandle): NoteDocHandle {
  handles.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

function agentAppend(handle: NoteDocHandle, text: string): void {
  handle.editor.update(
    () => {
      const last = $getRoot().getLastChild();
      if ($isParagraphNode(last)) last.append($createTextNode(text));
      else $getRoot().append($createParagraphNode().append($createTextNode(text)));
    },
    { discrete: true },
  );
}

describe('note-doc — bootstrap and projection', () => {
  it('bootstraps from markdown and projects back', () => {
    const note = track(createNoteDoc('n1', { markdown: 'Hello world\n\nsecond paragraph\n' }));
    const markdown = projectMarkdown(note.editor);
    expect(markdown).toContain('Hello world');
    expect(markdown).toContain('second paragraph');
  });

  it('reflects a local edit in the doc immediately (projection + Yjs state)', () => {
    const note = track(createNoteDoc('n2', { markdown: 'Base\n' }));
    agentAppend(note, ' appended');

    expect(projectMarkdown(note.editor)).toContain('appended');
    expect(encodeNoteUpdate(note.doc).length).toBeGreaterThan(1);
  });
});

describe('note-doc — peer exchange (agent ↔ app)', () => {
  it('applies an agent update and reflects it in the app projection', () => {
    const hub = new MemoryHub();
    const app = track(createNoteDoc('note', { markdown: 'Original body\n' }));
    const agent = track(createNoteDoc('note'));
    joinPeer(agent, app);

    const offAgent = connectDoc(hub, 'note', agent.doc);
    const offApp = connectDoc(hub, 'note', app.doc);

    // Agent edits like an MCP tool would.
    agentAppend(agent, ' AGENT EDIT');

    flushEditor(app.editor);
    expect(projectMarkdown(app.editor)).toContain('AGENT EDIT');
    expect(projectMarkdown(app.editor)).toContain('Original body');

    offAgent();
    offApp();
  });

  it('merges divergent edits from two peers that share lineage', () => {
    const app = track(createNoteDoc('m', { markdown: 'Shared base\n' }));
    const agent = track(createNoteDoc('m'));
    joinPeer(agent, app);

    agentAppend(app, ' APP SIDE');
    agentAppend(agent, ' AGENT SIDE');

    const appState = encodeNoteUpdate(app.doc);
    const agentState = encodeNoteUpdate(agent.doc);
    applyRemoteUpdate(app.doc, agentState);
    applyRemoteUpdate(agent.doc, appState);
    flushEditor(app.editor);
    flushEditor(agent.editor);

    const appProjection = projectMarkdown(app.editor);
    expect(appProjection).toContain('APP SIDE');
    expect(appProjection).toContain('AGENT SIDE');

    // The CRDT guarantee: both replicas hold identical state (state vectors
    // match) and a fresh derivation from each doc agrees. Live editors can lag
    // under reentrant remote applies (spike part 5), so compare the data.
    expect(Array.from(noteStateVector(app.doc))).toEqual(Array.from(noteStateVector(agent.doc)));
    expect(projectDocMarkdown(app.doc)).toBe(projectDocMarkdown(agent.doc));
  });

  it('ignores a malformed update without throwing', () => {
    const note = track(createNoteDoc('bad', { markdown: 'safe\n' }));
    expect(() => applyRemoteUpdate(note.doc, new Uint8Array([1, 2, 3, 4]))).not.toThrow();
    expect(projectMarkdown(note.editor)).toContain('safe');
  });

  it('applies a remote update in a headless peer without touching the DOM', async () => {
    // Remote applies run a deferred `onUpdate` that renders cursors; in a
    // headless editor `getRootElement()` throws, which used to crash the MCP
    // server right after every live edit.
    const app = track(createNoteDoc('headless', { markdown: 'hello\n' }));
    const peer = track(createNoteDoc('headless'));
    applyRemoteUpdate(peer.doc, encodeNoteUpdate(app.doc));
    expect(() => flushEditor(peer.editor)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(projectMarkdown(peer.editor)).toContain('hello');
  });

  it('re-bootstrapping replaces content on an existing doc', () => {
    const note = track(createNoteDoc('re', { markdown: 'first\n' }));
    bootstrapFromMarkdown(note.editor, 'completely different\n');
    const markdown = projectMarkdown(note.editor);
    expect(markdown).toContain('completely different');
    expect(markdown).not.toContain('first');
  });
});

describe('note-doc — excluded properties do not cross the wire', () => {
  it('keeps per-device reference hydration fields out of the shared doc', () => {
    const app = track(createNoteDoc('ref'));
    app.editor.update(
      () => {
        $getRoot().append(
          $createReferenceNode({
            url: 'https://example.com',
            title: 'Example',
            autoResolve: true,
            hydrationAttempted: true,
          }),
        );
      },
      { discrete: true },
    );

    const peer = track(createNoteDoc('ref'));
    joinPeer(peer, app);

    peer.editor.getEditorState().read(() => {
      const node = $getRoot().getFirstChild();
      expect($isReferenceNode(node)).toBe(true);
      const reference = node as ReferenceNode;
      // Real content syncs...
      expect(reference.__url).toBe('https://example.com');
      expect(reference.__title).toBe('Example');
      // ...but this device's hydration bookkeeping must not (spike part 2).
      expect(reference.__autoResolve).toBe(false);
      expect(reference.__hydrationAttempted).toBe(false);
    });
  });
});
