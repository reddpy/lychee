// Canonical label for a note that has no title. This is also the editor's
// title-field placeholder, so an unnamed note reads identically whether you're
// editing it or seeing it referenced (sidebar, tabs, search, breadcrumb).
export const NEW_NOTE_TITLE = "New Page";

// Resolve a note's display title. An empty/whitespace title — or the legacy
// "Untitled" sentinel (older notes and pre-strip data) — falls back to
// NEW_NOTE_TITLE. Centralizing this keeps every surface consistent and prevents
// the fallback from drifting per call site.
// Whether a note has a real, user-provided title — i.e. not blank and not the
// legacy "Untitled" sentinel. The inverse of "shows the NEW_NOTE_TITLE
// placeholder". Used for empty-note detection and tab title state.
export function hasNoteTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  return trimmed !== "" && trimmed !== "Untitled";
}

export function displayNoteTitle(title: string | null | undefined): string {
  const trimmed = (title ?? "").trim();
  return hasNoteTitle(trimmed) ? trimmed : NEW_NOTE_TITLE;
}
