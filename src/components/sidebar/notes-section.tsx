import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ChevronDown } from 'lucide-react';

import type { DocumentRow } from '../../shared/documents';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '../ui/sidebar';
import { useDocumentStore } from '../../renderer/document-store';
import { NoteTreeItem } from './note-tree-item';

const MAX_NESTING_DEPTH = 4; // root depth 0, deepest child depth 4 (5 levels)

/** Poof/pop exit animation when a note is trashed (framer-motion). */
const noteExitTransition = { duration: 0.2, ease: 'easeIn' as const };
const noteExit = {
  scale: 0.96,
  opacity: 0,
  transition: noteExitTransition,
};

export type NotesSectionProps = {
  documents: DocumentRow[];
  selectedId: string | null;
  loading: boolean;
  expandedIds: Set<string>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  createDocument: (parentId?: string | null) => Promise<void>;
};

function buildChildrenByParent(documents: DocumentRow[]) {
  const map = new Map<string | null, DocumentRow[]>();
  for (const doc of documents) {
    const key = doc.parentId ?? null;
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(doc);
    } else {
      map.set(key, [doc]);
    }
  }
  return map;
}

function NoteTreeRecursive({
  doc,
  depth,
  childrenByParent,
  expandedIds,
  selectedId,
  onToggleExpanded,
  onAddPageInside,
  highlightId,
}: {
  doc: DocumentRow;
  depth: number;
  childrenByParent: Map<string | null, DocumentRow[]>;
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggleExpanded: (id: string) => void;
  onAddPageInside: (parentId: string) => void;
  highlightId?: string | null;
}) {
  const children = childrenByParent.get(doc.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(doc.id);
  const canAddChild = depth < MAX_NESTING_DEPTH;
  const isHighlighted = highlightId === doc.id;

  return (
    <>
      <NoteTreeItem
        doc={doc}
        depth={depth}
        children={children}
        isExpanded={isExpanded}
        canAddChild={canAddChild}
        isSelected={selectedId === doc.id}
        onToggleExpanded={onToggleExpanded}
        onAddPageInside={onAddPageInside}
        isHighlighted={isHighlighted}
        isRoot={depth === 0}
      />
      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && (
          <motion.div
            className="mt-0.5"
            style={{ overflow: 'hidden' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <AnimatePresence initial={false}>
              {children.map((child) => (
                <motion.div
                  key={child.id}
                  layout
                  initial={false}
                  exit={noteExit}
                  transition={noteExitTransition}
                >
                  <NoteTreeRecursive
                    doc={child}
                    depth={depth + 1}
                    childrenByParent={childrenByParent}
                    expandedIds={expandedIds}
                    selectedId={selectedId}
                    onToggleExpanded={onToggleExpanded}
                    onAddPageInside={onAddPageInside}
                    highlightId={highlightId}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function NotesSection({
  documents,
  selectedId,
  loading,
  expandedIds,
  setExpandedIds,
  createDocument,
}: NotesSectionProps) {
  const { open } = useSidebar();
  const [notesSectionOpen, setNotesSectionOpen] = React.useState(true);
  const lastCreatedId = useDocumentStore((s) => s.lastCreatedId);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [highlightId, setHighlightId] = React.useState<string | null>(null);

  const childrenByParent = React.useMemo(
    () => buildChildrenByParent(documents),
    [documents],
  );
  const rootDocs = childrenByParent.get(null) ?? [];

  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [setExpandedIds]);

  const handleAddPageInside = React.useCallback(
    (parentId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        return next;
      });
      void createDocument(parentId);
    },
    [setExpandedIds, createDocument],
  );

  // Scroll newly created note into view and briefly highlight it. Must run unconditionally (no early return before hooks).
  React.useEffect(() => {
    if (!lastCreatedId) return;

    const container = scrollRef.current;
    if (container) {
      const el = container.querySelector<HTMLElement>(
        `[data-note-id="${lastCreatedId}"]`,
      );
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    setHighlightId(lastCreatedId);
    const timeout = window.setTimeout(() => {
      setHighlightId(null);
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [lastCreatedId, documents]);

  if (!open) return null;

  return (
    <>
      <SidebarGroup>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => setNotesSectionOpen((prev) => !prev)}
            className="px-2 text-xs font-medium uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]"
          >
            <span className="flex flex-1 items-center gap-1.5">
              {notesSectionOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span className='capitalize'>Notes</span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <AnimatePresence initial={false}>
        {notesSectionOpen && (
          <motion.div
            key="notes-section-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="min-h-0 mt-1 flex-1 overflow-hidden flex flex-col"
          >
            <div className="min-h-0 flex-1 flex flex-col">
              <div ref={scrollRef} className="notes-scroll min-h-0 flex-1 pr-1 py-1">
                <SidebarMenu>
                  {loading && (
                    <SidebarMenuItem>
                      <SidebarMenuButton>
                        <span className="h-4 w-4 shrink-0 rounded-full bg-[hsl(var(--muted-foreground))]/20" />
                        <span className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                          Loading…
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {!loading && (
                    <AnimatePresence initial={false}>
                      {rootDocs.map((doc) => (
                        <motion.div
                          key={doc.id}
                          layout
                          initial={false}
                          exit={noteExit}
                          transition={noteExitTransition}
                        >
                          <NoteTreeRecursive
                            doc={doc}
                            depth={0}
                            childrenByParent={childrenByParent}
                            expandedIds={expandedIds}
                            selectedId={selectedId}
                            onToggleExpanded={toggleExpanded}
                            onAddPageInside={handleAddPageInside}
                            highlightId={highlightId}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </SidebarMenu>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
