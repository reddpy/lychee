import type { ComponentType } from "react";

/**
 * Node type → React renderer registry.
 *
 * Decorator nodes must be importable without a DOM/React-component runtime so
 * the Yjs binding (and markdown conversion) can run headless — in the main
 * process, the standalone MCP server, and plain Node tests. The renderer entry
 * registers the actual components; a headless context simply finds none and
 * `decorate()` returns null.
 */
type NodeRenderer = ComponentType<any>;

const renderers = new Map<string, NodeRenderer>();

export function registerNodeRenderer(type: string, component: NodeRenderer): void {
  renderers.set(type, component);
}

export function getNodeRenderer(type: string): NodeRenderer | undefined {
  return renderers.get(type);
}

/** Test/teardown helper. */
export function clearNodeRenderers(): void {
  renderers.clear();
}
