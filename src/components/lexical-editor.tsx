import * as React from "react"
import debounce from "lodash/debounce"
import { cn } from "@/lib/utils"
import { useDocumentStore } from "@/renderer/document-store"
import type { DocumentRow } from "@/shared/documents"
import type { SerializedEditorState } from "lexical"

import { Editor } from "@/components/blocks/editor-x"

function getSerializedState(
  content: string | undefined
): SerializedEditorState | undefined {
  if (!content || content.trim() === "") return undefined
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === "object" && parsed.root) return parsed
  } catch {
    // ignore invalid JSON
  }
  return undefined
}

function EditorTitle({
  documentId,
  title,
  className,
}: {
  documentId: string
  title: string
  className?: string
}) {
  const [localTitle, setLocalTitle] = React.useState(title)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const updateDocumentInStore = useDocumentStore((s) => s.updateDocumentInStore)

  React.useEffect(() => {
    setLocalTitle(title)
  }, [documentId, title])

  const handleBlur = React.useCallback(() => {
    const trimmed = localTitle.trim() || "Untitled"
    if (trimmed === title) return
    setLocalTitle(trimmed)
    window.lychee
      .invoke("documents.update", { id: documentId, title: trimmed })
      .then(({ document: doc }) => {
        updateDocumentInStore(doc.id, { title: doc.title })
      })
      .catch((err) => console.error("Title save failed:", err))
  }, [documentId, title, localTitle, updateDocumentInStore])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        inputRef.current?.blur()
      }
    },
    []
  )

  return (
    <input
      ref={inputRef}
      type="text"
      value={localTitle}
      onChange={(e) => setLocalTitle(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        "w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-[hsl(var(--muted-foreground))]",
        className
      )}
      placeholder="Untitled"
      aria-label="Document title"
    />
  )
}

export function LexicalEditor({
  documentId,
  document,
}: {
  documentId: string
  document: DocumentRow
}) {
  const updateDocumentInStore = useDocumentStore((s) => s.updateDocumentInStore)

  const editorSerializedState = React.useMemo(
    () => getSerializedState(document.content),
    [documentId, document.content]
  )

  const save = React.useMemo(
    () =>
      debounce(
        (
          id: string,
          serialized: SerializedEditorState,
          onSaved?: (doc: DocumentRow) => void
        ) => {
          const content = JSON.stringify(serialized)
          window.lychee
            .invoke("documents.update", { id, content })
            .then(({ document: doc }) => {
              updateDocumentInStore(doc.id, {
                content: doc.content,
                updatedAt: doc.updatedAt,
              })
              onSaved?.(doc)
            })
            .catch((err) => console.error("Save failed:", err))
        },
        600
      ),
    [updateDocumentInStore]
  )

  React.useEffect(() => {
    return () => save.cancel()
  }, [save])

  const handleSerializedChange = React.useCallback(
    (value: SerializedEditorState) => {
      save(documentId, value)
    },
    [documentId, save]
  )

  return (
    <main className="h-full flex-1 bg-[hsl(var(--background))] border-t-0 overflow-auto">
      <div className="mx-auto max-w-[900px] px-8 py-10">
        <EditorTitle
          documentId={documentId}
          title={document.title}
          className="mb-6"
        />
        <Editor
          key={documentId}
          editorSerializedState={editorSerializedState}
          onSerializedChange={handleSerializedChange}
        />
      </div>
    </main>
  )
}
