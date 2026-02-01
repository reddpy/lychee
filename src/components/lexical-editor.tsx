import * as React from "react"
import debounce from "lodash/debounce"
import { Smile, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDocumentStore } from "@/renderer/document-store"
import type { DocumentRow } from "@/shared/documents"
import type { SerializedEditorState } from "lexical"

import { Editor } from "@/components/editor/editor"
import { NoteEmojiPicker } from "@/components/sidebar/note-emoji-picker"

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

function NoteHeader({
  documentId,
  document,
}: {
  documentId: string
  document: DocumentRow
}) {
  const [emojiPickerOpen, setEmojiPickerOpen] = React.useState(false)
  const [addIconPickerOpen, setAddIconPickerOpen] = React.useState(false)
  const updateDocumentInStore = useDocumentStore(
    (s) => s.updateDocumentInStore
  )

  const handleEmojiSelect = React.useCallback(
    async (native: string) => {
      try {
        const { document: updated } = await window.lychee.invoke(
          "documents.update",
          { id: documentId, emoji: native }
        )
        updateDocumentInStore(documentId, { emoji: updated.emoji })
      } catch {
        // ignore
      }
    },
    [documentId, updateDocumentInStore]
  )

  const removeEmoji = React.useCallback(
    async () => {
      try {
        const { document: updated } = await window.lychee.invoke(
          "documents.update",
          { id: documentId, emoji: null }
        )
        updateDocumentInStore(documentId, { emoji: updated.emoji })
      } catch {
        // ignore
      }
    },
    [documentId, updateDocumentInStore]
  )

  const handleRemoveEmojiClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      removeEmoji()
    },
    [removeEmoji]
  )

  return (
    <div className="mb-2 flex flex-col gap-1">
      <div className="flex items-end gap-3">
        {document.emoji ? (
          <div className="group relative inline-flex items-end rounded">
            <NoteEmojiPicker
              docId={documentId}
              currentEmoji={document.emoji}
              onSelect={handleEmojiSelect}
              open={emojiPickerOpen}
              onOpenChange={setEmojiPickerOpen}
              trigger={
                <button
                  type="button"
                  className={cn(
                    "flex h-20 w-20 items-center justify-center rounded-lg bg-transparent text-6xl leading-none transition-colors",
                    "hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  )}
                  title="Change icon"
                  aria-label="Change note icon"
                >
                  {document.emoji}
                </button>
              }
            />
            <button
              type="button"
              onClick={handleRemoveEmojiClick}
              className="absolute right-0 top-0 flex h-6 w-6 translate-x-3 -translate-y-2 items-center justify-center rounded-full bg-[hsl(var(--background))] p-0.5 text-[hsl(var(--muted-foreground))] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              title="Remove icon"
              aria-label="Remove note icon"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-sm text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity group-hover/title-area:opacity-100">
        <NoteEmojiPicker
          docId={documentId}
          currentEmoji={document.emoji}
          onSelect={handleEmojiSelect}
          open={addIconPickerOpen}
          onOpenChange={setAddIconPickerOpen}
          trigger={
            <button
              type="button"
              className={cn(
                "hover:text-[hsl(var(--foreground))]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:rounded",
                document.emoji && "invisible pointer-events-none"
              )}
              title="Add Icon"
              aria-label="Add note icon"
            >
              <span className="inline-flex items-center gap-1.5">
                <Smile className="h-4 w-4" />
                <span>Add Icon</span>
              </span>
            </button>
          }
        />
      </div>
    </div>
  )
}

const EMPTY_TITLE = ''
const LEGACY_UNTITLED = 'Untitled'

function EditorTitle({
  documentId,
  title,
  className,
}: {
  documentId: string
  title: string
  className?: string
}) {
  const normalizedTitle =
    title == null || title === '' || title === LEGACY_UNTITLED ? EMPTY_TITLE : title
  const [localTitle, setLocalTitle] = React.useState(normalizedTitle)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const updateDocumentInStore = useDocumentStore((s) => s.updateDocumentInStore)
  const pendingSaveRef = React.useRef({ documentId, title: localTitle })
  pendingSaveRef.current = { documentId, title: localTitle }

  React.useEffect(() => {
    setLocalTitle(normalizedTitle)
  }, [documentId, normalizedTitle])

  React.useEffect(() => {
    return () => {
      const { documentId: id, title: t } = pendingSaveRef.current
      const trimmed = (t ?? "").trim()
      window.lychee
        .invoke("documents.update", { id, title: trimmed })
        .then(({ document: doc }) =>
          updateDocumentInStore(doc.id, { title: doc.title })
        )
        .catch(() => {})
    }
  }, [documentId, updateDocumentInStore])

  React.useEffect(() => {
    const trimmed = localTitle.trim()
    if (trimmed === normalizedTitle) return
    const t = window.setTimeout(() => {
      setLocalTitle(trimmed)
      window.lychee
        .invoke("documents.update", { id: documentId, title: trimmed })
        .then(({ document: doc }) => {
          updateDocumentInStore(doc.id, { title: doc.title })
        })
        .catch((err) => console.error("Title save failed:", err))
    }, 500)
    return () => window.clearTimeout(t)
  }, [localTitle, documentId, normalizedTitle, updateDocumentInStore])

  const handleBlur = React.useCallback(() => {
    const trimmed = localTitle.trim()
    if (trimmed === normalizedTitle) return
    setLocalTitle(trimmed)
    window.lychee
      .invoke("documents.update", { id: documentId, title: trimmed })
      .then(({ document: doc }) => {
        updateDocumentInStore(doc.id, { title: doc.title })
      })
      .catch((err) => console.error("Title save failed:", err))
  }, [documentId, normalizedTitle, localTitle, updateDocumentInStore])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        inputRef.current?.blur()
      }
    },
    []
  )

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setLocalTitle(value)
      updateDocumentInStore(documentId, { title: value })
    },
    [documentId, updateDocumentInStore]
  )

  return (
    <input
      ref={inputRef}
      type="text"
      value={localTitle}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        "w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-[hsl(var(--muted-foreground))]",
        className
      )}
      placeholder="New Page"
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
        <div className="group/title-area">
          <NoteHeader documentId={documentId} document={document} />
          <EditorTitle
            documentId={documentId}
            title={document.title ?? ''}
            className="mb-6"
          />
        </div>
        <Editor
          key={documentId}
          editorSerializedState={editorSerializedState}
          onSerializedChange={handleSerializedChange}
        />
      </div>
    </main>
  )
}
