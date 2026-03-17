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
}

