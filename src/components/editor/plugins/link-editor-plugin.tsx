"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  createCommand,
  type RangeSelection,
} from "lexical"
import { $createLinkNode, $isLinkNode, $toggleLink } from "@lexical/link"
import { createDOMRange } from "@lexical/selection"
import { mergeRegister } from "@lexical/utils"
import { FileText, Link, X } from "lucide-react"

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  captureLinkSelection,
  withRestoredLinkSelection,
  type RestoredSelectionInfo,
} from "@/components/editor/plugins/link-selection"
import { onToolbarExclusive } from "@/components/lexical-editor"
import { useDocumentStore } from "@/renderer/document-store"
import {
  createInternalNoteUrl,
  INTERNAL_NOTE_REL,
  parseInternalNoteUrl,
  rankNoteLinkCandidates,
} from "@/shared/internal-note-link"

export const OPEN_LINK_EDITOR_COMMAND = createCommand<void>("OPEN_LINK_EDITOR_COMMAND")

const LINK_SELECTION_HIGHLIGHT = "lychee-link-selection"
let activeHighlightOwner: symbol | null = null

type SelectionOverlayRect = {
  top: number
  left: number
  width: number
  height: number
}

function showLinkSelectionHighlight(
  editor: Parameters<typeof createDOMRange>[0],
  selection: RangeSelection,
  owner: symbol,
): SelectionOverlayRect[] {
  if (selection.isCollapsed()) return []

  const range = createDOMRange(
    editor,
    selection.anchor.getNode(),
    selection.anchor.offset,
    selection.focus.getNode(),
    selection.focus.offset,
  )
  if (!range) return []

  if (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  ) {
    CSS.highlights.set(LINK_SELECTION_HIGHLIGHT, new Highlight(range))
    activeHighlightOwner = owner
    return []
  }

  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }))
}

function clearLinkSelectionHighlight(owner: symbol) {
  if (activeHighlightOwner !== owner) return
  CSS.highlights.delete(LINK_SELECTION_HIGHLIGHT)
  activeHighlightOwner = null
}

/**
 * Browser engines do not consistently return a usable rect for a collapsed
 * Range. Electron can return an all-zero rect, which causes a fixed popover
 * anchor to be placed at the top-left corner of the window. When that happens,
 * derive the caret position from an adjacent character or its containing block.
 */
