import * as Y from "yjs";
import { createHeadlessEditor } from "@lexical/headless";
import {
  createBinding,
  createUndoManager,
  syncCursorPositions,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Binding,
  type ExcludedProperties,
} from "@lexical/yjs";
import type { Awareness } from "y-protocols/awareness";
import type { LexicalEditor } from "lexical";
import { $createParagraphNode, $getRoot, $isElementNode, $isTextNode } from "lexical";
import { nodes } from "@/components/editor/nodes";
import { ReferenceNode } from "@/components/editor/nodes/reference-node";
import { exportDocumentMarkdown, $importDocumentMarkdown } from "@/components/editor/markdown-io";

/**
 * Custom Lexical ⇄ Yjs binding (no `CollaborationPlugin`).
 *
 * We drive `@lexical/yjs` directly so the same module works headless (main
 * process / MCP / tests) and inside the renderer. It is deliberately defensive:
 * the spike (spike-findings.md part 5) showed `@lexical/yjs` can throw during
 * concurrent normalization, and that wrapping both sync directions keeps
 * convergence intact.
 *
 * Editor ⇄ Y.Doc semantics:
 * - Local edits flow through `editor.update()` and are mirrored into the doc by
 *   `syncLexicalUpdateToYjs`.
 * - Remote doc changes flow into the editor via `syncYjsChangesToLexical`, which
 *   applies on a later microtask — call {@link flushEditor} before reading.
 * - Bootstrap MUST go through `editor.update()` (spike finding 1); feeding a
 *   saved state via `setEditorState` does not sync.
 */

/** Origin tag for updates that arrived from a peer, so we never echo them back. */
export const REMOTE_ORIGIN = "lychee-remote";

/**
 * Fields that must never cross the wire (spike findings part 2). They are
 * per-device hydration bookkeeping, not content: syncing them would let one
 * device's failed hydration suppress another device's retry, and would create
 * spurious conflict churn. Everything else on the node is real content.
 */
const EXCLUDED_PROPERTIES: ExcludedProperties = new Map([
  [ReferenceNode, new Set(["__hydrationAttempted", "__autoResolve"])],
]);

/** Minimal provider stub — used when no real awareness is supplied. */
const STUB_AWARENESS = {
  getLocalState: (): null => null,
  setLocalState: () => {},
  setLocalStateField: () => {},
  getStates: () => new Map<number, unknown>(),
  on: () => {},
  off: () => {},
};

/** Minimal CollaborationProvider object the binding accepts. */
function createProvider(awareness: unknown): never {
  return {
    awareness,
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
  } as never;
}

export interface NoteDocHandle {
  id: string;
  doc: Y.Doc;
  editor: LexicalEditor;
  binding: Binding;
  dispose(): void;
}

export function createHeadlessNoteEditor(namespace = "lychee-sync"): LexicalEditor {
  return createHeadlessEditor({
    namespace,
    nodes,
    onError: (error) => {
      throw error;
    },
  });
}

/** A valid, empty root state, used as the "previous" side when seeding. */
const EMPTY_EDITOR_STATE = JSON.stringify({
  root: { children: [], direction: null, format: "", indent: 0, type: "root", version: 1 },
});

/**
 * Adopt whatever the editor already contains into the (empty) Y.Doc, as if it
 * were a single update from an empty baseline. Needed when the editor was
 * populated *before* the binding existed (e.g. a React composer's default
 * paragraph) — a normal update would diff against an empty binding and throw
 * (Lexical error #94).
 */
function seedBindingFromEditor(
  editor: LexicalEditor,
  binding: Binding,
  provider: unknown,
): void {
  editor.getEditorState().read(() => {
    const current = editor.getEditorState();
    const dirtyElements = new Map<string, boolean>();
    const dirtyLeaves = new Set<string>();
    current._nodeMap.forEach((node) => {
      if ($isElementNode(node)) dirtyElements.set(node.getKey(), true);
      else if ($isTextNode(node)) dirtyLeaves.add(node.getKey());
    });
    const empty = editor.parseEditorState(EMPTY_EDITOR_STATE);
    syncLexicalUpdateToYjs(
      binding,
      provider as never,
      empty,
      current,
      dirtyElements,
      dirtyLeaves,
      new Set(),
      new Set(),
    );
  });
}

/**
 * Re-adopt the editor's current content into its Y.Doc. Repairs a binding whose
 * editor holds nodes the doc never received — e.g. Lexical normalizes an emptied
 * root by adding a paragraph inside a `collaboration`-tagged remote apply, which
 * `syncLexicalUpdateToYjs` deliberately ignores, leaving editor and doc diverged.
 */
export function reseedBindingFromEditor(editor: LexicalEditor, binding: Binding): void {
  try {
    seedBindingFromEditor(editor, binding, createProvider(STUB_AWARENESS));
  } catch (error) {
    console.error("[sync] reseed failed:", error);
  }
}

/**
 * `syncCursorPositions` renders remote cursors into the DOM, which a headless
 * editor cannot do — it throws "getRootElement is not supported in headless
 * mode" from a deferred update callback, crashing the whole process. Skip it for
 * headless bindings (the app renderer keeps the real one).
 */
function syncCursorPositionsSafe(binding: Binding, provider: unknown): void {
  if ((binding.editor as { _headless?: boolean })._headless) return;
  try {
    syncCursorPositions(binding, provider as never);
  } catch (error) {
    console.error("[sync] cursor sync failed:", error);
  }
}

