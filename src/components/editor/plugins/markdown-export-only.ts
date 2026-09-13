/**
 * A regex that never matches any input.
 *
 * `@lexical/markdown` tests every transformer's `regExp`/`regExpStart` against
 * each line during import. An export-only transformer must therefore use a
 * pattern that genuinely cannot match. The common `/(?:)/` does NOT qualify —
 * it matches the empty string inside every line, so the importer believes the
 * line (or, for a multiline transformer, the entire document) was handled and
 * silently drops it.
 */
export const NEVER_MATCH = /(?!)/;
