import React from 'react';
import { Menu as MenuIcon } from 'lucide-react';

import type { WindowAction } from '../shared/ipc-types';
import { useDocumentStore } from '../renderer/document-store';
import { useSettingsStore } from '../renderer/settings-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const LYCHEE_WEBSITE_URL = 'https://lycheenote.com';
const LYCHEE_REPO_URL = 'https://github.com/reddpy/lychee';
const LYCHEE_ISSUES_URL = 'https://github.com/reddpy/lychee/issues';

function dispatchWindowAction(action: WindowAction): void {
  void window.lychee.invoke('window.action', { action });
}

function openExternal(url: string): void {
  void window.lychee.invoke('shell.openExternal', { url });
}

export function HamburgerMenu() {
  const openSettings = useSettingsStore((s) => s.openSettings);

  const handleNewNote = React.useCallback(() => {
    void useDocumentStore.getState().createDocument(null);
  }, []);

  const handleCloseTab = React.useCallback(() => {
    const { selectedId, closeTab } = useDocumentStore.getState();
    if (selectedId) closeTab(selectedId);
  }, []);

  const handleReopen = React.useCallback(() => {
    useDocumentStore.getState().reopenLastClosedTab();
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Application menu"
          className="titlebar-nodrag flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[hsl(var(--muted-foreground))] transition-all hover:border-brand/30 hover:bg-brand/15 hover:text-brand"
        >
          <MenuIcon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={6}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>File</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={handleNewNote}>
              New Note
              <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleCloseTab}>
              Close Tab
              <DropdownMenuShortcut>Ctrl+W</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleReopen}>
              Reopen Closed Tab
              <DropdownMenuShortcut>Ctrl+Shift+T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={openSettings}>
              Settings…
              <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => dispatchWindowAction('quit')}>
              Quit
              <DropdownMenuShortcut>Ctrl+Q</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>View</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => dispatchWindowAction('reload')}>
              Reload
              <DropdownMenuShortcut>Ctrl+R</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatchWindowAction('forceReload')}>
              Force Reload
              <DropdownMenuShortcut>Ctrl+Shift+R</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatchWindowAction('toggleDevTools')}>
              Toggle Developer Tools
              <DropdownMenuShortcut>Ctrl+Shift+I</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => dispatchWindowAction('resetZoom')}>
              Actual Size
              <DropdownMenuShortcut>Ctrl+0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatchWindowAction('zoomIn')}>
              Zoom In
              <DropdownMenuShortcut>Ctrl++</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatchWindowAction('zoomOut')}>
              Zoom Out
              <DropdownMenuShortcut>Ctrl+-</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => dispatchWindowAction('toggleFullscreen')}>
              Toggle Full Screen
              <DropdownMenuShortcut>F11</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Window</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => dispatchWindowAction('minimize')}>
              Minimize
              <DropdownMenuShortcut>Ctrl+M</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatchWindowAction('close')}>
              Close
              <DropdownMenuShortcut>Ctrl+W</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Help</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => openExternal(LYCHEE_WEBSITE_URL)}>
              Lychee Website
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openExternal(LYCHEE_REPO_URL)}>
              View on GitHub
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openExternal(LYCHEE_ISSUES_URL)}>
              Report an Issue
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
