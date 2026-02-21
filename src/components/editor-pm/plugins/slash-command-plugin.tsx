import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EditorView } from "prosemirror-view"
import { setBlockType } from "prosemirror-commands"
import { wrapInList } from "prosemirror-schema-list"
import { TextSelection } from "prosemirror-state"
import { schema } from "../schema"
import { useProseMirrorView } from "../context"
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Minus,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────

interface SlashCommand {
  title: string
  icon: React.ReactNode
  keywords: string[]
  onSelect: (view: EditorView) => void
}

// ── Commands ───────────────────────────────────────────

function getCommands(): SlashCommand[] {
  return [
    {
      title: "Text",
      icon: <Type className="h-4 w-4" />,
      keywords: ["paragraph", "normal", "text"],
      onSelect: (view) => {
        setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)
      },
    },
    {
      title: "Heading 1",
      icon: <Heading1 className="h-4 w-4" />,
      keywords: ["h1", "heading", "title"],
      onSelect: (view) => {
        setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch)
      },
    },
    {
      title: "Heading 2",
      icon: <Heading2 className="h-4 w-4" />,
      keywords: ["h2", "heading", "subtitle"],
      onSelect: (view) => {
        setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch)
      },
    },
    {
      title: "Heading 3",
      icon: <Heading3 className="h-4 w-4" />,
      keywords: ["h3", "heading"],
      onSelect: (view) => {
        setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch)
      },
    },
    {
      title: "Bullet List",
      icon: <List className="h-4 w-4" />,
      keywords: ["ul", "unordered", "bullet", "list"],
      onSelect: (view) => {
        wrapInList(schema.nodes.bullet_list)(view.state, view.dispatch)
      },
    },
    {
      title: "Numbered List",
      icon: <ListOrdered className="h-4 w-4" />,
      keywords: ["ol", "ordered", "numbered", "list"],
      onSelect: (view) => {
        wrapInList(schema.nodes.ordered_list)(view.state, view.dispatch)
      },
    },
    {
      title: "Quote",
      icon: <Quote className="h-4 w-4" />,
      keywords: ["blockquote", "quote"],
      onSelect: (view) => {
        const { $from, $to } = view.state.selection
        const range = $from.blockRange($to)
        if (range) {
          view.dispatch(view.state.tr.wrap(range, [{ type: schema.nodes.blockquote }]))
        }
      },
    },
    {
      title: "Code Block",
      icon: <Code className="h-4 w-4" />,
      keywords: ["code", "codeblock", "snippet"],
      onSelect: (view) => {
        setBlockType(schema.nodes.codeBlock)(view.state, view.dispatch)
      },
    },
    {
      title: "Divider",
      icon: <Minus className="h-4 w-4" />,
      keywords: ["hr", "divider", "horizontal", "rule", "line"],
      onSelect: (view) => {
        const { $from } = view.state.selection
        const tr = view.state.tr.replaceRangeWith(
          $from.before(),
          $from.after(),
          schema.nodes.horizontalRule.create()
        )
        // Add paragraph after if at end of doc
        const pos = tr.mapping.map($from.after())
        if (pos >= tr.doc.content.size) {
          tr.insert(tr.doc.content.size, schema.nodes.paragraph.create())
        }
        tr.setSelection(TextSelection.create(tr.doc, pos + 1))
        view.dispatch(tr.scrollIntoView())
      },
    },
  ]
}

// ── Slash Menu Component ───────────────────────────────

function SlashMenu({
  view,
  query,
  from,
  onClose,
}: {
  view: EditorView
  query: string
  from: number
  onClose: () => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  const allCommands = useMemo(() => getCommands(), [])

  const filtered = useMemo(() => {
    if (!query) return allCommands
    const regex = new RegExp(query, "i")
    return allCommands.filter(
      (cmd) =>
        regex.test(cmd.title) || cmd.keywords.some((kw) => regex.test(kw))
    )
  }, [query, allCommands])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered.length])

  // Position menu below cursor
  useEffect(() => {
    if (!menuRef.current) return
    const coords = view.coordsAtPos(from)
    const editorRect = view.dom.getBoundingClientRect()
    menuRef.current.style.left = `${coords.left - editorRect.left}px`
    menuRef.current.style.top = `${coords.bottom - editorRect.top + 4}px`
  }, [view, from, query])

  const executeCommand = useCallback(
    (cmd: SlashCommand) => {
      // Delete the slash and query text first
      const to = view.state.selection.from
      const tr = view.state.tr.delete(from, to)
      view.dispatch(tr)
      // Now execute the command
      cmd.onSelect(view)
      view.focus()
      onClose()
    },
    [view, from, onClose]
  )

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % filtered.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (filtered[selectedIndex]) {
          executeCommand(filtered[selectedIndex])
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }

    // Capture phase so we intercept before PM's keymap
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [filtered, selectedIndex, executeCommand, onClose])

  if (filtered.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="absolute z-50 w-[200px] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
    >
      {filtered.map((cmd, i) => (
        <div
          key={cmd.title}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
            i === selectedIndex && "bg-accent text-accent-foreground"
          )}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => setSelectedIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            executeCommand(cmd)
          }}
        >
          {cmd.icon}
          <span>{cmd.title}</span>
        </div>
      ))}
    </div>
  )
}

// ── Plugin ─────────────────────────────────────────────

function SlashCommandHandler({ view }: { view: EditorView }) {
  const [menuState, setMenuState] = useState<{ from: number; query: string } | null>(null)

  useEffect(() => {
    const handler = () => {
      const { state } = view
      const { $from, empty } = state.selection

      if (!empty || $from.parent.type === schema.nodes.title) {
        if (menuState) setMenuState(null)
        return
      }

      // Get text from start of block to cursor
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc")
      const match = textBefore.match(/(?:^|\s)\/([\w]*)$/)

      if (match) {
        const slashOffset = textBefore.lastIndexOf("/")
        const absoluteFrom = $from.start() + slashOffset
        setMenuState({ from: absoluteFrom, query: match[1] })
      } else {
        if (menuState) setMenuState(null)
      }
    }

    view.dom.addEventListener("pm-update", handler)
    return () => view.dom.removeEventListener("pm-update", handler)
  }, [view, menuState])

  if (!menuState) return null

  return (
    <SlashMenu
      view={view}
      query={menuState.query}
      from={menuState.from}
      onClose={() => setMenuState(null)}
    />
  )
}

// ── Export ──────────────────────────────────────────────

export function SlashCommandPlugin() {
  const view = useProseMirrorView()
  if (!view) return null
  return <SlashCommandHandler view={view} />
}
