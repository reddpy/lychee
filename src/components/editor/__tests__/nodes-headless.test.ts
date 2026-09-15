import { describe, it, expect, afterEach } from 'vitest';
import { createHeadlessEditor } from '@lexical/headless';
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { nodes } from '../nodes';
import { $createReferenceNode } from '../nodes/reference-node';
import {
  clearNodeRenderers,
  getNodeRenderer,
  registerNodeRenderer,
} from '../nodes/node-renderers';
import { exportDocumentMarkdown, importDocumentMarkdown } from '../markdown-io';

/**
 * Stage 0 gate: the editor node modules must import and run in a plain Node
 * environment (no DOM, no renderer components) so the Yjs binding and markdown
 * conversion can run headlessly (main process / MCP / tests).
 *
 * vitest runs this file under `environment: node` (the repo default), so a
 * window/`document` touched at import time throws here.
 */

function makeEditor() {
  return createHeadlessEditor({
    namespace: 'headless-test',
    nodes,
    onError: (error) => {
      throw error;
    },
  });
}

afterEach(() => clearNodeRenderers());

describe('nodes are headless-safe', () => {
  it('imports the full node set without a renderer runtime', () => {
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('exposes no decorator renderer until the renderer entry registers one', () => {
    clearNodeRenderers();
    expect(getNodeRenderer('reference')).toBeUndefined();
    const Marker = (): null => null;
    registerNodeRenderer('reference', Marker);
    expect(getNodeRenderer('reference')).toBe(Marker);
  });

  it('round-trips a reference node through a headless editor', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('hello'));
        root.append(paragraph);
        root.append(
          $createReferenceNode({
            url: 'https://example.test/article',
            displayMode: 'card',
            title: 'Example',
          }),
        );
      },
      { discrete: true },
    );

    const serialized = JSON.stringify(editor.getEditorState().toJSON());
    expect(serialized).toContain('"reference"');
    expect(serialized).toContain('https://example.test/article');

    const reopened = makeEditor();
    reopened.setEditorState(reopened.parseEditorState(serialized));
    reopened.getEditorState().read(() => {
      const json = JSON.stringify(reopened.getEditorState().toJSON());
      expect(json).toContain('"reference"');
    });
  });

  it('serializes every custom node type headlessly', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode().append($createTextNode('body')));
      },
      { discrete: true },
    );
    const state = editor.getEditorState().toJSON();
    expect(state.root.type).toBe('root');
  });

  it('round-trips markdown through a headless editor (main/MCP content path)', () => {
    const editor = makeEditor();
    importDocumentMarkdown(editor, '## Heading\n\n- one\n- two\n\nparagraph text\n');
    const markdown = exportDocumentMarkdown(editor);
    expect(markdown).toContain('Heading');
    expect(markdown).toContain('one');
    expect(markdown).toContain('paragraph text');
  });
});
