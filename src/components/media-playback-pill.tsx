import { useCallback, useEffect } from "react";
import { Pause, Play, Volume2, X } from "lucide-react";
import { useMediaStore } from "@/renderer/media-store";
import { useDocumentStore } from "@/renderer/document-store";

export function MediaPlaybackPill() {
  const activeMedia = useMediaStore((s) => s.activeMedia);
  const togglePlayback = useMediaStore((s) => s.togglePlayback);
  const dismiss = useMediaStore((s) => s.dismiss);
  const selectedId = useDocumentStore((s) => s.selectedId);
  const selectDocument = useDocumentStore((s) => s.selectDocument);
  const documents = useDocumentStore((s) => s.documents);
  const openTabs = useDocumentStore((s) => s.openTabs);

  // If the media's tab was closed or replaced, dismiss the pill
  useEffect(() => {
    if (activeMedia && !openTabs.includes(activeMedia.noteId)) {
      dismiss();
    }
  }, [activeMedia, openTabs, dismiss]);

  const handleSwitchTab = useCallback(() => {
    if (!activeMedia) return;
    selectDocument(activeMedia.noteId);
    // Small delay so the tab becomes visible before scrolling
    setTimeout(() => activeMedia.scrollTo(), 50);
  }, [activeMedia, selectDocument]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      togglePlayback();
    },
    [togglePlayback],
  );

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      dismiss();
    },
    [dismiss],
  );

  // Show when media is tracked on a non-active tab (playing or paused)
  if (!activeMedia || activeMedia.noteId === selectedId || !openTabs.includes(activeMedia.noteId)) return null;

  const doc = documents.find((d) => d.id === activeMedia.noteId);
  const noteEmoji = doc?.emoji ?? null;
  const noteTitle = activeMedia.noteTitle || "Untitled";
  const contentTitle = activeMedia.contentTitle || "Media";
  const isPlaying = activeMedia.isPlaying;

  return (
    <div
      className="group absolute top-3 right-4 z-50 flex items-center rounded-full border border-[hsl(var(--border))] bg-popover p-1 shadow-md cursor-pointer select-none animate-in fade-in-0 slide-in-from-top-2 duration-200 hover:shadow-lg transition-all"
      onClick={handleSwitchTab}
      title={`Playing in: ${noteTitle}`}
    >
      <div className="flex items-center gap-1.5 max-w-0 overflow-hidden opacity-0 group-hover:max-w-[220px] group-hover:opacity-100 group-hover:mr-1.5 transition-all duration-200">
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors ml-0.5"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate leading-tight max-w-[180px]">
            {contentTitle}
          </span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] truncate leading-tight max-w-[180px]">
            {noteEmoji && <span className="mr-0.5">{noteEmoji}</span>}{noteTitle}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={handleToggle}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#C14B55] text-white hover:bg-[#a83f48] transition-colors"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Volume2 className="h-3.5 w-3.5 group-hover:hidden" />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current group-hover:hidden" />
        )}
        {isPlaying ? (
          <Pause className="h-3 w-3 fill-current hidden group-hover:block" />
        ) : (
          <Play className="h-3 w-3 fill-current hidden group-hover:block" />
        )}
      </button>
    </div>
  );
}
