export interface DocumentRow {
  id: string; // UUID
  title: string;
  content: string; // stringified editor state JSON
  createdAt: string; // ISO
  updatedAt: string; // ISO
  parentId: string | null;
  /** Native emoji character for note icon (e.g. "📄"). Null = use default icon. */
  emoji: string | null;
}

