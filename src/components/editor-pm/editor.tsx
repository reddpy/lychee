import { useEffect, useRef, useCallback, useState } from "react"
import { EditorState, Transaction } from "prosemirror-state"
import { EditorView, NodeViewConstructor } from "prosemirror-view"
import { Node as PMNode } from "prosemirror-model"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { dropCursor } from "prosemirror-dropcursor"
import { gapCursor } from "prosemirror-gapcursor"
import {
  ProsemirrorAdapterProvider,
  useNodeViewFactory,
} from "@prosemirror-adapter/react"

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
import { FloatingToolbarPlugin } from "./plugins/floating-toolbar-plugin"
import { SlashCommandPlugin } from "./plugins/slash-command-plugin"
import { BlockView, HorizontalRuleView } from "./node-views/block-view"

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

// ── ContentAs helpers (apply classes that toDOM would) ──

function paragraphContentAs(_node: PMNode): HTMLElement {
  const el = document.createElement("p")
  el.className = "leading-7"
  return el
}

function blockquoteContentAs(_node: PMNode): HTMLElement {
  const el = document.createElement("blockquote")
  el.className = "mt-1 border-l-2 pl-6 italic"
  return el
}

function codeBlockContentAs(_node: PMNode): HTMLElement {
  const el = document.createElement("pre")
  el.className = "editor-code"
  return el
}

function toggleContentAs(node: PMNode): HTMLElement {
  const el = document.createElement("details")
  el.className = "Collapsible__container"
  if (node.attrs.open) el.setAttribute("open", "true")
  return el
}

const HEADING_CLASSES: Record<number, string> = {
  1: "scroll-m-20 text-4xl font-bold tracking-tight mt-10 mb-4",
  2: "scroll-m-20 text-3xl font-semibold tracking-tight mt-8 mb-4",
  3: "scroll-m-20 text-2xl font-semibold tracking-tight mt-6 mb-3",
}

function headingContentAs(node: PMNode): HTMLElement {
  const level = node.attrs.level as number
  const el = document.createElement("h" + level)
  el.className = HEADING_CLASSES[level] || ""
  return el
}

// ── Editor Component ─────────────────────────────────────

interface EditorProps {
  editorSerializedState?: Record<string, unknown>
  onSerializedChange?: (json: Record<string, unknown>) => void
  initialTitle?: string
  onTitleChange?: (title: string) => void
}

export function Editor(props: EditorProps) {
  return (
    <ProsemirrorAdapterProvider>
      <EditorInner {...props} />
    </ProsemirrorAdapterProvider>
  )
}

function EditorInner({
  editorSerializedState,
  onSerializedChange,
  initialTitle,
  onTitleChange,
}: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [view, setView] = useState<EditorView | null>(null)
  const onSerializedChangeRef = useRef(onSerializedChange)
  const onTitleChangeRef = useRef(onTitleChange)
  const lastTitleRef = useRef<string>("")

  const nodeViewFactory = useNodeViewFactory()
  const nodeViewFactoryRef = useRef(nodeViewFactory)
  nodeViewFactoryRef.current = nodeViewFactory

  // Keep callbacks current without re-creating the view
  onSerializedChangeRef.current = onSerializedChange
  onTitleChangeRef.current = onTitleChange

  const dispatchTransaction = useCallback(
    (tr: Transaction) => {
      const view = viewRef.current
      if (!view) return

      const newState = view.state.apply(tr)
      view.updateState(newState)
      view.dom.dispatchEvent(new Event("pm-update"))

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

    const factory = nodeViewFactoryRef.current

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

    // ── Build NodeViews ──────────────────────────────────
    const HEADING_LINE_H: Record<number, string> = { 1: "2.7rem", 2: "2.25rem", 3: "1.8rem" }

    const nodeViews: Record<string, NodeViewConstructor> = {
      paragraph: factory({ component: BlockView, as: "div", contentAs: paragraphContentAs }),
      heading: factory({
        component: BlockView,
        contentAs: headingContentAs,
        as: (node: PMNode) => {
          const el = document.createElement("div")
          el.style.setProperty("--block-line-h", HEADING_LINE_H[node.attrs.level as number] || "1.75rem")
          return el
        },
        // Always recreate so contentAs tag (h1/h2/h3) and --block-line-h update
        update: () => false,
      }),
      blockquote: factory({ component: BlockView, as: "div", contentAs: blockquoteContentAs }),
      bullet_list: factory({ component: BlockView, as: "div", contentAs: "ul" }),
      ordered_list: factory({ component: BlockView, as: "div", contentAs: "ol" }),
      codeBlock: factory({ component: BlockView, as: "div", contentAs: codeBlockContentAs }),
      horizontalRule: factory({ component: HorizontalRuleView, as: "div" }),
      toggleContainer: factory({ component: BlockView, as: "div", contentAs: toggleContentAs }),
    }

    // ── Create EditorView ────────────────────────────────
    const state = EditorState.create({
      doc,
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

    const v = new EditorView(editorRef.current!, {
      state,
      dispatchTransaction,
      nodeViews,
    })

    viewRef.current = v
    setView(v)

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
      setView(null)
    }
    // Only run on mount — props are captured via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ProseMirrorProvider value={view}>
      <div className="bg-background relative">
        <div ref={editorRef} className="ProseMirror-editor" />
        <SlashCommandPlugin />
      </div>
      <FloatingToolbarPlugin />
    </ProseMirrorProvider>
  )
}
