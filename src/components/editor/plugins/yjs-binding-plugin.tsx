import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { bindLiveNote, unbindLiveNote } from "@/renderer/note-sync";

/**
 * Binds the live editor to its per-note Y.Doc. Mounted only in Yjs mode.
 * Local edits flow into the doc and peer edits flow back live; the markdown
 * file stays the durable projection via the normal autosave path.
 */
export function YjsBindingPlugin({
  documentId,
  markdown,
}: {
  documentId: string;
  markdown: string;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    bindLiveNote({ documentId, editor, markdown });
    return () => unbindLiveNote(documentId);
    // `markdown` seeds the doc only at mount; later updates arrive via the doc.
  }, [documentId, editor]);
  return null;
}
