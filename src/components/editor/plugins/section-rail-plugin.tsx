"use client"

import { type ReactElement, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getNodeByKey,
  $getRoot,
  $setSelection,
  type LexicalEditor,
  type NodeKey,
  TextNode,
} from "lexical"
import { $isHeadingNode, HeadingNode } from "@lexical/rich-text"
import { $isTitleNode } from "../nodes/title-node"
import { HIGHLIGHT_BLOCK_COMMAND } from "./block-highlight-plugin"
import { cn } from "@/lib/utils"

type HeadingLevel = "h1" | "h2" | "h3"

interface HeadingInfo {
  key: NodeKey
  tag: HeadingLevel
  text: string
}

/** Distance from the scroll container's top edge (px) at which a heading is
 *  considered the "current" section. Roughly the sticky toolbar height plus a
 *  little breathing room. */
const ACTIVE_HEADING_OFFSET = 96

/** Bar width encodes the heading level (h1 widest → h3 narrowest); bars are
 *  right-aligned so the hierarchy reads as an inset stack. */
const BAR_WIDTH: Record<HeadingLevel, string> = {
  h1: "w-6",
  h2: "w-4",
  h3: "w-3",
}
const BAR_HEIGHT_CLASS = "h-[3px]"

const FLYOUT_INDENT: Record<HeadingLevel, number> = {
  h1: 10,
  h2: 22,
  h3: 34,
}

function readHeadings(editor: LexicalEditor): HeadingInfo[] {
  const result: HeadingInfo[] = []
  editor.getEditorState().read(() => {
    for (const node of $getRoot().getChildren()) {
      if (!$isHeadingNode(node)) continue
      const tag = node.getTag()
      if (tag !== "h1" && tag !== "h2" && tag !== "h3") continue
      result.push({ key: node.getKey(), tag, text: node.getTextContent() })
    }
  })
  return result
}

function headingsEqual(a: HeadingInfo[], b: HeadingInfo[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].tag !== b[i].tag || a[i].text !== b[i].text) {
      return false
    }
  }
  return true
}

/**
 * Compact vertical section rail pinned to the right edge of the editor
 * viewport. Each bar represents a heading; the bar for the section currently in
 * view is highlighted as you scroll. Hovering the rail reveals a flyout with
 * the heading titles (mirroring the toolbar's section popup content) so long
 * notes get fast, on-demand navigation without an always-open giant list.
 * Clicking a bar jumps straight to that section.
 */
