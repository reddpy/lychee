import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COLLABORATION_TAG } from "lexical";
import { useEffect } from "react";
import { changedTopLevelKeys } from "@/renderer/agent-highlight";
import { isNoteReady } from "@/renderer/note-sync";

const AGENT_ADDED_CLASS = "lychee-agent-added";
/** How long an "added by agent" highlight lingers before it clears itself. */
const HIGHLIGHT_MS = 10_000;

/** Softly fade a freshly-inserted block in (Claude-style: opacity only). */
function animateIn(element: HTMLElement): void {
  if (typeof element.animate !== "function") return;
  element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 650,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
}

/** Lightweight diagnostics surface (safe to inspect from the console). */
interface HighlightDebug {
  mountedAt: string;
  marks: number;
  lastKeys: string[];
}
declare global {
  interface Window {
    __lycheeAgentHighlight?: HighlightDebug;
  }
}

/**
 * Highlights blocks an AI peer just added, Google-Docs-suggestion style.
 *
 * Dismissal is driven by real interaction only — click, a key press (typing),
 * Escape, or a 10s timeout. It deliberately does NOT clear on editor updates:
 * a collaboration apply is often followed by another programmatic update
 * (normalization, etc.), and clearing on those made the highlight vanish before
 * it could be seen. Only applies after the note's initial load, so replaying
 * persisted state on open never highlights anything.
 */
export function AgentHighlightPlugin({ documentId }: { documentId: string }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const pending = new Set<string>();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempts = 0;

    if (typeof window !== "undefined") {
      window.__lycheeAgentHighlight = {
        mountedAt: new Date().toISOString(),
        marks: 0,
        lastKeys: [],
      };
    }

    const clearOne = (key: string): void => {
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
      editor.getElementByKey(key)?.classList.remove(AGENT_ADDED_CLASS);
    };

    const clearAll = (): void => {
      pending.clear();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      retryAttempts = 0;
      for (const key of [...timers.keys()]) clearOne(key);
    };

    const applyOne = (key: string): void => {
      const element = editor.getElementByKey(key);
      if (!element) {
        pending.add(key); // element not committed yet; retried below
        return;
      }
      pending.delete(key);
      element.classList.add(AGENT_ADDED_CLASS);
      animateIn(element);
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => clearOne(key), HIGHLIGHT_MS),
      );
    };

    // Decorator nodes (images, bookmarks, media) can commit their DOM a tick
    // after the collaboration update, so retry pending keys for a short while.
    const scheduleRetry = (): void => {
      if (pending.size === 0 || retryTimer !== null || retryAttempts >= 20) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryAttempts += 1;
        for (const key of [...pending]) applyOne(key);
        scheduleRetry();
      }, 50);
    };

    const mark = (keys: string[]): void => {
      if (keys.length === 0) return;
      if (window.__lycheeAgentHighlight) {
        window.__lycheeAgentHighlight.marks += 1;
        window.__lycheeAgentHighlight.lastKeys = keys;
      }
      retryAttempts = 0;
      for (const key of keys) applyOne(key);
      scheduleRetry();
    };

    const unregisterUpdate = editor.registerUpdateListener(
      ({ prevEditorState, editorState, tags }) => {
        // Retry any blocks whose DOM wasn't ready when first marked.
        if (pending.size > 0) for (const key of [...pending]) applyOne(key);
        if (tags.has(COLLABORATION_TAG)) {
          // Skip the initial replay of persisted CRDT state on open — only live
          // agent updates (which arrive once the note is ready) highlight.
          if (!isNoteReady(documentId)) return;
          mark(changedTopLevelKeys(prevEditorState, editorState));
        }
      },
    );

    let rootElement: HTMLElement | null = null;
    const unregisterRoot = editor.registerRootListener((root) => {
      rootElement?.removeEventListener("pointerdown", clearAll);
      rootElement = root;
      rootElement?.addEventListener("pointerdown", clearAll);
    });

    // Any key press (including typing over the note) dismisses the highlight.
    const onKeyDown = (): void => clearAll();
    window.addEventListener("keydown", onKeyDown);

    return () => {
      unregisterUpdate();
      unregisterRoot();
      rootElement?.removeEventListener("pointerdown", clearAll);
      window.removeEventListener("keydown", onKeyDown);
      clearAll();
    };
  }, [editor, documentId]);

  return null;
}
