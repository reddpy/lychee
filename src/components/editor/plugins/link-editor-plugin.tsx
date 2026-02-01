"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  LexicalEditor,
  createCommand,
} from "lexical"
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link"
import { mergeRegister } from "@lexical/utils"
import { Link, X } from "lucide-react"

export const OPEN_LINK_EDITOR_COMMAND = createCommand<void>("OPEN_LINK_EDITOR_COMMAND")

function LinkEditorPopover({
  editor,
  isOpen,
  onClose,
  initialUrl,
  position,
}: {
  editor: LexicalEditor
  isOpen: boolean
  onClose: () => void
  initialUrl: string
  position: { top: number; left: number }
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(initialUrl)

  useEffect(() => {
    setUrl(initialUrl)
  }, [initialUrl])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (url.trim()) {
        const finalUrl = url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")
          ? url
          : `https://${url}`
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, finalUrl)
      }
      onClose()
    },
    [editor, url, onClose]
  )

  const handleRemove = useCallback(() => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    onClose()
  }, [editor, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    },
    [onClose]
  )

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed z-[100] flex items-center gap-1 rounded-lg border bg-popover p-1.5 shadow-lg"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      <Link className="h-4 w-4 text-muted-foreground ml-1" />
      <form onSubmit={handleSubmit} className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter URL..."
          className="w-[200px] bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          className="rounded px-2 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Apply
        </button>
        {initialUrl && (
          <button
            type="button"
            onClick={handleRemove}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Remove link"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>
    </div>,
    document.body
  )
}

export function LinkEditorPlugin() {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [initialUrl, setInitialUrl] = useState("")

  const openLinkEditor = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      // Check if we're in a link
      const nodes = selection.getNodes()
      let existingUrl = ""
      for (const node of nodes) {
        const parent = node.getParent()
        if ($isLinkNode(parent)) {
          existingUrl = parent.getURL()
          break
        }
      }
      setInitialUrl(existingUrl)

      // Get position from native selection
      const nativeSelection = window.getSelection()
      if (!nativeSelection || nativeSelection.rangeCount === 0) return

      const range = nativeSelection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      setPosition({
        top: rect.bottom + 8,
        left: rect.left,
      })
      setIsOpen(true)
    })
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        OPEN_LINK_EDITOR_COMMAND,
        () => {
          openLinkEditor()
          return true
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (isOpen) {
            setIsOpen(false)
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [editor, openLinkEditor, isOpen])

  return (
    <LinkEditorPopover
      editor={editor}
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      initialUrl={initialUrl}
      position={position}
    />
  )
}
