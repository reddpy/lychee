import { create } from "zustand";

const transientClearTimers = new Map<string, number>();

/** Per-tab search state (keyed by tabId). */
type SearchHighlightTabState = {
  query: string;
  isOpen: boolean;
  activeIndex: number;
  matchCount: number;
  scrollRequest: number;
};

/** Transient jump from command palette (keyed by documentId). */
export type TransientJump = {
  query: string;
  activeIndex: number;
  expiresAt: number;
};

const defaultTabState: SearchHighlightTabState = {
  query: "",
  isOpen: false,
  activeIndex: 0,
  matchCount: 0,
  scrollRequest: 0,
};

type SearchHighlightState = {
  /** Regular in-note search state, keyed by tabId. */
  states: Record<string, SearchHighlightTabState>;
  /** Transient highlight jumps from command palette, keyed by documentId. */
  transients: Record<string, TransientJump>;

  openHighlight: (tabId: string, query?: string, activeIndex?: number) => void;
  setQuery: (tabId: string, query: string) => void;
  setActiveIndex: (tabId: string, activeIndex: number) => void;
  setMatchCount: (tabId: string, matchCount: number) => void;
  setHighlight: (tabId: string, query: string, activeIndex?: number) => void;
  clearHighlight: (tabId?: string) => void;
  requestScroll: (tabId: string) => void;
  removeTabState: (tabId: string) => void;

  /** Set a transient highlight jump (from command palette) — keyed by documentId. */
  setTransientJump: (
    docId: string,
    query: string,
    activeIndex?: number,
    durationMs?: number,
  ) => void;
  /** Clear a transient jump — keyed by documentId. */
  clearTransientJump: (docId: string) => void;
};

export const useSearchHighlightStore = create<SearchHighlightState>((set) => ({
  states: {},
  transients: {},

  openHighlight: (tabId, query, activeIndex) =>
    set((state) => {
      const prev = state.states[tabId] ?? defaultTabState;
      return {
        states: {
          ...state.states,
          [tabId]: {
            ...prev,
            query: query ?? prev.query,
            isOpen: true,
            activeIndex: Math.max(0, activeIndex ?? prev.activeIndex),
          },
        },
      };
    }),

  setQuery: (tabId, query) =>
    set((state) => {
      const prev = state.states[tabId] ?? defaultTabState;
      return { states: { ...state.states, [tabId]: { ...prev, query } } };
    }),

  setActiveIndex: (tabId, activeIndex) =>
    set((state) => {
      const prev = state.states[tabId] ?? defaultTabState;
      return {
        states: {
          ...state.states,
          [tabId]: { ...prev, activeIndex: Math.max(0, activeIndex) },
        },
      };
    }),

  setMatchCount: (tabId, matchCount) =>
    set((state) => {
      const prev = state.states[tabId] ?? defaultTabState;
      return { states: { ...state.states, [tabId]: { ...prev, matchCount } } };
    }),

  setHighlight: (tabId, query, activeIndex = 0) =>
    set((state) => ({
      states: {
        ...state.states,
        [tabId]: {
          ...(state.states[tabId] ?? defaultTabState),
          query,
          isOpen: true,
          activeIndex: Math.max(0, activeIndex),
        },
      },
    })),

  clearHighlight: (tabId) =>
    set((state) => {
      if (!tabId) return { states: {} };
      const prev = state.states[tabId];
      if (!prev) return state;
      return {
        states: {
          ...state.states,
          [tabId]: { ...prev, isOpen: false },
        },
      };
    }),

  requestScroll: (tabId) =>
    set((state) => {
      const prev = state.states[tabId] ?? defaultTabState;
      return {
        states: {
          ...state.states,
          [tabId]: { ...prev, scrollRequest: prev.scrollRequest + 1 },
        },
      };
    }),

  removeTabState: (tabId) =>
    set((state) => {
      const next = { ...state.states };
      delete next[tabId];
      return { states: next };
    }),

  setTransientJump: (docId, query, activeIndex = 0, durationMs = 3000) =>
    set((state) => {
      const existingTimer = transientClearTimers.get(docId);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        transientClearTimers.delete(docId);
      }
      const clearTimer = window.setTimeout(() => {
        useSearchHighlightStore.setState((current) => {
          if (!current.transients[docId]) return current;
          const next = { ...current.transients };
          delete next[docId];
          return { transients: next };
        });
        transientClearTimers.delete(docId);
      }, Math.max(0, durationMs));
      transientClearTimers.set(docId, clearTimer);
      const expiresAt = Date.now() + Math.max(0, durationMs);
      return {
        transients: {
          ...state.transients,
          [docId]: { query, activeIndex: Math.max(0, activeIndex), expiresAt },
        },
      };
    }),

  clearTransientJump: (docId) =>
    set((state) => {
      const timer = transientClearTimers.get(docId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        transientClearTimers.delete(docId);
      }
      if (!state.transients[docId]) return state;
      const next = { ...state.transients };
      delete next[docId];
      return { transients: next };
    }),
}));
