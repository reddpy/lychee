import * as React from 'react';

export type SidebarSectionId = 'bookmarks' | 'notes';

const STORAGE_KEY = 'lychee:sidebar-section-order';
const DEFAULT_ORDER: SidebarSectionId[] = ['bookmarks', 'notes'];

function isSectionId(value: unknown): value is SidebarSectionId {
  return value === 'bookmarks' || value === 'notes';
}

/**
 * Pure parser for a serialized order from storage. Falls back to the default
 * order when the value is missing, malformed, or doesn't contain exactly one
 * of each known section id.
 */
export function parseStoredOrder(raw: string | null): SidebarSectionId[] {
  if (!raw) return [...DEFAULT_ORDER];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_ORDER];
    const valid = parsed.filter(isSectionId);
    const unique = Array.from(new Set(valid));
    if (unique.length !== DEFAULT_ORDER.length) return [...DEFAULT_ORDER];
    return unique;
  } catch {
    return [...DEFAULT_ORDER];
  }
}

function loadOrder(): SidebarSectionId[] {
  return parseStoredOrder(localStorage.getItem(STORAGE_KEY));
}

export function useSidebarSectionOrder() {
  const [order, setOrder] = React.useState<SidebarSectionId[]>(loadOrder);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  }, [order]);

  return { order, setOrder };
}
