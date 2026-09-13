import { createHeadlessEditor } from "@lexical/headless"

import { nodes } from "@/components/editor/nodes"
import { $importDocumentMarkdown, exportDocumentMarkdown } from "@/components/editor/markdown-io"
import { parseDocumentContent } from "@/components/editor/content-load"
import { useDocumentStore } from "@/renderer/document-store"
import type { VaultFileChangedEvent } from "@/shared/vault-watch"

/**
 * Watcher bridge: main detects a file change and classifies it; the renderer
 * converts markdown → Lexical content (the node modules are React-coupled and
 * cannot load in main) and calls back so main persists it.
 */

function makeEditor() {
  return createHeadlessEditor({
    namespace: "vault-watch",
    nodes,
    onError: (error) => {
      throw error
    },
  })
}

/** External markdown body → stored markdown content plus its canonical form. */
function convertBody(body: string): { content: string; bodyMarkdown: string } {
  const editor = makeEditor()
  editor.update(
    () => {
      $importDocumentMarkdown(body)
    },
    { discrete: true },
  )
  const bodyMarkdown = exportDocumentMarkdown(editor)
  return { content: bodyMarkdown, bodyMarkdown }
}

/** The note's stored content → its canonical markdown form (for conflict restore). */
function canonicalFromContent(content: string): string {
  const editor = makeEditor()
  const load = parseDocumentContent({ content })
  if (load.status !== "ready") return ""
  editor.setEditorState(editor.parseEditorState(JSON.stringify(load.editorState)))
  return exportDocumentMarkdown(editor)
}

export async function handleVaultFileChanged(event: VaultFileChangedEvent): Promise<void> {
  if (event.action === "import") {
    const { content, bodyMarkdown } = convertBody(event.body)
    await window.lychee.invoke("vault.resolveExternalChange", {
      action: "import",
      id: event.id,
      relativePath: event.relativePath,
      title: event.title,
      parentId: event.parentId,
      sortOrder: event.sortOrder,
      emoji: event.emoji ?? null,
      bookmarkedAt: event.bookmarkedAt ?? null,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      contentSchemaVersion: event.contentSchemaVersion,
      content,
      bodyMarkdown,
    })
    await useDocumentStore.getState().loadDocuments(true)
    return
  }

  if (event.action === "apply") {
    const { content, bodyMarkdown } = convertBody(event.body)
    await window.lychee.invoke("vault.resolveExternalChange", {
      action: "apply",
      id: event.id,
      relativePath: event.relativePath,
      title: event.title,
      emoji: event.emoji ?? null,
      bookmarkedAt: event.bookmarkedAt ?? null,
      sortOrder: event.sortOrder,
      updatedAt: event.updatedAt,
      content,
      bodyMarkdown,
    })
    await useDocumentStore.getState().loadDocuments(true)
    // Let an open editor refresh itself from the new content (only if clean).
    window.dispatchEvent(new CustomEvent("lychee-vault-applied", { detail: { id: event.id } }))
    return
  }

  if (event.action === "delete") {
    const store = useDocumentStore.getState()
    const removed = new Set(event.ids)
    for (const tab of store.openTabs) {
      if (removed.has(tab.docId)) store.closeTab(tab.tabId, { skipHistory: true })
    }
    await store.loadDocuments(true)
    return
  }

  if (event.action === "sync") {
    const store = useDocumentStore.getState()
    const removed = new Set(event.ids)
    for (const tab of store.openTabs) {
      if (removed.has(tab.docId)) store.closeTab(tab.tabId, { skipHistory: true })
    }
    await store.loadDocuments(true)
    return
  }

  const bodyMarkdown = canonicalFromContent(event.existingContent)
  await window.lychee.invoke("vault.resolveExternalChange", {
    action: "conflict",
    id: event.id,
    relativePath: event.relativePath,
    conflictContents: event.body,
    bodyMarkdown,
  })
}

/** Subscribe to watcher events. Returns an unsubscribe function. */
export function registerVaultWatcherBridge(): () => void {
  return window.lychee.on("vault:file-changed", (event) => {
    void handleVaultFileChanged(event)
  })
}
