import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createNodeSelection,
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  DROP_COMMAND,
  DRAGOVER_COMMAND,
  PASTE_COMMAND,
  type LexicalCommand,
} from "lexical"
import { $insertNodeToNearestRoot } from "@lexical/utils"
import { $createImageNode, ImageNode, $isImageNode, type CreateImageNodeParams } from "@/components/editor/nodes/image-node"

const IMAGE_MARKDOWN_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/

export const INSERT_IMAGE_COMMAND: LexicalCommand<CreateImageNodeParams> = createCommand("INSERT_IMAGE")

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

function isExternalUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://")
}

function isImageFile(file: File): boolean {
  return IMAGE_MIME_TYPES.has(file.type)
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function saveImageAndUpdate(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  nodeKey: string,
  file: File,
) {
  const base64 = await readFileAsBase64(file)
  const { id, filePath } = await window.lychee.invoke("images.save", {
    data: base64,
    mimeType: file.type,
  })

  editor.update(() => {
    const node = $getNodeByKey(nodeKey)
    if (!$isImageNode(node)) return
    node.setImageId(id)
    node.setSrc(filePath)
    node.setLoading(false)
    const selection = $getSelection()
    if (!selection || ($isNodeSelection(selection) && selection.has(nodeKey))) {
      const nodeSelection = $createNodeSelection()
      nodeSelection.add(nodeKey)
      $setSelection(nodeSelection)
    }
  }, { tag: "history-merge" })
}

const downloadingNodes = new Set<string>()

async function downloadAndSaveImage(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  nodeKey: string,
  url: string,
) {
  if (downloadingNodes.has(nodeKey)) return
  downloadingNodes.add(nodeKey)
  try {
    // Download via main process to bypass renderer CSP
    const { id, filePath } = await window.lychee.invoke("images.download", { url })
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isImageNode(node)) return
      node.setImageId(id)
      node.setSrc(filePath)
      node.setSourceUrl(url)
      node.setLoading(false)
    }, { tag: "history-merge" })
  } catch {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isImageNode(node)) return
      node.setSrc("")
      node.setSourceUrl(url)
      node.setLoading(false)
    }, { tag: "history-merge" })
  } finally {
    downloadingNodes.delete(nodeKey)
  }
}

function getImageFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files).filter(isImageFile)
}

export function ImagePlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // INSERT_IMAGE_COMMAND: insert a node (optionally in loading state)
    const removeInsertCommand = editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      (payload) => {
        const imageNode = $createImageNode(payload)
        $insertNodeToNearestRoot(imageNode)
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    )

    // DROP_COMMAND: handle image file drops
    const removeDropCommand = editor.registerCommand(
      DROP_COMMAND,
      (event) => {
        const files = event.dataTransfer ? getImageFiles(event.dataTransfer) : []
        if (files.length === 0) return false

        event.preventDefault()

        for (const file of files) {
          // Insert a loading placeholder immediately (already in update context)
          const node = $createImageNode({ loading: true })
          $insertNodeToNearestRoot(node)
          // Save file in background, then update the node
          saveImageAndUpdate(editor, node.getKey(), file)
        }

        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    // DRAGOVER_COMMAND: allow dropping
    const removeDragOverCommand = editor.registerCommand(
      DRAGOVER_COMMAND,
      (event) => {
        const hasFiles = event.dataTransfer?.types.includes("Files") ?? false
        if (hasFiles) {
          event.preventDefault()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )

    // PASTE_COMMAND: handle image pastes
    const removePasteCommand = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null
        if (!clipboardData) return false

        const files = getImageFiles(clipboardData)
        if (files.length === 0) return false

        event.preventDefault()

        for (const file of files) {
          // Already in update context from command handler
          const node = $createImageNode({ loading: true })
          $insertNodeToNearestRoot(node)
          saveImageAndUpdate(editor, node.getKey(), file)
        }

        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    // PASTE_COMMAND: handle pasted markdown image syntax (e.g. ![alt](url))
    const removeMarkdownPasteCommand = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null
        if (!clipboardData) return false

        const text = clipboardData.getData("text/plain").trim()
        const match = text.match(IMAGE_MARKDOWN_RE)
        if (!match) return false

        event.preventDefault()
        const [, altText, src] = match
        const isExternal = isExternalUrl(src)
        const imageNode = $createImageNode({ src, altText, loading: isExternal })
        $insertNodeToNearestRoot(imageNode)
        // Download is triggered by the mutation listener
        return true
      },
      COMMAND_PRIORITY_LOW,
    )

    // Always ensure a paragraph exists after every image so the cursor
    // has somewhere to land.  Also download external URL images locally.
    const removeMutationListener = editor.registerMutationListener(
      ImageNode,
      (mutations) => {
        editor.update(() => {
          for (const [key, type] of mutations) {
            if (type === "destroyed") continue
            const node = $getNodeByKey(key)
            if (!$isImageNode(node)) continue

            // Ensure trailing paragraph
            const next = node.getNextSibling()
            if (!next || $isImageNode(next)) {
              node.insertAfter($createParagraphNode())
            }

            // Download external URL images locally (e.g. from markdown shortcut or paste)
            if (type === "created") {
              const src = node.__src
              if (src && !node.__imageId && isExternalUrl(src)) {
                if (!node.__loading) node.setLoading(true)
                downloadAndSaveImage(editor, key, src)
              }
            }

            // Undo can restore a node stuck in loading state — remove it
            if (type === "updated" && node.__loading && !node.__imageId) {
              node.remove()
            }
          }
        }, { tag: "history-merge" })
      },
    )

    return () => {
      removeInsertCommand()
      removeDropCommand()
      removeDragOverCommand()
      removePasteCommand()
      removeMarkdownPasteCommand()
      removeMutationListener()
    }
  }, [editor])

  return null
}
