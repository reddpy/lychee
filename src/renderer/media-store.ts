import { create } from "zustand";

type ActiveVideo = {
  noteId: string;
  noteTitle: string;
  videoId: string;
  /** Title of the YouTube video. */
  videoTitle: string;
  /** Opaque key to identify which component owns this entry. */
  key: string;
  /** Whether this video is currently playing. */
  isPlaying: boolean;
  /** Callback to pause this video (provided by the component). */
  pause: () => void;
  /** Callback to resume this video (provided by the component). */
  play: () => void;
  /** Callback to scroll the video into view. */
  scrollTo: () => void;
};

type MediaState = {
  activeVideo: ActiveVideo | null;
};

type MediaActions = {
  /** Record a new playing video. Auto-pauses the previous one if different. */
  setPlaying: (
    key: string,
    noteId: string,
    noteTitle: string,
    videoId: string,
    videoTitle: string,
    pause: () => void,
    play: () => void,
    scrollTo: () => void,
  ) => void;
  /** Mark video as paused (only if the caller's key matches). */
  setPaused: (key: string) => void;
  /** Toggle play/pause on the currently active video. */
  togglePlayback: () => void;
  /** Dismiss the pill: pause if playing, then clear active video. */
  dismiss: () => void;
};

export const useMediaStore = create<MediaState & MediaActions>((set, get) => ({
  activeVideo: null,

  setPlaying(key, noteId, noteTitle, videoId, videoTitle, pause, play, scrollTo) {
    const prev = get().activeVideo;
    if (prev && prev.key !== key) {
      prev.pause();
    }
    set({ activeVideo: { key, noteId, noteTitle, videoId, videoTitle, isPlaying: true, pause, play, scrollTo } });
  },

  setPaused(key) {
    const current = get().activeVideo;
    if (current && current.key === key) {
      set({ activeVideo: { ...current, isPlaying: false } });
    }
  },

  togglePlayback() {
    const current = get().activeVideo;
    if (!current) return;
    if (current.isPlaying) {
      current.pause();
      set({ activeVideo: { ...current, isPlaying: false } });
    } else {
      current.play();
      set({ activeVideo: { ...current, isPlaying: true } });
    }
  },

  dismiss() {
    const current = get().activeVideo;
    if (current) {
      if (current.isPlaying) current.pause();
      set({ activeVideo: null });
    }
  },
}));
