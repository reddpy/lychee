/**
 * Pure decision logic for reflecting vault file changes into the database.
 *
 * Kept free of fs/DB so it is exhaustively testable; the watcher supplies the
 * facts and the orchestration applies the decision.
 *
 * Safety model: an unrecognized file is a new note; a changed file whose
 * revision matches our last export is our own write (ignore); an external edit
 * to an existing note is applied only when the database has not changed since
 * that export, otherwise it is a conflict. An external delete trashes the note
 * (and its subtree) — unless the same note id is still present under another
 * path, which means the file was renamed/moved rather than deleted.
 */

export type VaultChangeAction = 'ignore' | 'adopt' | 'import' | 'apply' | 'conflict';

export interface VaultChangeFacts {
  /** Whether the file currently exists. */
  exists: boolean;
  /** Revision of the current file bytes. */
  fileRevision: string;
  /** Whether the file's frontmatter carries an id. */
  hasId: boolean;
  /** The matching note, or null when none exists. */
  note: null | {
    /** NoteMetadata.vaultFileRevision at last export. */
    fileRevision?: string;
    /** NoteMetadata.vaultContentRevision at last export. */
    contentRevision?: string;
    /** Revision of the note's current stored content. */
    currentContentRevision: string;
  };
}

export function classifyVaultChange(facts: VaultChangeFacts): VaultChangeAction {
  if (!facts.exists) return 'ignore'; // deletes are not propagated (safe default)
  // Only auto-ingest real Lychee notes (frontmatter `id`). Plain markdown that
  // happens to live in the folder is ignored so an unrelated `.md` never becomes
  // a note.
  if (!facts.hasId) return 'ignore';
  if (!facts.note) return 'import';
  // No baseline yet (e.g. first time watching a pre-existing folder): adopt the
  // file as the note's canonical projection rather than manufacture a conflict.
  if (facts.note.fileRevision === undefined && facts.note.contentRevision === undefined) return 'adopt';
  if (facts.fileRevision === facts.note.fileRevision) return 'ignore'; // our own write
  if (facts.note.currentContentRevision === facts.note.contentRevision) return 'apply';
  return 'conflict';
}

/** Payload pushed to the renderer when a watched file needs handling. */
export type VaultFileChangedEvent =
  | {
      action: 'import';
      /** The note id from frontmatter — preserved so identity is stable. */
      id: string;
      relativePath: string;
      title: string;
      parentId: string | null;
      sortOrder: number;
      emoji?: string | null;
      bookmarkedAt?: string | null;
      createdAt?: string;
      updatedAt?: string;
      contentSchemaVersion?: number;
      body: string;
    }
  | {
      action: 'apply';
      id: string;
      relativePath: string;
      title?: string;
      emoji?: string | null;
      bookmarkedAt?: string | null;
      /** Adopt the file's `order` (a live reorder from the OS). */
      sortOrder?: number;
      /** The file's `updated` timestamp, adopted as the note's `updatedAt`. */
      updatedAt?: string;
      body: string;
    }
  | {
      action: 'conflict';
      id: string;
      relativePath: string;
      /** The external edit (body) to preserve in a conflict copy. */
      body: string;
      /** The note's current stored editor content, to restore the canonical file. */
      existingContent: string;
    }
  | {
      /** An external delete: the note (and subtree) was moved to the trash. */
      action: 'delete';
      relativePath: string;
      /** The trashed note ids, so the renderer can close their tabs. */
      ids: string[];
    }
  | {
      /**
       * Cross-device tombstones were reconciled into the DB. `ids` are the notes
       * that became trashed, so the renderer can close their tabs.
       */
      action: 'sync';
      ids: string[];
    };

/** Renderer's response after converting markdown → Lexical content. */
export type VaultResolveRequest =
  | {
      action: 'import';
      /** The note id from frontmatter — preserved so identity is stable. */
      id: string;
      relativePath: string;
      title: string;
      parentId: string | null;
      sortOrder: number;
      emoji: string | null;
      bookmarkedAt: string | null;
      createdAt?: string;
      updatedAt?: string;
      contentSchemaVersion?: number;
      content: string;
      bodyMarkdown: string;
    }
  | {
      action: 'apply';
      id: string;
      relativePath: string;
      title?: string;
      emoji?: string | null;
      bookmarkedAt?: string | null;
      /** Adopt the file's `order` (a live reorder from the OS). */
      sortOrder?: number;
      /** The file's `updated` timestamp, adopted as the note's `updatedAt`. */
      updatedAt?: string;
      content: string;
      bodyMarkdown: string;
    }
  | { action: 'conflict'; id: string; relativePath: string; conflictContents: string; bodyMarkdown: string };

/** Temp/editor artifacts (and dot-entries such as `.trash`) to never process. */
export function shouldIgnoreVaultPath(basename: string): boolean {
  if (basename.startsWith('.')) return true;
  if (basename.endsWith('.tmp')) return true;
  if (basename.endsWith('~')) return true;
  if (basename.endsWith('.swp') || basename.endsWith('.swx')) return true;
  return false;
}

/** Conflict copies we wrote ourselves must not be re-imported as notes. */
export function isConflictCopyPath(relativePath: string): boolean {
  return / \(conflict \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}( \d+)?\)\.md$/i.test(relativePath);
}

const NON_MARKDOWN_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|bmp|ico|heic|avif|tiff?|pdf|zip|rar|7z|tar|gz|dmg|pkg|exe|msi|app|mp3|wav|flac|aac|ogg|m4a|mp4|mov|avi|mkv|webm|wmv|flv|txt|csv|json|xml|html?|css|js|ts|tsx|docx?|xlsx?|pptx?|pages|numbers|key|epub|rtf)$/i;

/**
 * Whether a note title is actually a non-markdown filename. Used to find notes
 * that an older build mistakenly imported from arbitrary files in the watched
 * folder, so the user can remove them.
 */
export function isNonMarkdownFileTitle(title: string): boolean {
  return NON_MARKDOWN_EXTENSIONS.test(title.trim());
}
