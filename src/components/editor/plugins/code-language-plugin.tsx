"use client"

import { JSX, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getNodeByKey, NodeKey } from "lexical"
import { $isCodeNode } from "@lexical/code"
import { Check, ChevronDown } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

// Comprehensive language list with Prism.js compatible identifiers
const LANGUAGES = [
  { value: "", label: "Plain Text" },
  { value: "bash", label: "Bash" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "css", label: "CSS" },
  { value: "dart", label: "Dart" },
  { value: "diff", label: "Diff" },
  { value: "docker", label: "Docker" },
  { value: "elixir", label: "Elixir" },
  { value: "erlang", label: "Erlang" },
  { value: "go", label: "Go" },
  { value: "graphql", label: "GraphQL" },
  { value: "groovy", label: "Groovy" },
  { value: "haskell", label: "Haskell" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "jsx", label: "JSX" },
  { value: "kotlin", label: "Kotlin" },
  { value: "latex", label: "LaTeX" },
  { value: "lua", label: "Lua" },
  { value: "markdown", label: "Markdown" },
  { value: "matlab", label: "MATLAB" },
  { value: "nginx", label: "Nginx" },
  { value: "objectivec", label: "Objective-C" },
  { value: "ocaml", label: "OCaml" },
  { value: "perl", label: "Perl" },
  { value: "php", label: "PHP" },
  { value: "powershell", label: "PowerShell" },
  { value: "python", label: "Python" },
  { value: "r", label: "R" },
  { value: "ruby", label: "Ruby" },
  { value: "rust", label: "Rust" },
  { value: "sass", label: "Sass" },
  { value: "scala", label: "Scala" },
  { value: "scheme", label: "Scheme" },
  { value: "scss", label: "SCSS" },
  { value: "sql", label: "SQL" },
  { value: "swift", label: "Swift" },
  { value: "toml", label: "TOML" },
  { value: "tsx", label: "TSX" },
  { value: "typescript", label: "TypeScript" },
  { value: "vbnet", label: "VB.NET" },
  { value: "vim", label: "Vim" },
  { value: "markup", label: "XML/HTML" },
  { value: "yaml", label: "YAML" },
  { value: "zig", label: "Zig" },
]

function CodeBlockToolbar({
  language,
  onChange,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: {
  language: string
  onChange: (language: string) => void
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const [open, setOpen] = useState(false)
  const currentLabel = LANGUAGES.find((l) => l.value === language)?.label || "Plain Text"

  // Position in the header area (top-right of code block)
  return createPortal(
    <div
      className="fixed z-50 flex items-center gap-1"
      style={{
        top: anchorRect.top + 5,
        right: window.innerWidth - anchorRect.right + 8,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground bg-background hover:bg-accent border border-border rounded shadow-sm transition-colors"
          >
            {currentLabel}
            <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-0" align="end" side="bottom" sideOffset={4}>
          <Command>
            <CommandInput placeholder="Search language..." />
            <CommandList>
              <CommandEmpty>No language found.</CommandEmpty>
              <CommandGroup>
                {LANGUAGES.map((lang) => (
                  <CommandItem
                    key={lang.value}
                    value={lang.label}
                    onSelect={() => {
                      onChange(lang.value)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        lang.value === language ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    {lang.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>,
    document.body
  )
}

export function CodeLanguagePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [hoveredCodeBlock, setHoveredCodeBlock] = useState<{
    nodeKey: NodeKey
    element: HTMLElement
    language: string
  } | null>(null)
  const [isToolbarHovered, setIsToolbarHovered] = useState(false)
  const hideTimeoutRef = useRef<number | null>(null)

  // Track hover over code blocks
  useEffect(() => {
    const rootElement = editor.getRootElement()
    if (!rootElement) return

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const codeElement = target.closest("code.EditorTheme__code") as HTMLElement | null

      if (codeElement) {
        // Clear any pending hide timeout
        if (hideTimeoutRef.current) {
          window.clearTimeout(hideTimeoutRef.current)
          hideTimeoutRef.current = null
        }

        // Find the CodeNode key from the element
        editor.getEditorState().read(() => {
          const editorState = editor.getEditorState()
          editorState._nodeMap.forEach((node, key) => {
            if ($isCodeNode(node)) {
              const element = editor.getElementByKey(key)
              if (element === codeElement) {
                setHoveredCodeBlock({
                  nodeKey: key,
                  element: codeElement,
                  language: node.getLanguage() || "",
                })
              }
            }
          })
        })
      }
    }

    const handleMouseOut = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const relatedTarget = event.relatedTarget as HTMLElement | null
      const codeElement = target.closest("code.EditorTheme__code")

      // Check if we're leaving a code block (and not entering another part of it)
      if (codeElement && (!relatedTarget || !codeElement.contains(relatedTarget))) {
        // Delay hiding to allow moving to the toolbar
        hideTimeoutRef.current = window.setTimeout(() => {
          if (!isToolbarHovered) {
            setHoveredCodeBlock(null)
          }
        }, 150)
      }
    }

    rootElement.addEventListener("mouseover", handleMouseOver)
    rootElement.addEventListener("mouseout", handleMouseOut)

    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }
      rootElement.removeEventListener("mouseover", handleMouseOver)
      rootElement.removeEventListener("mouseout", handleMouseOut)
    }
  }, [editor, isToolbarHovered])

  const handleLanguageChange = useCallback(
    (newLanguage: string) => {
      if (!hoveredCodeBlock) return

      editor.update(() => {
        const node = $getNodeByKey(hoveredCodeBlock.nodeKey)
        if ($isCodeNode(node)) {
          node.setLanguage(newLanguage)
        }
      })
      setHoveredCodeBlock((prev) =>
        prev ? { ...prev, language: newLanguage } : null
      )
    },
    [editor, hoveredCodeBlock]
  )

  const handleToolbarMouseEnter = useCallback(() => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    setIsToolbarHovered(true)
  }, [])

  const handleToolbarMouseLeave = useCallback(() => {
    setIsToolbarHovered(false)
    // Hide after a short delay
    hideTimeoutRef.current = window.setTimeout(() => {
      setHoveredCodeBlock(null)
    }, 150)
  }, [])

  if (!hoveredCodeBlock) {
    return null
  }

  const rect = hoveredCodeBlock.element.getBoundingClientRect()

  return (
    <CodeBlockToolbar
      language={hoveredCodeBlock.language}
      onChange={handleLanguageChange}
      anchorRect={rect}
      onMouseEnter={handleToolbarMouseEnter}
      onMouseLeave={handleToolbarMouseLeave}
    />
  )
}
