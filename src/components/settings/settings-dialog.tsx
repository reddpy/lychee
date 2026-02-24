import { useState } from 'react';
import { Settings } from 'lucide-react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useSettingsStore } from '@/renderer/settings-store';

const sections = ['General', 'Appearance', 'Editor'] as const;
type Section = (typeof sections)[number];

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
            <h3 className="text-sm font-semibold mb-1">{activeSection}</h3>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {activeSection} settings will appear here.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
