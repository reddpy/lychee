import * as React from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { createPortal } from "react-dom";

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

function normalizeQueryInput(value: string) {
  return value.normalize("NFC");
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
    if (current.nodeType === Node.TEXT_NODE) {
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
  documentId,
  isActive,
}: {
  documentId: string;
  isActive: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const query = useSearchHighlightStore(
    (s) => s.states[documentId]?.query ?? "",
  );
  const transientJump = useSearchHighlightStore(
    (s) => s.states[documentId]?.transient ?? null,
  );
  const activeIndex = useSearchHighlightStore(
    (s) => s.states[documentId]?.activeIndex ?? 0,
  );
  const isOpenForDoc = useSearchHighlightStore(
    (s) => isActive && (s.states[documentId]?.isOpen ?? false),
  );
  const openHighlight = useSearchHighlightStore((s) => s.openHighlight);
  const setQuery = useSearchHighlightStore((s) => s.setQuery);
  const setActiveIndex = useSearchHighlightStore((s) => s.setActiveIndex);
  const clearHighlight = useSearchHighlightStore((s) => s.clearHighlight);
  const clearTransientJump = useSearchHighlightStore((s) => s.clearTransientJump);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const allRangesRef = React.useRef<TextRange[]>([]);
  const textSearchCacheRef = React.useRef<WeakMap<Node, TextNodeSearchCache>>(
    new WeakMap(),
  );
  const [activeMatchIndex, setActiveMatchIndex] = React.useState(0);
  const activeMatchIndexRef = React.useRef(0);
  const [matchCount, setMatchCount] = React.useState(0);
  const wasVisibleRef = React.useRef(false);
  const [pillTop, setPillTop] = React.useState(0);
  const [pillRight, setPillRight] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const didAutoFocusRef = React.useRef(false);
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
    clearAllHighlights();
    clearHighlight(documentId);
  }, [clearAllHighlights, clearHighlight, documentId]);

  const toggleFind = React.useCallback(() => {
    if (isOpenForDoc) {
      closeFind();
      return;
    }
    if (isTransientActive && transientJump) {
      // Cmd/Ctrl+F should interrupt transient mode and open a fresh in-note find UX.
      clearTransientJump(documentId);
      setQuery(documentId, "");
      setActiveIndex(documentId, 0);
      openHighlight(documentId, "", 0);
      return;
    }
    openHighlight(documentId);
  }, [
    clearTransientJump,
    closeFind,
    documentId,
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
      const modeIsVisible = isOpenForDoc || isTransientActive;
      const activeQuery = effectiveQuery;
      if (!modeIsVisible || !activeQuery.trim()) {
        allRangesRef.current = [];
        setMatchCount(0);
        setActiveMatchIndex(0);
        clearAllHighlights();
        return;
      }

      const root = editor.getRootElement();
      if (!root) return;

      const ranges = createTextRanges(root, activeQuery, textSearchCacheRef.current);
      allRangesRef.current = ranges;
      setMatchCount(ranges.length);

      if (!supportsCustomHighlightApi()) {
        setActiveMatchIndex(0);
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
      } else {
        highlights.set(
          allName,
          new (window as unknown as {
            Highlight: new (...args: Range[]) => unknown;
          }).Highlight(...ranges.map((item) => item.range)),
        );
      }

      if (ranges.length === 0) {
        setActiveMatchIndex(0);
        applyActiveHighlight(0, false, false, activeName);
        return;
      }

      const nextIndex = resetToFirst
        ? 0
        : clampIndex(
            isTransientActive ? effectiveActiveIndex : activeMatchIndexRef.current,
            ranges.length,
          );
      setActiveMatchIndex(nextIndex);
      if (!isTransientActive) setActiveIndex(documentId, nextIndex);
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
      documentId,
      setActiveIndex,
    ],
  );

  React.useEffect(() => {
    return () => {
      clearAllHighlights();
    };
  }, [clearAllHighlights]);

  React.useEffect(() => {
    activeMatchIndexRef.current = activeMatchIndex;
  }, [activeMatchIndex]);

  React.useEffect(() => {
    if (!isOpenForDoc) {
      didAutoFocusRef.current = false;
      return;
    }
    if (!didAutoFocusRef.current) {
      inputRef.current?.focus();
      inputRef.current?.select();
      didAutoFocusRef.current = true;
    }
  }, [isOpenForDoc]);

  React.useEffect(() => {
    if (!isOpenForDoc) return;
    const requestedIndex = Math.max(0, effectiveActiveIndex);
    setActiveMatchIndex(requestedIndex);
    activeMatchIndexRef.current = requestedIndex;
    // Typing should keep focus in the find input; do not move selection.
    refreshHighlights(false, false);
  }, [effectiveActiveIndex, isOpenForDoc, effectiveQuery, refreshHighlights]);

  React.useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    if (wasVisible && !isHighlightVisible) {
      clearAllHighlights();
    }
    if (!wasVisible && isHighlightVisible) {
      requestAnimationFrame(() => refreshHighlights(false, true));
    }
    wasVisibleRef.current = isHighlightVisible;
  }, [clearAllHighlights, isHighlightVisible, refreshHighlights]);

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

  React.useEffect(() => {
    if (!isActive) return;
    const root = editor.getRootElement();
    const scrollContainer = getScrollContainer(root);
    if (!scrollContainer) return;

    const updatePosition = () => {
      const rect = scrollContainer.getBoundingClientRect();
      setPillRight(window.innerWidth - rect.right + 14);
      setPillTop(rect.top + 12);
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(scrollContainer);
    window.addEventListener("resize", updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, [editor, isActive]);

  const navigateMatch = React.useCallback((direction: -1 | 1) => {
    if (allRangesRef.current.length === 0) {
      refreshHighlights(false, false);
    }
    const count = allRangesRef.current.length;
    if (count <= 0) return;
    const next = clampIndex(activeMatchIndex + direction, count);
    activeMatchIndexRef.current = next;
    setActiveMatchIndex(next);
    setActiveIndex(documentId, next);
    applyActiveHighlight(next, true, true, highlightNames.active);
    inputRef.current?.focus();
  }, [
    activeMatchIndex,
    applyActiveHighlight,
    documentId,
    highlightNames.active,
    refreshHighlights,
    setActiveIndex,
  ]);

  const handlePrev = React.useCallback(() => navigateMatch(-1), [navigateMatch]);
  const handleNext = React.useCallback(() => navigateMatch(1), [navigateMatch]);

  if (!isActive) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-40"
      style={{ top: pillTop, right: pillRight }}
    >
      <button
        type="button"
        data-testid="note-find-trigger"
        onClick={toggleFind}
        aria-label="Find in note"
        aria-expanded={isOpenForDoc}
        className={
          "flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-200 " +
          (isOpenForDoc
            ? "border-[#C14B55]/30 bg-[#C14B55]/15 text-[#C14B55]"
            : "border-transparent bg-transparent text-[hsl(var(--muted-foreground))]/65 hover:bg-[#C14B55]/15 hover:text-[#C14B55] hover:border-[#C14B55]/30")
        }
      >
        <Search className="h-4 w-4" />
      </button>

      {isOpenForDoc ? (
        <div
          data-testid="note-find-panel"
          className="absolute right-0 top-10 flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-popover px-1 py-1 shadow-md"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <input
            ref={inputRef}
            data-testid="note-find-input"
            value={query}
            onChange={(event) => {
              setQuery(documentId, normalizeQueryInput(event.target.value));
              setActiveIndex(documentId, 0);
            }}
            onKeyDown={(event) => {
              if (isFindShortcut(event)) {
                event.preventDefault();
                event.stopPropagation();
                closeFind();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closeFind();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) {
                  handlePrev();
                } else {
                  handleNext();
                }
              }
            }}
            className="h-7 w-48 bg-transparent px-2 text-xs text-[hsl(var(--foreground))] outline-none"
            placeholder="Find in note..."
            aria-label="Find in note"
          />
          <span
            data-testid="note-find-counter"
            className="w-12 text-center text-xs text-[hsl(var(--muted-foreground))]"
          >
            {matchCount > 0 ? `${activeMatchIndex + 1}/${matchCount}` : "0/0"}
          </span>
          <button
            type="button"
            data-testid="note-find-prev"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handlePrev}
            disabled={matchCount === 0}
            className={
              "inline-flex h-6 w-6 items-center justify-center rounded " +
              (matchCount > 0
                ? "hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
                : "opacity-40")
            }
            aria-label="Previous match"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="note-find-next"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleNext}
            disabled={matchCount === 0}
            className={
              "inline-flex h-6 w-6 items-center justify-center rounded " +
              (matchCount > 0
                ? "hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
                : "opacity-40")
            }
            aria-label="Next match"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="note-find-close"
            onMouseDown={(event) => event.preventDefault()}
            onClick={closeFind}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
            aria-label="Close find"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
