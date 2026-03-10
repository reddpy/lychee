import * as React from 'react';
import { LexicalComposer, type InitialConfigType } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ContentEditable as LexicalContentEditable } from '@lexical/react/LexicalContentEditable';
import type { SerializedEditorState } from 'lexical';

import { sanitizeSerializedState } from './editor';
import { nodes } from './nodes';
import { editorTheme } from './themes/editor-theme';
import { buildHighlightedPreviewStateFromParsed } from '../../shared/search-preview-state';

const previewConfigBase: InitialConfigType = {
  namespace: 'EditorPreview',
  theme: editorTheme,
  nodes,
  editable: false,
  onError: (error: Error) => {
    console.error(error);
  },
};

function parseSerializedState(content: string): SerializedEditorState | undefined {
  if (!content || content.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(content) as SerializedEditorState;
    const sanitized = sanitizeSerializedState(parsed);
    if (!sanitized) return undefined;
    return sanitized;
  } catch {
    return undefined;
  }
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function buildHighlightedPreviewState(content: string, query: string): string | undefined {
  const parsed = parseSerializedState(content);
  return buildHighlightedPreviewStateFromParsed(parsed, query);
}

export type ReadOnlyNotePreviewHandle = {
  prevMatch: () => void;
  nextMatch: () => void;
  getMatchState: () => { activeIndex: number; count: number };
};

export const ReadOnlyNotePreview = React.forwardRef<
  ReadOnlyNotePreviewHandle,
  {
    editorState?: string;
    query?: string;
    onMatchStateChange?: (activeIndex: number, count: number) => void;
  }
>(function ReadOnlyNotePreview({ editorState, query, onMatchStateChange }, ref) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const matchElementsRef = React.useRef<HTMLElement[]>([]);
  const activeMatchIndexRef = React.useRef(0);
  const matchCountRef = React.useRef(0);
  const [isPositioningPreview, setIsPositioningPreview] = React.useState(false);
  const [matchCount, setMatchCount] = React.useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = React.useState(0);
  const mountKey = React.useMemo(() => hashString(editorState ?? ''), [editorState]);

  const clampIndex = React.useCallback((index: number, count: number) => {
    if (count <= 0) return 0;
    if (index < 0) return 0;
    if (index >= count) return count - 1;
    return index;
  }, []);

  React.useEffect(() => {
    activeMatchIndexRef.current = activeMatchIndex;
  }, [activeMatchIndex]);

  React.useEffect(() => {
    matchCountRef.current = matchCount;
  }, [matchCount]);

  const applyActiveMatch = React.useCallback((index: number, shouldScroll = true) => {
    const elements = matchElementsRef.current;
    elements.forEach((el) => {
      el.classList.remove('!bg-[#C14B55]', '!text-white', 'ring-1', 'ring-[#C14B55]/50');
    });
    if (elements.length === 0) return;
    const normalized = clampIndex(index, elements.length);
    const active = elements[normalized];
    active.classList.add('!bg-[#C14B55]', '!text-white', 'ring-1', 'ring-[#C14B55]/50');
    if (shouldScroll) {
      active.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [clampIndex]);

  const collectMatches = React.useCallback(
    (resetToFirst: boolean, scrollOnSet: boolean) => {
      const root = rootRef.current;
      if (!root) return;
      const marks = Array.from(root.querySelectorAll<HTMLElement>('.ContentEditable__root mark'));
      matchElementsRef.current = marks;
      setMatchCount(marks.length);
      if (marks.length === 0) {
        activeMatchIndexRef.current = 0;
        setActiveMatchIndex(0);
        return;
      }
      const nextIndex = resetToFirst ? 0 : clampIndex(activeMatchIndexRef.current, marks.length);
      activeMatchIndexRef.current = nextIndex;
      setActiveMatchIndex(nextIndex);
      applyActiveMatch(nextIndex, scrollOnSet);
    },
    [applyActiveMatch, clampIndex],
  );

  React.useEffect(() => {
    if (!query?.trim()) {
      matchElementsRef.current.forEach((el) => {
        el.classList.remove('!bg-[#C14B55]', '!text-white', 'ring-1', 'ring-[#C14B55]/50');
      });
      matchElementsRef.current = [];
      setMatchCount(0);
      activeMatchIndexRef.current = 0;
      setActiveMatchIndex(0);
      return;
    }
    setIsPositioningPreview(true);
    const timer = window.setTimeout(() => {
      collectMatches(true, true);
      requestAnimationFrame(() => setIsPositioningPreview(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editorState, query, collectMatches]);

  React.useEffect(() => {
    if (!query?.trim()) return;
    if (matchCount === 0) return;
    applyActiveMatch(activeMatchIndex, true);
  }, [activeMatchIndex, applyActiveMatch, matchCount, query]);

  React.useEffect(() => {
    onMatchStateChange?.(activeMatchIndex, matchCount);
  }, [activeMatchIndex, matchCount, onMatchStateChange]);

  React.useImperativeHandle(
    ref,
    () => ({
      prevMatch: () =>
        setActiveMatchIndex((prev) => {
          const next = clampIndex(prev - 1, matchCountRef.current);
          activeMatchIndexRef.current = next;
          return next;
        }),
      nextMatch: () =>
        setActiveMatchIndex((prev) => {
          const next = clampIndex(prev + 1, matchCountRef.current);
          activeMatchIndexRef.current = next;
          return next;
        }),
      getMatchState: () => ({
        activeIndex: activeMatchIndexRef.current,
        count: matchCountRef.current,
      }),
    }),
    [clampIndex],
  );

  return (
    <div className="relative [&_mark]:rounded-sm [&_mark]:bg-[#C14B55]/18 [&_mark]:text-[hsl(var(--foreground))]">
      {isPositioningPreview ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-[hsl(var(--background))]/75">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[hsl(var(--border))] border-t-[hsl(var(--muted-foreground))]" />
        </div>
      ) : null}
      <LexicalComposer
        key={mountKey}
        initialConfig={{
          ...previewConfigBase,
          ...(editorState ? { editorState } : {}),
        }}
      >
        <div
          ref={rootRef}
          className={
            'mx-auto max-w-5xl px-4 py-3 transition-opacity duration-120 ' +
            (isPositioningPreview ? 'opacity-0' : 'opacity-100')
          }
        >
          <RichTextPlugin
            contentEditable={
              <LexicalContentEditable className="ContentEditable__root relative block min-h-full cursor-default overflow-visible px-0 focus:outline-none font-normal select-none pointer-events-none" />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <ListPlugin />
          <CheckListPlugin />
          <TablePlugin
            hasCellMerge={false}
            hasCellBackgroundColor={false}
            hasTabHandler={false}
            hasHorizontalScroll={true}
          />
          <LinkPlugin />
        </div>
      </LexicalComposer>
    </div>
  );
});
