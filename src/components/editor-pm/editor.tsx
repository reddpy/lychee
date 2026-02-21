import { useEffect, useRef, useCallback } from "react"
import { EditorState, Transaction } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Node as PMNode } from "prosemirror-model"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { dropCursor } from "prosemirror-dropcursor"
import { gapCursor } from "prosemirror-gapcursor"

import { schema } from "./schema"
import { ProseMirrorProvider } from "./context"
import {
  isLexicalFormat,
  isProseMirrorFormat,
  migrateLexicalToProseMirror,
} from "./migrate-lexical"
import { formatKeymap } from "./plugins/keymap"
import { editorInputRules } from "./plugins/inputrules"
import { blockKeymap, listKeymap } from "./plugins/block-keymap"

import "./theme.css"

// ── Helpers ──────────────────────────────────────────────

/** Parse stored JSON content into a ProseMirror doc node. */
function parseDoc(json: unknown): PMNode {
  if (json && typeof json === "object") {
    if (isLexicalFormat(json)) {
      const pmJson = migrateLexicalToProseMirror(json as Record<string, unknown>)
      return schema.nodeFromJSON(pmJson)
    }
    if (isProseMirrorFormat(json)) {
      return schema.nodeFromJSON(json)
    }
  }
  // Default empty document
  return schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "title" },
      { type: "paragraph" },
    ],
  })
}

/** Extract the title text from the first child of a doc node. */
function getTitleText(doc: PMNode): string {
  const titleNode = doc.firstChild
  if (titleNode && titleNode.type.name === "title") {
    return titleNode.textContent
  }
  return ""
}

// ── Editor Component ─────────────────────────────────────
// Title enforcement is handled by the schema: doc content = "title block+"
// ProseMirror will refuse transactions that violate this constraint and
// auto-generate filler nodes when needed.

interface EditorProps {
  editorSerializedState?: Record<string, unknown>
  onSerializedChange?: (json: Record<string, unknown>) => void
  initialTitle?: string
  onTitleChange?: (title: string) => void
}

export function Editor({
  editorSerializedState,
  onSerializedChange,
  initialTitle,
  onTitleChange,
}: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onSerializedChangeRef = useRef(onSerializedChange)
  const onTitleChangeRef = useRef(onTitleChange)
  const lastTitleRef = useRef<string>("")

  // Keep callbacks current without re-creating the view
  onSerializedChangeRef.current = onSerializedChange
  onTitleChangeRef.current = onTitleChange

  const dispatchTransaction = useCallback(
    (tr: Transaction) => {
      const view = viewRef.current
      if (!view) return

      const newState = view.state.apply(tr)
      view.updateState(newState)

      if (tr.docChanged) {
        // Notify parent of content change
        onSerializedChangeRef.current?.(newState.doc.toJSON() as Record<string, unknown>)

        // Check for title change
        const newTitle = getTitleText(newState.doc)
        if (newTitle !== lastTitleRef.current) {
          lastTitleRef.current = newTitle
          onTitleChangeRef.current?.(newTitle)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (!editorRef.current) return

    // Build initial doc
    let doc = parseDoc(editorSerializedState)

    // If we have an initialTitle and the doc's title is empty, set it
    if (initialTitle && getTitleText(doc) === "" && doc.firstChild?.type.name === "title") {
      const newTitle = schema.nodes.title.create(null, [schema.text(initialTitle)])
      const blocks = [newTitle]
      for (let i = 1; i < doc.childCount; i++) blocks.push(doc.child(i))
      doc = schema.nodes.doc.create(null, blocks)
    }

    lastTitleRef.current = getTitleText(doc)
    createView(doc)

    function createView(docNode: PMNode) {
      const state = EditorState.create({
        doc: docNode,
        plugins: [
          history(),
          keymap({ "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }),
          formatKeymap(),
          listKeymap(),    // splitListItem on Enter — before blockKeymap
          blockKeymap(),   // Notion-style overrides — before baseKeymap
          editorInputRules(),
          keymap(baseKeymap),
          dropCursor(),
          gapCursor(),
        ],
      })

      const view = new EditorView(editorRef.current!, {
        state,
        dispatchTransaction,
      })

      viewRef.current = view
    }

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
    // Only run on mount — props are captured via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ProseMirrorProvider value={viewRef.current}>
      <div className="bg-background overflow-hidden">
        <div ref={editorRef} className="ProseMirror-editor" />
      </div>
    </ProseMirrorProvider>
  )
}