function getLinkEditorAnchorRect(range: Range, editorRoot: HTMLElement | null): DOMRect {
  const rangeRect = range.getBoundingClientRect()
  const rangeElement = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as HTMLElement
    : range.startContainer.parentElement
  const rangeStyles = rangeElement ? getComputedStyle(rangeElement) : null
  const computedLineHeight = rangeStyles ? Number.parseFloat(rangeStyles.lineHeight) : Number.NaN
  const fallbackLineHeight = rangeStyles
    ? Number.parseFloat(rangeStyles.fontSize) * 1.4
    : 0
  const lineHeight = Number.isFinite(computedLineHeight) && computedLineHeight > 0
    ? computedLineHeight
    : fallbackLineHeight

  if (rangeRect.height > 0) {
    return new DOMRect(
      rangeRect.left,
      rangeRect.top,
      0,
      Math.max(rangeRect.height, lineHeight),
    )
  }

  const { startContainer, startOffset } = range
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent ?? ""
    const characterRange = document.createRange()
    const hasCaretPosition = rangeRect.left !== 0 || rangeRect.top !== 0

    if (startOffset > 0) {
      characterRange.setStart(startContainer, startOffset - 1)
      characterRange.setEnd(startContainer, startOffset)
      const characterRect = characterRange.getBoundingClientRect()
      if (characterRect.width > 0 || characterRect.height > 0) {
        return new DOMRect(
          hasCaretPosition ? rangeRect.left : characterRect.right,
          characterRect.top,
          0,
          Math.max(characterRect.height, lineHeight),
        )
      }
    } else if (startOffset < text.length) {
      characterRange.setStart(startContainer, startOffset)
      characterRange.setEnd(startContainer, startOffset + 1)
      const characterRect = characterRange.getBoundingClientRect()
      if (characterRect.width > 0 || characterRect.height > 0) {
        return new DOMRect(
          hasCaretPosition ? rangeRect.left : characterRect.left,
          characterRect.top,
          0,
          Math.max(characterRect.height, lineHeight),
        )
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

export function LinkEditorPlugin({ documentId }: { documentId: string }) {
  const [editor] = useLexicalComposerContext()
  const documents = useDocumentStore((state) => state.documents)
  const [isOpen, setIsOpen] = useState(false)
  const [initialUrl, setInitialUrl] = useState("")
  const [query, setQuery] = useState("")
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const [selectionOverlayRects, setSelectionOverlayRects] = useState<SelectionOverlayRect[]>([])
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const savedSelectionRef = useRef<RangeSelection | null>(null)
  const highlightOwnerRef = useRef(Symbol("link-selection-highlight"))
  const resultsId = useId()

  const noteCandidates = useMemo(
    () => rankNoteLinkCandidates(documents, query, documentId),
    [documents, documentId, query],
  )

  useEffect(() => {
    if (!isOpen) return
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [isOpen])

  useEffect(() => {
    setActiveCandidateIndex((index) => Math.min(index, Math.max(0, noteCandidates.length - 1)))
  }, [noteCandidates.length])

  const clearSelectionHighlight = useCallback(() => {
    clearLinkSelectionHighlight(highlightOwnerRef.current)
    setSelectionOverlayRects([])
  }, [])

  useEffect(() => {
    const owner = highlightOwnerRef.current
    return () => clearLinkSelectionHighlight(owner)
  }, [])

  const closeLinkEditor = useCallback((
    refocusEditor = false,
    restoreSelection = false,
  ) => {
    const selectionToRestore = savedSelectionRef.current
    setIsOpen(false)
    clearSelectionHighlight()
    savedSelectionRef.current = null
    if (refocusEditor) {
      requestAnimationFrame(() => {
        editor.getRootElement()?.focus({ preventScroll: true })
        if (restoreSelection && selectionToRestore) {
          withRestoredLinkSelection(editor, selectionToRestore, () => {})
        }
      })
    }
  }, [clearSelectionHighlight, editor])

  const runWithSavedSelection = useCallback((
    apply: (selection: RangeSelection, info: RestoredSelectionInfo) => void,
  ): RestoredSelectionInfo | null => {
    return withRestoredLinkSelection(editor, savedSelectionRef.current, apply)
  }, [editor])

  const openLinkEditor = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      const capturedSelection = captureLinkSelection(selection)
      savedSelectionRef.current = capturedSelection
      clearLinkSelectionHighlight(highlightOwnerRef.current)
      setSelectionOverlayRects(showLinkSelectionHighlight(
        editor,
        capturedSelection,
        highlightOwnerRef.current,
      ))

      // Check if we're in a link
      const nodes = selection.getNodes()
      let existingUrl = ""
      for (const node of nodes) {
        const link = $isLinkNode(node) ? node : node.getParent()
        if ($isLinkNode(link)) {
          existingUrl = link.getURL()
          break
        }
      }
      setInitialUrl(existingUrl)
      // Show a readable title when editing an internal link. The UUID remains
      // in initialUrl so changing/removing the link still targets the node.
      const internalTarget = parseInternalNoteUrl(existingUrl)
      const internalDocument = internalTarget
        ? documents.find((document) => document.id === internalTarget.documentId)
        : undefined
      setQuery(internalDocument?.title.trim() || existingUrl)
      setActiveCandidateIndex(0)

      // Build a collapsed DOM range from Lexical's focus point. The browser's
      // native selection can lag behind (or already be moving toward the popup
      // input), which makes its rectangle an unreliable popover anchor.
      const cursorNode = selection.focus.getNode()
      const range = createDOMRange(
        editor,
        cursorNode,
        selection.focus.offset,
        cursorNode,
        selection.focus.offset,
      )
      if (!range) return

      const rect = getLinkEditorAnchorRect(range, editor.getRootElement())
      setAnchorRect(rect)
      setIsOpen(true)
    })
  }, [documents, editor])

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
            closeLinkEditor(true, true)
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      )
    )

    // Dismiss on tab switch so popover doesn't bleed into duplicate tabs
    const unsubTabSwitch = onToolbarExclusive("__link-editor__", () => {
      closeLinkEditor()
    })

    return () => {
      unregister()
      unsubTabSwitch()
    }
  }, [editor, openLinkEditor, isOpen, closeLinkEditor])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const enteredUrl = query.trim()
      if (!enteredUrl) return

      const finalUrl = enteredUrl.startsWith("http://") || enteredUrl.startsWith("https://") || enteredUrl.startsWith("mailto:")
        ? enteredUrl
        : `https://${enteredUrl}`
      const applied = runWithSavedSelection((selection, restoredInfo) => {
        if (!initialUrl && restoredInfo.isCollapsed) {
          const link = $createLinkNode(finalUrl)
          link.append($createTextNode(enteredUrl))
          selection.insertNodes([link])
        } else {
          $toggleLink(finalUrl)
        }
      })

      if (applied) closeLinkEditor(true)
    },
    [closeLinkEditor, initialUrl, query, runWithSavedSelection]
  )

  const handleNoteSelect = useCallback(
    (targetDocumentId: string, targetTitle: string) => {
      const internalUrl = createInternalNoteUrl(targetDocumentId)
      const applied = runWithSavedSelection((selection, restoredInfo) => {
        if (!initialUrl && restoredInfo.isCollapsed) {
          const link = $createLinkNode(internalUrl, { rel: INTERNAL_NOTE_REL })
          link.append($createTextNode(targetTitle))
          selection.insertNodes([link])
        } else {
          // Preserve selected or existing link text; only change its destination.
          $toggleLink({
            url: internalUrl,
            rel: INTERNAL_NOTE_REL,
          })
        }
      })

      if (applied) closeLinkEditor(true)
    },
    [closeLinkEditor, initialUrl, runWithSavedSelection],
  )

  const handleRemove = useCallback(() => {
    const removed = runWithSavedSelection(() => $toggleLink(null))
    if (removed) closeLinkEditor(true)
  }, [closeLinkEditor, runWithSavedSelection])

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeLinkEditor(true, true)
      return
    }
    if (event.key === "ArrowDown" && noteCandidates.length > 0) {
      event.preventDefault()
      setActiveCandidateIndex((index) => (index + 1) % noteCandidates.length)
      return
    }
    if (event.key === "ArrowUp" && noteCandidates.length > 0) {
      event.preventDefault()
      setActiveCandidateIndex((index) => (index - 1 + noteCandidates.length) % noteCandidates.length)
      return
    }
    if (event.key === "Enter" && noteCandidates.length > 0) {
      event.preventDefault()
      const candidate = noteCandidates[activeCandidateIndex]
      if (candidate) {
        handleNoteSelect(candidate.document.id, candidate.displayTitle)
      }
    }
  }, [activeCandidateIndex, closeLinkEditor, handleNoteSelect, noteCandidates])

  return (
    <>
      {isOpen && selectionOverlayRects.length > 0 && createPortal(
        <div
          aria-hidden="true"
          data-link-selection-overlay
          className="pointer-events-none fixed inset-0 z-40"
        >
          {selectionOverlayRects.map((rect, index) => (
            <span
              key={`${rect.left}-${rect.top}-${index}`}
              className="absolute rounded-[2px] opacity-45"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                backgroundColor: "Highlight",
              }}
            />
          ))}
        </div>,
        document.body,
      )}
      <Popover
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeLinkEditor()
      }}
    >
      <PopoverAnchor
        style={{
          position: "fixed",
          top: anchorRect?.bottom ?? 0,
          left: anchorRect && typeof window !== "undefined"
            ? Math.max(
                16,
                Math.min(
                  anchorRect.left,
                  window.innerWidth - Math.min(380, window.innerWidth - 32) - 16,
                ),
              )
            : anchorRect?.left ?? 0,
          width: anchorRect?.width ?? 0,
          height: 0,
        }}
      />
      <PopoverContent
        className="w-[min(380px,calc(100vw-2rem))] overflow-hidden p-0 !animate-none"
        side="bottom"
        align="start"
        sideOffset={20}
        avoidCollisions={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus({ preventScroll: true })
          inputRef.current?.select()
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          closeLinkEditor(true, true)
        }}
      >
        <form onSubmit={handleSubmit}>
          <div className="flex items-center gap-2 p-2">
            <Link className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveCandidateIndex(0)
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="Search notes or enter URL..."
              aria-label="Search notes or enter URL"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={noteCandidates.length > 0}
              aria-controls={resultsId}
              aria-activedescendant={noteCandidates[activeCandidateIndex]
                ? `${resultsId}-${noteCandidates[activeCandidateIndex].document.id}`
                : undefined}
              className="h-8 min-w-0 flex-1"
            />
            <Button type="submit" size="sm" className="h-8" disabled={!query.trim()}>
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
                aria-label="Remove link"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div
            id={resultsId}
            role="listbox"
            aria-label={query.trim() ? "Matching notes" : "Recent notes"}
            className="max-h-56 overflow-y-auto border-t border-[hsl(var(--border))] p-1"
          >
            {noteCandidates.length > 0 ? noteCandidates.map(({ document, displayTitle }, index) => (
              <button
                key={document.id}
                id={`${resultsId}-${document.id}`}
                type="button"
                role="option"
                aria-selected={index === activeCandidateIndex}
                data-note-link-id={document.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveCandidateIndex(index)}
                onClick={() => handleNoteSelect(document.id, displayTitle)}
                className={
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors " +
                  (index === activeCandidateIndex
                    ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                    : "hover:bg-[hsl(var(--accent))]")
                }
              >
                {document.emoji ? (
                  <span className="text-base leading-none">{document.emoji}</span>
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                )}
                <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
              </button>
            )) : (
              <div className="px-2 py-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
                {query.trim() ? "No matching notes." : "No other notes yet."}
              </div>
            )}
          </div>
        </form>
      </PopoverContent>
      </Popover>
    </>
  )
}
