"use client"

import { useEffect, useRef } from "react"
import { InitialConfigType, LexicalComposer } from "@lexical/react/LexicalComposer"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical"

import { editorTheme } from "@/components/editor/themes/editor-theme"
import { nodes } from "@/components/editor/nodes"
import { Plugins } from "@/components/editor/plugins"
import { LYCHEE_SAVE_TAG } from "@/components/editor/editor-tags"

export { LYCHEE_SAVE_TAG } from "@/components/editor/editor-tags"

/** Custom save tag for async hydration mutations. Paired with `history-merge`
 *  on the same editor.update call so undo bundles the conversion + the
 *  metadata fill into a single step, while still triggering a save via the
 *  HydrationSaveListener below. */

function HydrationSaveListener({ onChange }: { onChange: (editor: LexicalEditor) => void }): null {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerUpdateListener(({ tags }) => {
      if (tags.has(LYCHEE_SAVE_TAG)) {
        onChange(editor)
      }
    })
  }, [editor, onChange])
  return null
}

const editorConfig: InitialConfigType = {
  namespace: "Editor",
  theme: editorTheme,
  nodes,
  onError: (error: Error) => {
    console.error(error)
  },
}

/**
 * Applies stored content after mount instead of via LexicalComposer's
 * `editorState` (which throws if the parsed state is empty). Any failure here
 * falls back to a valid empty paragraph, so a bad note can never crash the app.
 */
function InitialContentPlugin({ editorState }: { editorState?: string }): null {
  const [editor] = useLexicalComposerContext()
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current) return
    applied.current = true

    if (editorState) {
      try {
        const parsed = editor.parseEditorState(editorState)
        if (!parsed.isEmpty()) {
          editor.setEditorState(parsed)
          return
        }
      } catch {
        // fall through to default content
      }
    }

    editor.update(
      () => {
        const root = $getRoot()
        if (root.isEmpty()) root.append($createParagraphNode())
      },
      { discrete: true },
    )
  }, [editor, editorState])

  return null
}

export function Editor({
  documentId,
  tabId,
  activeTabId,
  isActive,
  editorState,
  onEditorChange,
}: {
  documentId: string
  tabId: string
  /** The currently active tabId for this document (changes on tab switch). */
  activeTabId: string | null
  isActive: boolean
  /** A validated, serialized editor state (or undefined for default content). */
  editorState?: string
  onEditorChange?: (editor: LexicalEditor) => void
}) {
  return (
    <div className="bg-background overflow-hidden">
      <LexicalComposer initialConfig={editorConfig}>
        <InitialContentPlugin editorState={editorState} />
        <Plugins
          documentId={documentId}
          tabId={tabId}
          activeTabId={activeTabId}
          isActive={isActive}
        />

        <OnChangePlugin
          ignoreSelectionChange={true}
          onChange={(_editorState, editor) => {
            onEditorChange?.(editor)
          }}
        />
        {/* Hydration-save listener: fires onChange for editor.update calls
            tagged with 'lychee-save' (paired with 'history-merge' on async
            hydration mutations). This routes our hydration saves to the DB
            without disabling OnChangePlugin's default history-merge filter —
            which other plugins (TabSelectionPlugin, table resizer, image
            paste) rely on to NOT trigger spurious saves on their own
            history-merge updates. */}
        <HydrationSaveListener
          onChange={(editor) => {
            onEditorChange?.(editor)
          }}
        />
      </LexicalComposer>
    </div>
  )
}
