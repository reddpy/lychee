import { useState } from 'react';
import { Settings, Sun, Moon, Monitor } from 'lucide-react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useSettingsStore } from '@/renderer/settings-store';
import { useThemeStore } from '@/renderer/theme-store';
import { AISettings } from '@/components/settings/ai-settings';

const sections = ['General', 'Appearance', 'Editor', 'AI'] as const;
type Section = (typeof sections)[number];

type Mode = 'light' | 'dark' | 'system';

const themeOptions: { value: Mode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function AppearanceSettings() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">Appearance</h3>
      <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
        Choose how Lychee looks.
      </p>

      <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2 block">
        Theme
      </label>
      <div className="inline-flex rounded-lg border border-[hsl(var(--border))] p-0.5">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ' +
              (mode === value
                ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-medium'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionContent({ section }: { section: Section }) {
  if (section === 'Appearance') return <AppearanceSettings />;
  if (section === 'AI') return <AISettings />;
  return (
    <>
      <h3 className="text-sm font-semibold mb-1">{section}</h3>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        {section} settings will appear here.
      </p>
    </>
  );
}

export function SettingsDialog() {
  const isOpen = useSettingsStore((s) => s.isSettingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const [activeSection, setActiveSection] = useState<Section>('General');

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeSettings();
          setActiveSection('General');
        }
      }}
    >
      <DialogContent
        className="sm:max-w-2xl h-[32rem] p-0 flex flex-col"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 pt-4 pb-3">
          <Settings className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          <h2 className="text-base font-semibold">Settings</h2>
        </div>
        <Separator />

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Left nav */}
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-[hsl(var(--border))] px-2 py-2">
            {sections.map((section) => (
              <button
                key={section}
                type="button"
                onClick={() => setActiveSection(section)}
                className={
                  'rounded-md px-3 py-1.5 text-left text-sm transition-colors ' +
                  (section === activeSection
                    ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-medium'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]')
                }
              >
                {section}
              </button>
            ))}
          </nav>

          {/* Right pane */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <SectionContent section={activeSection} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
