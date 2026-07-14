// @vitest-environment happy-dom
/**
 * THROWAWAY SPIKE — validates the Yjs binding bet before committing to the sync
 * design. Safe to delete after findings are recorded in
 * feature_research/. See feature_research/born-sync-ready-shadow-ydoc-plan.md.
 *
 * What it proves:
 *  1. createHeadlessEditor with our real custom nodes (Title, Image, Bookmark)
 *     + the @lexical/yjs binding does not throw.
 *  2. A real EditorState (with bookmark + image) round-trips
 *     EditorState -> Y.Doc -> EditorState equal (modulo intentionally-excluded
 *     volatile fields).
 *  3. Two independent Y.Docs with divergent edits merge to convergence (proves
 *     CRDT lineage works with our node tree).
 *
 * Run: pnpm exec vitest run src/spike/yjs-binding.spike.test.ts
 */
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";

// The decorator node files import React components that transitively pull in the
// renderer app shell (theme-store -> window.lychee IPC bridge), which doesn't
// exist in a test/headless context. The @lexical/yjs binding never calls
// decorate(), so stub the components to import the REAL node classes in
// isolation. (This coupling is itself a spike finding — see feature_research.)
vi.mock("@/components/editor/nodes/bookmark-component", () => ({
  BookmarkComponent: (): null => null,
}));
vi.mock("@/components/editor/nodes/image-component", () => ({
  ImageComponent: (): null => null,
}));
import {
  createBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Binding,
} from "@lexical/yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
} from "lexical";

import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { TitleNode, $createTitleNode } from "@/components/editor/nodes/title-node";
import { ImageNode, $createImageNode } from "@/components/editor/nodes/image-node";
import {
  BookmarkNode,
  $createBookmarkNode,
} from "@/components/editor/nodes/bookmark-node";

// Built-ins + the custom nodes we care about.
const NODES = [
  TitleNode,
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  ImageNode,
  BookmarkNode,
];

// Minimal fake provider — the binding only touches awareness for cursors,
// which we don't exercise.
function fakeProvider(): any {
  const awareness = {
    getLocalState: (): null => null,
    setLocalState: () => {},
    getStates: () => new Map<number, unknown>(),
    on: () => {},
    off: () => {},
  };
  return {
    awareness,
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  } as never;
}

type Bound = {
  editor: LexicalEditor;
  binding: Binding;
  doc: Y.Doc;
  dispose: () => void;
};

function makeBoundEditor(id: string): Bound {
  const editor = createHeadlessEditor({
    namespace: "spike",
    nodes: NODES,
    onError: (e) => {
      throw e;
    },
  });
  const provider = fakeProvider();
  const doc = new Y.Doc();
  const docMap = new Map([[id, doc]]);
  const binding = createBinding(editor, provider, id, doc, docMap);

  const unregister = editor.registerUpdateListener(
    ({
      prevEditorState,
      editorState,
      dirtyElements,
      dirtyLeaves,
      normalizedNodes,
      tags,
    }) => {
      if (tags.has("skip-collab")) return;
      syncLexicalUpdateToYjs(
        binding,
        provider,
        prevEditorState,
        editorState,
        dirtyElements,
        dirtyLeaves,
        normalizedNodes,
        tags,
      );
    },
  );

  const sharedType = binding.root.getSharedType();
  const observer = (events: unknown, transaction: { origin: unknown }) => {
    if (transaction.origin !== binding) {
      // no-op cursor sync — we don't test cursors
      syncYjsChangesToLexical(
        binding,
        provider,
        events as never,
        false,
        () => {},
      );
    }
  };
  sharedType.observeDeep(observer as never);

  return {
    editor,
    binding,
    doc,
    dispose: () => {
      unregister();
      sharedType.unobserveDeep(observer as never);
    },
  };
}

