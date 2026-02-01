"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  createCommand,
} from "lexical"
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link"
import { mergeRegister } from "@lexical/utils"
import { Link, X } from "lucide-react"

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export const OPEN_LINK_EDITOR_COMMAND = createCommand<void>("OPEN_LINK_EDITOR_COMMAND")

export function LinkEditorPlugin() {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [initialUrl, setInitialUrl] = useState("")
  const [url, setUrl] = useState("")
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setUrl(initialUrl)
  }, [initialUrl])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    }
  }, [isOpen])

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
      setAnchorRect(rect)
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

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (url.trim()) {
        const finalUrl = url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")
          ? url
          : `https://${url}`
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, finalUrl)
      }
      setIsOpen(false)
    },
    [editor, url]
  )

  const handleRemove = useCallback(() => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
    setIsOpen(false)
  }, [editor])

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverAnchor
        style={{
          position: "fixed",
          top: anchorRect?.bottom ?? 0,
          left: anchorRect?.left ?? 0,
          width: anchorRect?.width ?? 0,
          height: 0,
        }}
      />
      <PopoverContent
        className="w-auto p-2"
        side="bottom"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <Link className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter URL..."
            className="h-8 w-[220px] text-sm"
          />
          <Button type="submit" size="sm" className="h-8">
            Apply
          </Button>
          {initialUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleRemove}
              title="Remove link"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}
