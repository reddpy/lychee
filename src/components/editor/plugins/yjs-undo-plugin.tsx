import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  COMMAND_PRIORITY_EDITOR,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { useEffect } from "react";
import { getNoteUndoManager } from "@/renderer/note-sync";

/**
 * Routes undo/redo through the note's Yjs `UndoManager` (per-origin) instead of
 * Lexical's `HistoryPlugin`, so undo only reverts this device's edits in a
 * shared document. Mounted only in Yjs mode.
 */
export function YjsUndoPlugin({ documentId }: { documentId: string }): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        UNDO_COMMAND,
        () => {
          getNoteUndoManager(documentId)?.undo();
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        REDO_COMMAND,
        () => {
          getNoteUndoManager(documentId)?.redo();
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor, documentId]);
  return null;
}
