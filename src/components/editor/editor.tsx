"use client"

import { InitialConfigType, LexicalComposer } from "@lexical/react/LexicalComposer"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { EditorState, SerializedEditorState } from "lexical"

import { editorTheme } from "@/components/editor/themes/editor-theme"
import { nodes } from "@/components/editor/nodes"
import { Plugins } from "@/components/editor/plugins"

const editorConfig: InitialConfigType = {
  namespace: "Editor",
  theme: editorTheme,
  nodes,
  onError: (error: Error) => {
    console.error(error)
  },
}

// Sanitize the serialized state to handle version mismatches
function sanitizeSerializedState(
  state: SerializedEditorState
): SerializedEditorState {
  // Clone to avoid mutating the original
  const cloned = JSON.parse(JSON.stringify(state))
  return cloned
}

export function Editor({
  editorSerializedState,
  onSerializedChange,
}: {
  editorSerializedState?: SerializedEditorState
  onSerializedChange?: (editorSerializedState: SerializedEditorState) => void
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
          ignoreSelectionChange={true}
          onChange={(editorState: EditorState) => {
            onSerializedChange?.(editorState.toJSON())
          }}
        />
      </LexicalComposer>
    </div>
  )
}
