import { useCallback } from "react";
import { Pause, Play, Volume2, X } from "lucide-react";
import { useMediaStore } from "@/renderer/media-store";
import { useDocumentStore } from "@/renderer/document-store";

export function MediaPlaybackPill() {
  const activeVideo = useMediaStore((s) => s.activeVideo);
  const togglePlayback = useMediaStore((s) => s.togglePlayback);
  const dismiss = useMediaStore((s) => s.dismiss);
  const selectedId = useDocumentStore((s) => s.selectedId);
  const selectDocument = useDocumentStore((s) => s.selectDocument);
  const documents = useDocumentStore((s) => s.documents);

  const handleSwitchTab = useCallback(() => {
    if (!activeVideo) return;
    selectDocument(activeVideo.noteId);
    // Small delay so the tab becomes visible before scrolling
    setTimeout(() => activeVideo.scrollTo(), 50);
  }, [activeVideo, selectDocument]);

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

  // Show when a video is tracked on a non-active tab (playing or paused)
  if (!activeVideo || activeVideo.noteId === selectedId) return null;

  const doc = documents.find((d) => d.id === activeVideo.noteId);
  const noteEmoji = doc?.emoji ?? null;
  const noteTitle = activeVideo.noteTitle || "Untitled";
  const videoTitle = activeVideo.videoTitle || "YouTube";
  const isPlaying = activeVideo.isPlaying;

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
            {videoTitle}
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
        aria-label={isPlaying ? "Pause video" : "Play video"}
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
