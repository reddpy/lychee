import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { AppSidebar } from '../components/app-sidebar';
import { CollapsedSidebarWidget } from '../components/collapsed-sidebar-widget';
import { LexicalEditor } from '../components/lexical-editor';
import { LycheeLogoHorizontal } from '../components/sidebar/lychee-logo';
import { TabStrip } from '../components/tab-strip';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../components/ui/sidebar';
import { useDocumentStore } from '../renderer/document-store';

/** Unified top bar: left section aligns with sidebar, right section holds tabs. */
function TopBar() {
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
    <div className="titlebar-drag flex h-10 w-full shrink-0 bg-[#C14B55]">
      {/* Left section — fixed width matching sidebar right edge */}
      <div
        className="flex w-[var(--sidebar-width)] shrink-0 items-center"
      >
        {/* Traffic lights space — always reserved */}
        <div className="w-[76px] shrink-0" />
        {/* Sidebar toggle */}
        <div className="titlebar-nodrag flex shrink-0 items-center px-1 translate-y-0.5">
          <SidebarTrigger className="h-7 w-7 rounded-md border border-transparent text-white/80 hover:border-white/20 hover:bg-white/15 hover:text-white transition-all" />
        </div>
        {/* Spacer pushes chevrons to the right edge */}
        <div className="flex-1" />
        {/* Tab nav chevrons */}
        <div className="titlebar-nodrag flex shrink-0 items-center gap-0.5 px-1.5 translate-y-0.5">
          <button
            type="button"
            onClick={handlePrevTab}
            disabled={!canGoLeft}
            aria-label="Previous tab"
            className={
              'flex h-6 w-6 items-center justify-center rounded-sm text-white/80 transition-colors ' +
              (canGoLeft
                ? 'hover:bg-white/15 hover:text-white'
                : 'opacity-30')
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNextTab}
            disabled={!canGoRight}
            aria-label="Next tab"
            className={
              'flex h-6 w-6 items-center justify-center rounded-sm text-white/80 transition-colors ' +
              (canGoRight
                ? 'hover:bg-white/15 hover:text-white'
                : 'opacity-30')
            }
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab strip fills remaining space */}
      <div className="relative flex min-w-0 flex-1 items-stretch">
        {hasTabs ? <TabStrip /> : null}
        {/* Bottom accent line when no tabs are open */}
        {!hasTabs && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/15" />}
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
        <div className="relative flex min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset>
            <div className="flex min-h-0 flex-1 flex-col">
              <EditorArea />
            </div>
          </SidebarInset>
          <CollapsedSidebarWidget />
        </div>
      </div>
    </SidebarProvider>
  );
}
