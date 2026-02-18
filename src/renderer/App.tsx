import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { AppSidebar } from '../components/app-sidebar';
import { LexicalEditor } from '../components/lexical-editor';
import { LycheeLogoHorizontal } from '../components/sidebar/lychee-logo';
import { TabStrip } from '../components/tab-strip';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '../components/ui/sidebar';
import { useDocumentStore } from '../renderer/document-store';

/** Unified top bar: left side matches sidebar, right side holds tabs. */
function TopBar() {
  const { open } = useSidebar();
  const openTabs = useDocumentStore((s) => s.openTabs);
  const selectedId = useDocumentStore((s) => s.selectedId);
  const selectDocument = useDocumentStore((s) => s.selectDocument);
  const hasTabs = openTabs.length > 0;

  const activeIndex = selectedId != null ? openTabs.indexOf(selectedId) : -1;
  const canGoLeft = activeIndex > 0;
  const canGoRight = activeIndex >= 0 && activeIndex < openTabs.length - 1;

  const handlePrevTab = React.useCallback(() => {
    if (!canGoLeft) return;
    const prevId = openTabs[activeIndex - 1];
    if (prevId) selectDocument(prevId);
  }, [canGoLeft, activeIndex, openTabs, selectDocument]);

  const handleNextTab = React.useCallback(() => {
    if (!canGoRight) return;
    const nextId = openTabs[activeIndex + 1];
    if (nextId) selectDocument(nextId);
  }, [canGoRight, activeIndex, openTabs, selectDocument]);

  return (
    <div className="titlebar-drag flex h-10 w-full shrink-0">
      {/* Left section — traffic lights, chevrons, toggle.
          When open: expands to full sidebar width with border-r.
          When collapsed: fixed size for all controls, no border-r. */}
      <div
        className={
          'flex shrink-0 items-center border-b border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-background))] transition-[width] duration-200 ease-out ' +
          (open ? 'w-[var(--sidebar-width)]' : 'w-[184px]')
        }
      >
        {/* Traffic lights space — always reserved */}
        <div className="w-[76px] shrink-0" />
        {/* Sidebar toggle */}
        <div className="titlebar-nodrag flex shrink-0 items-center px-2">
          <SidebarTrigger className="h-6 w-6 text-[hsl(var(--sidebar-foreground))]" />
        </div>
        {/* Spacer pushes chevrons to the right edge */}
        <div className="flex-1" />
        {/* Tab nav chevrons — separated by a divider, pinned to right edge */}
        <div className="titlebar-nodrag flex shrink-0 items-center gap-0.5 border-l border-[hsl(var(--sidebar-border))] px-1.5">
          <button
            type="button"
            onClick={handlePrevTab}
            disabled={!canGoLeft}
            aria-label="Previous tab"
            className={
              'flex h-6 w-6 items-center justify-center rounded-sm text-[hsl(var(--sidebar-foreground))] transition-colors ' +
              (canGoLeft
                ? 'hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]'
                : 'opacity-30')
            }
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleNextTab}
            disabled={!canGoRight}
            aria-label="Next tab"
            className={
              'flex h-6 w-6 items-center justify-center rounded-sm text-[hsl(var(--sidebar-foreground))] transition-colors ' +
              (canGoRight
                ? 'hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]'
                : 'opacity-30')
            }
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Right section — tab strip (background stays draggable, individual tabs are nodrag) */}
      <div className={`flex min-w-0 flex-1 items-stretch ${hasTabs ? 'bg-[hsl(var(--muted))]/50' : 'bg-[hsl(var(--background))]'}`}>
        {hasTabs ? <TabStrip /> : null}
      </div>
    </div>
  );
}

function EditorArea() {
  const selectedId = useDocumentStore((s) => s.selectedId);
  const openTabs = useDocumentStore((s) => s.openTabs);
  const documents = useDocumentStore((s) => s.documents);
  const selected = selectedId
    ? documents.find((d) => d.id === selectedId)
    : undefined;

  // Only show editor if selectedId has a corresponding open tab
  if (!selectedId || !selected || !openTabs.includes(selectedId)) {
    return (
      <main className="flex h-full flex-1 items-start justify-center bg-[hsl(var(--background))] pt-[20vh]">
        <div className="flex flex-col items-center gap-6 select-none">
          <LycheeLogoHorizontal className="h-20 opacity-15" />
          <div className="h-px w-36 bg-[hsl(var(--muted-foreground))]/10" />
          <p className="text-xl text-[hsl(var(--muted-foreground))]/40">
            Start writing
            <span className="inline-flex w-5">
              <span className="animate-[ellipsis_1.5s_steps(4,end)_infinite] overflow-hidden whitespace-nowrap">...</span>
            </span>
          </p>
        </div>
      </main>
    );
  }

  return (
    <LexicalEditor key={selectedId} documentId={selected.id} document={selected} />
  );
}

export function App() {
  return (
    <SidebarProvider defaultOpen>
      <div className="flex h-full w-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset>
            <div className="flex min-h-0 flex-1 flex-col">
              <EditorArea />
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
