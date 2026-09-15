import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef } from "react";
import {
  bindLiveNote,
  setNoteCursorsContainer,
  unbindLiveNote,
} from "@/renderer/note-sync";

/**
 * Binds the live editor to its per-note Y.Doc. Mounted only in Yjs mode.
 * Local edits flow into the doc and peer edits flow back live; the markdown
 * file stays the durable projection via the normal autosave path. Also hosts the
 * container that remote (peer/agent) cursors render into.
 */
export function YjsBindingPlugin({
  documentId,
  markdown,
}: {
  documentId: string;
  markdown: string;
}): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const cursorsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bindLiveNote({ documentId, editor, markdown });
    return () => unbindLiveNote(documentId);
    // `markdown` seeds the doc only at mount; later updates arrive via the doc.
  }, [documentId, editor]);

  useEffect(() => {
    setNoteCursorsContainer(documentId, cursorsRef.current);
    return () => setNoteCursorsContainer(documentId, null);
  }, [documentId]);

  return (
    <div
      ref={cursorsRef}
      data-yjs-cursors=""
      className="pointer-events-none absolute inset-0 z-10"
    />
  );
}
