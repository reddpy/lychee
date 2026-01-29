import * as React from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { HashtagPlugin } from '@lexical/react/LexicalHashtagPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { EditorState, LexicalEditor as LexicalEditorType } from 'lexical';
import { $createParagraphNode, $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND } from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { CodeNode, $createCodeNode } from '@lexical/code';
import {
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
  ListNode,
  ListItemNode,
} from '@lexical/list';
import { LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { HashtagNode } from '@lexical/hashtag';
import { TRANSFORMERS } from '@lexical/markdown';
import debounce from 'lodash/debounce';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { useDocumentStore } from '../renderer/document-store';
import type { DocumentRow } from '../shared/documents';

const LEXICAL_NAMESPACE = 'LycheeEditor';

const theme = {
  paragraph: 'mb-2 last:mb-0',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: 'underline line-through',
    code: 'rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-[13px]',
  },
  list: {
    ul: 'list-disc list-inside mb-2',
    ol: 'list-decimal list-inside mb-2',
    listitem: 'ml-4',
  },
  heading: {
    h1: 'text-3xl font-semibold tracking-tight mb-4',
    h2: 'text-2xl font-semibold tracking-tight mb-3',
    h3: 'text-xl font-semibold tracking-tight mb-2',
  },
  link: 'text-[hsl(var(--primary))] underline cursor-pointer',
  quote: 'border-l-4 border-[hsl(var(--border))] pl-4 italic text-[hsl(var(--muted-foreground))] mb-2',
  code: 'block rounded bg-[hsl(var(--muted))] p-3 font-mono text-[13px] mb-2 overflow-x-auto',
};

function ToolbarButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 w-7 px-0 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  const applyBlock = React.useCallback(
    (block: 'paragraph' | 'h1' | 'h2' | 'h3' | 'quote' | 'code') => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (block === 'paragraph') {
          $setBlocksType(selection, () => $createParagraphNode());
        } else if (block === 'quote') {
          $setBlocksType(selection, () => $createQuoteNode());
        } else if (block === 'code') {
          $setBlocksType(selection, () => $createCodeNode());
        } else {
          const tag = block as 'h1' | 'h2' | 'h3';
          $setBlocksType(selection, () => $createHeadingNode(tag));
        }
      });
    },
    [editor],
  );

  const applyLink = React.useCallback(() => {
    const url = window.prompt('Enter URL');
    if (url == null) return;
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url || null);
  }, [editor]);

  const updateToolbar = React.useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        setIsOpen(false);
        return;
      }
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) {
        setIsOpen(false);
        return;
      }
      const range = domSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setIsOpen(false);
        return;
      }
      const top = rect.top + window.scrollY - 40;
      const left = rect.left + window.scrollX + rect.width / 2;
      setCoords({ top, left });
      setIsOpen(true);
    });
  }, [editor]);

  React.useEffect(() => {
    return editor.registerUpdateListener(() => {
      updateToolbar();
    });
  }, [editor, updateToolbar]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        transform: 'translate(-50%, -100%)',
        zIndex: 50,
      }}
      className="flex flex-wrap items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-white px-2 py-1 shadow-md"
    >
      <ToolbarButton
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
      >
        <span className="font-semibold">B</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
      >
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() =>
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')
        }
      >
        <span className="line-through">S</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')}
      >
        {'</>'}
      </ToolbarButton>
      <div className="mx-1 h-4 w-px bg-[hsl(var(--border))]" />
      <ToolbarButton onClick={() => applyBlock('paragraph')}>T</ToolbarButton>
      <ToolbarButton onClick={() => applyBlock('h1')}>H1</ToolbarButton>
      <ToolbarButton onClick={() => applyBlock('h2')}>H2</ToolbarButton>
      <ToolbarButton onClick={() => applyBlock('h3')}>H3</ToolbarButton>
      <ToolbarButton onClick={() => applyBlock('quote')}>&ldquo;</ToolbarButton>
      <ToolbarButton onClick={() => applyBlock('code')}>{'{ }'}</ToolbarButton>
      <div className="mx-1 h-4 w-px bg-[hsl(var(--border))]" />
      <ToolbarButton
        onClick={() =>
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
        }
      >
        &bull;
      </ToolbarButton>
      <ToolbarButton
        onClick={() =>
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
        }
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        onClick={() =>
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
        }
      >
        &#10003;
      </ToolbarButton>
      <div className="mx-1 h-4 w-px bg-[hsl(var(--border))]" />
      <ToolbarButton onClick={applyLink}>∞</ToolbarButton>
      <div className="mx-1 h-4 w-px bg-[hsl(var(--border))]" />
      <ToolbarButton onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}>
        &#8630;
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}>
        &#8631;
      </ToolbarButton>
    </div>
  );
}

