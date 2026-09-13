/** Shared types for AI/agent (MCP) integration. */

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * The values an app's "custom MCP" form asks for. Some clients (ChatGPT, Zed)
 * only accept a local server through their own UI and require these to be typed
 * in one at a time, so the app surfaces each field individually.
 */
export interface McpSetupFields {
  name: string;
  type: 'STDIO';
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory: string;
}
