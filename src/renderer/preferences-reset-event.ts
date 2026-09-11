// Lightweight pub/sub for "reset all settings". Kept free of store imports so
// layout hooks (sidebar, section order) can subscribe without pulling the theme
// and appearance stores — and their DOM/window side effects — into modules that
// are imported in plain Node test environments.

const RESET_EVENT = 'lychee:preferences-reset';

export function onPreferencesReset(handler: () => void): () => void {
  window.addEventListener(RESET_EVENT, handler);
  return () => window.removeEventListener(RESET_EVENT, handler);
}

export function emitPreferencesReset(): void {
  window.dispatchEvent(new Event(RESET_EVENT));
}