function getInitialEditorState(content: string | undefined): string | undefined {
  if (!content || content.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.root) return content;
  } catch {
    // ignore invalid JSON
  }
  return undefined;
}

function SaveOnChangePlugin({
  documentId,
  onSaved,
}: {
  documentId: string;
  onSaved?: (doc: DocumentRow) => void;
}) {
  const save = React.useMemo(
    () =>
      debounce((id: string, json: string) => {
        window.lychee
          .invoke('documents.update', { id, content: json })
          .then(({ document: doc }) => {
            onSaved?.(doc);
          })
          .catch((err) => console.error('Save failed:', err));
      }, 600),
    [onSaved],
  );

  React.useEffect(() => {
    return () => save.cancel();
  }, [save]);

  const handleChange = React.useCallback(
    (editorState: EditorState) => {
      const json = JSON.stringify(editorState.toJSON());
      save(documentId, json);
    },
    [documentId, save],
  );

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />;
}

function EditorTitle({
  documentId,
  title,
  className,
}: {
  documentId: string;
  title: string;
  className?: string;
}) {
  const [localTitle, setLocalTitle] = React.useState(title);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const updateDocumentInStore = useDocumentStore((s) => s.updateDocumentInStore);

  React.useEffect(() => {
    setLocalTitle(title);
  }, [documentId, title]);

  const handleBlur = React.useCallback(() => {
    const trimmed = localTitle.trim() || 'Untitled';
    if (trimmed === title) return;
    setLocalTitle(trimmed);
    window.lychee
      .invoke('documents.update', { id: documentId, title: trimmed })
      .then(({ document: doc }) => {
        updateDocumentInStore(doc.id, { title: doc.title });
      })
      .catch((err) => console.error('Title save failed:', err));
  }, [documentId, title, localTitle, updateDocumentInStore]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inputRef.current?.blur();
      }
    },
    [],
  );

  return (
    <input
      ref={inputRef}
      type="text"
      value={localTitle}
      onChange={(e) => setLocalTitle(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-[hsl(var(--muted-foreground))]',
        className,
      )}
      placeholder="Untitled"
      aria-label="Document title"
    />
  );
}

export function LexicalEditor({
  documentId,
  document,
}: {
  documentId: string;
  document: DocumentRow;
}) {
  const updateDocumentInStore = useDocumentStore((s) => s.updateDocumentInStore);
  const initialEditorState = React.useMemo(
    () => getInitialEditorState(document.content),
    [documentId],
  );

  const initialConfig = React.useMemo(
    () => ({
      namespace: LEXICAL_NAMESPACE,
      theme,
      onError: (err: Error) => console.error('Lexical error:', err),
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, HashtagNode, CodeNode],
      editorState: initialEditorState
        ? (editor: LexicalEditorType) => {
            // Let Lexical parse the persisted JSON string.
            const editorState = editor.parseEditorState(initialEditorState);
            editor.setEditorState(editorState);
          }
        : undefined,
    }),
    [documentId, initialEditorState],
  );

  const handleSaved = React.useCallback(
    (doc: DocumentRow) => {
      updateDocumentInStore(doc.id, { content: doc.content, updatedAt: doc.updatedAt });
    },
    [updateDocumentInStore],
  );

  return (
    <main className="h-full flex-1 bg-[hsl(var(--background))] border-t-0 overflow-auto">
      <div className="mx-auto max-w-[900px] px-8 py-10">
        <EditorTitle documentId={documentId} title={document.title} className="mb-6" />
        <LexicalComposer key={documentId} initialConfig={initialConfig}>
          <FloatingToolbarPlugin />
          <div className="relative">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="min-h-[300px] text-[15px] leading-7 outline-none"
                  aria-placeholder="Start writing..."
                  // TS types require this prop; actual placeholder UI is provided via RichTextPlugin.placeholder.
                  placeholder={null as unknown as undefined}
                />
              }
              placeholder={
                <div className="pointer-events-none absolute left-0 top-0 text-[15px] leading-7 text-[hsl(var(--muted-foreground))]">
                  Start writing...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
          <HistoryPlugin />
          <ListPlugin />
          <CheckListPlugin />
          <LinkPlugin />
          <HashtagPlugin />
          <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
          <TabIndentationPlugin />
          <AutoFocusPlugin />
          <SaveOnChangePlugin documentId={documentId} onSaved={handleSaved} />
        </LexicalComposer>
      </div>
    </main>
  );
}