// Build a realistic note (title + paragraph + bookmark + image + paragraph)
// THROUGH editor.update() — the path that marks nodes dirty and therefore syncs
// to the Y.Doc via the binding. (setEditorState does NOT sync; see the
// regression test below.)
function loadFixture(b: Bound) {
  b.editor.update(
    () => {
      const root = $getRoot();
      root.clear();

      const title = $createTitleNode();
      title.append($createTextNode("Sync Spike Note"));

      const p1 = $createParagraphNode();
      p1.append($createTextNode("Some body text before the embeds."));

      const bookmark = $createBookmarkNode({
        url: "https://example.com/article",
        title: "Example Article",
        description: "A description fetched from OG metadata.",
        imageUrl: "https://example.com/og.png",
        faviconUrl: "https://example.com/favicon.ico",
      });

      const image = $createImageNode({
        imageId: "img-abc-123",
        altText: "An example image",
        alignment: "center",
        width: 640,
        height: 480,
      });

      const p2 = $createParagraphNode();

      root.append(title, p1, bookmark, image, p2);
    },
    { discrete: true },
  );
}

function jsonOf(b: Bound): unknown {
  return b.editor.getEditorState().toJSON();
}

// syncYjsChangesToLexical applies remote changes via a NON-discrete
// editor.update (commits on a later microtask). A trailing discrete no-op
// update flushes the queue so we can read synchronously.
function flush(b: Bound) {
  b.editor.update(() => {}, { discrete: true });
}

describe("Yjs binding spike", () => {
  it("registers custom nodes + binding without throwing", () => {
    const b = makeBoundEditor("doc1");
    expect(b.binding).toBeTruthy();
    b.dispose();
  });

  it("CONSTRAINT: setEditorState does NOT sync into the Y.Doc", () => {
    // Documents the shadow-editor design constraint: feeding a saved state via
    // setEditorState bypasses dirty tracking, so the binding writes nothing.
    // Content must be applied through editor.update() instead.
    const a = makeBoundEditor("doc1");
    const built = makeBoundEditor("tmp");
    loadFixture(built);
    const serialized = JSON.stringify(built.editor.getEditorState().toJSON());

    a.editor.setEditorState(a.editor.parseEditorState(serialized));

    // a.doc received nothing despite a.editor having full content.
    const mirror = makeBoundEditor("doc1");
    Y.applyUpdate(mirror.doc, Y.encodeStateAsUpdate(a.doc));
    const mirrorChildren = (jsonOf(mirror) as any).root.children.length;
    expect(mirrorChildren).toBe(0);

    a.dispose();
    built.dispose();
    mirror.dispose();
  });

  it("round-trips EditorState -> Y.Doc -> EditorState with bookmark + image", () => {
    const a = makeBoundEditor("doc1");
    loadFixture(a);

    // Sync a's Y.Doc into a fresh editor b via Yjs state transfer.
    const b = makeBoundEditor("doc1");
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    flush(b);

    const aJson = JSON.stringify(jsonOf(a));
    const bJson = JSON.stringify(jsonOf(b));

    // Report what each side looks like for manual inspection.
    console.log("A:", aJson);
    console.log("B:", bJson);

    expect(bJson).toEqual(aJson);
    a.dispose();
    b.dispose();
  });

  it("merges divergent edits across two Y.Docs to convergence", () => {
    const a = makeBoundEditor("doc1");
    loadFixture(a);

    const b = makeBoundEditor("doc1");
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    flush(b);

    // Divergent edits: a appends a paragraph, b appends a different paragraph.
    a.editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode("edit from A"));
        $getRoot().append(p);
      },
      { discrete: true },
    );
    b.editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode("edit from B"));
        $getRoot().append(p);
      },
      { discrete: true },
    );

    // Exchange updates both directions.
    const aState = Y.encodeStateAsUpdate(a.doc);
    const bState = Y.encodeStateAsUpdate(b.doc);
    Y.applyUpdate(a.doc, bState);
    Y.applyUpdate(b.doc, aState);
    flush(a);
    flush(b);

    const aJson = JSON.stringify(jsonOf(a));
    const bJson = JSON.stringify(jsonOf(b));
    console.log("merged A:", aJson);
    console.log("merged B:", bJson);

    expect(aJson).toEqual(bJson);
    a.dispose();
    b.dispose();
  });
});
