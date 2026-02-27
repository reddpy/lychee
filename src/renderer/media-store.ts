import { create } from "zustand";

type ActiveMedia = {
  noteId: string;
  noteTitle: string;
  contentId: string;
  contentTitle: string;
  contentType: string;
  /** Opaque key to identify which component owns this entry. */
  key: string;
  /** Whether this media is currently playing. */
  isPlaying: boolean;
  /** Callback to pause this media (provided by the component). */
  pause: () => void;
  /** Callback to resume this media (provided by the component). */
  play: () => void;
  /** Callback to scroll the media into view. */
  scrollTo: () => void;
};

type MediaState = {
  activeMedia: ActiveMedia | null;
};

type MediaActions = {
  /** Record a new playing media. Auto-pauses the previous one if different. */
  setPlaying: (
    key: string,
    noteId: string,
    noteTitle: string,
    contentId: string,
    contentTitle: string,
    contentType: string,
    pause: () => void,
    play: () => void,
    scrollTo: () => void,
  ) => void;
  /** Mark media as paused (only if the caller's key matches). */
  setPaused: (key: string) => void;
  /** Toggle play/pause on the currently active media. */
  togglePlayback: () => void;
  /** Dismiss the pill: pause if playing, then clear active media. */
  dismiss: () => void;
};

export const useMediaStore = create<MediaState & MediaActions>((set, get) => ({
  activeMedia: null,

  setPlaying(key, noteId, noteTitle, contentId, contentTitle, contentType, pause, play, scrollTo) {
    const prev = get().activeMedia;
    if (prev && prev.key !== key) {
      prev.pause();
    }
    set({ activeMedia: { key, noteId, noteTitle, contentId, contentTitle, contentType, isPlaying: true, pause, play, scrollTo } });
  },

  setPaused(key) {
    const current = get().activeMedia;
    if (current && current.key === key) {
      set({ activeMedia: { ...current, isPlaying: false } });
    }
  },

  togglePlayback() {
    const current = get().activeMedia;
    if (!current) return;
    if (current.isPlaying) {
      current.pause();
      set({ activeMedia: { ...current, isPlaying: false } });
    } else {
      current.play();
      set({ activeMedia: { ...current, isPlaying: true } });
    }
  },

  dismiss() {
    const current = get().activeMedia;
    if (current) {
      if (current.isPlaying) current.pause();
      set({ activeMedia: null });
    }
  },
}));
