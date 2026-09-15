"use client"

import { useEffect } from "react"
import { InitialConfigType, LexicalComposer } from "@lexical/react/LexicalComposer"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import type { LexicalEditor } from "lexical"

import { editorTheme } from "@/components/editor/themes/editor-theme"
import { nodes } from "@/components/editor/nodes"
// Register decorator node → React renderers before the composer mounts. This
// side effect is renderer-only; headless contexts import `nodes` directly.
import "@/components/editor/nodes/register-node-renderers"
import { Plugins } from "@/components/editor/plugins"
import { YjsBindingPlugin } from "@/components/editor/plugins/yjs-binding-plugin"
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
 * Applies stored content to `LexicalComposer` at mount time (single pass) when a
 * validated, non-empty state is available. Deliberately avoids applying the
 * state in a `useEffect` after mount: that rendered the whole document twice
 * (empty → filled), which caused a visible flash and a second full mount of
 * every block/decorator. `editorState` here is pre-validated by
 * `safeComposerState`, so Lexical never receives an empty state (which throws).
 */

export function Editor({
  documentId,
  tabId,
  activeTabId,
  isActive,
  editorState,
  noteMarkdown,
  onEditorChange,
}: {
  documentId: string
  tabId: string
  /** The currently active tabId for this document (changes on tab switch). */
  activeTabId: string | null
  isActive: boolean
  /** A validated, serialized editor state (or undefined for default content). */
  editorState?: string
  /** The note's stored markdown; seeds the Y.Doc in Yjs mode. */
  noteMarkdown?: string
  onEditorChange?: (editor: LexicalEditor) => void
}) {
  const yjsEnabled =
    typeof window !== "undefined" && window.lychee?.flags?.yjs === true
  const useYjs = yjsEnabled && noteMarkdown !== undefined
  return (
    <div className="bg-background overflow-hidden">
      <LexicalComposer
        initialConfig={
          useYjs
            ? editorConfig
            : editorState
              ? { ...editorConfig, editorState }
              : editorConfig
        }
      >
        {useYjs && <YjsBindingPlugin documentId={documentId} markdown={noteMarkdown ?? ""} />}
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
