import type { VaultImportItem, VaultImportRequest } from "@/shared/vault-import"

/**
 * Renderer half of import. Content is stored as markdown; the main process
 * rewrites portable `assets/<hash>` references to local image ids when it
 * imports, so no Lexical conversion is needed here.
 */
export function buildImportRequests(items: VaultImportItem[]): VaultImportRequest[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    content: item.body,
    parentId: item.parentId,
    emoji: item.emoji,
    bookmarkedAt: item.bookmarkedAt,
    sortOrder: item.order,
    createdAt: item.created,
    updatedAt: item.updated,
    contentSchemaVersion: item.contentSchemaVersion,
  }))
}
