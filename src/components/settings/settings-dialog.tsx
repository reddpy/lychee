import { useState } from 'react';
import {
  Check,
  Monitor,
  Moon,
  PenLine,
  Palette,
  Settings,
  SlidersHorizontal,
  Sun,
  X,
} from 'lucide-react';

import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/renderer/settings-store';
import { useThemeStore } from '@/renderer/theme-store';

type SectionKey = 'general' | 'appearance' | 'editor';

const sections: { key: SectionKey; label: string; icon: typeof Settings }[] = [
  { key: 'general', label: 'General', icon: SlidersHorizontal },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'editor', label: 'Editor', icon: PenLine },
];

type Mode = 'light' | 'dark' | 'system';

const themeOptions: {
  value: Mode;
  label: string;
  icon: typeof Sun;
  preview: string;
}[] = [
  {
    value: 'light',
    label: 'Light',
    icon: Sun,
    preview: 'bg-gradient-to-br from-white to-zinc-100 text-zinc-700',
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: Moon,
    preview: 'bg-gradient-to-br from-zinc-900 to-zinc-800 text-zinc-200',
  },
  {
    value: 'system',
    label: 'System',
    icon: Monitor,
    preview:
      'bg-[linear-gradient(135deg,white_0%,white_50%,#18181b_50%,#27272a_100%)] text-zinc-600',
  },
];

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        {description}
      </p>
    </div>
  );
}

function AppearanceSettings() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Appearance"
        description="Customize how Lychee looks on your screen."
      />

      <div className="space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Theme</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Choose a fixed mode or sync with your system.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {themeOptions.map(({ value, label, icon: Icon, preview }) => {
            const isActive = mode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={isActive}
                className={cn(
                  'group relative flex flex-col items-center gap-2 rounded-lg border p-2.5 text-left transition-all duration-150',
                  isActive
                    ? 'border-[hsl(var(--primary))]/55 bg-[hsl(var(--primary))]/5 shadow-sm'
                    : 'border-[hsl(var(--border))] hover:border-[hsl(var(--muted-foreground))]/40 hover:bg-[hsl(var(--accent))]/50',
                )}
              >
                <div
                  className={cn(
                    'flex h-14 w-full items-center justify-center rounded-md ring-1 ring-black/5',
                    preview,
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-medium">{label}</span>
                {isActive && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlaceholderSettings({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <SectionHeader title={title} description={description} />
      <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Nothing here yet — coming soon.
      </div>
    </div>
  );
}

function SectionContent({ section }: { section: SectionKey }) {
  if (section === 'appearance') return <AppearanceSettings />;
  if (section === 'editor')
    return (
      <PlaceholderSettings
        title="Editor"
        description="Tune writing behavior, shortcuts, and editor defaults."
      />
    );
  return (
    <PlaceholderSettings
      title="General"
      description="App-wide preferences and startup options."
    />
  );
}

export function SettingsDialog() {
  const isOpen = useSettingsStore((s) => s.isSettingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const [activeSection, setActiveSection] = useState<SectionKey>('general');

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeSettings();
          setActiveSection('general');
        }
      }}
    >
      <DialogContent
        className="sm:max-w-[min(44rem,calc(100vw-10rem))] h-[min(34rem,calc(100vh-6rem))] gap-0 overflow-hidden rounded-2xl border border-[hsl(var(--border))]/60 bg-[hsl(var(--popover))]/95 p-0 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.4),0_10px_20px_-8px_rgba(0,0,0,0.15),inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-black/5 backdrop-blur-xl flex flex-col"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/40 px-5 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close settings"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))]"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Left nav */}
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-[hsl(var(--border))] bg-[hsl(var(--background))]/30 px-2 py-3">
            {sections.map(({ key, label, icon: Icon }) => {
              const isActive = key === activeSection;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveSection(key)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-medium'
                      : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/60 hover:text-[hsl(var(--foreground))]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right pane */}
          <div className="flex-1 overflow-y-auto px-7 py-6">
            <SectionContent section={activeSection} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
