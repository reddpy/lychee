import { useCallback, useEffect, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { EditorView } from "prosemirror-view"
import { EditorState } from "prosemirror-state"
import { toggleMark, setBlockType, lift } from "prosemirror-commands"
import { wrapInList, liftListItem } from "prosemirror-schema-list"
import { schema } from "../schema"
import { useProseMirrorView } from "../context"
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  ChevronDown,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// ── Types ──────────────────────────────────────────────

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "number" | "quote" | "code"

const BLOCK_TYPE_OPTIONS: { value: BlockType; label: string; icon: React.ElementType }[] = [
  { value: "paragraph", label: "Paragraph", icon: Type },
  { value: "h1", label: "Heading 1", icon: Heading1 },
  { value: "h2", label: "Heading 2", icon: Heading2 },
  { value: "h3", label: "Heading 3", icon: Heading3 },
  { value: "bullet", label: "Bullet List", icon: List },
  { value: "number", label: "Numbered List", icon: ListOrdered },
  { value: "quote", label: "Quote", icon: Quote },
  { value: "code", label: "Code Block", icon: Code2 },
]

interface ToolbarState {
  isVisible: boolean
  isBold: boolean
  isItalic: boolean
  isUnderline: boolean
  isStrikethrough: boolean
  isCode: boolean
  blockType: BlockType
  isSingleBlock: boolean
}

const HIDDEN_STATE: ToolbarState = {
  isVisible: false,
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  isCode: false,
  blockType: "paragraph",
  isSingleBlock: true,
}

const TOOLBAR_WIDTH = 380
const TOOLBAR_HEIGHT = 45
const TOOLBAR_GAP = 8
const TAB_BAR_HEIGHT = 120

// ── Helpers ────────────────────────────────────────────

function hasMark(state: EditorState, markType: typeof schema.marks.bold): boolean {
  const { from, $from, to, empty } = state.selection
  if (empty) return !!markType.isInSet(state.storedMarks || $from.marks())
  let found = false
  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false
    if (node.isInline && markType.isInSet(node.marks)) found = true
  })
  return found
}

function getBlockType(state: EditorState): BlockType {
  const { $from } = state.selection
  const parent = $from.parent

  if (parent.type === schema.nodes.heading) {
    const level = parent.attrs.level as number
    if (level === 1) return "h1"
    if (level === 2) return "h2"
    return "h3"
  }
  if (parent.type === schema.nodes.codeBlock) return "code"

  // Check if inside a blockquote or list by walking up
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type === schema.nodes.blockquote) return "quote"
    if (node.type === schema.nodes.bullet_list) return "bullet"
    if (node.type === schema.nodes.ordered_list) return "number"
  }

  return "paragraph"
}

function readSelectionState(state: EditorState): Omit<ToolbarState, "isVisible"> | null {
  const { from, to, empty } = state.selection
  if (empty) return null

  const text = state.doc.textBetween(from, to)
  if (!text || text.length === 0) return null

  const $from = state.selection.$from
  const $to = state.selection.$to
  // Show block type selector when selection is within a single block and not in the title
  const inTitle = $from.parent.type === schema.nodes.title
  const isSingleBlock = $from.parent === $to.parent && !inTitle

  return {
    isBold: hasMark(state, schema.marks.bold),
    isItalic: hasMark(state, schema.marks.italic),
    isUnderline: hasMark(state, schema.marks.underline),
    isStrikethrough: hasMark(state, schema.marks.strikethrough),
    isCode: hasMark(state, schema.marks.code),
    blockType: getBlockType(state),
    isSingleBlock,
  }
}

// ── Block Type Selector ────────────────────────────────

