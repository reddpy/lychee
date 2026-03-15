import { type ReactElement, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getNodeByKey, $getRoot, $setSelection, type NodeKey, TextNode } from "lexical"
import { $isHeadingNode, HeadingNode, type HeadingTagType } from "@lexical/rich-text"
import { $isTitleNode } from "../nodes/title-node"
import { HIGHLIGHT_BLOCK_COMMAND } from "./block-highlight-plugin"
import { emitToolbarExclusive, onToolbarExclusive } from "@/components/lexical-editor"

interface HeadingInfo {
  key: NodeKey
  tag: HeadingTagType
  text: string
}

export function SectionIndicatorPlugin({ documentId }: { documentId: string }): ReactElement | null {
  const [editor] = useLexicalComposerContext()
  const [headings, setHeadings] = useState<HeadingInfo[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [toolbarEl, setToolbarEl] = useState<Element | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setToolbarEl(document.querySelector(`[data-toolbar-id="${documentId}"]`))
  }, [documentId])

  useEffect(() => {
    return onToolbarExclusive("sections", () => setIsOpen(false))
  }, [])

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
      if (needsUpdate) readHeadings()
    })

    return () => {
      removeHeadingListener()
      removeTextListener()
    }
  }, [editor])

  // Close on outside click / Escape
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setIsOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }
    window.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("mousedown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [isOpen])

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

  if (headings.length < 2 || !toolbarEl) return null

  return createPortal(
    <div
      ref={containerRef}
      className="relative"
      onMouseDown={() => {
        editor.getRootElement()?.blur()
        editor.update(() => { $setSelection(null) })
      }}
    >
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => {
            if (!prev) emitToolbarExclusive("sections")
            return !prev
          })
        }}
        aria-label="Navigate sections"
        aria-expanded={isOpen}
        className={`flex h-8 w-8 items-center justify-center cursor-pointer rounded-full border transition-all duration-200 group select-none ${
          isOpen
            ? "border-[#C14B55]/30 bg-[#C14B55]/15 text-[#C14B55]"
            : "border-transparent bg-transparent text-[hsl(var(--muted-foreground))]/65 hover:bg-[#C14B55]/15 hover:text-[#C14B55] hover:border-[#C14B55]/30"
        }`}
      >
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
          <rect width="14" height="2" rx="1" className={`${isOpen ? "fill-[#C14B55]" : "fill-muted-foreground/60 group-hover:fill-[#C14B55]"} transition-colors duration-200`} />
          <rect y="4" width="9" height="2" rx="1" className={`${isOpen ? "fill-[#C14B55]" : "fill-muted-foreground/60 group-hover:fill-[#C14B55]"} transition-colors duration-200`} />
          <rect y="8" width="12" height="2" rx="1" className={`${isOpen ? "fill-[#C14B55]" : "fill-muted-foreground/60 group-hover:fill-[#C14B55]"} transition-colors duration-200`} />
        </svg>
      </button>
      {isOpen && (
        <div
          className="rounded-lg border border-[hsl(var(--border))] bg-popover py-2 px-2 shadow-md min-w-[220px] max-w-[300px] animate-in fade-in-0 duration-75"
          style={{ position: "absolute", right: 0, top: 36 }}
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
      )}
    </div>,
    toolbarEl
  )
}
