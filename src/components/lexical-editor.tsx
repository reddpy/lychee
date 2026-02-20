import * as React from "react";
import debounce from "lodash/debounce";
import { Smile, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/renderer/document-store";
import type { DocumentRow } from "@/shared/documents";
import type { SerializedEditorState } from "lexical";

import { Editor } from "@/components/editor/editor";
import { NoteEmojiPicker } from "@/components/sidebar/note-emoji-picker";

function getSerializedState(
  content: string | undefined,
): SerializedEditorState | undefined {
  if (!content || content.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && parsed.root) return parsed;
  } catch {
    // ignore invalid JSON
  }
  return undefined;
}

const LEGACY_UNTITLED = "Untitled";

export function LexicalEditor({
  documentId,
  document,
}: {
  documentId: string;
  document: DocumentRow;
}) {
  const [emojiPickerOpen, setEmojiPickerOpen] = React.useState(false);
  const [addIconPickerOpen, setAddIconPickerOpen] = React.useState(false);
  const updateDocumentInStore = useDocumentStore(
    (s) => s.updateDocumentInStore,
  );

  const editorSerializedState = React.useMemo(
    () => getSerializedState(document.content),
    [documentId, document.content],
  );

  const initialTitle = React.useMemo(() => {
    const title = document.title;
    if (title == null || title === "" || title === LEGACY_UNTITLED) {
      return "";
    }
    return title;
  }, [document.title]);

  const handleEmojiSelect = React.useCallback(
    async (native: string) => {
      try {
        const { document: updated } = await window.lychee.invoke(
          "documents.update",
          { id: documentId, emoji: native },
        );
        updateDocumentInStore(documentId, { emoji: updated.emoji });
      } catch {
        // ignore
      }
    },
    [documentId, updateDocumentInStore],
  );

  const removeEmoji = React.useCallback(async () => {
    try {
      const { document: updated } = await window.lychee.invoke(
        "documents.update",
        { id: documentId, emoji: null },
      );
      updateDocumentInStore(documentId, { emoji: updated.emoji });
    } catch {
      // ignore
    }
  }, [documentId, updateDocumentInStore]);

  const handleRemoveEmojiClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeEmoji();
    },
    [removeEmoji],
  );

  const saveContent = React.useMemo(
    () =>
      debounce(
        (
          id: string,
          serialized: SerializedEditorState,
          onSaved?: (doc: DocumentRow) => void,
        ) => {
          const content = JSON.stringify(serialized);
          window.lychee
            .invoke("documents.update", { id, content })
            .then(({ document: doc }) => {
              updateDocumentInStore(doc.id, {
                content: doc.content,
                updatedAt: doc.updatedAt,
              });
              onSaved?.(doc);
            })
            .catch((err) => console.error("Save failed:", err));
        },
        600,
      ),
    [updateDocumentInStore],
  );

  const saveTitle = React.useMemo(
    () =>
      debounce((id: string, newTitle: string) => {
        window.lychee
          .invoke("documents.update", { id, title: newTitle })
          .then(({ document: doc }) => {
            updateDocumentInStore(doc.id, { title: doc.title });
          })
          .catch((err) => console.error("Title save failed:", err));
      }, 500),
    [updateDocumentInStore],
  );

  React.useEffect(() => {
    return () => {
      saveContent.cancel();
      saveTitle.cancel();
    };
  }, [saveContent, saveTitle]);

  const handleSerializedChange = React.useCallback(
    (value: SerializedEditorState) => {
      saveContent(documentId, value);
    },
    [documentId, saveContent],
  );

  const handleTitleChange = React.useCallback(
    (title: string) => {
      updateDocumentInStore(documentId, { title });
      saveTitle(documentId, title);
    },
    [documentId, updateDocumentInStore, saveTitle],
  );

  return (
    <main className="h-full flex-1 bg-[hsl(var(--background))] border-t-0 overflow-auto">
      <div className="mx-auto max-w-225 px-8 py-10">
        {/* Emoji or Add Icon above editor */}
        <div className="pl-8 mb-2">
          {document.emoji ? (
            <div className="group/emoji relative inline-flex items-end rounded w-fit">
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
                      "hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
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
                className="absolute right-0 top-0 flex h-6 w-6 translate-x-3 -translate-y-2 items-center justify-center rounded-full bg-[hsl(var(--background))] p-0.5 text-[hsl(var(--muted-foreground))] opacity-0 shadow-sm transition-opacity group-hover/emoji:opacity-100 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                title="Remove icon"
                aria-label="Remove note icon"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
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
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors text-sm text-[hsl(var(--muted-foreground))]",
                    "hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                  )}
                  title="Add Icon"
                  aria-label="Add note icon"
                >
                  <Smile className="h-4 w-4" />
                  <span>Add Icon</span>
                </button>
              }
            />
          )}
        </div>

        {/* Editor with title as first block */}
        <Editor
          key={documentId}
          editorSerializedState={editorSerializedState}
          onSerializedChange={handleSerializedChange}
          initialTitle={initialTitle}
          onTitleChange={handleTitleChange}
        />
      </div>
    </main>
  );
}
