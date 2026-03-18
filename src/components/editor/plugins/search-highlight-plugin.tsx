import * as React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { useSearchHighlightStore } from "@/renderer/search-highlight-store";

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

function isFindShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  const isModifier = event.metaKey || event.ctrlKey;
  return isModifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f";
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

function shouldScrollMatchIntoView(
  element: HTMLElement,
  container: HTMLElement | null,
) {
  if (!container) return true;
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const topInset = 24;
  const bottomInset = 24;
  const visibleTop = containerRect.top + topInset;
  const visibleBottom = containerRect.bottom - bottomInset;
  return elementRect.top < visibleTop || elementRect.bottom > visibleBottom;
}

function scrollMatchIntoView(
  element: HTMLElement,
  container: HTMLElement | null,
  preferCenter: boolean,
) {
  if (!container) {
    element.scrollIntoView({
      behavior: "auto",
      block: preferCenter ? "center" : "nearest",
      inline: "nearest",
    });
    return;
  }
  if (!shouldScrollMatchIntoView(element, container)) return;

  if (preferCenter) {
    element.scrollIntoView({
      behavior: "auto",
      block: "center",
      inline: "nearest",
    });
    return;
  }

  // Step navigation should keep a small visual cushion, not snap to an edge.
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const containerHeight = Math.max(1, containerRect.height);
  const padding = Math.min(40, Math.max(18, containerHeight * 0.12));
  const visibleTop = containerRect.top + padding;
  const visibleBottom = containerRect.bottom - padding;

  if (elementRect.top < visibleTop) {
    container.scrollTop += elementRect.top - visibleTop;
    return;
  }
  if (elementRect.bottom > visibleBottom) {
    container.scrollTop += elementRect.bottom - visibleBottom;
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
  const tabIdRef = React.useRef(tabId);
  React.useEffect(() => { tabIdRef.current = tabId; }, [tabId]);
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
          scrollMatchIntoView(element, scrollContainer, !moveSelection);
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

  React.useEffect(() => {
    return () => {
      clearAllHighlights();
    };
  }, [clearAllHighlights]);

  const prevQueryRef = React.useRef(effectiveQuery);
  const prevIndexRef = React.useRef(effectiveActiveIndex);
  const prevTabIdRef = React.useRef(tabId);

  React.useEffect(() => {
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
  React.useEffect(() => {
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
    if (wasVisible && !isHighlightVisible) {
      clearAllHighlights();
    }
    if (!wasVisible && isHighlightVisible) {
      // Scroll to the match on initial reveal when activated via transient jump
      // (palette preview open), but not when regular find opens.
      requestAnimationFrame(() => refreshHighlights(false, isTransientActive));
    }
    wasVisibleRef.current = isHighlightVisible;
  }, [clearAllHighlights, isHighlightVisible, isTransientActive, refreshHighlights]);

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
    return editor.registerRootListener((nextRoot) => {
      if (!nextRoot) return;
      requestAnimationFrame(() => refreshHighlights(false, false));
    });
  }, [editor, isOpenForDoc, isTransientActive, refreshHighlights]);

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
      if (!isFindShortcut(event)) return;
      event.preventDefault();
      toggleFind();
    };

    return editor.registerRootListener((nextRoot, prevRoot) => {
      prevRoot?.removeEventListener("keydown", onKeyDown);
      nextRoot?.addEventListener("keydown", onKeyDown);
    });
  }, [
    editor,
    isActive,
    toggleFind,
  ]);

  React.useEffect(() => {
    if (!isActive) return;
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.body.dataset.lycheeCommandPaletteOpen === "true") return;
      if (!isFindShortcut(event)) return;
      event.preventDefault();
      toggleFind();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    isActive,
    toggleFind,
  ]);

  return null;
}
