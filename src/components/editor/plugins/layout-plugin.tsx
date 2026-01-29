import type { JSX } from "react"
import type { LexicalEditor } from "lexical"

/**
 * Stub for layout/columns plugin. Add full implementation later if needed.
 */
export function InsertLayoutDialog({
  onClose,
}: {
  activeEditor: LexicalEditor
  onClose: () => void
}): JSX.Element {
  onClose()
  return null
}
