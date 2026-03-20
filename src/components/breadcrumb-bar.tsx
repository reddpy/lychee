import { useState, useMemo, useCallback, useEffect, type MouseEvent } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import { useDocumentStore, selectActiveDocId } from "@/renderer/document-store";
import { DocumentRow } from "@/shared/documents";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** Cache the Map across renders — only rebuild when the docs array reference changes. */
let cachedDocs: DocumentRow[] | null = null;
let cachedMap: Map<string, DocumentRow> | null = null;

function getDocMap(docs: DocumentRow[]): Map<string, DocumentRow> {
  if (docs !== cachedDocs) {
    cachedDocs = docs;
    cachedMap = new Map(docs.map((d) => [d.id, d]));
  }
  return cachedMap!;
}

function buildAncestors(currentId: string, docs: DocumentRow[]): DocumentRow[] {
  const byId = getDocMap(docs);
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

type BreakpointMode = "medium" | "wide";

function getBreakpoint(w: number): BreakpointMode {
  if (w < 768) return "medium";
  return "wide";
}

function useBreakpointMode(): BreakpointMode {
  const [mode, setMode] = useState<BreakpointMode>(() =>
    getBreakpoint(window.innerWidth),
  );

  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setMode((prev) => {
          const next = getBreakpoint(window.innerWidth);
          return next === prev ? prev : next;
        });
      });
    };
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
    };
  }, []);

  return mode;
}

/** Max ancestors to show inline before collapsing the middle into "..." */
const COLLAPSE_THRESHOLDS: Record<BreakpointMode, number> = {
  medium: 1,   // only direct parent
  wide: 4,     // full trail, collapse at 4+
};

/** Max character width for truncated titles */
const TITLE_MAX_W: Record<BreakpointMode, string> = {
  medium: "100px",
  wide: "120px",
};

function AncestorSegment({
  doc,
  onNavigate,
  onAuxClick,
  maxTitleW,
}: {
  doc: DocumentRow;
  onNavigate: (id: string, e: MouseEvent) => void;
  onAuxClick: (id: string, e: MouseEvent) => void;
  maxTitleW: string;
}) {
  return (
    <button
      type="button"
      title={doc.title || "Untitled"}
      onClick={(e) => onNavigate(doc.id, e)}
      onAuxClick={(e) => onAuxClick(doc.id, e)}
      className="flex items-center gap-1 min-w-0 rounded px-1 py-0.5 text-xs text-[hsl(var(--muted-foreground))]/70 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors cursor-pointer select-none"
    >
      {doc.emoji && (
        <span className="text-xs leading-none shrink-0">{doc.emoji}</span>
      )}
      <span className="truncate" style={{ maxWidth: maxTitleW }}>
        {doc.title || "Untitled"}
      </span>
    </button>
  );
}

function Chevron() {
  return (
    <ChevronRight className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))]/40" />
  );
}

export function BreadcrumbBar() {
  const [collapseOpen, setCollapseOpen] = useState(false);
  const mode = useBreakpointMode();

  // Close popover when breakpoint changes (ancestors shift between inline/collapsed)
  useEffect(() => {
    setCollapseOpen(false);
  }, [mode]);
  const selectedId = useDocumentStore(selectActiveDocId);
  const documents = useDocumentStore((s) => s.documents);
  const openTab = useDocumentStore((s) => s.openTab);
  const navigateCurrentTab = useDocumentStore((s) => s.navigateCurrentTab);

  const ancestors = useMemo(
    () => (selectedId ? buildAncestors(selectedId, documents) : []),
    [selectedId, documents],
  );

  const currentDoc = useMemo(
    () => documents.find((d) => d.id === selectedId),
    [selectedId, documents],
  );

  const handleNavigate = useCallback(
    (id: string, event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey) {
        openTab(id);
      } else {
        navigateCurrentTab(id);
      }
      setCollapseOpen(false);
    },
    [navigateCurrentTab, openTab],
  );

  const handleAuxClick = useCallback(
    (id: string, event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      openTab(id);
      setCollapseOpen(false);
    },
    [openTab],
  );

  if (!currentDoc) return null;

  const threshold = COLLAPSE_THRESHOLDS[mode];
  const maxTitleW = TITLE_MAX_W[mode];

  // How many ancestors to show inline
  const visibleAncestors = threshold > 0 ? ancestors.slice(-threshold) : [];
  const hiddenAncestors = ancestors.slice(0, ancestors.length - visibleAncestors.length);
  const needsCollapse = hiddenAncestors.length > 0;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-0.5 min-w-0 overflow-hidden"
    >
      {/* Collapsed ancestors dropdown */}
      {needsCollapse && (
        <>
          <Popover open={collapseOpen} onOpenChange={setCollapseOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-center rounded px-1 py-0.5 text-xs text-[hsl(var(--muted-foreground))]/50 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors cursor-pointer select-none"
              >
                <Ellipsis className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-52 max-h-60 overflow-y-auto p-1"
              align="start"
              side="bottom"
              sideOffset={4}
            >
              {hiddenAncestors.map((doc, i) => (
                <button
                  key={doc.id}
                  type="button"
                  title={doc.title || "Untitled"}
                  onClick={(e) => handleNavigate(doc.id, e)}
                  onAuxClick={(e) => handleAuxClick(doc.id, e)}
                  className="group/row flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm text-left hover:bg-[hsl(var(--accent))] transition-colors"
                  style={{ paddingLeft: `${8 + i * 14}px` }}
                >
                  <span className="shrink-0 text-[hsl(var(--muted-foreground))]/25 text-xs leading-none select-none">
                    {i < hiddenAncestors.length - 1 ? "├" : "└"}
                  </span>
                  {doc.emoji ? (
                    <span className="text-base leading-none shrink-0">
                      {doc.emoji}
                    </span>
                  ) : null}
                  <span className="truncate">{doc.title || "Untitled"}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Chevron />
        </>
      )}

      {/* Visible ancestors */}
      {visibleAncestors.map((ancestor, i) => (
        <span key={ancestor.id} className="flex items-center gap-0.5 min-w-0">
          {i > 0 && <Chevron />}
          <AncestorSegment
            doc={ancestor}
            onNavigate={handleNavigate}
            onAuxClick={handleAuxClick}
            maxTitleW={maxTitleW}
          />
        </span>
      ))}

      {/* Current note */}
      {(visibleAncestors.length > 0 || needsCollapse) && <Chevron />}
      <span
        title={currentDoc.title || "Untitled"}
        className="flex items-center gap-1 min-w-0 px-1 py-0.5 text-xs text-[hsl(var(--muted-foreground))]/40 select-none"
      >
        {currentDoc.emoji && (
          <span className="text-xs leading-none shrink-0">
            {currentDoc.emoji}
          </span>
        )}
        <span className="truncate" style={{ maxWidth: maxTitleW }}>
          {currentDoc.title || "Untitled"}
        </span>
      </span>
    </nav>
  );
}
