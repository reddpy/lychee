import type { DocumentRow } from "./documents"
import { displayNoteTitle } from "./note-title"
import { scoreDocument } from "./search-preview"

const INTERNAL_NOTE_PROTOCOL = "https:"
const INTERNAL_NOTE_HOST = "note.lychee.invalid"

/** DOM relationship marker used in addition to the reserved internal origin. */
export const INTERNAL_NOTE_REL = "lychee-note"

export type InternalNoteLinkTarget = {
  documentId: string
}

/**
 * Internal links use the document UUID rather than its title so links survive
 * note renames. `.invalid` is a permanently reserved, non-resolving TLD, while
 * the URL shape leaves the fragment available for later header-level links.
 */
export function createInternalNoteUrl(documentId: string): string {
  const normalizedId = documentId.trim()
  if (!normalizedId) {
    throw new Error("Cannot create an internal note link without a document ID")
  }
  return `https://${INTERNAL_NOTE_HOST}/${encodeURIComponent(normalizedId)}`
}

/** Return the internal target for a Lychee note URL, or null for any other URL. */
export function parseInternalNoteUrl(url: string): InternalNoteLinkTarget | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== INTERNAL_NOTE_PROTOCOL || parsed.hostname !== INTERNAL_NOTE_HOST) {
      return null
    }

    const encodedId = parsed.pathname.slice(1)
    if (!encodedId || encodedId.includes("/")) return null

    const documentId = decodeURIComponent(encodedId).trim()
    return documentId ? { documentId } : null
  } catch {
    return null
  }
}

type LinkableDocument = Pick<DocumentRow, "id" | "title" | "updatedAt">

export type RankedNoteLinkCandidate<T extends LinkableDocument = LinkableDocument> = {
  document: T
  displayTitle: string
  score: number
}

/**
 * Rank note-link targets by title only. An empty query shows the most recently
 * updated notes, while a query prefers exact, then prefix, then substring
 * matches. The source note is intentionally omitted from "other notes".
 */
export function rankNoteLinkCandidates<T extends LinkableDocument>(
  documents: readonly T[],
  query: string,
  sourceDocumentId: string,
  limit = 8,
): RankedNoteLinkCandidate<T>[] {
  const normalizedQuery = query.trim()

  return documents
    .filter((document) => document.id !== sourceDocumentId)
    .map((document) => ({
      document,
      displayTitle: displayNoteTitle(document.title),
      score: normalizedQuery ? scoreDocument(document.title, normalizedQuery) : 0,
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.document.updatedAt !== a.document.updatedAt) {
        return b.document.updatedAt.localeCompare(a.document.updatedAt)
      }
      const titleOrder = a.displayTitle.localeCompare(b.displayTitle)
      return titleOrder !== 0 ? titleOrder : a.document.id.localeCompare(b.document.id)
    })
    .slice(0, Math.max(0, limit))
}
