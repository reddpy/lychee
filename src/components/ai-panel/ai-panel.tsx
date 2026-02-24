import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Sparkles, X, Square, Settings } from 'lucide-react';
import { useAIPanelStore } from '@/renderer/ai-panel-store';
import { useSettingsStore } from '@/renderer/settings-store';
import { AI_ACTIONS, type AIAction } from './ai-actions';

type StreamState =
  | { status: 'idle' }
  | { status: 'streaming'; requestId: string; text: string }
  | { status: 'done'; text: string }
  | { status: 'error'; text: string; error: string };

let nextRequestId = 0;
function genRequestId(): string {
  return `ai-${++nextRequestId}-${Date.now()}`;
}

export function AIPanel({
  documentId,
  getNoteText,
}: {
  documentId: string;
  getNoteText: () => string;
}) {
  const isOpen = useAIPanelStore((s) => s.openPanels[documentId]);
  const closePanel = useAIPanelStore((s) => s.closePanel);
  const openSettings = useSettingsStore((s) => s.openSettings);

  const [state, setState] = useState<StreamState>({ status: 'idle' });
  const [lastAction, setLastAction] = useState<AIAction | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRequestId = useRef<string | null>(null);

  // Auto-scroll as streaming text arrives
  useEffect(() => {
    if (state.status === 'streaming' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state]);

  // Clean up stream listener on unmount
  useEffect(() => {
    return () => {
      if (activeRequestId.current) {
        window.lychee.invoke('ai.chatStop', { requestId: activeRequestId.current });
      }
    };
  }, []);

  const handleAction = useCallback(
    (action: AIAction) => {
      const noteText = getNoteText();
      if (!noteText.trim()) {
        setState({ status: 'error', text: '', error: 'This note is empty.' });
        return;
      }

      // Stop any existing stream
      if (activeRequestId.current) {
        window.lychee.invoke('ai.chatStop', { requestId: activeRequestId.current });
      }

      const requestId = genRequestId();
      activeRequestId.current = requestId;
      setLastAction(action);
      setState({ status: 'streaming', requestId, text: '' });

      // Subscribe to stream chunks
      const unsub = window.lychee.on('ai.stream', (payload) => {
        if (payload.requestId !== requestId) return;

        if (payload.error) {
          setState({ status: 'error', text: '', error: payload.error });
          activeRequestId.current = null;
          unsub();
          return;
        }

        if (payload.done) {
          setState((prev) =>
            prev.status === 'streaming'
              ? { status: 'done', text: prev.text }
              : prev,
          );
          activeRequestId.current = null;
          unsub();
          return;
        }

        if (payload.chunk) {
          setState((prev) =>
            prev.status === 'streaming'
              ? { ...prev, text: prev.text + payload.chunk }
              : prev,
          );
        }
      });

      // Fire off the request
      window.lychee
        .invoke('ai.chatStart', {
          requestId,
          messages: [
            { role: 'system' as const, content: action.systemPrompt },
            { role: 'user' as const, content: action.buildUserMessage(noteText) },
          ],
        })
        .then((res) => {
          if (!res.ok) {
            setState({ status: 'error', text: '', error: (res as any).error || 'Request failed' });
            activeRequestId.current = null;
            unsub();
          }
        })
        .catch((err) => {
          setState({ status: 'error', text: '', error: String(err) });
          activeRequestId.current = null;
          unsub();
        });
    },
    [getNoteText],
  );

  const handleStop = useCallback(() => {
    if (activeRequestId.current) {
      window.lychee.invoke('ai.chatStop', { requestId: activeRequestId.current });
      setState((prev) =>
        prev.status === 'streaming'
          ? { status: 'done', text: prev.text }
          : prev,
      );
      activeRequestId.current = null;
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--background))]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          <span className="text-sm font-semibold">AI</span>
        </div>
        <button
          type="button"
          onClick={() => closePanel(documentId)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 border-b border-[hsl(var(--border))]">
        {AI_ACTIONS.map((action) => {
          const Icon = action.icon;
          const isActive =
            lastAction?.id === action.id &&
            (state.status === 'streaming' || state.status === 'done');
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => handleAction(action)}
              disabled={state.status === 'streaming'}
              className={
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ' +
                (isActive
                  ? 'border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]') +
                (state.status === 'streaming' ? ' opacity-50 cursor-not-allowed' : '')
              }
            >
              <Icon className="h-3 w-3" />
              {action.label}
            </button>
          );
        })}
        {state.status === 'streaming' && (
          <button
            type="button"
            onClick={handleStop}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        )}
      </div>

      {/* Response area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {state.status === 'idle' && (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Click an action above to get started.
          </p>
        )}

        {state.status === 'error' && (
          <div className="space-y-2">
            <p className="text-sm text-red-500">{state.error}</p>
            {state.error.includes('not configured') && (
              <button
                type="button"
                onClick={() => openSettings()}
                className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--primary))] hover:underline"
              >
                <Settings className="h-3 w-3" />
                Open Settings
              </button>
            )}
          </div>
        )}

        {(state.status === 'streaming' || state.status === 'done') && (
          <div className="ai-panel-prose text-sm leading-relaxed text-[hsl(var(--foreground))]">
            <Markdown>{state.text}</Markdown>
            {state.status === 'streaming' && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-[hsl(var(--foreground))] animate-pulse align-text-bottom" />
            )}
          </div>
        )}
      </div>

    </div>
  );
}