function BlockTypeSelector({ view, blockType, onChanged }: { view: EditorView; blockType: BlockType; onChanged: () => void }) {
  const [open, setOpen] = useState(false)

  const currentOption = BLOCK_TYPE_OPTIONS.find((o) => o.value === blockType)
  const CurrentIcon = currentOption?.icon || Type

  const handleSelect = useCallback(
    (newType: BlockType) => {
      view.focus()

      // Helper: lift out of list/blockquote first if needed
      const liftFromWrapper = () => {
        // Try lifting from list item
        if (liftListItem(schema.nodes.list_item)(view.state, view.dispatch)) return
        // Try generic lift (for blockquote etc.)
        lift(view.state, view.dispatch)
      }

      const currentType = blockType
      const isInList = currentType === "bullet" || currentType === "number"
      const isInQuote = currentType === "quote"

      // If converting to a textblock type (paragraph, heading, code)
      if (newType === "paragraph" || newType === "h1" || newType === "h2" || newType === "h3" || newType === "code") {
        // First lift out of any wrapper
        if (isInList || isInQuote) liftFromWrapper()

        // Now set the block type
        if (newType === "paragraph") {
          setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)
        } else if (newType === "h1") {
          setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch)
        } else if (newType === "h2") {
          setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch)
        } else if (newType === "h3") {
          setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch)
        } else if (newType === "code") {
          setBlockType(schema.nodes.codeBlock)(view.state, view.dispatch)
        }
      } else if (newType === "bullet" || newType === "number") {
        // Lift from existing wrapper first
        if (isInList || isInQuote) liftFromWrapper()
        // Ensure it's a paragraph (can't wrap heading/code in list)
        setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)
        const listType = newType === "bullet" ? schema.nodes.bullet_list : schema.nodes.ordered_list
        wrapInList(listType)(view.state, view.dispatch)
      } else if (newType === "quote") {
        if (isInList || isInQuote) liftFromWrapper()
        setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)
        // Wrap in blockquote using the wrap command
        const { $from, $to } = view.state.selection
        const range = $from.blockRange($to)
        if (range) {
          const tr = view.state.tr.wrap(range, [{ type: schema.nodes.blockquote }])
          view.dispatch(tr)
        }
      }

      setOpen(false)
      onChanged()
    },
    [view, onChanged, blockType]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-8 px-2 inline-flex items-center justify-center gap-1 rounded-md transition-colors hover:bg-muted text-foreground text-sm"
          aria-label="Change block type"
        >
          <CurrentIcon className="h-4 w-4" />
          <span className="max-w-20 truncate">{currentOption?.label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start" sideOffset={8}>
        <div className="flex flex-col">
          {BLOCK_TYPE_OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors text-left",
                  blockType === option.value
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted"
                )}
              >
                <Icon className="h-4 w-4" />
                {option.label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Floating Toolbar ───────────────────────────────────

function FloatingToolbar({ view }: { view: EditorView }) {
  const [state, setState] = useState<ToolbarState>(HIDDEN_STATE)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const scrollHiddenRef = useRef(false)
  const visibleRef = useRef(false)

  visibleRef.current = state.isVisible

  const positionToolbar = useCallback(() => {
    const nativeSelection = window.getSelection()
    if (!nativeSelection || nativeSelection.rangeCount === 0) return
    const rect = nativeSelection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    if (toolbarRef.current) {
      const left = Math.max(rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2, 10)
      const top = Math.max(rect.top - TOOLBAR_HEIGHT - TOOLBAR_GAP, 10)
      toolbarRef.current.style.top = `${top}px`
      toolbarRef.current.style.left = `${left}px`
    }
  }, [])

  // Right-click shows toolbar; mousedown hides it
  useEffect(() => {
    const root = view.dom

    const handleContextMenu = (e: MouseEvent) => {
      const selState = readSelectionState(view.state)
      if (!selState) return
      e.preventDefault()
      setState({ ...selState, isVisible: true })
      requestAnimationFrame(() => positionToolbar())
    }

    const handleMouseDown = () => {
      scrollHiddenRef.current = false
      setState(HIDDEN_STATE)
    }

    root.addEventListener("contextmenu", handleContextMenu)
    root.addEventListener("mousedown", handleMouseDown)
    return () => {
      root.removeEventListener("contextmenu", handleContextMenu)
      root.removeEventListener("mousedown", handleMouseDown)
    }
  }, [view, positionToolbar])

  // Refresh toolbar state on any editor state change (undo, redo, etc.)
  useEffect(() => {
    const handler = () => {
      if (!visibleRef.current) return
      const selState = readSelectionState(view.state)
      if (selState) {
        setState({ ...selState, isVisible: true })
      } else {
        setState(HIDDEN_STATE)
      }
    }
    view.dom.addEventListener("pm-update", handler)
    return () => view.dom.removeEventListener("pm-update", handler)
  }, [view])

  // Scroll: hide when selection leaves viewport, re-show when it returns
  useEffect(() => {
    const handleScroll = () => {
      if (!visibleRef.current && !scrollHiddenRef.current) return

      const nativeSelection = window.getSelection()
      if (!nativeSelection || nativeSelection.rangeCount === 0) return
      const rect = nativeSelection.getRangeAt(0).getBoundingClientRect()
      const outOfView = rect.bottom < TAB_BAR_HEIGHT || rect.top > window.innerHeight

      if (!toolbarRef.current) return

      if (outOfView) {
        toolbarRef.current.style.visibility = "hidden"
        scrollHiddenRef.current = true
      } else {
        if (scrollHiddenRef.current) {
          toolbarRef.current.style.visibility = "visible"
          scrollHiddenRef.current = false
        }
        const left = Math.max(rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2, 10)
        const top = Math.max(rect.top - TOOLBAR_HEIGHT - TOOLBAR_GAP, TAB_BAR_HEIGHT)
        toolbarRef.current.style.top = `${top}px`
        toolbarRef.current.style.left = `${left}px`
      }
    }

    window.addEventListener("scroll", handleScroll, true)
    return () => window.removeEventListener("scroll", handleScroll, true)
  }, [])

  const refreshState = useCallback(() => {
    const selState = readSelectionState(view.state)
    if (selState) {
      setState({ ...selState, isVisible: true })
    } else {
      setState(HIDDEN_STATE)
    }
  }, [view])

  const handleFormat = useCallback(
    (markType: typeof schema.marks.bold) => {
      view.focus()
      toggleMark(markType)(view.state, view.dispatch)
      // PM dispatch is synchronous — view.state is already updated
      refreshState()
    },
    [view, refreshState]
  )

  if (!state.isVisible) return null

  const btnClass = (active: boolean) =>
    cn(
      "h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors",
      active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
    )

  return createPortal(
    <div
      ref={toolbarRef}
      className="floating-toolbar fixed z-50 flex items-center gap-0.5 rounded-md border border-[hsl(var(--border))] bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
    >
      {state.isSingleBlock && (
        <>
          <BlockTypeSelector view={view} blockType={state.blockType} onChanged={refreshState} />
          <div className="mx-1 h-6 w-px bg-border" />
        </>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat(schema.marks.bold)} className={btnClass(state.isBold)} aria-label="Bold">
            <Bold className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Bold <kbd className="ml-1.5 opacity-60">⌘B</kbd></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat(schema.marks.italic)} className={btnClass(state.isItalic)} aria-label="Italic">
            <Italic className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Italic <kbd className="ml-1.5 opacity-60">⌘I</kbd></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat(schema.marks.underline)} className={btnClass(state.isUnderline)} aria-label="Underline">
            <Underline className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Underline <kbd className="ml-1.5 opacity-60">⌘U</kbd></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat(schema.marks.strikethrough)} className={btnClass(state.isStrikethrough)} aria-label="Strikethrough">
            <Strikethrough className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Strikethrough <kbd className="ml-1.5 opacity-60">⌘⇧S</kbd></TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => handleFormat(schema.marks.code)} className={btnClass(state.isCode)} aria-label="Inline code">
            <Code className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>Inline code <kbd className="ml-1.5 opacity-60">⌘E</kbd></TooltipContent>
      </Tooltip>
    </div>,
    document.body
  )
}

// ── Export ──────────────────────────────────────────────

export function FloatingToolbarPlugin() {
  const view = useProseMirrorView()
  if (!view) return null
  return <FloatingToolbar view={view} />
}
