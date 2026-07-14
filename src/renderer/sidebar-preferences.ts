export const SIDEBAR_PREFERENCES_SETTING_KEY = 'ui.sidebar.layout';

export const DEFAULT_SIDEBAR_WIDTH = 288;
export const MIN_SIDEBAR_WIDTH = 224;
export const MAX_SIDEBAR_WIDTH = 480;

export type SidebarPreferences = {
  open: boolean;
  width: number;
};

export function clampSidebarWidth(width: number): number {
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)),
  );
}

/** Parse persisted UI state without allowing malformed values into layout CSS. */
export function parseStoredSidebarPreferences(
  raw: string | null,
  defaultOpen = true,
): SidebarPreferences {
  const fallback = { open: defaultOpen, width: DEFAULT_SIDEBAR_WIDTH };
  if (!raw) return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;

    const value = parsed as Record<string, unknown>;
    return {
      open: typeof value.open === 'boolean' ? value.open : fallback.open,
      width:
        typeof value.width === 'number' && Number.isFinite(value.width)
          ? clampSidebarWidth(value.width)
          : fallback.width,
    };
  } catch {
    return fallback;
  }
}

export function serializeSidebarPreferences(preferences: SidebarPreferences): string {
  return JSON.stringify({
    version: 1,
    open: preferences.open,
    width: clampSidebarWidth(preferences.width),
  });
}
