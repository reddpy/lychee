"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  createCommand,
} from "lexical"
import { $createLinkNode, $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link"
import { mergeRegister } from "@lexical/utils"
import { Link, X } from "lucide-react"

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { onToolbarExclusive } from "@/components/lexical-editor"

export const OPEN_LINK_EDITOR_COMMAND = createCommand<void>("OPEN_LINK_EDITOR_COMMAND")

/**
 * Browser engines do not consistently return a usable rect for a collapsed
 * Range. Electron can return an all-zero rect, which causes a fixed popover
 * anchor to be placed at the top-left corner of the window. When that happens,
 * derive the caret position from an adjacent character or its containing block.
 */
function getLinkEditorAnchorRect(range: Range, editorRoot: HTMLElement | null): DOMRect {
  const rangeRect = range.getBoundingClientRect()
  if (rangeRect.width > 0 || rangeRect.height > 0 || rangeRect.left !== 0 || rangeRect.top !== 0) {
    return rangeRect
  }

  const { startContainer, startOffset } = range
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent ?? ""
    const characterRange = document.createRange()

    if (startOffset > 0) {
      characterRange.setStart(startContainer, startOffset - 1)
      characterRange.setEnd(startContainer, startOffset)
      const characterRect = characterRange.getBoundingClientRect()
      if (characterRect.width > 0 || characterRect.height > 0) {
        return new DOMRect(characterRect.right, characterRect.top, 0, characterRect.height)
      }
    } else if (startOffset < text.length) {
      characterRange.setStart(startContainer, startOffset)
      characterRange.setEnd(startContainer, startOffset + 1)
      const characterRect = characterRange.getBoundingClientRect()
      if (characterRect.width > 0 || characterRect.height > 0) {
        return new DOMRect(characterRect.left, characterRect.top, 0, characterRect.height)
      }
    }
  }

  // Empty paragraphs have no adjacent character. Their block still gives us
  // the correct line position, unlike the native collapsed range.
  const block = startContainer.nodeType === Node.ELEMENT_NODE
    ? startContainer as HTMLElement
    : startContainer.parentElement
  const blockRect = block?.getBoundingClientRect() ?? editorRoot?.getBoundingClientRect()
  if (blockRect) {
    return new DOMRect(blockRect.left, blockRect.top, 0, blockRect.height)
  }

  return rangeRect
}

export function LinkEditorPlugin() {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const [initialUrl, setInitialUrl] = useState("")
  const [url, setUrl] = useState("")
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
      // Reset on every open. `existingUrl` can be an unchanged empty string,
      // in which case an effect watching `initialUrl` would not run and the
      // previous dialog's URL would remain in the input.
      setUrl(existingUrl)

      // Get position from native selection
      const nativeSelection = window.getSelection()
      if (!nativeSelection || nativeSelection.rangeCount === 0) return

      const range = nativeSelection.getRangeAt(0)
      const rect = getLinkEditorAnchorRect(range, editor.getRootElement())
      setAnchorRect(rect)
      setIsOpen(true)
    })
  }, [editor])

  useEffect(() => {
    const unregister = mergeRegister(
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

    // Dismiss on tab switch so popover doesn't bleed into duplicate tabs
    const unsubTabSwitch = onToolbarExclusive("__link-editor__", () => {
      setIsOpen(false)
    })

    return () => {
      unregister()
      unsubTabSwitch()
    }
  }, [editor, openLinkEditor, isOpen])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const enteredUrl = url.trim()
      if (enteredUrl) {
        const finalUrl = enteredUrl.startsWith("http://") || enteredUrl.startsWith("https://") || enteredUrl.startsWith("mailto:")
          ? enteredUrl
          : `https://${enteredUrl}`
        const insertUrlAsText = editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
          return selection.anchor.getNode().getTopLevelElement()?.getTextContent().length === 0
        })

        if (insertUrlAsText) {
          editor.update(() => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

            const link = $createLinkNode(finalUrl)
            link.append($createTextNode(enteredUrl))
            selection.insertNodes([link])
          })
        } else {
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, finalUrl)
        }
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
