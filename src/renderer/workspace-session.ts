/**
 * Persisted workspace session: which notes were open in tabs when the app last
 * quit, so `restoreLastSession` can reopen them. Stores only document ids —
 * tab ids are per-session instances and are regenerated on restore.
 *
 * Kept free of store imports so the startup config loader can parse it without
 * pulling the document store into its module graph.
 */

export const WORKSPACE_SESSION_SETTING_KEY = 'workspace.session';

export type WorkspaceSession = {
  /** Open documents in tab order. */
  tabs: string[];
  /** Index into `tabs` of the active tab. */
  selectedIndex: number;
};

export const DEFAULT_WORKSPACE_SESSION: WorkspaceSession = {
  tabs: [],
  selectedIndex: 0,
};

export function parseStoredWorkspaceSession(raw: string | null): WorkspaceSession {
  const fallback: WorkspaceSession = { tabs: [], selectedIndex: 0 };
  if (!raw) return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;

    const value = parsed as { tabs?: unknown; selectedIndex?: unknown };
    if (!Array.isArray(value.tabs)) return fallback;

    const tabs = value.tabs.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (tabs.length === 0) return fallback;

    const selectedIndex =
      typeof value.selectedIndex === 'number' &&
      Number.isInteger(value.selectedIndex) &&
      value.selectedIndex >= 0 &&
      value.selectedIndex < tabs.length
        ? value.selectedIndex
        : 0;

    return { tabs, selectedIndex };
  } catch {
    return fallback;
  }
}

export function serializeWorkspaceSession(session: WorkspaceSession): string {
  const tabs = session.tabs.filter((id) => typeof id === 'string' && id.length > 0);
  const selectedIndex =
    tabs.length === 0
      ? 0
      : Math.min(Math.max(Math.trunc(session.selectedIndex), 0), tabs.length - 1);
  return JSON.stringify({ version: 1, tabs, selectedIndex });
}
