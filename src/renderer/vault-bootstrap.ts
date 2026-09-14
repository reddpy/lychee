import { listAllDocuments } from "./document-io"
import { useDocumentStore } from "./document-store"
import { buildVaultEntriesProgressive, writeVaultEntriesInBatches } from "./vault-export"

/**
 * Ensures the user's notes exist as physical markdown files, with no setup step,
 * and keeps the vault and the app watching each other (bidirectional edits).
 *
 * On launch main creates the vault directory (default `~/Documents/Lychee`) and
 * reports whether it still needs the existing notes written into it. We export
 * progressively (never blocking the UI) and then start watching so external
 * edits — an editor, MCP, or a cloud-sync client — reconcile back. Watching is
 * the default; only an explicit opt-out disables it.
 */
export async function bootstrapVault(): Promise<void> {
  try {
    const { directory, needsExport, needsRefresh, watchEnabled } = await window.lychee.invoke(
      "vault.bootstrap",
      {},
    )

    if (needsExport || needsRefresh) {
      const entries = await buildVaultEntriesProgressive(await listAllDocuments())
      await writeVaultEntriesInBatches(directory, entries)
    }

    // Start watching only after any initial export, so the files we just wrote
    // are not re-imported as external additions.
    if (watchEnabled) {
      await window.lychee.invoke("vault.watchStart", { directory })
    }

    // Bootstrap may have rebuilt the index from the files (empty/lost DB). Reload
    // so the sidebar reflects it even if the mount-time load ran first and the
    // watcher has no changes to emit.
    await useDocumentStore.getState().loadDocuments(true)
  } catch (error) {
    console.error("[vault] bootstrap failed", error)
  }
}
