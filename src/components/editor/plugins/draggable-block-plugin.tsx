"use client"

import { JSX, useRef, useCallback, useState } from "react"
import { DraggableBlockPlugin_EXPERIMENTAL } from "@lexical/react/LexicalDraggableBlockPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $createNodeSelection, $getNearestNodeFromDOMNode, $setSelection } from "lexical"
import { $isImageNode } from "@/components/editor/nodes/image-node"
import { GripVerticalIcon } from "lucide-react"
import { HIGHLIGHT_BLOCK_COMMAND } from "./block-highlight-plugin"

const DRAGGABLE_BLOCK_MENU_CLASSNAME = "draggable-block-menu"

function isOnMenu(element: HTMLElement): boolean {
  return !!element.closest(`.${DRAGGABLE_BLOCK_MENU_CLASSNAME}`)
}

export function DraggableBlockPlugin({
  anchorElem,
}: {
  anchorElem: HTMLElement | null
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const menuRef = useRef<HTMLDivElement>(null)
  const targetLineRef = useRef<HTMLDivElement>(null)
  const targetBlockRef = useRef<HTMLElement | null>(null)
  const [hideMenu, setHideMenu] = useState(false)

  // Clear selection and blur editor when clicking drag handle to prevent scroll-back on drop
  // For image blocks, select the node so resize handles appear
  const handleMouseDown = useCallback(() => {
    const block = targetBlockRef.current
    editor.update(() => {
      if (block) {
        const node = $getNearestNodeFromDOMNode(block)
        if ($isImageNode(node)) {
          const selection = $createNodeSelection()
          selection.add(node.getKey())
          $setSelection(selection)
          return
        }
      }
      $setSelection(null)
    })

    const rootElement = editor.getRootElement()
    if (rootElement) {
      rootElement.blur()
    }

    if (block) {
      editor.dispatchCommand(HIGHLIGHT_BLOCK_COMMAND, block)
    }
  }, [editor])

  // Called when the target block element changes - hide menu if it's the title
  const handleElementChanged = useCallback((element: HTMLElement | null) => {
    targetBlockRef.current = element
    if (element && element.getAttribute("data-lexical-no-drag") === "true") {
      setHideMenu(true)
    } else {
      setHideMenu(false)
    }
  }, [])

  if (!anchorElem) {
    return null
  }

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef as React.RefObject<HTMLDivElement>}
      targetLineRef={targetLineRef as React.RefObject<HTMLDivElement>}
      menuComponent={
        <div
          ref={menuRef}
          className="draggable-block-menu absolute top-0 left-0 flex items-center justify-center cursor-grab rounded-md px-0.5 py-0.5 opacity-0 will-change-transform hover:bg-accent active:cursor-grabbing active:bg-muted"
          style={hideMenu ? { visibility: "hidden", pointerEvents: "none" } : undefined}
          onMouseDown={handleMouseDown}
        >
          <GripVerticalIcon className="size-4 text-muted-foreground hover:text-foreground" />
        </div>
      }
      targetLineComponent={
        <div
          ref={targetLineRef}
          className="pointer-events-none absolute top-0 left-0 h-1 rounded-full bg-primary opacity-0 will-change-transform"
          style={{ boxShadow: "0 0 8px hsl(355 49% 53% / 0.5)" }}
        />
      }
      isOnMenu={isOnMenu}
      onElementChanged={handleElementChanged}
    />
  )
}
