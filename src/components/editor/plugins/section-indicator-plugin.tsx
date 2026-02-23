import { type ReactElement, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getNodeByKey, $getRoot, $setSelection, type NodeKey, TextNode } from "lexical"
import { $isHeadingNode, HeadingNode, type HeadingTagType } from "@lexical/rich-text"
import { HIGHLIGHT_BLOCK_COMMAND } from "./block-highlight-plugin"

interface HeadingInfo {
  key: NodeKey
  tag: HeadingTagType
  text: string
}

function getScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let el = element
  while (el) {
    if (el.tagName === "MAIN") return el
    el = el.parentElement
  }
  return null
}

export function SectionIndicatorPlugin(): ReactElement | null {
  const [editor] = useLexicalComposerContext()
  const [headings, setHeadings] = useState<HeadingInfo[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [pillTop, setPillTop] = useState(0)
  const [pillRight, setPillRight] = useState(0)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Rebuild heading list on heading structural changes AND text edits inside headings
  useEffect(() => {
    const readHeadings = () => {
      editor.getEditorState().read(() => {
        const result: HeadingInfo[] = []
        for (const node of $getRoot().getChildren()) {
          if (!$isHeadingNode(node)) continue
          const tag = node.getTag()
          if (tag !== "h1" && tag !== "h2" && tag !== "h3") continue
          result.push({ key: node.getKey(), tag, text: node.getTextContent() })
        }
        setHeadings((prev) => {
          if (prev.length !== result.length) return result
          for (let i = 0; i < prev.length; i++) {
            if (prev[i].key !== result[i].key || prev[i].tag !== result[i].tag || prev[i].text !== result[i].text) return result
          }
          return prev
        })
      })
    }

    // Heading added/removed/tag changed (also fires on init with existing nodes)
    const removeHeadingListener = editor.registerMutationListener(HeadingNode, () => readHeadings())

    // Text edited inside a heading — check if any mutated text node lives in a heading
    const removeTextListener = editor.registerMutationListener(TextNode, (mutations) => {
      editor.getEditorState().read(() => {
        for (const [key, mutation] of mutations) {
          if (mutation === "destroyed") continue
          const node = $getNodeByKey(key)
          if (node && $isHeadingNode(node.getParent())) {
            readHeadings()
            return
          }
        }
      })
    })

    return () => {
      removeHeadingListener()
      removeTextListener()
    }
  }, [editor])

  // Position the pill based on the scroll container — only on resize/layout
  useEffect(() => {
    const root = editor.getRootElement()
    const scrollContainer = getScrollContainer(root)
    if (!scrollContainer) return

    const updatePosition = () => {
      const rect = scrollContainer.getBoundingClientRect()
      setPillRight(window.innerWidth - rect.right + 14)
      setPillTop(rect.top + rect.height * 0.3)
    }

    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(scrollContainer)
    window.addEventListener("resize", updatePosition)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updatePosition)
    }
  }, [editor])

  // Cleanup
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const handleEnter = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setIsOpen(true)
  }, [])

  const handleLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 250)
  }, [])

  const handleClick = useCallback(
    (key: NodeKey) => {
      const dom = editor.getElementByKey(key)
      if (dom) {
        dom.scrollIntoView({ behavior: "smooth", block: "start" })
        editor.dispatchCommand(HIGHLIGHT_BLOCK_COMMAND, dom)
      }
    },
    [editor]
  )

  if (headings.length < 2) return null

  return createPortal(
    <div
      className="fixed z-40"
      style={{ top: pillTop, right: pillRight }}
      onMouseDown={() => {
        editor.getRootElement()?.blur()
        editor.update(() => { $setSelection(null) })
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {isOpen ? (
        <div
          className="rounded-lg border border-[hsl(var(--border))] bg-popover py-2 px-2 shadow-md min-w-[220px] max-w-[300px] animate-in fade-in-0 zoom-in-95 duration-150"
          style={{ position: "absolute", right: 0, top: 0 }}
        >
          {headings.map((heading) => {
            const paddingLeft =
              heading.tag === "h1" ? 10 : heading.tag === "h2" ? 24 : 38
            return (
              <button
                key={heading.key}
                type="button"
                onClick={() => handleClick(heading.key)}
                style={{ paddingLeft }}
                className="block w-full text-left rounded-md pr-3 py-1.5 text-sm text-muted-foreground transition-colors truncate hover:bg-accent hover:text-accent-foreground"
              >
                {heading.text || "Untitled"}
              </button>
            )
          })}
        </div>
      ) : (
        <div
          className="flex items-center justify-center cursor-pointer border border-r-0 border-[hsl(var(--border))] bg-popover hover:bg-primary shadow-md transition-all duration-200 group"
          style={{
            width: 36,
            height: 28,
            borderRadius: "8px 0 0 8px",
          }}
        >
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
            <rect width="14" height="2" rx="1" className="fill-muted-foreground/60 group-hover:fill-primary-foreground transition-colors duration-200" />
            <rect y="4" width="9" height="2" rx="1" className="fill-muted-foreground/60 group-hover:fill-primary-foreground transition-colors duration-200" />
            <rect y="8" width="12" height="2" rx="1" className="fill-muted-foreground/60 group-hover:fill-primary-foreground transition-colors duration-200" />
          </svg>
        </div>
      )}
    </div>,
    document.body
  )
}
