import * as React from 'react';

import { AppSidebar } from '../components/app-sidebar';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../components/ui/sidebar';

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

function Header() {
  return (
    <header
      className="h-12 w-full border-b border-[hsl(var(--border))] bg-white/70 backdrop-blur flex items-center pl-4"
    >
      <div className="flex-1">
        <div className="text-[13px] font-semibold tracking-tight">Lychee</div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
          Local-first workspace
        </div>
      </div>
    </header>
  );
}

function EditorPlaceholder() {
  return (
    <main className="h-full flex-1 bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-[900px] px-8 py-10">
        <div className="text-3xl font-semibold tracking-tight">Untitled</div>
        <div className="mt-6 text-[15px] leading-7 text-[hsl(var(--muted-foreground))]">
          This is the initial UI skeleton. Next we’ll wire the sidebar to your SQLite
          documents and replace this area with the Lexical editor.
        </div>
        <div className="mt-8 h-48 rounded-lg border border-[hsl(var(--border))] bg-white/50" />
      </div>
    </main>
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
            <div className="flex h-[calc(100vh-3rem-2rem)]">
              <EditorPlaceholder />
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}

