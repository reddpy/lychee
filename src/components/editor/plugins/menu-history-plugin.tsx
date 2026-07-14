import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { REDO_COMMAND, UNDO_COMMAND } from "lexical";

/**
 * Routes Edit-menu undo/redo back through Lexical after Escape has blurred the
 * editor. Native Electron undo mutates the DOM outside Lexical and corrupts
 * the history continuation. Both a menu click and its accelerator use this
 * route, so a focused and a blurred editor share the same history owner.
 */
export function MenuHistoryPlugin({ isActive }: { isActive: boolean }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!isActive) return;

    const dispatchHistoryCommand = (command: typeof UNDO_COMMAND) => {
      const root = editor.getRootElement();
      if (!root) return;

      // Preserve normal undo behavior in text controls such as the find input.
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement
      ) {
        document.execCommand(command === UNDO_COMMAND ? "undo" : "redo");
        return;
      }

      editor.focus();
      editor.dispatchCommand(command, undefined);
    };

    const offUndo = window.lychee.on("menu:undo", () => {
      dispatchHistoryCommand(UNDO_COMMAND);
    });
    const offRedo = window.lychee.on("menu:redo", () => {
      dispatchHistoryCommand(REDO_COMMAND);
    });

    return () => {
      offUndo();
      offRedo();
    };
  }, [editor, isActive]);

  return null;
}
