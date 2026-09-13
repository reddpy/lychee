import type { ReactElement } from "react"
import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
} from "lexical"

export const UNKNOWN_NODE_TYPE = "unknown"

export type SerializedUnknownNode = {
  type: typeof UNKNOWN_NODE_TYPE
  /** The original serialized node, preserved verbatim so it survives a save. */
  raw: unknown
  version: 1
}

function originalType(raw: unknown): string {
  if (raw && typeof raw === "object" && typeof (raw as { type?: unknown }).type === "string") {
    return (raw as { type: string }).type
  }
  return UNKNOWN_NODE_TYPE
}

function collectText(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const node = value as { text?: unknown; children?: unknown }
  const parts: string[] = []
  if (typeof node.text === "string") parts.push(node.text)
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const text = collectText(child)
      if (text) parts.push(text)
    }
  }
  return parts.join(" ")
}

/**
 * Placeholder for a serialized node type this build does not register.
 *
 * Without this, Lexical's `$parseSerializedNode` throws on the unknown type and
 * the editor keeps only the nodes parsed before it — the truncation that
 * issue #286 reported. `exportJSON` returns the original payload untouched, so
 * a save re-emits it verbatim and an upgraded build can still load the note.
 *
 * A pre-parse pass (`content-load.ts`) rewrites unrecognized types into this
 * node before Lexical ever sees them.
 */
export class UnknownNode extends DecoratorNode<ReactElement> {
  __raw: unknown

  static getType(): string {
    return UNKNOWN_NODE_TYPE
  }

  static clone(node: UnknownNode): UnknownNode {
    return new UnknownNode(node.__raw, node.__key)
  }

  constructor(raw: unknown, key?: NodeKey) {
    super(key)
    this.__raw = raw
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div")
    element.className = "editor-unknown-node"
    element.setAttribute("data-unknown-type", originalType(this.__raw))
    return element
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): false {
    return false
  }

  static importJSON(serializedNode: SerializedUnknownNode): UnknownNode {
    return $createUnknownNode(serializedNode.raw)
  }

  /** Emit an `unknown` envelope. `content-load` unwraps `raw` and restores the
   *  real node as soon as a build registers that type. */
  exportJSON(): SerializedUnknownNode {
    return { type: UNKNOWN_NODE_TYPE, raw: this.__raw, version: 1 }
  }

  getTextContent(): string {
    return collectText(this.__raw)
  }

  /** The original serialized payload, for verbatim export. */
  getRaw(): unknown {
    return this.__raw
  }

  decorate(): ReactElement {
    return (
      <div
        className="my-2 rounded-md border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] select-none"
        data-testid="unknown-node-placeholder"
        contentEditable={false}
      >
        Unsupported content from a newer version ({originalType(this.__raw)})
      </div>
    )
  }
}

export function $createUnknownNode(raw: unknown): UnknownNode {
  return $applyNodeReplacement(new UnknownNode(raw))
}

export function $isUnknownNode(
  node: LexicalNode | null | undefined,
): node is UnknownNode {
  return node instanceof UnknownNode
}
