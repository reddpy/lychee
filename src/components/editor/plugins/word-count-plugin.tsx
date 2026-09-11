"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, type EditorState } from "lexical"

import { useEditorStatsStore } from "@/renderer/editor-stats-store"

function count(text: string): { words: number; characters: number } {
  const trimmed = text.trim()
  return {
    words: trimmed === "" ? 0 : trimmed.split(/\s+/).length,
    characters: text.length,
  }
}

/** Publishes word/character counts for the note into the shared stats store. */
export function WordCountPlugin({ documentId }: { documentId: string }): null {
  const [editor] = useLexicalComposerContext()
  const setStats = useEditorStatsStore((s) => s.setStats)
  const clearStats = useEditorStatsStore((s) => s.clearStats)

  useEffect(() => {
    const publish = (editorState: EditorState) => {
      editorState.read(() => {
        setStats(documentId, count($getRoot().getTextContent()))
      })
    }

    publish(editor.getEditorState())
    const unregister = editor.registerUpdateListener(({ editorState }) => publish(editorState))
    return () => {
      unregister()
      clearStats(documentId)
    }
  }, [editor, documentId, setStats, clearStats])

  return null
}
