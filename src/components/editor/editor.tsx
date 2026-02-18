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

// Sanitize the serialized state to handle empty states
function sanitizeSerializedState(
  state: SerializedEditorState
): SerializedEditorState | null {
  // Clone to avoid mutating the original
  const cloned = JSON.parse(JSON.stringify(state))

  // Ensure root has at least one child (Lexical requires this)
  if (!cloned.root?.children?.length) {
    return null // Let Lexical create default state
  }

  return cloned
}

export function Editor({
  editorSerializedState,
  onSerializedChange,
  initialTitle,
  onTitleChange,
}: {
  editorSerializedState?: SerializedEditorState
  onSerializedChange?: (editorSerializedState: SerializedEditorState) => void
  initialTitle?: string
  onTitleChange?: (title: string) => void
}) {
  const initialState = (() => {
    if (editorSerializedState == null) return undefined
    const sanitized = sanitizeSerializedState(editorSerializedState)
    if (sanitized == null) return undefined
    return JSON.stringify(sanitized)
  })()

  return (
    <div className="bg-background overflow-hidden">
      <LexicalComposer
        initialConfig={{
          ...editorConfig,
          ...(initialState != null ? { editorState: initialState } : {}),
        }}
      >
        <Plugins initialTitle={initialTitle} onTitleChange={onTitleChange} />

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
