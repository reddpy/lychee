import { useEffect, type RefObject } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalNode,
  type NodeKey,
} from "lexical"
import { mergeRegister } from "@lexical/utils"

interface UseDecoratorBlockOptions {
  nodeKey: NodeKey
  containerRef: RefObject<HTMLElement | null>
  /** Type guard — return true if the node is the expected type. */
  isNodeType: (node: LexicalNode | null) => boolean
  /** When true, clicks inside the container are swallowed without toggling selection. */
  isResizing?: boolean
  /** CSS selector for elements that should not trigger selection on click (e.g. ".image-toolbar"). */
  ignoreClickSelector?: string
}

export function useDecoratorBlock({
  nodeKey,
  containerRef,
  isNodeType,
  isResizing = false,
  ignoreClickSelector,
}: UseDecoratorBlockOptions) {
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)

  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if (isNodeType(node)) node!.remove()
        return true
      }
      return false
    }

    const onEnter = (event: KeyboardEvent | null) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        if (event) event.preventDefault()
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if (!node) return
          const next = node.getNextSibling()
          if (next) {
            next.selectStart()
          } else {
            const paragraph = $createParagraphNode()
            node.insertAfter(paragraph)
            paragraph.selectStart()
          }
        })
        return true
      }
      return false
    }

    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          if (isResizing) return true
          const target = event.target as Node
          if (containerRef.current?.contains(target)) {
            if (ignoreClickSelector && (target as HTMLElement).closest?.(ignoreClickSelector)) return true
            if (!event.shiftKey) clearSelection()
            setSelected(true)
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_LOW),
    )
  }, [editor, isResizing, isSelected, nodeKey, setSelected, clearSelection, isNodeType, containerRef, ignoreClickSelector])

  return { isSelected, setSelected, clearSelection }
}
