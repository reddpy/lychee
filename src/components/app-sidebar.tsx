import * as React from 'react';
import { FileText, Plus, Search, Settings, SquareStack } from 'lucide-react';

import { cn } from '../lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from './ui/sidebar';

const items = [
  { title: 'Notes', icon: FileText },
  { title: 'Search', icon: Search },
  { title: 'Settings', icon: Settings },
];

// Temporary logo placeholder. We'll swap this for a custom SVG later.
function LycheeLogo() {
  return <SquareStack className="h-3 w-3" />;
}

export function AppSidebar() {
  const { open } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex w-full items-center gap-2 overflow-hidden">
          <button
            type="button"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-white/70 border border-[hsl(var(--sidebar-border))]"
            title="Lychee Notes"
            aria-label="Lychee Notes"
          >
            <LycheeLogo />
          </button>
          <div
            className={cn(
              'min-w-0 flex-1 text-sm font-semibold truncate transition-opacity duration-150',
              open ? 'opacity-100' : 'opacity-0',
            )}
            title="Lychee Notes"
          >
            Lychee Notes
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Actions</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="New note">
                <Plus className="h-4 w-4 shrink-0" />
                <span className={cn('truncate', !open && 'sr-only')}>New note</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton tooltip={item.title}>
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className={cn('truncate', !open && 'sr-only')}>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