export function SectionRailPlugin({
  documentId,
  isActive,
}: {
  documentId: string
  isActive: boolean
}): ReactElement | null {
  const [editor] = useLexicalComposerContext()
  const [headings, setHeadings] = useState<HeadingInfo[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  // Popup highlight/scroll target. Normally mirrors the scroll-spy active
  // section, but a rail click snaps it straight to the clicked row so the list
  // jumps into position instead of tracking every intermediate section while
  // the note smooth-scrolls.
  const [selectedIndex, setSelectedIndex] = useState(0)
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const activeIndexRef = useRef(0)
  const selectedIndexRef = useRef(0)
  // While a rail click is smooth-scrolling the note, the popup selection is
  // pinned to the clicked row until the note actually reaches it.
  const programmaticRef = useRef(false)
  const jumpTargetRef = useRef<number | null>(null)

  // Rebuild the heading list on structural changes and on text edits inside
  // headings, mirroring the note drawer's outline detection.
  useEffect(() => {
    const read = () => {
      const next = readHeadings(editor)
      setHeadings((prev) => (headingsEqual(prev, next) ? prev : next))
    }

    const removeHeadingListener = editor.registerMutationListener(HeadingNode, () => read())
    const removeTextListener = editor.registerMutationListener(TextNode, (mutations) => {
      let needsUpdate = false
      editor.getEditorState().read(() => {
        for (const [key] of mutations) {
          const node = $getNodeByKey(key)
          if (!node) continue
          const parent = node.getParent()
          if ($isTitleNode(parent)) continue
          if ($isHeadingNode(parent)) {
            needsUpdate = true
            return
          }
        }
      })
      if (needsUpdate) read()
    })

    read()
    return () => {
      removeHeadingListener()
      removeTextListener()
    }
  }, [editor])

  // Track which heading is at the top of the viewport as the user scrolls.
  // Uses a capture-phase document listener (rather than an element-bound one)
  // to match the scroll-retention convention in lexical-editor.tsx.
  useEffect(() => {
    if (!isActive || headings.length < 2) return
    const root = editor.getRootElement()
    const scrollEl = root?.closest("main") as HTMLElement | null
    if (!scrollEl) return

    let frame = 0
    const compute = () => {
      frame = 0
      const containerTop = scrollEl.getBoundingClientRect().top
      const scrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 4
      const atBottom =
        scrollable &&
        scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2
      let next: number
      // A short final section may never scroll up to the activation line, so
      // treat the true bottom of the note as being "in" the last section.
      if (atBottom) {
        next = headings.length - 1
      } else {
        next = 0
        headings.forEach((heading, index) => {
          const el = editor.getElementByKey(heading.key)
          if (!el) return
          if (el.getBoundingClientRect().top - containerTop <= ACTIVE_HEADING_OFFSET) {
            next = index
          }
        })
      }
      activeIndexRef.current = next
      setActiveIndex((prev) => (prev === next ? prev : next))

      // Hold the popup selection on the clicked row while a rail jump animates,
      // then release once the note reaches it. This prevents the list from
      // stepping through every section it scrolls past.
      if (programmaticRef.current && next === jumpTargetRef.current) {
        programmaticRef.current = false
        jumpTargetRef.current = null
      }
      if (!programmaticRef.current) {
        setSelectedIndex((prev) => (prev === next ? prev : next))
      }
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(compute)
    }
    const onScroll = (event: Event) => {
      if (event.target !== scrollEl) return
      schedule()
    }
    // A manual scroll mid-jump means the user took over: resume following.
    const cancelJump = () => {
      if (!programmaticRef.current) return
      programmaticRef.current = false
      jumpTargetRef.current = null
      setSelectedIndex(activeIndexRef.current)
    }
    const onScrollEnd = () => cancelJump()

    document.addEventListener("scroll", onScroll, true)
    scrollEl.addEventListener("scrollend", onScrollEnd)
    scrollEl.addEventListener("wheel", cancelJump, { passive: true })
    scrollEl.addEventListener("touchstart", cancelJump, { passive: true })
    window.addEventListener("resize", schedule)
    schedule()
    return () => {
      document.removeEventListener("scroll", onScroll, true)
      scrollEl.removeEventListener("scrollend", onScrollEnd)
      scrollEl.removeEventListener("wheel", cancelJump)
      scrollEl.removeEventListener("touchstart", cancelJump)
      window.removeEventListener("resize", schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [editor, headings, isActive])

  // Background tabs shouldn't leave a hover-opened flyout waiting on return.
  useEffect(() => {
    if (!isActive) setIsHovered(false)
  }, [isActive])

  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  const centerPopup = useCallback((index: number) => {
    const panel = flyoutRef.current
    if (!panel) return
    const item = panel.children[index] as HTMLElement | undefined
    if (!item) return
    const centered = item.offsetTop - panel.clientHeight / 2 + item.offsetHeight / 2
    const max = panel.scrollHeight - panel.clientHeight
    panel.scrollTop = Math.max(0, Math.min(centered, max))
  }, [])

  // Centre the selected row once, when the flyout opens. Afterwards rail clicks
  // jump it directly; it does not follow the scroll-spy.
  useEffect(() => {
    if (!isHovered) return
    const frame = requestAnimationFrame(() => centerPopup(selectedIndexRef.current))
    return () => cancelAnimationFrame(frame)
  }, [isHovered, centerPopup])

  const handleJump = useCallback(
    (key: NodeKey) => {
      const dom = editor.getElementByKey(key)
      if (!dom) return
      dom.scrollIntoView({ behavior: "smooth", block: "start" })
      editor.dispatchCommand(HIGHLIGHT_BLOCK_COMMAND, dom)
    },
    [editor],
  )

  // Rail click: snap the popup to the clicked row immediately (no progressive
  // selection), then smooth-scroll the note. The rail keeps tracking normally.
  const handleRailJump = useCallback(
    (key: NodeKey, index: number) => {
      setSelectedIndex(index)
      selectedIndexRef.current = index
      centerPopup(index)
      if (index !== activeIndexRef.current) {
        jumpTargetRef.current = index
        programmaticRef.current = true
      } else {
        jumpTargetRef.current = null
        programmaticRef.current = false
      }
      handleJump(key)
    },
    [centerPopup, handleJump],
  )

  // Only the active editor instance renders a rail; background tabs stay hidden.
  if (!isActive || headings.length < 2 || typeof document === "undefined") return null

  return createPortal(
    <div
      data-testid="section-rail"
      data-document-id={documentId}
      role="navigation"
      aria-label="Note sections"
      className="fixed right-4 top-1/2 z-30 -translate-y-1/2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={() => {
        editor.getRootElement()?.blur()
        editor.update(() => {
          $setSelection(null)
        })
      }}
    >
      <div className="flex flex-col items-end gap-1.5 py-2">
        {headings.map((heading, index) => (
          <button
            key={heading.key}
            type="button"
            data-testid="section-rail-bar"
            data-active={index === activeIndex}
            aria-label={`Go to section: ${heading.text || "Untitled"}`}
            aria-current={index === activeIndex ? "true" : undefined}
            onClick={() => handleRailJump(heading.key, index)}
            className={cn(
              BAR_HEIGHT_CLASS,
              BAR_WIDTH[heading.tag],
              "cursor-pointer rounded-full transition-all duration-150 ease-out",
              index === activeIndex
                ? "bg-[hsl(var(--foreground))] scale-x-105"
                : "bg-[hsl(var(--muted-foreground))]/30 hover:bg-[hsl(var(--muted-foreground))]/60",
            )}
          />
        ))}
      </div>

      {isHovered && (
        <div
          data-testid="section-rail-flyout"
          // The `pr-1` gap is an invisible hover bridge: without it the cursor
          // crosses dead space between the rail and the panel, firing
          // mouseleave and closing the flyout before the pointer arrives.
          className="absolute right-full top-1/2 -translate-y-1/2 pr-1"
        >
          <div
            ref={flyoutRef}
            className="relative max-h-[70vh] min-w-[220px] max-w-[300px] overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-popover px-2 py-2 shadow-md animate-in fade-in-0 duration-75"
          >
            {headings.map((heading, index) => (
              <button
                key={heading.key}
                type="button"
                onClick={() => handleRailJump(heading.key, index)}
                style={{ paddingLeft: FLYOUT_INDENT[heading.tag] }}
                className={cn(
                  "block w-full truncate rounded-md py-1.5 pr-3 text-left text-sm transition-colors",
                  index === selectedIndex
                    ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]",
                )}
              >
                {heading.text || "Untitled"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
