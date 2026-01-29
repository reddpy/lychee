"use client"

import {
  type InitialConfigType,
  LexicalComposer,
} from "@lexical/react/LexicalComposer"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import type { EditorState, SerializedEditorState } from "lexical"

import { editorTheme } from "@/components/editor/themes/editor-theme"

import { nodes } from "./nodes"
import { Plugins } from "./plugins"
import { sanitizeSerializedState } from "./sanitize-state"

const editorConfig: InitialConfigType = {
  namespace: "Editor",
  theme: editorTheme,
  nodes,
  onError: (error: Error) => {
    console.error(error)
  },
}

export function Editor({
  editorSerializedState,
  onSerializedChange,
}: {
  editorSerializedState?: SerializedEditorState
  onSerializedChange?: (state: SerializedEditorState) => void
}) {
  const initialState =
    editorSerializedState != null
      ? JSON.stringify(sanitizeSerializedState(editorSerializedState))
      : undefined

  return (
    <div className="bg-background overflow-hidden">
      <LexicalComposer
        initialConfig={{
          ...editorConfig,
          ...(initialState != null ? { editorState: initialState } : {}),
        }}
      >
        <Plugins />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState: EditorState) => {
            onSerializedChange?.(editorState.toJSON())
          }}
        />
      </LexicalComposer>
    </div>
  )
}
