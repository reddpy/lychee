import type { DocumentRow } from "@/shared/documents"

/** Every note with full content, via paginated IPC. */
export async function listAllDocuments(): Promise<DocumentRow[]> {
  const all: DocumentRow[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { documents } = await window.lychee.invoke("documents.list", {
      limit: pageSize,
      offset,
    })
    all.push(...documents)
    if (documents.length < pageSize) break
  }
  return all
}
