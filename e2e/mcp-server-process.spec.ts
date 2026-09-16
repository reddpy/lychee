import fs from 'fs';
import path from 'path';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { test, expect, PROJECT_ROOT } from './electron-app';
import { openLiveNote, syncSocketPath, waitForSyncSocket } from './mcp-live-helpers';
import { waitForContent, writeNote } from './vault-helpers';

/**
 * Drives the ACTUAL built MCP server binary over stdio JSON-RPC — the same way
 * Zed/Codex do — against a live app. Covers the CLI, the tool surface, the
 * server_info build stamp, and both the live and file-fallback write paths.
 */

const BUNDLE = path.join(PROJECT_ROOT, 'out', 'mcp', 'lychee-mcp.mjs');

function ensureBundle(): void {
  if (!fs.existsSync(BUNDLE)) {
    execFileSync('node', ['scripts/build-mcp.mjs'], { cwd: PROJECT_ROOT, stdio: 'ignore' });
  }
}

interface McpClient {
  request: (method: string, params?: unknown) => Promise<any>;
  notify: (method: string, params?: unknown) => void;
  close: () => void;
}

function startMcp(args: string[]): McpClient {
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

async function connectMcp(args: string[]): Promise<McpClient> {
  const client = startMcp(args);
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0.0.0' },
  });
  client.notify('notifications/initialized');
  return client;
}

function callTool(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content.map((part) => part.text).join('\n'));
}

test.use({ yjsFlag: true });

test.beforeAll(() => ensureBundle());

test.describe('MCP server process', () => {
  test('advertises tools and reports a build stamp', async ({ vaultDir, testDir }) => {
    const socket = syncSocketPath(testDir);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const tools = await client.request('tools/list');
      const names = tools.tools.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining(['append_to_note', 'update_note', 'get_note', 'server_info']),
      );

      const info = callTool(await client.request('tools/call', { name: 'server_info', arguments: {} }));
      // The build stamp is injected at bundle time — proves the running bundle,
      // not a stale process ('dev' would mean the define was dropped).
      expect(info.build).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(info.build).not.toBe('dev');
      expect(info.liveSyncEnabled).toBe(true);
      expect(info.vault).toBe(vaultDir);
    } finally {
      client.close();
    }
  });

  test('append_to_note edits the open note live', async ({ window, vaultDir, testDir }) => {
    const { docId, body } = await openLiveNote(window, 'MCP Process Live');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'append_to_note',
          arguments: { id: docId, text: 'written by the mcp process' },
        }),
      );
      expect(result).toMatchObject({ ok: true, live: true });
    } finally {
      client.close();
    }

    await expect(body).toContainText('written by the mcp process');
    await waitForContent(vaultDir, 'MCP Process Live.md', 'written by the mcp process');
  });

  test('get_note reads back what a live edit wrote', async ({ window, vaultDir, testDir }) => {
    const { docId } = await openLiveNote(window, 'MCP Read Back');
    const socket = syncSocketPath(testDir);
    await waitForSyncSocket(socket);

    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      await client.request('tools/call', {
        name: 'append_to_note',
        arguments: { id: docId, text: 'roundtrip value' },
      });
      await expect
        .poll(async () => {
          const result = await client.request('tools/call', {
            name: 'get_note',
            arguments: { id: docId },
          });
          const text = (result as { content: Array<{ text: string }> }).content[0].text;
          return text.includes('roundtrip value');
        })
        .toBe(true);
    } finally {
      client.close();
    }
  });

  test('falls back to the file when the note is not open', async ({ vaultDir, testDir }) => {
    writeNote(vaultDir, 'Offline Note.md', { id: 'offline-note', title: 'Offline Note' }, 'seed');
    const socket = syncSocketPath(testDir);

    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'append_to_note',
          arguments: { id: 'offline-note', text: 'appended offscreen' },
        }),
      );
      // No live doc: the file tool handles it (no `live: true`).
      expect(result.live).not.toBe(true);
      expect(result.ok).toBe(true);
    } finally {
      client.close();
    }

    await waitForContent(vaultDir, 'Offline Note.md', 'appended offscreen');
  });

  test('unknown note id reports not-found rather than crashing', async ({ vaultDir, testDir }) => {
    const socket = syncSocketPath(testDir);
    const client = await connectMcp([`--vault`, vaultDir, `--sync-socket`, socket]);
    try {
      const result = callTool(
        await client.request('tools/call', {
          name: 'append_to_note',
          arguments: { id: 'does-not-exist', text: 'nope' },
        }),
      );
      expect(result).toMatchObject({ ok: false, reason: 'note_not_found' });
    } finally {
      client.close();
    }
  });
});
