export interface DocumentRow {
  id: string; // UUID
  title: string;
  content: string; // stringified editor state JSON
  createdAt: string; // ISO
  updatedAt: string; // ISO
  parentId: string | null;
  /** Native emoji character for note icon (e.g. "📄"). Null = use default icon. */
  emoji: string | null;
  /** When set, document is in trash (ISO date). Null = not trashed. */
  deletedAt: string | null;
  /** Sort order within siblings (lower = earlier). */
  sortOrder: number;
  /** Per-note metadata (JSON). */
  metadata: NoteMetadata;
}

/** Extensible per-note settings stored as JSON in the `metadata` column. */
export interface NoteMetadata {
  /** When set, note is bookmarked/starred (ISO date). Null/undefined = not bookmarked. */
  bookmarkedAt?: string | null;
  /**
   * Editor content schema version last written for this note. Older builds
   * refuse to overwrite content whose version is newer than they understand,
   * which prevents a downgrade/rollback from silently dropping fields.
   * Distinct from the database `schema_version`.
   */
  contentSchemaVersion?: number;
  /**
   * Revision of the markdown file last written for this note (vault export).
   * The watcher compares the on-disk file against this to distinguish our own
   * writes from external edits. Internal — never written to the file.
   */
  vaultFileRevision?: string;
  /** Content revision at the time of the last vault export (conflict baseline). */
  vaultContentRevision?: string;
  /**
   * Relative POSIX path of the note's file within the vault, as last written.
   * Lets a title change / move rename the old file instead of orphaning it.
   * Internal — never written to the file.
   */
  vaultRelativePath?: string;
}

/**
 * Current serialized-editor-content schema version. Bump whenever a registered
 * node's serialized shape changes in a way older builds cannot round-trip.
 */
export const CONTENT_SCHEMA_VERSION = 1;


