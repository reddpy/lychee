import * as React from "react";
import { createPortal } from "react-dom";
import debounce from "lodash/debounce";
import { Smile, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/renderer/document-store";
import { useAIPanelStore } from "@/renderer/ai-panel-store";
import type { DocumentRow } from "@/shared/documents";
import type { EditorState, SerializedEditorState } from "lexical";
import { $getRoot } from "lexical";

import { Editor } from "@/components/editor/editor";
import { NoteEmojiPicker } from "@/components/sidebar/note-emoji-picker";
import { AIPanel } from "@/components/ai-panel/ai-panel";

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
  hidden,
}: {
  documentId: string;
  document: DocumentRow;
  hidden: boolean;
}) {
  const [emojiPickerOpen, setEmojiPickerOpen] = React.useState(false);
  const [addIconPickerOpen, setAddIconPickerOpen] = React.useState(false);
  const updateDocumentInStore = useDocumentStore(
    (s) => s.updateDocumentInStore,
  );
  const aiEnabled = useAIPanelStore((s) => s.aiEnabled);
  const togglePanel = useAIPanelStore((s) => s.togglePanel);
  const isPanelOpen = useAIPanelStore((s) => s.openPanels[documentId]);
  // Extract plain text from serialized Lexical JSON for AI context
  const extractText = (node: any): string => {
    if (!node) return "";
    if (node.text) return node.text;
    if (node.children) return node.children.map(extractText).join("\n");
    return "";
  };

  const noteTextRef = React.useRef(
    document.content ? extractText(getSerializedState(document.content)?.root) : "",
  );
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [pillPos, setPillPos] = React.useState({ top: 0, right: 0 });

  const getNoteText = React.useCallback(() => noteTextRef.current, []);

  // Position the AI pill on the right edge of the scroll container
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || hidden) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setPillPos({
        top: rect.top + rect.height * 0.5,
        right: window.innerWidth - rect.right + 14,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [hidden]);

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
          editorState: EditorState,
          onSaved?: (doc: DocumentRow) => void,
        ) => {
          const json = editorState.toJSON();
          json.root.children = (json.root as any).children.filter(
            (child: any) => child.type !== "loading-placeholder",
          );
          const content = JSON.stringify(json);
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
      saveContent.flush();
      saveTitle.flush();
    };
  }, [saveContent, saveTitle]);

  const handleEditorStateChange = React.useCallback(
    (editorState: EditorState) => {
      saveContent(documentId, editorState);
      editorState.read(() => {
        noteTextRef.current = $getRoot().getTextContent();
      });
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
    <main
      className="flex h-full flex-1 bg-[hsl(var(--background))] border-t-0"
      style={hidden ? { display: "none" } : undefined}
    >
      {/* Editor scroll area */}
      <div className="flex-1 overflow-auto cursor-text" ref={scrollRef} data-editor-scroll>
        <div className="mx-auto max-w-225 px-8 py-20">
          {/* Emoji above editor */}
          {document.emoji && (
            <div className="pl-8 mb-2">
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
            </div>
          )}

          {/* Add Icon button — visible when hovering above or on the title */}
          {!document.emoji && (
            <div className="add-icon-zone pl-8 pb-2 -mt-20 pt-20">
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
                      "add-icon-btn inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-opacity text-sm text-[hsl(var(--muted-foreground))]",
                      "hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                      "opacity-0",
                    )}
                    title="Add Icon"
                    aria-label="Add note icon"
                  >
                    <Smile className="h-4 w-4" />
                    <span>Add Icon</span>
                  </button>
                }
              />
            </div>
          )}

          {/* Editor with title as first block */}
          <Editor
            editorSerializedState={editorSerializedState}
            onEditorStateChange={handleEditorStateChange}
            initialTitle={initialTitle}
            onTitleChange={handleTitleChange}
          />
        </div>
      </div>

      {/* AI Panel */}
      {aiEnabled && <AIPanel documentId={documentId} getNoteText={getNoteText} />}

      {/* AI pill trigger — portal, fixed position on right edge like section indicator */}
      {aiEnabled && !hidden && createPortal(
        <div
          className="fixed z-40"
          style={{ top: pillPos.top, right: pillPos.right, transform: "translateY(-50%)" }}
        >
          <button
            type="button"
            onClick={() => togglePanel(documentId)}
            className={cn(
              "flex items-center justify-center cursor-pointer border border-r-0 border-[hsl(var(--border))] shadow-md transition-all duration-200 group",
              isPanelOpen
                ? "bg-primary"
                : "bg-popover hover:bg-primary",
            )}
            style={{ width: 36, height: 28, borderRadius: "8px 0 0 8px" }}
            title="AI assistant"
            aria-label="Toggle AI panel"
          >
            <Sparkles
              className={cn(
                "h-3.5 w-3.5 transition-colors duration-200",
                isPanelOpen
                  ? "text-primary-foreground"
                  : "text-muted-foreground/60 group-hover:text-primary-foreground",
              )}
            />
          </button>
        </div>,
        window.document.body,
      )}
    </main>
  );
}
