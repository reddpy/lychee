import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, FileText, MoreHorizontal } from 'lucide-react';

import type { DocumentRow } from '../../shared/documents';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useHoverLock,
} from '../ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useDocumentStore, selectActiveDocId } from '../../renderer/document-store';
import { DocumentContextMenu, DocumentDropdownMenuContent } from './document-command-menu';
import { cn } from '../../lib/utils';

export type BookmarksSectionProps = {
  documents: DocumentRow[];
};

const itemExit = {
  opacity: 0,
  height: 0,
  transition: { duration: 0.2, ease: 'easeOut' as const },
};

function BookmarkItem({ doc, isSelected }: { doc: DocumentRow; isSelected: boolean }) {
  const { openTab, openOrSelectTab } = useDocumentStore();
  const hoverLock = useHoverLock();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [optionsTooltip, setOptionsTooltip] = React.useState(false);

  const iconNode = doc.emoji ? (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-base leading-none">
      {doc.emoji}
    </span>
  ) : (
    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  );

  return (
    <DocumentContextMenu docId={doc.id} canAddChild={false}>
      <div className="relative" data-note-id={doc.id} data-section="bookmarks">
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page'}
            isActive={isSelected}
            onClick={(e: React.MouseEvent) => {
              if (e.metaKey || e.ctrlKey) {
                openTab(doc.id);
              } else {
                openOrSelectTab(doc.id);
              }
            }}
            onAuxClick={(e: React.MouseEvent) => {
              if (e.button === 1) {
                e.preventDefault();
                openTab(doc.id);
              }
            }}
            className="group cursor-pointer text-sm"
          >
            <div className={cn("relative flex w-full min-w-0 items-center gap-1.5 rounded-md transition-[padding] duration-200 text-left group-hover:pr-8", menuOpen && "pr-8")}>
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="flex h-3.5 w-3.5 items-center justify-center">
                  {iconNode}
                </span>
              </span>
              <span className={cn(
                "flex-1 truncate select-none text-[hsl(var(--muted-foreground))]",
                isSelected && "font-extrabold text-[hsl(var(--foreground))]",
              )}>
                {doc.title && doc.title !== 'Untitled' ? doc.title : 'New Page'}
              </span>

              {/* Options (⋯) dropdown — appears on hover, no + button since canAddChild=false */}
              <div
                className={cn("absolute right-0 top-0 bottom-0 flex items-center gap-0.5 pl-4 opacity-0 transition-opacity group-hover:opacity-100 bg-gradient-to-r from-transparent to-[hsl(var(--sidebar-accent))]", menuOpen && "opacity-100")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu onOpenChange={(open) => { setMenuOpen(open); hoverLock(open); if (open) setOptionsTooltip(false); }}>
                  <TooltipPrimitive.Root open={optionsTooltip} onOpenChange={setOptionsTooltip} delayDuration={150}>
                    <TooltipPrimitive.Trigger asChild>
                      <DropdownMenuTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md outline-hidden border border-transparent hover:scale-110 hover:shadow-lg hover:border-[hsl(var(--border))] hover:text-[hsl(var(--foreground))] transition-[transform,box-shadow,border-color,color]"
                          onClick={(e) => e.stopPropagation()}
                          onFocus={(e) => e.preventDefault()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </span>
                      </DropdownMenuTrigger>
                    </TooltipPrimitive.Trigger>
                    <TooltipPrimitive.Portal>
                      <TooltipPrimitive.Content
                        side="top"
                        sideOffset={4}
                        className="z-50 rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-xs text-[hsl(var(--background))] shadow"
                      >
                        Options
                        <TooltipPrimitive.Arrow className="fill-[hsl(var(--foreground))]" />
                      </TooltipPrimitive.Content>
                    </TooltipPrimitive.Portal>
                  </TooltipPrimitive.Root>
                  <DocumentDropdownMenuContent docId={doc.id} canAddChild={false} />
                </DropdownMenu>
              </div>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </div>
    </DocumentContextMenu>
  );
}

export function BookmarksSection({ documents }: BookmarksSectionProps) {
  const [isOpen, setIsOpen] = React.useState(true);
  const selectedId = useDocumentStore(selectActiveDocId);

  const bookmarked = React.useMemo(
    () =>
      documents
        .filter((d): d is DocumentRow & { metadata: { bookmarkedAt: string } } => !!d.metadata?.bookmarkedAt)
        .sort((a, b) => b.metadata.bookmarkedAt.localeCompare(a.metadata.bookmarkedAt)),
    [documents],
  );

  if (bookmarked.length === 0) return null;

  return (
    <>
      <SidebarGroup>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => setIsOpen((prev) => !prev)}
            className="px-2 text-xs font-medium uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]"
          >
            <span className="flex flex-1 items-center gap-1.5">
              <motion.span
                className="flex shrink-0 items-center justify-center"
                animate={{ rotate: isOpen ? 90 : 0 }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 30,
                }}
              >
                <ChevronRight className="h-3 w-3" />
              </motion.span>
              <span className="capitalize">Bookmarks</span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            className="min-h-0 flex-1 overflow-hidden flex flex-col"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 35,
              mass: 0.8,
              opacity: { duration: 0.15 },
            }}
          >
            <div className="min-h-0 flex-1 flex flex-col">
              <div className="sidebar-panel notes-scroll min-h-0 flex-1 pr-2 py-1">
                <SidebarMenu>
                  <AnimatePresence initial={false}>
                    {bookmarked.map((doc) => (
                      <motion.div key={doc.id} exit={itemExit}>
                        <BookmarkItem doc={doc} isSelected={selectedId === doc.id} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </SidebarMenu>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
