import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { AppSidebar } from '../components/app-sidebar';
import { CollapsedSidebarWidget } from '../components/collapsed-sidebar-widget';
import { LexicalEditor } from '../components/lexical-editor';
import { MediaPlaybackPill } from '../components/media-playback-pill';
import { SettingsDialog } from '../components/settings/settings-dialog';
import { LycheeLogoHorizontal } from '../components/sidebar/lychee-logo';
import { TabStrip } from '../components/tab-strip';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '../components/ui/sidebar';
import { useDocumentStore } from '../renderer/document-store';

/** Unified top bar: left section aligns with sidebar, right section holds tabs. */
function TopBar() {
  const { open: sidebarOpen } = useSidebar();
  const openTabs = useDocumentStore((s) => s.openTabs);
  const selectedId = useDocumentStore((s) => s.selectedId);
  const selectDocument = useDocumentStore((s) => s.selectDocument);
  const hasTabs = openTabs.length > 0;

  const activeIndex = selectedId != null ? openTabs.findIndex((t) => t.tabId === selectedId) : -1;
  const canGoLeft = activeIndex > 0;
  const canGoRight = activeIndex >= 0 && activeIndex < openTabs.length - 1;

  const handlePrevTab = React.useCallback(() => {
    if (!canGoLeft) return;
    const prevTab = openTabs[activeIndex - 1];
    if (prevTab) selectDocument(prevTab.tabId);
  }, [canGoLeft, activeIndex, openTabs, selectDocument]);

  const handleNextTab = React.useCallback(() => {
    if (!canGoRight) return;
    const nextTab = openTabs[activeIndex + 1];
    if (nextTab) selectDocument(nextTab.tabId);
  }, [canGoRight, activeIndex, openTabs, selectDocument]);

  return (
    <div className="titlebar-drag relative flex h-10 w-full shrink-0 bg-[hsl(var(--sidebar-background))]">
      {/* Left section — matches sidebar width when open, shrinks when collapsed */}
      <div
        className={`relative z-20 flex shrink-0 items-center overflow-hidden border-r border-r-[hsl(var(--border))] transition-[width] duration-200 ease-out ${sidebarOpen ? 'w-[var(--sidebar-width)]' : 'w-[184px]'}`}
      >
        {/* Traffic lights space — always reserved */}
        <div className="w-[76px] shrink-0" />
        {/* Sidebar toggle */}
        <div className="titlebar-nodrag flex shrink-0 items-center px-1 translate-y-0.5">
          <SidebarTrigger className="h-7 w-7 rounded-md border border-transparent text-[hsl(var(--muted-foreground))] hover:bg-[#C14B55]/15 hover:border-[#C14B55]/30 hover:text-[#C14B55] transition-all" />
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
              'flex h-6 w-6 items-center justify-center rounded-sm text-[hsl(var(--muted-foreground))] transition-colors ' +
              (canGoLeft
                ? 'hover:bg-[#C14B55]/15 hover:text-[#C14B55]'
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
              'flex h-6 w-6 items-center justify-center rounded-sm text-[hsl(var(--muted-foreground))] transition-colors ' +
              (canGoRight
                ? 'hover:bg-[#C14B55]/15 hover:text-[#C14B55]'
                : 'opacity-30')
            }
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab strip fills remaining space */}
      <div className="relative flex min-w-0 flex-1 items-stretch bg-[hsl(var(--sidebar-background))]">
        {hasTabs ? <TabStrip /> : null}
      </div>
      {/* Bottom border — last child so it paints above inactive tabs; active tab z-10 breaks through */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-foreground/8" />
    </div>
  );
}

function EditorArea() {
  const selectedId = useDocumentStore((s) => s.selectedId);
  const openTabs = useDocumentStore((s) => s.openTabs);
  const documents = useDocumentStore((s) => s.documents);

  const docById = React.useMemo(() => {
    const map = new Map<string, (typeof documents)[number]>();
    for (const d of documents) map.set(d.id, d);
    return map;
  }, [documents]);

  // Collect unique docIds in tab order (first occurrence wins for stable ordering).
  const uniqueDocIds = React.useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const { docId } of openTabs) {
      if (!seen.has(docId)) {
        seen.add(docId);
        result.push(docId);
      }
    }
    return result;
  }, [openTabs]);

  // The active docId: whichever tab is selected.
  const activeDocId = React.useMemo(
    () => openTabs.find((t) => t.tabId === selectedId)?.docId ?? null,
    [openTabs, selectedId],
  );

  const hasActiveTab = activeDocId != null;

  if (!hasActiveTab) {
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
    <>
      {uniqueDocIds.map((docId) => {
        const doc = docById.get(docId);
        if (!doc) return null;
        const activeTabId = openTabs.find((t) => t.tabId === selectedId && t.docId === docId)?.tabId ?? null;
        return (
          <LexicalEditor
            key={docId}
            documentId={doc.id}
            document={doc}
            hidden={docId !== activeDocId}
            activeTabId={activeTabId}
          />
        );
      })}
    </>
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
            <div className="relative flex min-h-0 flex-1 flex-col">
              <EditorArea />
              <MediaPlaybackPill />
            </div>
          </SidebarInset>
          <CollapsedSidebarWidget />
        </div>
      </div>
      <SettingsDialog />
    </SidebarProvider>
  );
}
