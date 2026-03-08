import { useState, useMemo, useCallback } from "react";
import { FileText, Layers2 } from "lucide-react";
import { useDocumentStore } from "@/renderer/document-store";
import { DocumentRow } from "@/shared/documents";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";

function buildAncestors(currentId: string, docs: DocumentRow[]): DocumentRow[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const current = byId.get(currentId);
  if (!current?.parentId) return [];
  const chain: DocumentRow[] = [];
  let node = byId.get(current.parentId);
  while (node) {
    chain.unshift(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return chain;
}

function buildChildren(currentId: string, docs: DocumentRow[]): DocumentRow[] {
  return docs
    .filter((d) => d.parentId === currentId && !d.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function BreadcrumbPill() {
  const [open, setOpen] = useState(false);
  const { open: sidebarOpen } = useSidebar();
  const selectedId = useDocumentStore((s) => s.selectedId);
  const documents = useDocumentStore((s) => s.documents);
  const openOrSelectTab = useDocumentStore((s) => s.openOrSelectTab);

  const ancestors = useMemo(
    () => (selectedId ? buildAncestors(selectedId, documents) : []),
    [selectedId, documents],
  );

  const currentDoc = useMemo(
    () => documents.find((d) => d.id === selectedId),
    [selectedId, documents],
  );

  const children = useMemo(
    () => (selectedId ? buildChildren(selectedId, documents) : []),
    [selectedId, documents],
  );

  const handleNavigate = useCallback(
    (id: string) => {
      openOrSelectTab(id);
    },
    [openOrSelectTab],
  );

  if (sidebarOpen || !currentDoc || (!ancestors.length && !children.length))
    return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="absolute left-0 top-6 z-50 flex items-center justify-center border border-l-0 border-[hsl(var(--border))] bg-popover shadow-md transition-all duration-200 group cursor-pointer select-none hover:bg-primary data-[state=open]:bg-primary data-[state=open]:border-primary/30"
          style={{ width: 44, height: 36, borderRadius: "0 10px 10px 0" }}
          aria-label="Navigate note hierarchy"
        >
          <Layers2 className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary-foreground group-data-[state=open]:text-primary-foreground transition-colors duration-200" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-64 max-h-80 overflow-y-auto p-1"
        align="start"
        side="right"
        sideOffset={6}
      >
        <div className="px-2 py-1.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide select-none">
          Note Tree
        </div>
        {ancestors.map((ancestor, i) => (
          <button
            key={ancestor.id}
            type="button"
            onClick={() => handleNavigate(ancestor.id)}
            className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-sm text-left hover:bg-[hsl(var(--accent))] transition-colors"
            style={{ paddingLeft: `${8 + i * 12}px` }}
          >
            {ancestor.emoji ? (
              <span className="text-base leading-none shrink-0">
                {ancestor.emoji}
              </span>
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
            )}
            <span className="truncate">{ancestor.title || "Untitled"}</span>
          </button>
        ))}

        <div
          className="flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm opacity-40 select-none"
          style={{ paddingLeft: `${8 + ancestors.length * 12}px` }}
        >
          {currentDoc.emoji ? (
            <span className="text-base leading-none shrink-0">
              {currentDoc.emoji}
            </span>
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          )}
          <span className="truncate font-medium">
            {currentDoc.title || "Untitled"}
          </span>
        </div>

        {children.map((child) => (
          <button
            key={child.id}
            type="button"
            onClick={() => handleNavigate(child.id)}
            className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-sm text-left hover:bg-[hsl(var(--accent))] transition-colors"
            style={{ paddingLeft: `${8 + (ancestors.length + 1) * 12}px` }}
          >
            {child.emoji ? (
              <span className="text-base leading-none shrink-0">
                {child.emoji}
              </span>
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
            )}
            <span className="truncate">{child.title || "Untitled"}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
