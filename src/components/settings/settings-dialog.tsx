import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  Database,
  FolderOpen,
  Info,
  Loader2,
  Languages,
  Keyboard,
  Monitor,
  Moon,
  PenLine,
  Palette,
  Pipette,
  Plus,
  RotateCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorPickerPopover } from '@/components/ui/color-picker';
import { Switch } from '@/components/ui/switch';
import { LycheeLogo } from '@/components/sidebar/lychee-logo';
import { UpdateDot } from '@/components/update-dot';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/renderer/settings-store';
import { useThemeStore } from '@/renderer/theme-store';
import { useAppearanceStore } from '@/renderer/appearance-store';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_HEX,
  MAX_HIGHLIGHT_COLORS,
} from '@/renderer/appearance-preferences';
import { useUpdateStore } from '@/renderer/update-store';
import { type UpdateAction, describeUpdate } from '@/renderer/update-status-view';
import type { DataLocations, SpellCheckState } from '@/shared/ipc-types';
import {
  displayKeybinding,
  keybindingFromEvent,
  keybindingsConflict,
  normalizeKeybinding,
  shortcutRegistry,
  type ShortcutCategory,
  type ShortcutId,
} from '@/shared/keybindings';
import { useKeybindingsStore } from '@/renderer/keybindings-store';

type SectionKey = 'general' | 'appearance' | 'editor' | 'keyboard' | 'about';

const sections: { key: SectionKey; label: string; icon: typeof Settings }[] = [
  { key: 'general', label: 'General', icon: SlidersHorizontal },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'editor', label: 'Editor', icon: PenLine },
  { key: 'keyboard', label: 'Shortcuts', icon: Keyboard },
  { key: 'about', label: 'About', icon: Info },
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

/** Marker colors offered in Appearance. Selecting one toggles it in/out of the
 *  active highlight palette. */
const HIGHLIGHT_PRESET_COLORS = [
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#34d399',
  '#38bdf8',
  '#60a5fa',
  '#c084fc',
  '#f472b6',
  '#94a3b8',
];

function AccentSwatch({
  hex,
  label,
  active,
  onClick,
}: {
  hex: string | null;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const color = hex ?? DEFAULT_ACCENT_HEX;
  return (
    <button
      type="button"
      data-testid="accent-preset"
      data-accent={hex ?? 'default'}
      onClick={onClick}
      aria-label={`${label} accent`}
      aria-pressed={active}
      title={label}
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-full border transition-transform hover:scale-105',
        active
          ? 'border-[hsl(var(--foreground))]/60 ring-2 ring-[hsl(var(--ring))]/30'
          : 'border-[hsl(var(--border))]',
      )}
      style={{ backgroundColor: color }}
    >
      {active && (
        <Check className="h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" strokeWidth={3} />
      )}
    </button>
  );
}

function HighlightSwatch({
  hex,
  active,
  onToggle,
}: {
  hex: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="highlight-preset"
      data-color={hex}
      aria-label={`Highlight color ${hex}`}
      aria-pressed={active}
      title={active ? `${hex} (click to remove)` : `${hex} (click to add)`}
      onClick={onToggle}
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-full border transition-transform hover:scale-105',
        active
          ? 'border-[hsl(var(--foreground))]/60 ring-2 ring-[hsl(var(--ring))]/30'
          : 'border-[hsl(var(--border))]',
      )}
      style={{ backgroundColor: hex }}
    >
      {active && (
        <Check className="h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" strokeWidth={3} />
      )}
    </button>
  );
}

