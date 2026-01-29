import * as React from 'react';

import { AppSidebar } from '../components/app-sidebar';
import { LexicalEditor } from '../components/lexical-editor';
import { TabStrip } from '../components/tab-strip';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../components/ui/sidebar';
import { useDocumentStore } from '../renderer/document-store';

function Titlebar() {
  return (
    <div
      className="titlebar-drag h-8 w-full border-b border-[hsl(var(--border))] bg-white/60 backdrop-blur"
    >
      <div className="flex h-full items-center">
        {/* Leave space for macOS traffic lights */}
        <div className="w-[76px]" />
        {/* Sidebar toggle should not be draggable so clicks work */}
        <div className="titlebar-nodrag flex items-center px-1">
          <SidebarTrigger className="h-6 w-6 text-[hsl(var(--foreground))]" />
        </div>
      </div>
    </div>
  );
}

/** Header contains the tabs bar (Notion-style: tabs blend into editor). Same bg as editor when tabs present. */
function Header() {
  const openTabs = useDocumentStore((s) => s.openTabs);
  const hasTabs = openTabs.length > 0;

  return (
    <header
      className={
        hasTabs
          ? 'w-full border-b-0 bg-[hsl(var(--background))] pt-1'
          : 'h-12 w-full border-b border-[hsl(var(--border))] bg-white/70 backdrop-blur flex items-center pl-4'
      }
    >
      {hasTabs ? (
        <TabStrip />
      ) : (
        <div className="flex-1">
          <div className="text-[13px] font-semibold tracking-tight">Lychee</div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
            Local-first workspace
          </div>
        </div>
      )}
    </header>
  );
}

function EditorArea() {
  const selectedId = useDocumentStore((s) => s.selectedId);
  const documents = useDocumentStore((s) => s.documents);
  const selected = selectedId
    ? documents.find((d) => d.id === selectedId)
    : undefined;

  if (!selectedId || !selected) {
    return (
      <main className="h-full flex-1 bg-[hsl(var(--background))] border-t-0">
        <div className="mx-auto max-w-[900px] px-8 py-10">
          <div className="text-3xl font-semibold tracking-tight text-[hsl(var(--muted-foreground))]">
            Select a document or create one to start editing.
          </div>
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
        <Titlebar />
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset>
            <Header />
            <div className="flex min-h-0 flex-1 flex-col">
              <EditorArea />
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
