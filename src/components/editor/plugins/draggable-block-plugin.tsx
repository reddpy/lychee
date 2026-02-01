import { JSX, useRef, useCallback } from "react"
import { DraggableBlockPlugin_EXPERIMENTAL } from "@lexical/react/LexicalDraggableBlockPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $setSelection } from "lexical"
import { GripVerticalIcon } from "lucide-react"

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

  // Clear selection and blur editor when clicking drag handle to prevent scroll-back on drop
  const handleMouseDown = useCallback(() => {
    // Clear Lexical selection
    editor.update(() => {
      $setSelection(null)
    })
    // Blur the DOM element
    const rootElement = editor.getRootElement()
    if (rootElement) {
      rootElement.blur()
    }
  }, [editor])

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
          className="draggable-block-menu absolute top-0 left-0 cursor-grab rounded-md px-0.5 py-0.5 opacity-0 will-change-transform hover:bg-blue-50 active:cursor-grabbing active:bg-blue-100"
          onMouseDown={handleMouseDown}
        >
          <GripVerticalIcon className="size-4 text-gray-400 hover:text-blue-500" />
        </div>
      }
      targetLineComponent={
        <div
          ref={targetLineRef}
          className="pointer-events-none absolute top-0 left-0 h-1 rounded-full bg-blue-400 opacity-0 will-change-transform"
          style={{ boxShadow: "0 0 8px rgba(59, 130, 246, 0.5)" }}
        />
      }
      isOnMenu={isOnMenu}
    />
  )
}
