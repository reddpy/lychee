import fs from 'fs';
import path from 'path';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { PROJECT_ROOT } from './electron-app';

/**
 * Spawns the REAL built MCP server (`out/mcp/lychee-mcp.mjs`) over stdio and
 * speaks JSON-RPC to it, exactly like Zed/Codex. Shared by the process-level
 * e2e suites so every test drives the shipped binary, not a re-implementation.
 */

const BUNDLE = path.join(PROJECT_ROOT, 'out', 'mcp', 'lychee-mcp.mjs');

export function ensureMcpBundle(): void {
  if (!fs.existsSync(BUNDLE)) {
    execFileSync('node', ['scripts/build-mcp.mjs'], { cwd: PROJECT_ROOT, stdio: 'ignore' });
  }
}

export interface McpClient {
  request: (method: string, params?: unknown) => Promise<any>;
  notify: (method: string, params?: unknown) => void;
  close: () => void;
}

export function startMcp(args: string[]): McpClient {
  const child: ChildProcess = spawn(process.execPath, [BUNDLE, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const pending = new Map<number, (message: any) => void>();
  let nextId = 1;

  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.id != null && pending.has(message.id)) {
          pending.get(message.id)!(message);
          pending.delete(message.id);
        }
      } catch {
        // partial/non-JSON line
      }
    }
  });

  const request = (method: string, params: unknown = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) => {
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  const notify = (method: string, params: unknown = {}): void => {
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  return { request, notify, close: () => child.kill() };
}

export async function connectMcp(args: string[]): Promise<McpClient> {
  const client = startMcp(args);
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0.0.0' },
  });
  client.notify('notifications/initialized');
  return client;
}

/** Parse a `tools/call` result into the JSON the tool returned. */
export function callTool(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content.map((part) => part.text).join('\n'));
}

/** Raw text of a `tools/call` result (for non-JSON tools like get_note). */
export function toolText(result: unknown): string {
  const content = (result as { content: Array<{ text: string }> }).content;
  return content.map((part) => part.text).join('\n');
}
