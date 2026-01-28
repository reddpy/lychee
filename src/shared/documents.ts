export interface DocumentRow {
  id: string; // UUID
  title: string;
  content: string; // stringified editor state JSON
  createdAt: string; // ISO
  updatedAt: string; // ISO
  parentId: string | null;
}

