// Canonical label for a note that has no title. This is also the editor's
// title-field placeholder, so an unnamed note reads identically whether you're
// editing it or seeing it referenced (sidebar, tabs, search, breadcrumb).
export const NEW_NOTE_TITLE = "New Note";

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

/**
 * Characters allowed in a note title: letters (any script), numbers, spaces,
 * and light punctuation. Everything else — symbols, emoji, and filesystem-
 * hostile punctuation like `/ \ : * ? " < > |` — is dropped. Spaces are always
 * allowed; runs of whitespace are kept as typed (commit trims the ends).
 */
const TITLE_INPUT_DISALLOWED = /[^\p{L}\p{N}\s\-_',.&()!]/gu;

/**
 * Drop disallowed characters while preserving whitespace exactly as typed.
 * Use this when cleaning the live DOM so contentEditable's `&nbsp;` for
 * trailing spaces survives.
 */
export function stripDisallowedTitleChars(raw: string): string {
  return raw.replace(TITLE_INPUT_DISALLOWED, "");
}

/** Sanitize free-typed title text: drop disallowed chars, normalize whitespace. */
export function sanitizeTitleInput(raw: string): string {
  return stripDisallowedTitleChars(raw).replace(/\s/g, " ");
}