function AppearanceSettings() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const accent = useAppearanceStore((s) => s.accent);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const resetAccent = useAppearanceStore((s) => s.resetAccent);
  const palette = useAppearanceStore((s) => s.highlightPalette);
  const addHighlightColor = useAppearanceStore((s) => s.addHighlightColor);
  const removeHighlightColor = useAppearanceStore((s) => s.removeHighlightColor);
  const resetHighlightPalette = useAppearanceStore((s) => s.resetHighlightPalette);

  const [draftColor, setDraftColor] = useState('#f472b6');

  const isCustomAccent =
    accent !== null && !ACCENT_PRESETS.some((preset) => preset.hex === accent);

  const presetSwatches = [
    ...HIGHLIGHT_PRESET_COLORS,
    ...palette.filter((color) => !HIGHLIGHT_PRESET_COLORS.includes(color)),
  ];

  const toggleHighlight = (hex: string) => {
    const index = palette.indexOf(hex);
    if (index >= 0) removeHighlightColor(index);
    else addHighlightColor(hex);
  };

  const commitDraftColor = () => {
    addHighlightColor(draftColor);
  };

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
                  'relative flex flex-col items-center gap-2 rounded-lg border p-2.5 transition-all duration-150',
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

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Accent color</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Used for highlights, selection, and active controls.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="accent-reset"
            onClick={resetAccent}
            disabled={accent === null}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((preset) => (
            <AccentSwatch
              key={preset.name}
              hex={preset.hex}
              label={preset.name}
              active={accent === preset.hex}
              onClick={() => setAccent(preset.hex)}
            />
          ))}

          <ColorPickerPopover
            value={accent ?? DEFAULT_ACCENT_HEX}
            onChange={setAccent}
          >
            <button
              type="button"
              data-testid="accent-custom"
              aria-label="Custom accent color"
              aria-pressed={isCustomAccent}
              title="Custom color"
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-full border border-dashed transition-transform hover:scale-105',
                isCustomAccent
                  ? 'border-[hsl(var(--foreground))]/60 ring-2 ring-[hsl(var(--ring))]/30'
                  : 'border-[hsl(var(--muted-foreground))]/50 text-[hsl(var(--muted-foreground))]',
              )}
              style={isCustomAccent ? { backgroundColor: accent } : undefined}
            >
              {isCustomAccent ? (
                <Check className="h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" strokeWidth={3} />
              ) : (
                <Pipette className="h-4 w-4" />
              )}
            </button>
          </ColorPickerPopover>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Highlight colors</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Marker swatches shown in the editor toolbar.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="palette-reset"
            onClick={resetHighlightPalette}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {presetSwatches.map((hex) => (
            <HighlightSwatch
              key={hex}
              hex={hex}
              active={palette.includes(hex)}
              onToggle={() => toggleHighlight(hex)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ColorPickerPopover value={draftColor} onChange={setDraftColor}>
            <button
              type="button"
              data-testid="highlight-custom"
              aria-label="Custom highlight color"
              title="Custom color"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-[hsl(var(--muted-foreground))]/50 text-[hsl(var(--muted-foreground))] transition-transform hover:scale-105"
            >
              <Pipette className="h-4 w-4" />
            </button>
          </ColorPickerPopover>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="highlight-add"
            onClick={commitDraftColor}
            disabled={palette.length >= MAX_HIGHLIGHT_COLORS}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function GeneralSettings() {
  const revealFileLabel =
    window.lychee.platform === 'darwin'
      ? 'Reveal in Finder'
      : window.lychee.platform === 'win32'
        ? 'Show in Explorer'
        : 'Show in Folder';
  const [locations, setLocations] = useState<DataLocations | null>(null);
  const [activeAction, setActiveAction] = useState<
    'open-folder' | 'reveal-database' | 'backup' | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.lychee
      .invoke('data.getLocations', {})
      .then((value) => {
        if (alive) setLocations(value);
      })
      .catch(() => {
        if (alive) setActionError('Lychee couldn’t read the data location.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const openDataFolder = async (): Promise<void> => {
    setActiveAction('open-folder');
    setActionError(null);
    try {
      await window.lychee.invoke('data.openFolder', {});
    } catch {
      setActionError('Lychee couldn’t open the data folder. Try again or restart the app.');
    } finally {
      setActiveAction(null);
    }
  };

  const revealDatabase = async (): Promise<void> => {
    setActiveAction('reveal-database');
    setActionError(null);
    try {
      await window.lychee.invoke('data.revealDatabase', {});
    } catch {
      setActionError('Lychee couldn’t reveal the database file.');
    } finally {
      setActiveAction(null);
    }
  };

  const createBackup = async (): Promise<void> => {
    setActiveAction('backup');
    setActionError(null);
    setBackupPath(null);
    try {
      const result = await window.lychee.invoke('data.createBackup', {});
      if ('filePath' in result) setBackupPath(result.filePath);
    } catch {
      setActionError('Lychee couldn’t create the backup. Choose another location and try again.');
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="General"
        description="App-wide preferences and startup options."
      />

      <div className="space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Data</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Find and manage Lychee's local files.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/15">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Storage location</p>
              <p
                title={locations?.userDataPath}
                className="mt-1 truncate font-mono text-xs text-[hsl(var(--muted-foreground))]"
              >
                {locations?.userDataPath ?? 'Loading…'}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!locations || activeAction !== null}
              onClick={() => void openDataFolder()}
            >
              {activeAction === 'open-folder' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5" />
              )}
              Open Data Folder
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[hsl(var(--border))] px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                <p className="text-sm font-medium">Notes database</p>
              </div>
              <p
                title={locations?.databasePath}
                className="mt-1 truncate font-mono text-xs text-[hsl(var(--muted-foreground))]"
              >
                lychee.sqlite3
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={!locations || activeAction !== null}
              onClick={() => void revealDatabase()}
            >
              {activeAction === 'reveal-database' && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {revealFileLabel}
            </Button>
          </div>

          <div className="border-t border-[hsl(var(--border))] px-4 py-3.5">
            <p className="text-sm font-medium">Images</p>
            <p
              title={locations?.imagesPath}
              className="mt-1 truncate font-mono text-xs text-[hsl(var(--muted-foreground))]"
            >
              images/
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-[hsl(var(--border))] px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Database backup</p>
              <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                Save a consistent snapshot of your notes and settings. Images are not included.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={activeAction !== null}
              onClick={() => void createBackup()}
            >
              {activeAction === 'backup' && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Create Backup…
            </Button>
          </div>

          {(actionError || backupPath) && (
            <div className="border-t border-[hsl(var(--border))] px-4 py-3">
              {actionError ? (
                <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
                  {actionError}
                </p>
              ) : (
                <p role="status" className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                  Backup saved to <span className="font-mono">{backupPath}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AboutSettings() {
  const status = useUpdateStore((s) => s.status);
  const install = useUpdateStore((s) => s.install);
  const check = useUpdateStore((s) => s.check);
  const isLinux = window.lychee.platform === 'linux';

  const openReleases = (): void => {
    void window.lychee.invoke('shell.openExternal', { url: status.releaseUrl });
  };

  // All state/platform branching lives in describeUpdate (unit-tested); here we
  // only map the resolved action to a handler/icon/variant.
  const view = describeUpdate(status, isLinux);
  const handlers: Record<NonNullable<UpdateAction>, () => void> = {
    install,
    download: openReleases,
    check,
    'open-releases': openReleases,
  };
  const isPrimary = view.action === 'install' || view.action === 'download';
  const ActionIcon = view.action === 'download' ? Download : RotateCw;
  const showIcon = view.action === 'install' || view.action === 'download' || view.action === 'check';

  return (
    <div className="space-y-6">
      <SectionHeader title="About" description="Version and software updates." />

      <div className="flex items-center gap-3">
        <LycheeLogo className="h-10 w-10" />
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Lychee</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Version {status.currentVersion || '—'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
          {view.busy && <Loader2 className="h-4 w-4 animate-spin" />}
          <span className={isPrimary ? 'text-[hsl(var(--foreground))]' : undefined}>
            {view.message}
          </span>
        </div>
        {view.action && (
          <Button
            size="sm"
            variant={isPrimary ? 'default' : 'outline'}
            onClick={handlers[view.action]}
          >
            {showIcon && <ActionIcon />} {view.actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function languageName(language: string): string {
  try {
    const displayNames = new Intl.DisplayNames([navigator.language], { type: 'language' });
    return displayNames.of(language) ?? language;
  } catch {
    return language;
  }
}

function EditorSettings() {
  const [spellCheck, setSpellCheck] = useState<SpellCheckState | null>(null);

  useEffect(() => {
    let alive = true;
    void window.lychee.invoke('spellcheck.getState', {}).then((state) => {
      if (!alive) return;
      setSpellCheck(state);
    });

    const offState = window.lychee.on('spellcheck:state', (state) => {
      if (alive) setSpellCheck(state);
    });
    return () => {
      alive = false;
      offState();
    };
  }, []);

  const setSpellCheckEnabled = (enabled: boolean): void => {
    const previous = spellCheck;
    if (!previous) return;
    setSpellCheck({ ...previous, enabled });
    void window.lychee
      .invoke('spellcheck.setEnabled', { enabled })
      .then(setSpellCheck)
      .catch(() => setSpellCheck(previous));
  };

  const toggleLanguage = (language: string): void => {
    if (!spellCheck?.canChooseLanguages) return;
    const selected = spellCheck.languages.includes(language);
    if (selected && spellCheck.languages.length === 1) return;

    const languages = selected
      ? spellCheck.languages.filter((item) => item !== language)
      : [...spellCheck.languages, language];
    const previous = spellCheck;
    setSpellCheck({ ...spellCheck, languages });
    void window.lychee
      .invoke('spellcheck.setLanguages', { languages })
      .then(setSpellCheck)
      .catch(() => setSpellCheck(previous));
  };

  const selectedLanguageLabel = spellCheck?.languages.length
    ? spellCheck.languages.map(languageName).join(', ')
    : 'System language';

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Editor"
        description="Tune writing behavior, shortcuts, and editor defaults."
      />

      <div className="space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Spelling</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Control how Lychee checks your writing.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/15">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Label htmlFor="spellcheck-enabled">Check spelling while typing</Label>
              <p
                id="spellcheck-enabled-description"
                className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]"
              >
                Underline misspelled words and offer corrections on right-click.
              </p>
            </div>
            <Switch
              id="spellcheck-enabled"
              aria-label="Check spelling while typing"
              aria-describedby="spellcheck-enabled-description"
              checked={spellCheck?.enabled ?? false}
              disabled={!spellCheck}
              onCheckedChange={setSpellCheckEnabled}
            />
          </div>

          {spellCheck?.canChooseLanguages && (
            <div className="border-t border-[hsl(var(--border))] px-3.5 py-3">
              <div className="flex min-h-10 items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Spelling languages</p>
                  <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                    Select every language you write in.
                  </p>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!spellCheck}
                      className="max-w-56"
                    >
                      <Languages className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{selectedLanguageLabel}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-1">
                    <div className="max-h-64 overflow-y-auto">
                      {spellCheck.availableLanguages.map((language) => {
                        const selected = spellCheck.languages.includes(language);
                        const lastSelected = selected && spellCheck.languages.length === 1;
                        return (
                          <button
                            key={language}
                            type="button"
                            role="checkbox"
                            aria-checked={selected}
                            disabled={lastSelected}
                            onClick={() => toggleLanguage(language)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-[hsl(var(--accent))] focus-visible:bg-[hsl(var(--accent))] disabled:opacity-60"
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                              {selected && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {languageName(language)}
                            </span>
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">
                              {language}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </div>

        {spellCheck && !spellCheck.canChooseLanguages && (
          <p className="flex items-center gap-1.5 px-1 text-xs text-[hsl(var(--muted-foreground))]">
            <Languages className="h-3.5 w-3.5 shrink-0" />
            {window.lychee.platform === 'darwin'
              ? 'Spelling languages are managed by macOS.'
              : 'No configurable spelling languages are available on this system.'}
          </p>
        )}
      </div>
    </div>
  );
}

const shortcutCategories: ShortcutCategory[] = ['Editor', 'Navigation', 'Tabs', 'Formatting'];

function ShortcutKeycaps({ binding }: { binding: string }) {
  const isMac = window.lychee.platform === 'darwin';
  const parts = (normalizeKeybinding(binding) ?? binding).split('+');
  const labels: Record<string, string> = isMac
    ? {
        Mod: '⌘',
        Ctrl: '⌃',
        Meta: '⌘',
        Alt: '⌥',
        Shift: '⇧',
        Enter: '↩',
        Backspace: '⌫',
        Delete: '⌦',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
      }
    : {
        Mod: 'Ctrl',
        Meta: window.lychee.platform === 'win32' ? 'Win' : 'Super',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
      };

  return (
    <span className="flex items-center justify-center gap-1" aria-hidden="true">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="contents">
          {index > 0 && !isMac && (
            <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]/55">+</span>
          )}
          <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 font-sans text-[11px] font-semibold leading-none text-[hsl(var(--foreground))] shadow-[0_1px_0_hsl(var(--border)),inset_0_1px_0_hsl(var(--background))]">
            {labels[part] ?? part}
          </kbd>
        </span>
      ))}
    </span>
  );
}

function KeyboardSettings() {
  const bindings = useKeybindingsStore((state) => state.bindings);
  const loaded = useKeybindingsStore((state) => state.loaded);
  const setBinding = useKeybindingsStore((state) => state.setBinding);
  const resetBinding = useKeybindingsStore((state) => state.resetBinding);
  const resetAll = useKeybindingsStore((state) => state.resetAll);
  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const visible = shortcutRegistry.filter((shortcut) =>
    !normalizedQuery || `${shortcut.label} ${shortcut.description} ${shortcut.category}`.toLowerCase().includes(normalizedQuery),
  );

  const saveCaptured = async (id: ShortcutId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(null);
      setError(null);
      return;
    }
    const binding = keybindingFromEvent(event.nativeEvent, window.lychee.platform);
    if (!binding) {
      setError('Press a shortcut with Command/Ctrl, Alt, or Shift and another key.');
      return;
    }
    const conflict = shortcutRegistry.find(
      (item) =>
        item.id !== id &&
        keybindingsConflict(bindings[item.id], binding, window.lychee.platform),
    );
    if (conflict) {
      setError(`${displayKeybinding(binding, window.lychee.platform)} is already assigned to ${conflict.label}.`);
      return;
    }
    try {
      await setBinding(id, binding);
      setRecording(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save shortcut.');
    }
  };

  return (
    <div className="space-y-5" data-testid="keyboard-settings">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          title="Keyboard Shortcuts"
          description="Search Lychee actions, then click a shortcut to record a new binding."
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!loaded}
          onClick={() => void resetAll().then(() => setError(null)).catch(() => setError('Unable to reset shortcuts.'))}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset all
        </Button>
      </div>

      <div className="group relative rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/15 shadow-sm transition-[border-color,box-shadow,background-color] focus-within:border-brand/55 focus-within:bg-[hsl(var(--background))] focus-within:ring-3 focus-within:ring-brand/10">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))] transition-colors group-focus-within:text-brand" />
        <Input
          type="search"
          aria-label="Search keyboard shortcuts"
          placeholder="Search shortcuts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 rounded-lg border-0 bg-transparent pl-9 pr-10 shadow-none ring-0 [appearance:textfield] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear shortcut search"
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-[hsl(var(--destructive))]">{error}</p>}

      <div className="space-y-5">
        {shortcutCategories.map((category) => {
          const shortcuts = visible.filter((shortcut) => shortcut.category === category);
          if (shortcuts.length === 0) return null;
          return (
            <section key={category} aria-labelledby={`shortcut-category-${category}`}>
              <h4 id={`shortcut-category-${category}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {category}
              </h4>
              <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))]">
                {shortcuts.map((shortcut, index) => {
                  const customized = bindings[shortcut.id] !== shortcut.defaultBinding;
                  const isRecording = recording === shortcut.id;
                  return (
                    <div key={shortcut.id} className={cn('flex items-center gap-3 px-3 py-2.5', index > 0 && 'border-t border-[hsl(var(--border))]')}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{shortcut.label}</p>
                        <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{shortcut.description}</p>
                      </div>
                      {customized && (
                        <button
                          type="button"
                          aria-label={`Reset ${shortcut.label} shortcut`}
                          title="Reset to default"
                          onClick={() => void resetBinding(shortcut.id).then(() => setError(null)).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to reset shortcut.'))}
                          className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Change shortcut for ${shortcut.label}`}
                        aria-pressed={isRecording}
                        data-shortcut-recording={isRecording ? 'true' : undefined}
                        onClick={() => { setRecording(shortcut.id); setError(null); }}
                        onBlur={() => setRecording((current) => current === shortcut.id ? null : current)}
                        onKeyDown={(event) => { if (isRecording) void saveCaptured(shortcut.id, event); }}
                        className={cn(
                          'flex min-h-9 min-w-[7.5rem] items-center justify-center rounded-lg border px-2 text-center outline-none transition-[border-color,background-color,box-shadow,transform] focus-visible:ring-3 focus-visible:ring-brand/15 active:scale-[0.98]',
                          isRecording
                            ? 'border-brand/55 bg-brand/10 text-brand shadow-[inset_0_0_0_1px_hsl(var(--brand)/0.08)]'
                            : 'border-transparent bg-[hsl(var(--muted))]/35 hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/55',
                        )}
                      >
                        {isRecording ? (
                          <span className="text-xs font-medium">Press shortcut…</span>
                        ) : (
                          <ShortcutKeycaps binding={bindings[shortcut.id]} />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">No shortcuts match “{query}”.</p>
        )}
      </div>
    </div>
  );
}

function SectionContent({ section }: { section: SectionKey }) {
  if (section === 'general') return <GeneralSettings />;
  if (section === 'appearance') return <AppearanceSettings />;
  if (section === 'about') return <AboutSettings />;
  if (section === 'editor') return <EditorSettings />;
  if (section === 'keyboard') return <KeyboardSettings />;
  return null;
}

export function SettingsDialog() {
  const isOpen = useSettingsStore((s) => s.isSettingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const [activeSection, setActiveSection] = useState<SectionKey>('general');
  const firstNavRef = useRef<HTMLButtonElement>(null);

  // Land on About when opened while an update is pending — the red dot drew
  // them here, so show them the update straight away. Keyed on the open
  // transition only (read imperatively) so a status push arriving mid-session
  // doesn't yank the user off whatever section they're reading.
  useEffect(() => {
    if (isOpen && useUpdateStore.getState().hasUpdate) setActiveSection('about');
  }, [isOpen]);

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
        // Description varies per section (each SectionHeader carries its own
        // title + body), so there's no single root-level description to point
        // at. Explicit undefined silences the Radix warning intentionally.
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstNavRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (document.activeElement?.getAttribute('data-shortcut-recording') === 'true') {
            event.preventDefault();
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/40 px-5 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <DialogTitle className="text-sm font-semibold tracking-tight">Settings</DialogTitle>
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
            {sections.map(({ key, label, icon: Icon }, index) => {
              const isActive = key === activeSection;
              return (
                <button
                  key={key}
                  ref={index === 0 ? firstNavRef : undefined}
                  type="button"
                  onClick={() => setActiveSection(key)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))] font-medium'
                      : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                  {key === 'about' && <UpdateDot className="ml-auto" />}
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
