import * as React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import {
  setActiveMatchProbe,
  useSearchHighlightStore,
} from "@/renderer/search-highlight-store";
import { useKeybindingsStore } from "@/renderer/keybindings-store";
import { matchesKeybinding } from "@/shared/keybindings";

type TextRange = {
  range: Range;
  anchorNode: Node;
};

type TextNodeSearchCache = {
  raw: string;
  normalized: string;
};

function clampIndex(index: number, count: number) {
  if (count <= 0) return 0;
  if (index < 0) return count - 1;
  if (index >= count) return 0;
  return index;
}

function supportsCustomHighlightApi() {
  return (
    typeof window !== "undefined" &&
    typeof (window as { Highlight?: unknown }).Highlight !== "undefined" &&
    typeof CSS !== "undefined" &&
    "highlights" in CSS
  );
}

function normalizeSearchTerm(value: string) {
  return value.normalize("NFC").toLowerCase();
}

function getCachedNormalizedText(
  node: Node,
  rawText: string,
  cache: WeakMap<Node, TextNodeSearchCache>,
) {
  const cached = cache.get(node);
  if (cached && cached.raw === rawText) return cached.normalized;
  const normalized = normalizeSearchTerm(rawText);
  cache.set(node, { raw: rawText, normalized });
  return normalized;
}

function createTextRanges(
  root: HTMLElement,
  query: string,
  cache: WeakMap<Node, TextNodeSearchCache>,
): TextRange[] {
  const needle = normalizeSearchTerm(query.trim());
  if (!needle) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const ranges: TextRange[] = [];

  let current: Node | null = walker.nextNode();
  while (current) {
    const text = current.textContent ?? "";
    const textLower = getCachedNormalizedText(current, text, cache);
    let offset = 0;
    const lastStart = textLower.length - needle.length;

    while (offset <= lastStart) {
      const foundAt = textLower.indexOf(needle, offset);
      if (foundAt < 0) break;
      const range = document.createRange();
      range.setStart(current, foundAt);
      range.setEnd(current, foundAt + needle.length);
      ranges.push({ range, anchorNode: current });
      offset = foundAt + needle.length;
    }
    current = walker.nextNode();
  }

  return ranges;
}

function getScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let current = element;
  while (current) {
    if (current.tagName === "MAIN") return current;
    current = current.parentElement;
  }
  return null;
}

const MATCH_VIEW_INSET = 24;

/**
 * Bounding rect for a match range. A range's rect can be collapsed (zero size)
 * when the browser has not laid it out yet, so fall back to its first client
 * rect. Using the range (not the parent element) keeps visibility accurate for
 * matches inside tall nodes like code blocks.
 */
function getRangeRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  const rects = range.getClientRects();
  return rects.length > 0 ? rects[0] : null;
}

function isRangeVisible(
  range: Range,
  container: HTMLElement | null,
  inset = 0,
): boolean {
  const rect = getRangeRect(range);
  if (!rect) return false;
  if (!container) return true;
  const containerRect = container.getBoundingClientRect();
  return (
    rect.bottom > containerRect.top + inset &&
    rect.top < containerRect.bottom - inset
  );
}

