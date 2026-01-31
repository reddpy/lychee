import { FileText } from 'lucide-react';
import type { DocumentRow } from '../../shared/documents';

export type DragOverlayItemProps = {
  doc: DocumentRow;
};

export function DragOverlayItem({ doc }: DragOverlayItemProps) {
  const iconNode = doc.emoji ? (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base leading-none">
      {doc.emoji}
    </span>
  ) : (
    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
  );

  return (
    <div className="flex cursor-pointer items-center gap-2 rounded-md bg-[hsl(var(--sidebar-accent))]/70 px-3 py-2 text-sm shadow-lg border border-[hsl(var(--border))] opacity-70 backdrop-blur-sm">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {iconNode}
      </span>
      <span className="truncate max-w-[180px]">
        {doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page'}
      </span>
    </div>
  );
}
