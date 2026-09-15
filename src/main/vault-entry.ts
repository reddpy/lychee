import { importAssetsFromVault } from "./assets";
import { markdownStem, parentMarkdownPath } from "../shared/vault-path";
import { resolveNewTitle, resolveTitle, stripLeadingTitle } from "../shared/markdown-title";

/**
 * Single-file projection: derive a note's index fields from one vault file.
 *
 * This is the one place that turns a markdown file into (title, hierarchy,
 * content). It is shared by the startup reconcile (`vault-index`), the live
 * watcher (`vault-sync`), and the app/MCP write service (`note-service`) so all
 * three project a file identically.
 *
 * Content seam (Yjs): metadata and hierarchy are always derived from the file,
 * but `content` is a projection that today is markdown. A caller that owns the
 * canonical content (the renderer's Lexical conversion now, a Y.Doc later)
 * passes it via `contentOverride`; the file body is only read when no canonical
 * content is supplied. When Yjs becomes the source of truth, only the
 * `contentOverride` producer changes — this pipeline does not.
 */

export type EntryProjectionMode = "import" | "update";

export interface DerivedEntry {
  /** Display title (filename stem, or the frontmatter title for legacy files). */
  title: string;
  /** Parent note id from the folder layout, or null for the vault root. */
  parentId: string | null;
  /**
   * Canonical stored content, or null when the file has no body. Callers store
   * this as the note's content today; under Yjs this becomes the projection
   * input that feeds the Y.Doc.
   */
  content: string | null;
}

export function deriveEntry(args: {
  vault: string;
  relativePath: string;
  /** Frontmatter `title`, when present (legacy files only). */
  frontmatterTitle?: string | null;
  /** Raw markdown body from the file. */
  body: string;
  mode: EntryProjectionMode;
  /** The note's current title, for adopt-on-disk-rename behavior (`update`). */
  currentTitle?: string | null;
  /** The note's id, so a folder can never resolve to itself as its parent. */
  id: string;
  /** Lowercased vault-relative path → id map for parent resolution. */
  idByPath?: Map<string, string>;
  /**
   * Canonical content supplied by the owner of the content model (renderer
   * today, Yjs later). When provided, it wins over the file body.
   */
  contentOverride?: string | null;
}): DerivedEntry {
  const stemTitle = markdownStem(args.relativePath);
  const title =
    args.mode === "import"
      ? resolveNewTitle({ frontmatterTitle: args.frontmatterTitle, stemTitle })
      : resolveTitle({
          frontmatterTitle: args.frontmatterTitle,
          stemTitle,
          currentTitle: args.currentTitle ?? "",
        });

  let parentId: string | null = null;
  const parentPath = parentMarkdownPath(args.relativePath);
  if (parentPath && args.idByPath) {
    parentId = args.idByPath.get(parentPath.toLowerCase()) ?? null;
    if (parentId === args.id) parentId = null;
  }

  let content: string | null;
  if (args.contentOverride !== undefined) {
    // Canonical content (renderer/Yjs) is authoritative; still strip a legacy
    // leading `# Title` so the stored body matches the file-based model.
    content = stripLeadingTitle(args.contentOverride ?? "", title) || "";
  } else if (args.body.trim().length > 0) {
    content = stripLeadingTitle(
      importAssetsFromVault(args.vault, args.body),
      title,
    );
  } else {
    content = null;
  }

  return { title, parentId, content };
}
