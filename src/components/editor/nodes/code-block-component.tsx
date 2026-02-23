import { useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection"
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  type NodeKey,
} from "lexical"
import { mergeRegister } from "@lexical/utils"
import { $isCodeBlockNode } from "./code-block-node"
import { cn } from "@/lib/utils"
import { Copy, Check } from "lucide-react"

interface CodeBlockComponentProps {
  nodeKey: NodeKey
  code: string
  language: string
}

export function CodeBlockComponent({
  nodeKey,
  code: initialCode,
  language: initialLanguage,
}: CodeBlockComponentProps) {
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [code, setCode] = useState(initialCode)
  const [copied, setCopied] = useState(false)

  // Sync code from Lexical node when props change
  useEffect(() => {
    setCode(initialCode)
  }, [initialCode])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px"
    }
  }, [code, isEditing])

  // Keyboard commands when selected (not editing)
  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (isSelected && !isEditing && $isNodeSelection($getSelection())) {
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if ($isCodeBlockNode(node)) node.remove()
        return true
      }
      return false
    }

    const onEnter = (event: KeyboardEvent | null) => {
      if (isSelected && !isEditing && $isNodeSelection($getSelection())) {
        if (event) event.preventDefault()
        // Double-enter or just enter → edit mode
        setIsEditing(true)
        setTimeout(() => textareaRef.current?.focus(), 0)
        return true
      }
      return false
    }

    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          const target = event.target as Node
          if (containerRef.current?.contains(target)) {
            if (!event.shiftKey) clearSelection()
            setSelected(true)
            // Click on the code content area → enter editing immediately
            const contentEl = containerRef.current.querySelector(".code-block-content")
            if (contentEl?.contains(target)) {
              setIsEditing(true)
              setTimeout(() => textareaRef.current?.focus(), 0)
            }
            return true
          }
          // Clicked outside — exit editing
          if (isEditing) setIsEditing(false)
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_LOW)
    )
  }, [editor, isSelected, isEditing, nodeKey, setSelected, clearSelection])

  // Handle code changes
  const handleCodeChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newCode = e.target.value
      setCode(newCode)
      editor.update(() => {
        const node = $getNodeByKey(nodeKey)
        if ($isCodeBlockNode(node)) {
          node.setCode(newCode)
        }
      })
    },
    [editor, nodeKey]
  )

  // Handle tab key in textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault()
        const textarea = e.currentTarget
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const newCode = code.slice(0, start) + "  " + code.slice(end)
        setCode(newCode)
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if ($isCodeBlockNode(node)) node.setCode(newCode)
        })
        // Restore cursor position after React re-render
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2
        }, 0)
      } else if (e.key === "Escape") {
        e.preventDefault()
        setIsEditing(false)
        // Re-select the node in Lexical
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if (node) node.selectNext()
        })
      }
    },
    [code, editor, nodeKey]
  )

  // Copy to clipboard
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [code])

  const displayLanguage = initialLanguage || "plain text"

  return (
    <div
      ref={containerRef}
      className={cn(
        "code-block-container",
        isSelected && !isEditing && "selected",
        isEditing && "editing"
      )}
    >
      {/* Toolbar */}
      <div className="code-block-toolbar">
        <span className="code-block-lang">{displayLanguage}</span>
        <button
          className={cn("code-block-copy", copied && "copied")}
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            handleCopy()
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {copied ? (
            <>
              <Check size={14} />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code area */}
      <div className="code-block-content">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="code-block-textarea"
            value={code}
            onChange={handleCodeChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        ) : (
          <pre className="code-block-pre">
            <code>{code || "\n"}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
