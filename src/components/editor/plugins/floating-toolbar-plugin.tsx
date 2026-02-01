"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  LexicalEditor,
} from "lexical"
import { $isLinkNode } from "@lexical/link"
import { mergeRegister } from "@lexical/utils"
import { OPEN_LINK_EDITOR_COMMAND } from "./link-editor-plugin"
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
} from "lucide-react"
import { Toggle } from "@/components/ui/toggle"

function FloatingToolbar({
  editor,
}: {
  editor: LexicalEditor
}) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)
  const [isStrikethrough, setIsStrikethrough] = useState(false)
  const [isCode, setIsCode] = useState(false)
  const [isLink, setIsLink] = useState(false)

  const updateToolbar = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        setIsVisible(false)
        return
      }

      const text = selection.getTextContent()
      if (!text || text.length === 0 || selection.isCollapsed()) {
        setIsVisible(false)
        return
      }

      // Update format states
      setIsBold(selection.hasFormat("bold"))
      setIsItalic(selection.hasFormat("italic"))
      setIsUnderline(selection.hasFormat("underline"))
      setIsStrikethrough(selection.hasFormat("strikethrough"))
      setIsCode(selection.hasFormat("code"))

      // Check for link
      const nodes = selection.getNodes()
      const isLinkActive = nodes.some((node) => {
        const parent = node.getParent()
        return $isLinkNode(parent)
      })
      setIsLink(isLinkActive)

      // Get position from native selection
      const nativeSelection = window.getSelection()
      if (!nativeSelection || nativeSelection.rangeCount === 0) {
        setIsVisible(false)
        return
      }

      const range = nativeSelection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      if (rect.width === 0 || rect.height === 0) {
        setIsVisible(false)
        return
      }

      // Position above the selection
      const toolbarWidth = 250 // approximate width
      const left = rect.left + rect.width / 2 - toolbarWidth / 2
      const top = rect.top - 45

      setPosition({
        top: Math.max(top, 10),
        left: Math.max(left, 10),
      })
      setIsVisible(true)
    })
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar()
        })
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar()
          return false
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [editor, updateToolbar])

  // Hide on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        // Don't hide immediately - let selection change handle it
      }
    }

    document.addEventListener("mousedown", handleMouseDown)
    return () => document.removeEventListener("mousedown", handleMouseDown)
  }, [])

  const handleFormat = useCallback(
    (format: "bold" | "italic" | "underline" | "strikethrough" | "code") => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
    },
    [editor]
  )

  const handleLink = useCallback(() => {
    editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined)
  }, [editor])

  if (!isVisible) return null

  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      <Toggle
        size="sm"
        pressed={isBold}
        onPressedChange={() => handleFormat("bold")}
        aria-label="Bold"
      >
        <Bold className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={isItalic}
        onPressedChange={() => handleFormat("italic")}
        aria-label="Italic"
      >
        <Italic className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={isUnderline}
        onPressedChange={() => handleFormat("underline")}
        aria-label="Underline"
      >
        <Underline className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={isStrikethrough}
        onPressedChange={() => handleFormat("strikethrough")}
        aria-label="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={isCode}
        onPressedChange={() => handleFormat("code")}
        aria-label="Code"
      >
        <Code className="h-4 w-4" />
      </Toggle>
      <div className="mx-1 h-6 w-px bg-border" />
      <Toggle
        size="sm"
        pressed={isLink}
        onPressedChange={handleLink}
        aria-label="Link"
      >
        <Link className="h-4 w-4" />
      </Toggle>
    </div>,
    document.body
  )
}

export function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext()
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const updateRootElement = () => {
      setRootElement(editor.getRootElement())
    }
    updateRootElement()
    return editor.registerRootListener(updateRootElement)
  }, [editor])

  if (!rootElement) return null

  return <FloatingToolbar editor={editor} />
}
