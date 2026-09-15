import { registerNodeRenderer } from "./node-renderers";
import { ReferenceComponent } from "./reference-component";

/**
 * Renderer entry: bind decorator node types to their React components.
 *
 * Imported for side effects by the editor (`editor.tsx`) only. Keeping this
 * separate from the node classes is what lets the node modules be imported in a
 * headless context (main process, MCP, Node tests) without pulling in the
 * renderer/`window` runtime.
 */
registerNodeRenderer("reference", ReferenceComponent);
