"use client"

import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { registerCodeHighlighting } from "@lexical/code"

export function CodeBlockPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return registerCodeHighlighting(editor)
  }, [editor])

  return null
}
