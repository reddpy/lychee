import { useNodeViewContext } from "@prosemirror-adapter/react"
import { NodeSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Fragment, Slice } from "prosemirror-model"
import { GripVertical } from "lucide-react"

// ── Structural nodes that should NOT get a drag handle ──

const NO_HANDLE_TYPES = new Set(["title", "toggleTitle", "toggleContent"])

// ── Drag handle ─────────────────────────────────────────

function DragHandle({ view, getPos }: { view: EditorView; getPos: () => number | undefined }) {
  const onDragStart = (e: React.DragEvent) => {
    const pos = getPos()
    if (pos == null) return

    // Set NodeSelection so PM knows what's being dragged
    const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
    view.dispatch(tr)

    // Serialize the selected node for clipboard
    const sel = view.state.selection as NodeSelection
    const slice = new Slice(Fragment.from(sel.node), 0, 0)
    const { dom, text } = (view as any).serializeForClipboard(slice)
    e.dataTransfer.clearData()
    e.dataTransfer.setData("text/html", dom.innerHTML)
    e.dataTransfer.setData("text/plain", text)
    e.dataTransfer.effectAllowed = "copyMove"

    // Tell PM this is an internal move drag
    view.dragging = { slice, move: true } as any

    // Use the block element as drag image
    const nodeDOM = view.nodeDOM(pos)
    if (nodeDOM instanceof HTMLElement) {
      e.dataTransfer.setDragImage(nodeDOM, 0, 0)
    }
  }

  return (
    <div
      className="block-handle"
      contentEditable={false}
      draggable
      onDragStart={onDragStart}
    >
      <GripVertical className="size-4" />
    </div>
  )
}

// ── Generic Block View ──────────────────────────────────

export function BlockView() {
  const { contentRef, node, view, getPos } = useNodeViewContext()

  return (
    <>
      {!NO_HANDLE_TYPES.has(node.type.name) && (
        <DragHandle view={view} getPos={getPos} />
      )}
      <div ref={contentRef} />
    </>
  )
}

// ── Horizontal Rule View ────────────────────────────────
// HR is a leaf node (no content), so no contentRef needed.

export function HorizontalRuleView() {
  const { view, getPos } = useNodeViewContext()

  return (
    <>
      <DragHandle view={view} getPos={getPos} />
      <hr />
    </>
  )
}
