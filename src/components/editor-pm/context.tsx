import { createContext, useContext } from "react"
import { EditorView } from "prosemirror-view"

const ProseMirrorContext = createContext<EditorView | null>(null)

export const ProseMirrorProvider = ProseMirrorContext.Provider

export function useProseMirrorView(): EditorView | null {
  return useContext(ProseMirrorContext)
}