/**
 * Bind a (headless or live) Lexical editor to a Y.Doc bidirectionally, with both
 * sync directions wrapped defensively. Returns a disposable binding.
 */
export function bindEditorToDoc(args: {
  id: string;
  editor: LexicalEditor;
  doc: Y.Doc;
  awareness?: Awareness;
}): {
  binding: Binding;
  undoManager: Y.UndoManager;
  provider: unknown;
  dispose: () => void;
} {
  const provider = createProvider(args.awareness ?? STUB_AWARENESS);
  const docMap = new Map([[args.id, args.doc]]);
  const binding = createBinding(args.editor, provider, args.id, args.doc, docMap, EXCLUDED_PROPERTIES);
  // Per-origin undo: only this device's edits are undone (spike research sec 3).
  const undoManager = createNoteUndoManager(binding);

  // Adopt any pre-binding editor content so the binding and the editor agree
  // before the first diff.
  try {
    seedBindingFromEditor(args.editor, binding, provider);
  } catch (error) {
    console.error("[sync] binding seed failed:", error);
  }

  const unregister = args.editor.registerUpdateListener(
    ({ prevEditorState, editorState, dirtyElements, dirtyLeaves, normalizedNodes, tags }) => {
      if (tags.has("skip-collab")) return;
      try {
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
      } catch (error) {
        // Recoverable (spike part 5): the doc still converges.
        console.error("[sync] lexical→yjs sync failed:", error);
      }
    },
  );

  const sharedType = binding.root.getSharedType();
  const observer = (events: unknown, transaction: { origin: unknown }) => {
    if (transaction.origin === binding) return;
    try {
      syncYjsChangesToLexical(binding, provider, events as never, false, syncCursorPositionsSafe);
    } catch (error) {
      console.error("[sync] yjs→lexical sync failed:", error);
    }
  };
  sharedType.observeDeep(observer as never);

  return {
    binding,
    undoManager,
    provider,
    dispose() {
      unregister();
      sharedType.unobserveDeep(observer as never);
      undoManager.destroy();
    },
  };
}

/** Bind a headless editor to a Y.Doc and return a disposable handle. */
export function createNoteDoc(
  id: string,
  options: { markdown?: string; doc?: Y.Doc; awareness?: Awareness } = {},
): NoteDocHandle {
  const editor = createHeadlessNoteEditor();
  // A joining peer must receive the document state *before* the binding is
  // created: binding an empty doc first creates a divergent root structure, so
  // a later state merge would duplicate rather than merge. Pass `doc` to join.
  const doc = options.doc ?? new Y.Doc();
  const ownsDoc = options.doc === undefined;
  const { binding, dispose } = bindEditorToDoc({
    id,
    editor,
    doc,
    awareness: options.awareness,
  });

  if (options.markdown !== undefined) bootstrapFromMarkdown(editor, options.markdown);

  return {
    id,
    doc,
    editor,
    binding,
    dispose() {
      dispose();
      if (ownsDoc) doc.destroy();
    },
  };
}

/**
 * Replace the editor content with `markdown` (the only bootstrap path that
 * syncs). The root is cleared *inside* the update so every node is (re)created
 * after the binding exists — nodes that predate the binding are not tracked and
 * would never sync (spike finding 1).
 */
export function bootstrapFromMarkdown(editor: LexicalEditor, markdown: string): void {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      if (markdown.trim().length === 0) {
        root.append($createParagraphNode());
      } else {
        $importDocumentMarkdown(markdown);
      }
    },
    { discrete: true },
  );
}

/** The note's markdown projection (body only, no title/frontmatter). */
export function projectMarkdown(editor: LexicalEditor): string {
  return exportDocumentMarkdown(editor);
}

/**
 * Project a Y.Doc to markdown without disturbing any live binding: bind a
 * throwaway editor to an empty doc, then apply the source state so the binding
 * hydrates the editor. (Binding directly to a populated doc does not hydrate —
 * the observer only fires on changes.)
 */
export function projectDocMarkdown(doc: Y.Doc): string {
  const copy = new Y.Doc();
  const handle = createNoteDoc("__projection__", { doc: copy });
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  flushEditor(handle.editor);
  const markdown = projectMarkdown(handle.editor);
  handle.dispose();
  copy.destroy();
  return markdown;
}

/** Commit any pending remote apply (which lands on a later microtask — spike finding 4). */
export function flushEditor(editor: LexicalEditor): void {
  editor.update(() => {}, { discrete: true });
}

/** Remove all content (synced through the binding). */
export function clearEditor(editor: LexicalEditor): void {
  editor.update(
    () => {
      $getRoot().clear();
    },
    { discrete: true },
  );
}

/** Apply an update from a peer. Malformed updates are ignored, never fatal. */
export function applyRemoteUpdate(doc: Y.Doc, update: Uint8Array): void {
  try {
    Y.applyUpdate(doc, update, REMOTE_ORIGIN);
  } catch (error) {
    console.error("[sync] applyUpdate failed:", error);
  }
}

export function encodeNoteUpdate(doc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, stateVector);
}

export function noteStateVector(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

/** Per-origin undo: only this device's edits are undone (spike sec 3). */
export function createNoteUndoManager(binding: Binding): Y.UndoManager {
  return createUndoManager(binding, binding.root.getSharedType() as never);
}
