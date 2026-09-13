import { createHeadlessEditor } from "@lexical/headless"

import { nodes } from "@/components/editor/nodes"
import { parseDocumentContent } from "@/components/editor/content-load"
import { exportDocumentMarkdown } from "@/components/editor/markdown-io"
import { serializeFrontmatter } from "@/shared/frontmatter"
import { stripLeadingTitle } from "@/shared/markdown-title"
import { planVaultPaths, type VaultWriteEntry } from "@/shared/vault-path"
import { CONTENT_SCHEMA_VERSION, type DocumentRow } from "@/shared/documents"

/**
 * Turn stored note rows into vault files (frontmatter + markdown body).
 *
 * The note title is its filename (Obsidian model), so the body carries no title
 * line. Lexical (and therefore the markdown encoders) must run in the renderer —
 * the custom node modules transitively import React/renderer code. The main
 * process only writes the resulting bytes.
 */

function documentBodyMarkdown(document: DocumentRow): string {
  const editor = createHeadlessEditor({
    namespace: "vault-export",
    nodes,
    onError: (error) => {
      throw error
    },
  })

  const load = parseDocumentContent({
    content: document.content,
    contentSchemaVersion: document.metadata?.contentSchemaVersion,
  })

  if (load.status === "error") {
    throw new Error(`Cannot export note ${document.id}: ${load.reason}`)
  }

  if (load.status === "empty") {
    return ""
  }

  editor.setEditorState(editor.parseEditorState(JSON.stringify(load.editorState)))
  return stripLeadingTitle(exportDocumentMarkdown(editor), document.title)
}

function buildEntry(document: DocumentRow, relativePath: string): VaultWriteEntry {
  const frontmatter = serializeFrontmatter({
    id: document.id,
    title: document.title,
    emoji: document.emoji ?? undefined,
    bookmarked: document.metadata?.bookmarkedAt ?? undefined,
    created: document.createdAt,
    updated: document.updatedAt,
    contentSchemaVersion: document.metadata?.contentSchemaVersion ?? CONTENT_SCHEMA_VERSION,
    order: document.sortOrder,
  })

  return {
    relativePath,
    contents: `${frontmatter}\n${documentBodyMarkdown(document)}`,
    noteId: document.id,
  }
}

export function buildVaultEntries(documents: DocumentRow[]): VaultWriteEntry[] {
  const paths = planVaultPaths(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      parentId: document.parentId,
      sortOrder: document.sortOrder,
    })),
  )

  return documents.map((document) => {
    const relativePath = paths.get(document.id)
    if (!relativePath) throw new Error(`No vault path for note ${document.id}`)
    return buildEntry(document, relativePath)
  })
}

/** Build the single vault entry for one note, using the full tree for its path. */
export function buildVaultEntryFor(
  documents: DocumentRow[],
  id: string,
): VaultWriteEntry | null {
  const paths = planVaultPaths(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      parentId: document.parentId,
      sortOrder: document.sortOrder,
    })),
  )
  const document = documents.find((candidate) => candidate.id === id)
  const relativePath = paths.get(id)
  if (!document || !relativePath) return null
  return buildEntry(document, relativePath)
}

/**
 * Like `buildVaultEntries`, but yields to the event loop every batch so a large
 * vault does not freeze the renderer while exporting. `onProgress` reports
 * completion for a progress indicator.
 */
export async function buildVaultEntriesProgressive(
  documents: DocumentRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<VaultWriteEntry[]> {
  const paths = planVaultPaths(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      parentId: document.parentId,
      sortOrder: document.sortOrder,
    })),
  )

  const entries: VaultWriteEntry[] = []
  const batchSize = 20
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index]
    const relativePath = paths.get(document.id)
    if (!relativePath) throw new Error(`No vault path for note ${document.id}`)
    entries.push(buildEntry(document, relativePath))

    if ((index + 1) % batchSize === 0) {
      onProgress?.(index + 1, documents.length)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  onProgress?.(documents.length, documents.length)
  return entries
}

/**
 * Write entries to the vault in batches, yielding between them, so a large vault
 * does not block the main process (and the app) in one long synchronous write.
 */
export async function writeVaultEntriesInBatches(
  directory: string,
  entries: VaultWriteEntry[],
): Promise<number> {
  const batchSize = 100
  let written = 0
  for (let index = 0; index < entries.length; index += batchSize) {
    const batch = entries.slice(index, index + batchSize)
    const result = await window.lychee.invoke("vault.writeEntries", { directory, entries: batch })
    written += result.written
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return written
}

