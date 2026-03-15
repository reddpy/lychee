import { create } from "zustand";

const transientClearTimers = new Map<string, number>();

type SearchHighlightDocState = {
  query: string;
  isOpen: boolean;
  activeIndex: number;
  matchCount: number;
  scrollRequest: number;
  transient:
    | {
        query: string;
        activeIndex: number;
        expiresAt: number;
      }
    | null;
};

const defaultDocState: SearchHighlightDocState = {
  query: "",
  isOpen: false,
  activeIndex: 0,
  matchCount: 0,
  scrollRequest: 0,
  transient: null,
};

type SearchHighlightState = {
  states: Record<string, SearchHighlightDocState>;
  openHighlight: (docId: string, query?: string, activeIndex?: number) => void;
  setQuery: (docId: string, query: string) => void;
  setActiveIndex: (docId: string, activeIndex: number) => void;
  setMatchCount: (docId: string, matchCount: number) => void;
  setHighlight: (docId: string, query: string, activeIndex?: number) => void;
  setTransientJump: (
    docId: string,
    query: string,
    activeIndex?: number,
    durationMs?: number,
  ) => void;
  clearTransientJump: (docId: string) => void;
  clearHighlight: (docId?: string) => void;
  requestScroll: (docId: string) => void;
};

export const useSearchHighlightStore = create<SearchHighlightState>((set) => ({
  states: {},
  openHighlight: (docId, query, activeIndex) =>
    set((state) => {
      const timer = transientClearTimers.get(docId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        transientClearTimers.delete(docId);
      }
      const prev = state.states[docId] ?? defaultDocState;
      const next: SearchHighlightDocState = {
        ...prev,
        query: query ?? prev.query,
        isOpen: true,
        activeIndex: Math.max(0, activeIndex ?? prev.activeIndex),
        transient: null,
      };
      return { states: { ...state.states, [docId]: next } };
    }),
  setQuery: (docId, query) =>
    set((state) => {
      const prev = state.states[docId] ?? defaultDocState;
      return {
        states: {
          ...state.states,
          [docId]: { ...prev, query },
        },
      };
    }),
  setActiveIndex: (docId, activeIndex) =>
    set((state) => {
      const prev = state.states[docId] ?? defaultDocState;
      return {
        states: {
          ...state.states,
          [docId]: {
            ...prev,
            activeIndex: Math.max(0, activeIndex),
          },
        },
      };
    }),
  setMatchCount: (docId, matchCount) =>
    set((state) => {
      const prev = state.states[docId] ?? defaultDocState;
      return {
        states: {
          ...state.states,
          [docId]: { ...prev, matchCount },
        },
      };
    }),
  setHighlight: (docId, query, activeIndex = 0) =>
    set((state) => ({
      ...(transientClearTimers.has(docId)
        ? (() => {
            const timer = transientClearTimers.get(docId);
            if (timer === undefined) return {};
            window.clearTimeout(timer);
            transientClearTimers.delete(docId);
            return {};
          })()
        : {}),
      states: {
        ...state.states,
        [docId]: {
          ...(state.states[docId] ?? defaultDocState),
          query,
          isOpen: true,
          activeIndex: Math.max(0, activeIndex),
          transient: null,
        },
      },
    })),
  setTransientJump: (docId, query, activeIndex = 0, durationMs = 3000) =>
    set((state) => {
      const existingTimer = transientClearTimers.get(docId);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        transientClearTimers.delete(docId);
      }
      const clearTimer = window.setTimeout(() => {
        useSearchHighlightStore.setState((current) => {
          const prev = current.states[docId];
          if (!prev?.transient) return current;
          return {
            states: {
              ...current.states,
              [docId]: {
                ...prev,
                transient: null,
              },
            },
          };
        });
        transientClearTimers.delete(docId);
      }, Math.max(0, durationMs));
      transientClearTimers.set(docId, clearTimer);
      const prev = state.states[docId] ?? defaultDocState;
      const expiresAt = Date.now() + Math.max(0, durationMs);
      return {
        states: {
          ...state.states,
          [docId]: {
            ...prev,
            transient: {
              query,
              activeIndex: Math.max(0, activeIndex),
              expiresAt,
            },
          },
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
      const prev = state.states[docId];
      if (!prev || !prev.transient) return state;
      return {
        states: {
          ...state.states,
          [docId]: {
            ...prev,
            transient: null,
          },
        },
      };
    }),
  clearHighlight: (docId) =>
    set((state) => {
      if (docId) {
        const timer = transientClearTimers.get(docId);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          transientClearTimers.delete(docId);
        }
      } else {
        for (const timer of transientClearTimers.values()) {
          window.clearTimeout(timer);
        }
        transientClearTimers.clear();
      }
      if (!docId) return { states: {} };
      const prev = state.states[docId];
      if (!prev) return state;
      return {
        states: {
          ...state.states,
          [docId]: { ...prev, isOpen: false, transient: null },
        },
      };
    }),
  requestScroll: (docId) =>
    set((state) => {
      const prev = state.states[docId] ?? defaultDocState;
      return {
        states: {
          ...state.states,
          [docId]: { ...prev, scrollRequest: prev.scrollRequest + 1 },
        },
      };
    }),
}));