function scrollRangeIntoView(
  range: Range,
  container: HTMLElement | null,
  preferCenter: boolean,
) {
  const rect = getRangeRect(range);
  if (!rect) return;

  if (!container) {
    range.startContainer.parentElement?.scrollIntoView({
      behavior: "auto",
      block: preferCenter ? "center" : "nearest",
      inline: "nearest",
    });
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const visibleTop = containerRect.top + MATCH_VIEW_INSET;
  const visibleBottom = containerRect.bottom - MATCH_VIEW_INSET;
  if (rect.bottom > visibleTop && rect.top < visibleBottom) return;

  if (preferCenter) {
    const targetCenter = rect.top + rect.height / 2;
    const containerCenter = containerRect.top + containerRect.height / 2;
    container.scrollTop += targetCenter - containerCenter;
    return;
  }

  // Step navigation should keep a small visual cushion, not snap to an edge.
  const containerHeight = Math.max(1, containerRect.height);
  const padding = Math.min(40, Math.max(18, containerHeight * 0.12));
  const cushionTop = containerRect.top + padding;
  const cushionBottom = containerRect.bottom - padding;

  if (rect.top < cushionTop) {
    container.scrollTop += rect.top - cushionTop;
    return;
  }
  if (rect.bottom > cushionBottom) {
    container.scrollTop += rect.bottom - cushionBottom;
  }
}

export function SearchHighlightPlugin({
  tabId,
  documentId,
  isActive,
}: {
  tabId: string;
  documentId: string;
  isActive: boolean;
}): null {
  const [editor] = useLexicalComposerContext();
  const findBinding = useKeybindingsStore((s) => s.bindings['navigation.findInNote']);
  const query = useSearchHighlightStore(
    (s) => s.states[tabId]?.query ?? "",
  );
  const transientJump = useSearchHighlightStore(
    (s) => s.transients[documentId] ?? null,
  );
  const activeIndex = useSearchHighlightStore(
    (s) => s.states[tabId]?.activeIndex ?? 0,
  );
  const isOpenForDoc = useSearchHighlightStore(
    (s) => isActive && (s.states[tabId]?.isOpen ?? false),
  );
  const openHighlight = useSearchHighlightStore((s) => s.openHighlight);
  const setQuery = useSearchHighlightStore((s) => s.setQuery);
  const setActiveIndex = useSearchHighlightStore((s) => s.setActiveIndex);
  const clearHighlight = useSearchHighlightStore((s) => s.clearHighlight);
  const clearTransientJump = useSearchHighlightStore((s) => s.clearTransientJump);
  const storeSetMatchCount = useSearchHighlightStore((s) => s.setMatchCount);
  const scrollRequest = useSearchHighlightStore(
    (s) => s.states[tabId]?.scrollRequest ?? 0,
  );
  const allRangesRef = React.useRef<TextRange[]>([]);
  const textSearchCacheRef = React.useRef<WeakMap<Node, TextNodeSearchCache>>(
    new WeakMap(),
  );
  const activeMatchIndexRef = React.useRef(0);
  // Ref so that stale closures (update listener, mutation observer, etc.)
  // always read the *current* tabId rather than a captured-at-creation value.
  // Updated during render (not in an effect) so layout effects below — which
  // run before passive effects — never observe the previous tab's id.
  const tabIdRef = React.useRef(tabId);
  tabIdRef.current = tabId;
  const wasVisibleRef = React.useRef(false);
  const highlightNames = React.useMemo(
    () => ({
      all: "lychee-find-all",
      active: "lychee-find-active",
      transientAll: "lychee-find-transient-all",
      transientActive: "lychee-find-transient-active",
    }),
    [],
  );

  const isTransientActive =
    isActive &&
    !isOpenForDoc &&
    !!transientJump &&
    transientJump.query.trim().length > 0 &&
    transientJump.expiresAt > Date.now();
  const effectiveQuery = isTransientActive
    ? transientJump?.query ?? ""
    : query;
  const effectiveActiveIndex = isTransientActive
    ? transientJump?.activeIndex ?? 0
    : activeIndex;
  const isHighlightVisible = isOpenForDoc || isTransientActive;
  // Deferred work must consult the latest visibility and refresh callback. A
  // scheduled frame may otherwise run after this panel has closed with values
  // captured from an earlier render.
  const isHighlightVisibleRef = React.useRef(isHighlightVisible);
  isHighlightVisibleRef.current = isHighlightVisible;

  const clearAllHighlights = React.useCallback(() => {
    if (!supportsCustomHighlightApi()) return;
    const highlights = (CSS as unknown as { highlights: Map<string, unknown> })
      .highlights;
    highlights.delete(highlightNames.all);
    highlights.delete(highlightNames.active);
    highlights.delete(highlightNames.transientAll);
    highlights.delete(highlightNames.transientActive);
  }, [
    highlightNames.active,
    highlightNames.all,
    highlightNames.transientActive,
    highlightNames.transientAll,
  ]);

  const closeFind = React.useCallback(() => {
    clearHighlight(tabId);
  }, [clearHighlight, tabId]);

  const toggleFind = React.useCallback(() => {
    if (isOpenForDoc) {
      closeFind();
      return;
    }
    if (isTransientActive && transientJump) {
      // Cmd/Ctrl+F should interrupt transient mode and open a fresh in-note find UX.
      clearTransientJump(documentId);
      setQuery(tabId, "");
      setActiveIndex(tabId, 0);
      openHighlight(tabId, "", 0);
      return;
    }
    openHighlight(tabId);
  }, [
    clearTransientJump,
    closeFind,
    documentId,
    tabId,
    isOpenForDoc,
    isTransientActive,
    openHighlight,
    setActiveIndex,
    setQuery,
    transientJump,
  ]);

  const applyActiveHighlight = React.useCallback(
    (
      index: number,
      shouldScroll: boolean,
      moveSelection: boolean,
      activeName: string,
    ) => {
      if (!supportsCustomHighlightApi()) return;
      const ranges = allRangesRef.current;
      if (ranges.length === 0) {
        const highlights = (CSS as unknown as { highlights: Map<string, unknown> })
          .highlights;
        highlights.delete(activeName);
        return;
      }

      const normalized = clampIndex(index, ranges.length);
      const activeRange = ranges[normalized];
      const highlights = (CSS as unknown as {
        highlights: { set: (key: string, value: unknown) => void };
      }).highlights;
      highlights.set(
        activeName,
        new (window as unknown as { Highlight: new (...args: Range[]) => unknown })
          .Highlight(activeRange.range),
      );

      if (shouldScroll) {
        // Only move DOM selection for explicit navigation actions.
        if (moveSelection) {
          const domSelection = window.getSelection();
          if (domSelection) {
            domSelection.removeAllRanges();
            domSelection.addRange(activeRange.range.cloneRange());
          }
        }
        const element =
          activeRange.anchorNode.nodeType === Node.TEXT_NODE
            ? activeRange.anchorNode.parentElement
            : (activeRange.anchorNode as HTMLElement);
        if (element) {
          const scrollContainer = getScrollContainer(element);
          // Initial reveal can center; step navigation should be minimally invasive.
          // Scroll by the matched range so matches inside tall nodes (e.g. code
          // blocks) land precisely instead of scrolling the whole block.
          scrollRangeIntoView(activeRange.range, scrollContainer, !moveSelection);
        }
      }
    },
    [],
  );

  const refreshHighlights = React.useCallback(
    (resetToFirst: boolean, shouldScroll: boolean) => {
      const currentTabId = tabIdRef.current;
      const modeIsVisible = isOpenForDoc || isTransientActive;
      const activeQuery = effectiveQuery;
      if (!modeIsVisible || !activeQuery.trim()) {
        allRangesRef.current = [];
        storeSetMatchCount(currentTabId, 0);
        activeMatchIndexRef.current = 0;
        clearAllHighlights();
        return;
      }

      const root = editor.getRootElement();
      if (!root) return;

      const ranges = createTextRanges(root, activeQuery, textSearchCacheRef.current);
      allRangesRef.current = ranges;
      storeSetMatchCount(currentTabId, ranges.length);

      if (!supportsCustomHighlightApi()) {
        activeMatchIndexRef.current = 0;
        return;
      }

      const highlights = (CSS as unknown as {
        highlights: {
          set: (key: string, value: unknown) => void;
          delete: (key: string) => void;
        };
      }).highlights;
      const allName = isTransientActive
        ? highlightNames.transientAll
        : highlightNames.all;
      const activeName = isTransientActive
        ? highlightNames.transientActive
        : highlightNames.active;
      const oppositeAllName = isTransientActive
        ? highlightNames.all
        : highlightNames.transientAll;
      const oppositeActiveName = isTransientActive
        ? highlightNames.active
        : highlightNames.transientActive;
      // Ensure only one highlight mode is rendered at a time.
      highlights.delete(oppositeAllName);
      highlights.delete(oppositeActiveName);
      if (ranges.length === 0) {
        highlights.delete(allName);
        activeMatchIndexRef.current = 0;
        applyActiveHighlight(0, false, false, activeName);
        return;
      }

      highlights.set(
        allName,
        new (window as unknown as {
          Highlight: new (...args: Range[]) => unknown;
        }).Highlight(...ranges.map((item) => item.range)),
      );

      const nextIndex = resetToFirst
        ? 0
        : clampIndex(
            isTransientActive ? effectiveActiveIndex : activeMatchIndexRef.current,
            ranges.length,
          );
      activeMatchIndexRef.current = nextIndex;
      if (!isTransientActive) setActiveIndex(currentTabId, nextIndex);
      applyActiveHighlight(nextIndex, shouldScroll, false, activeName);
    },
    [
      applyActiveHighlight,
      clearAllHighlights,
      editor,
      effectiveActiveIndex,
      effectiveQuery,
      highlightNames.all,
      highlightNames.active,
      highlightNames.transientAll,
      highlightNames.transientActive,
      isOpenForDoc,
      isTransientActive,
      setActiveIndex,
      storeSetMatchCount,
    ],
  );

  const refreshHighlightsRef = React.useRef(refreshHighlights);
  refreshHighlightsRef.current = refreshHighlights;
  const scheduleRefreshHighlights = React.useCallback((shouldScroll: boolean) => {
    return requestAnimationFrame(() => {
      if (!isHighlightVisibleRef.current) return;
      refreshHighlightsRef.current(false, shouldScroll);
    });
  }, []);

  React.useEffect(() => {
    return () => {
      clearAllHighlights();
    };
  }, [clearAllHighlights]);

  // Expose the active match's on-screen state to the find bar so Enter/chevrons
  // can reveal the current match instead of skipping it when it is off-screen.
  // Only the active editor registers; hidden editors share the documentId key.
  React.useEffect(() => {
    if (!isActive) return;
    setActiveMatchProbe(tabId, () => {
      const ranges = allRangesRef.current;
      if (ranges.length === 0) return true;
      const index = clampIndex(activeMatchIndexRef.current, ranges.length);
      const active = ranges[index];
      if (!active) return true;
      const anchor = active.anchorNode;
      const element =
        anchor.nodeType === Node.TEXT_NODE
          ? anchor.parentElement
          : (anchor as HTMLElement);
      return isRangeVisible(active.range, getScrollContainer(element));
    });
    return () => setActiveMatchProbe(tabId, null);
  }, [isActive, tabId]);

  const prevQueryRef = React.useRef(effectiveQuery);
  const prevIndexRef = React.useRef(effectiveActiveIndex);
  const prevTabIdRef = React.useRef(tabId);

  // Layout effect so navigation scrolling settles in the same commit as the
  // index change. Otherwise a rapid next/prev (or Enter) can read a stale
  // viewport, think the active match is off-screen, and reveal instead of step.
  React.useLayoutEffect(() => {
    if (!isOpenForDoc) return;
    const tabSwitched = prevTabIdRef.current !== tabId;
    prevTabIdRef.current = tabId;

    // On tab switch the store reads shift to a different tab's saved state.
    // Treat this as a restore, not a fresh query change — preserve the saved index.
    if (tabSwitched) {
      prevQueryRef.current = effectiveQuery;
      prevIndexRef.current = effectiveActiveIndex;
      activeMatchIndexRef.current = Math.max(0, effectiveActiveIndex);
      refreshHighlights(false, false);
      return;
    }

    const queryChanged = prevQueryRef.current !== effectiveQuery;
    const indexChanged = prevIndexRef.current !== effectiveActiveIndex;
    prevQueryRef.current = effectiveQuery;
    prevIndexRef.current = effectiveActiveIndex;

    const requestedIndex = Math.max(0, effectiveActiveIndex);
    activeMatchIndexRef.current = requestedIndex;

    // Only scroll on explicit navigation (chevrons/Enter), not on typing
    refreshHighlights(queryChanged, indexChanged);
  }, [effectiveActiveIndex, isOpenForDoc, effectiveQuery, refreshHighlights, tabId]);

  // Scroll to current match when requested (e.g. single-match navigation)
  const prevScrollReqRef = React.useRef(scrollRequest);
  // A single-match Enter issues a scroll request without changing the active
  // index. This must run before the browser paints: a normal effect can be
  // deferred until after a following checkbox click, making that click appear
  // to unexpectedly move the note.
  React.useLayoutEffect(() => {
    if (prevScrollReqRef.current === scrollRequest) return;
    prevScrollReqRef.current = scrollRequest;
    if (!isOpenForDoc) return;
    const ranges = allRangesRef.current;
    if (ranges.length === 0) return;
    const idx = clampIndex(activeMatchIndexRef.current, ranges.length);
    const activeName = highlightNames.active;
    applyActiveHighlight(idx, true, false, activeName);
  }, [scrollRequest, isOpenForDoc, applyActiveHighlight, highlightNames.active]);

  React.useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    let frame: number | undefined;
    if (wasVisible && !isHighlightVisible) {
      clearAllHighlights();
    }
    if (!wasVisible && isHighlightVisible) {
      // Scroll to the match on initial reveal when activated via transient jump
      // (palette preview open), but not when regular find opens.
      frame = scheduleRefreshHighlights(isTransientActive);
    }
    wasVisibleRef.current = isHighlightVisible;
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [
    clearAllHighlights,
    isHighlightVisible,
    isTransientActive,
    scheduleRefreshHighlights,
  ]);

  React.useEffect(() => {
    if (!isOpenForDoc && !isTransientActive) return;
    return editor.registerUpdateListener(() => {
      refreshHighlights(false, false);
    });
  }, [editor, isOpenForDoc, isTransientActive, refreshHighlights]);

  React.useEffect(() => {
    if ((!isOpenForDoc && !isTransientActive) || !effectiveQuery.trim()) return;
    const root = editor.getRootElement();
    if (!root) return;

    const observer = new MutationObserver(() => {
      refreshHighlights(false, false);
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [editor, effectiveQuery, isOpenForDoc, isTransientActive, refreshHighlights]);

  React.useEffect(() => {
    if (!isOpenForDoc && !isTransientActive) return;
    const frames = new Set<number>();
    const unregister = editor.registerRootListener((nextRoot) => {
      if (!nextRoot) return;
      const frame = scheduleRefreshHighlights(false);
      frames.add(frame);
    });
    return () => {
      unregister();
      for (const frame of frames) cancelAnimationFrame(frame);
    };
  }, [editor, isOpenForDoc, isTransientActive, scheduleRefreshHighlights]);

  React.useEffect(() => {
    if (!isTransientActive || !transientJump) return;
    const remaining = Math.max(0, transientJump.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      clearTransientJump(documentId);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [clearTransientJump, documentId, isTransientActive, transientJump]);

  React.useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesKeybinding(event, findBinding, window.lychee.platform)) return;
      event.preventDefault();
      toggleFind();
    };

    return editor.registerRootListener((nextRoot, prevRoot) => {
      prevRoot?.removeEventListener("keydown", onKeyDown);
      nextRoot?.addEventListener("keydown", onKeyDown);
    });
  }, [
    editor,
    findBinding,
    isActive,
    toggleFind,
  ]);

  React.useEffect(() => {
    if (!isActive) return;
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.body.dataset.lycheeCommandPaletteOpen === "true") return;
      if (!matchesKeybinding(event, findBinding, window.lychee.platform)) return;
      event.preventDefault();
      toggleFind();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    isActive,
    findBinding,
    toggleFind,
  ]);

  return null;
}
